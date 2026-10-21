import { ApiError, cleanText, bad } from "../lib/validate.js";
import { getSetting, audit } from "../services/core.js";
import { createCheckout } from "../services/payments.js";
import { betaSettings, betaAccess, hasBeta, syncBetaBadge } from "../services/beta.js";
import { tx } from "../db.js";

export default async function betaRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    const s = await betaSettings(db);
    const access = req.auth ? await betaAccess(db, req.auth.user.id) : null;
    return { ...s, currency: await getSetting(db, "donation_currency", "eur"), payments: !!app.stripe, owned: !!(access && (access.paid || access.granted)), granted: !!access?.granted };
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
}

export async function betaAdminRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    await app.perm(req, "beta.grant");
    const { rows: [n] } = await db.query(
      `SELECT (SELECT COUNT(DISTINCT user_id) FROM donations WHERE purpose = 'beta' AND status IN ('succeeded', 'partially_refunded'))::int AS paid,
              (SELECT COUNT(*) FROM beta_grants WHERE revoked_at IS NULL)::int AS granted`);
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

  app.get("/users/:id", async (req) => {
    await app.perm(req, "users.read");
    return betaAccess(db, req.params.id);
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
      await syncBetaBadge(c, u.id);
      await audit(c, { actorId: req.auth.user.id, action: `beta.${req.body.action}`, targetType: "user", targetId: u.id, reason, ip: req.ip });
    });
    return betaAccess(db, req.params.id);
  });
}
