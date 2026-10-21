import { ApiError, cleanText, bad } from "../lib/validate.js";
import { getSetting, audit } from "../services/core.js";
import { createCheckout } from "../services/payments.js";
import { betaSettings, betaAccess, hasBeta, syncBeta, userKey, checkKey, createKey, openKey } from "../services/beta.js";
import { tx } from "../db.js";

export default async function betaRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    const s = await betaSettings(db);
    const access = req.auth ? await betaAccess(db, req.auth.user.id) : null;
    const key = req.auth ? await userKey(db, req.auth.user.id) : null;
    return {
      ...s, currency: await getSetting(db, "donation_currency", "eur"), payments: !!app.stripe,
      owned: !!(access && (access.paid || access.granted)), granted: !!access?.granted,
      key: key && { key: key.key, devices: key.devices, max_devices: key.max_devices, created_at: key.created_at },
    };
  });

  app.post("/checkout", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    const user = app.user(req, { verified: true });
    if (!app.stripe) throw new ApiError(503, "donations_not_configured");
    const s = await betaSettings(db);
    if (!s.paywall) throw new ApiError(409, "beta_free");
    if (await hasBeta(db, user.id)) throw new ApiError(409, "beta_owned");
    const currency = await getSetting(db, "donation_currency", "eur");
    const url = await createCheckout(app.stripe, db, app.cfg, { user, amountCents: s.price_cents, recurring: false, anonymous: true, currency, purpose: "beta" });
    return { url };
  });
}

export async function licenseRoutes(app) {
  const db = app.db;

  app.get("/", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const user = app.user(req, { mfa: false });
    const s = await betaSettings(db);
    const staff = (await req.auth.perms()).size > 0;
    const active = !s.paywall || staff || (await hasBeta(db, user.id));
    return { required: s.paywall, active, username: user.username };
  });

  app.post("/activate", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    schema: { body: { type: "object", required: ["key"], properties: { key: { type: "string", maxLength: 64 }, device: { type: "string", maxLength: 64 } } } } }, async (req, reply) => {
    const s = await betaSettings(db);
    const r = await checkKey(db, req.body.key, req.body.device);
    if (r.status != 200) {
      if (!s.paywall) return { active: true, required: false, username: null };
      throw new ApiError(r.status, r.error, undefined, r.max ? { max: r.max } : undefined);
    }
    return r.body;
  });
}

export async function betaAdminRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    await app.perm(req, "beta.grant");
    const { rows: [n] } = await db.query(
      `SELECT (SELECT COUNT(DISTINCT user_id) FROM donations WHERE purpose = 'beta' AND status IN ('succeeded', 'partially_refunded'))::int AS paid,
              (SELECT COUNT(*) FROM beta_grants WHERE revoked_at IS NULL)::int AS granted,
              (SELECT COUNT(*) FROM beta_keys WHERE revoked_at IS NULL)::int AS keys,
              (SELECT COUNT(*) FROM beta_activations a JOIN beta_keys k ON k.id = a.key_id WHERE k.revoked_at IS NULL)::int AS devices`);
    return { ...(await betaSettings(db)), ...n };
  });

  app.put("/", { schema: { body: { type: "object", required: ["paywall", "price_cents"], properties: {
    paywall: { type: "boolean" }, price_cents: { type: "integer", minimum: 100, maximum: 10000 } } } } }, async (req) => {
    await app.perm(req, "settings.manage");
    const value = { paywall: req.body.paywall, price_cents: req.body.price_cents };
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by) VALUES ('beta', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [value, req.auth.user.id]);
    await audit(db, { actorId: req.auth.user.id, action: "beta.settings", meta: value, ip: req.ip });
    return value;
  });

  app.get("/keys", async (req) => {
    await app.perm(req, "beta.grant");
    const { rows } = await db.query(
      `SELECT k.id, k.key_enc, k.last4, k.source, k.note, k.max_devices, k.created_at, k.revoked_at, u.username, u.id AS user_id, c.username AS created_by,
              (SELECT COUNT(*)::int FROM beta_activations a WHERE a.key_id = k.id) AS devices,
              (SELECT MAX(last_seen) FROM beta_activations a WHERE a.key_id = k.id) AS last_seen
         FROM beta_keys k LEFT JOIN users u ON u.id = k.user_id LEFT JOIN users c ON c.id = k.created_by
        ORDER BY k.created_at DESC LIMIT 300`);
    return { keys: rows.map(({ key_enc, ...k }) => ({ ...k, key: k.source == "manual" && !k.revoked_at ? openKey(key_enc) : null })) };
  });

  app.post("/keys", { schema: { body: { type: "object", properties: {
    count: { type: "integer", minimum: 1, maximum: 50 }, note: { type: "string", maxLength: 200 }, max_devices: { type: "integer", minimum: 1, maximum: 20 } } } } }, async (req) => {
    await app.perm(req, "beta.grant");
    const note = cleanText(req.body.note ?? "", 200);
    const keys = await tx(db, async c => {
      const out = [];
      for (let i = 0; i < (req.body.count ?? 1); i++) {
        out.push((await createKey(c, { source: "manual", note, createdBy: req.auth.user.id, maxDevices: req.body.max_devices ?? 3 })).key);
      }
      await audit(c, { actorId: req.auth.user.id, action: "beta.keys", reason: note, meta: { count: out.length }, ip: req.ip });
      return out;
    });
    return { keys };
  });

  app.post("/keys/:id/revoke", { schema: { body: { type: "object", required: ["reason"], properties: { reason: { type: "string", maxLength: 500 } } } } }, async (req) => {
    await app.perm(req, "beta.grant");
    const reason = cleanText(req.body.reason, 500);
    if (!reason || reason.length < 3) throw bad("reason_required");
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rowCount } = await db.query("UPDATE beta_keys SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL", [req.params.id, reason]);
    if (!rowCount) throw new ApiError(404, "not_found");
    await audit(db, { actorId: req.auth.user.id, action: "beta.key_revoke", targetType: "beta_key", targetId: req.params.id, reason, ip: req.ip });
    return { ok: true };
  });

  app.post("/keys/:id/reset-devices", async (req) => {
    await app.perm(req, "beta.grant");
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new ApiError(404, "not_found");
    await db.query("DELETE FROM beta_activations WHERE key_id = $1", [req.params.id]);
    await audit(db, { actorId: req.auth.user.id, action: "beta.key_reset_devices", targetType: "beta_key", targetId: req.params.id, ip: req.ip });
    return { ok: true };
  });

  app.get("/users/:id", async (req) => {
    await app.perm(req, "users.read");
    const key = await userKey(db, req.params.id);
    return { ...(await betaAccess(db, req.params.id)), key: key && { id: key.id, last4: key.last4, devices: key.devices, max_devices: key.max_devices } };
  });

  app.post("/users/:id", { schema: { body: { type: "object", required: ["action", "reason"], properties: {
    action: { enum: ["grant", "revoke"] }, reason: { type: "string", maxLength: 500 } } } } }, async (req) => {
    await app.perm(req, "beta.grant");
    const reason = cleanText(req.body.reason, 500);
    if (!reason || reason.length < 3) throw bad("reason_required");
    await tx(db, async c => {
      const { rows: [u] } = await c.query("SELECT id FROM users WHERE id = $1 AND status <> 'deleted'", [req.params.id]);
      if (!u) throw new ApiError(404, "not_found");
      if (req.body.action == "grant") {
        await c.query("INSERT INTO beta_grants (user_id, granted_by, reason) VALUES ($1, $2, $3) ON CONFLICT (user_id) WHERE revoked_at IS NULL DO NOTHING",
          [u.id, req.auth.user.id, reason]);
      } else {
        await c.query("UPDATE beta_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE user_id = $1 AND revoked_at IS NULL",
          [u.id, req.auth.user.id, reason]);
      }
      await syncBeta(c, u.id);
      await audit(c, { actorId: req.auth.user.id, action: `beta.${req.body.action}`, targetType: "user", targetId: u.id, reason, ip: req.ip });
    });
    const key = await userKey(db, req.params.id);
    return { ...(await betaAccess(db, req.params.id)), key: key && { id: key.id, last4: key.last4, devices: key.devices, max_devices: key.max_devices } };
  });
}
