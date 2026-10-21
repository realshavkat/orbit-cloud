import { tx } from "../db.js";
import { ApiError, bad, cleanText, intParam, usernameProblem } from "../lib/validate.js";
import { audit, notify } from "../services/core.js";
import { awardBadge, revokeBadge, syncRoleBadges, badgeByKey } from "../services/badges.js";
import { processEvent, markFailed } from "../services/payments.js";
import { cards } from "../services/profiles.js";

const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };
const idParam = { params: { type: "object", properties: { id: UUID } } };
const reasonBody = (extra = {}, required = ["reason"]) => ({ type: "object", required, properties: { reason: { type: "string", minLength: 3, maxLength: 500 }, ...extra } });
const RARITIES = ["common", "rare", "epic", "legendary", "exclusive"];

async function rankOf(db, userId) {
  const { rows: [r] } = await db.query(
    "SELECT COALESCE(MAX(r.rank), 0) AS rank FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1", [userId]);
  return r.rank;
}

export default async function adminRoutes(app) {
  const db = app.db;
  const perm = (req, key) => app.perm(req, key);

  async function outrank(req, targetId) {
    if (targetId == req.auth.user.id) throw new ApiError(403, "not_on_self");
    const [mine, theirs] = await Promise.all([rankOf(db, req.auth.user.id), rankOf(db, targetId)]);
    if (mine <= theirs) throw new ApiError(403, "rank_too_low");
  }

  app.get("/me", async (req) => {
    app.user(req);
    const perms = [...(await req.auth.perms())];
    if (!perms.length) throw new ApiError(403, "forbidden");
    return { permissions: perms, roles: await req.auth.roles() };
  });

  app.get("/stats", async (req) => {
    await perm(req, "stats.read");
    const one = async (sql) => (await db.query(sql)).rows[0];
    const out = {
      users: await one(`SELECT COUNT(*) FILTER (WHERE status <> 'deleted')::int AS total,
        COUNT(*) FILTER (WHERE created_at > now() - interval '7 days' AND status <> 'deleted')::int AS new_7d,
        COUNT(*) FILTER (WHERE created_at > now() - interval '30 days' AND status <> 'deleted')::int AS new_30d,
        COUNT(*) FILTER (WHERE last_active_at > now() - interval '30 days' AND status = 'active')::int AS active_30d,
        COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL AND status <> 'deleted')::int AS verified,
        COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended FROM users`),
      badges: (await db.query(
        `SELECT b.key, b.name, b.color, b.icon, COUNT(ub.*)::int AS n FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.revoked_at IS NULL
          GROUP BY b.id ORDER BY n DESC, b.name`)).rows,
      reports_open: (await one("SELECT COUNT(*)::int AS n FROM reports WHERE status IN ('open', 'reviewing')")).n,
      appeals_pending: (await one("SELECT COUNT(*)::int AS n FROM moderation_actions WHERE appeal_status = 'pending'")).n,
      webhooks: await one(`SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'pending')::int AS pending FROM payment_webhook_events`),
      services: { database: true, mail: app.mailer.configured, donations: !!app.stripe },
      signups: (await db.query(
        `SELECT d::date AS day, COUNT(u.id)::int AS n FROM generate_series(current_date - 29, current_date, interval '1 day') d
           LEFT JOIN users u ON u.created_at >= d AND u.created_at < d + interval '1 day' AND u.status <> 'deleted'
          GROUP BY d ORDER BY d`)).rows,
      mods_pending: (await one("SELECT COUNT(*)::int AS n FROM mod_versions WHERE status = 'pending'")).n,
    };
    if ((await req.auth.perms()).has("donations.read")) {
      out.donations = await one(`SELECT COUNT(*) FILTER (WHERE status IN ('succeeded','partially_refunded','refunded'))::int AS confirmed,
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('succeeded','partially_refunded','refunded')), 0)::int AS gross_cents,
        COALESCE(SUM(amount_cents - refunded_cents) FILTER (WHERE status IN ('succeeded','partially_refunded')), 0)::int AS net_cents,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'disputed')::int AS disputed FROM donations`);
    }
    return out;
  });

  app.get("/users", async (req) => {
    await perm(req, "users.read");
    const q = String(req.query.q ?? "").trim();
    const canEmail = (await req.auth.perms()).has("users.read_email");
    const byEmail = canEmail && q.includes("@");
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.status, u.created_at, u.last_active_at, u.email_verified_at IS NOT NULL AS verified ${canEmail ? ", u.email" : ""},
              COALESCE((SELECT array_agg(r.key ORDER BY r.rank DESC) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles
         FROM users u
        WHERE $1 = '' OR ${/^[0-9a-f-]{36}$/i.test(q) ? "u.id = $1::uuid" : byEmail ? "u.email_normalized = lower($1)" : "u.username_lower LIKE lower($1) || '%'"}
        ORDER BY u.created_at DESC LIMIT 50`, [q]);
    return { users: rows };
  });

  app.get("/users/:id", { schema: idParam }, async (req) => {
    await perm(req, "users.read");
    const perms = await req.auth.perms();
    const { rows: [u] } = await db.query(
      `SELECT id, username, status, suspended_until, social_suspended_until, profile_hidden, created_at, last_active_at,
              email_verified_at ${perms.has("users.read_email") ? ", email" : ""} FROM users WHERE id = $1`, [req.params.id]);
    if (!u) throw new ApiError(404, "not_found");
    const q = async (sql) => (await db.query(sql, [u.id])).rows;
    return {
      user: u,
      roles: (await q("SELECT r.key, ur.granted_at FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.rank DESC")),
      badges: await q(`SELECT b.key, b.name, b.color, b.icon, b.official, ub.source, ub.awarded_at, ub.revoked_at, ub.revoke_reason
        FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = $1 ORDER BY ub.awarded_at DESC`),
      reports: await q("SELECT id, reason, status, details, created_at FROM reports WHERE target_type = 'user' AND target_id = $1 ORDER BY created_at DESC LIMIT 50"),
      moderation: await q("SELECT id, action, reason, until, appeal_status, appeal_text, created_at FROM moderation_actions WHERE user_id = $1 ORDER BY created_at DESC"),
      notes: perms.has("users.notes")
        ? await q("SELECT n.id, n.body, n.created_at, a.username AS author FROM admin_notes n LEFT JOIN users a ON a.id = n.author_id WHERE n.user_id = $1 ORDER BY n.created_at DESC")
        : null,
      sessions: (await q("SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()"))[0].n,
      history: perms.has("audit.read")
        ? await q("SELECT a.action, a.reason, a.created_at, x.username AS actor FROM admin_audit_logs a LEFT JOIN users x ON x.id = a.actor_id WHERE a.target_type = 'user' AND a.target_id = $1::text ORDER BY a.created_at DESC LIMIT 100")
        : null,
    };
  });

  app.post("/users/:id/suspend", { schema: { ...idParam, body: reasonBody({ until: { type: ["string", "null"], format: "date-time" } }) } }, async (req) => {
    await perm(req, "users.suspend");
    await outrank(req, req.params.id);
    const until = req.body.until ? new Date(req.body.until) : null;
    await tx(db, async c => {
      const { rowCount } = await c.query("UPDATE users SET status = 'suspended', suspended_until = $2 WHERE id = $1 AND status <> 'deleted'", [req.params.id, until]);
      if (!rowCount) throw new ApiError(404, "not_found");
      await c.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]);
      await c.query("INSERT INTO moderation_actions (moderator_id, user_id, action, reason, until) VALUES ($1, $2, 'suspend', $3, $4)",
        [req.auth.user.id, req.params.id, req.body.reason, until]);
      await audit(c, { actorId: req.auth.user.id, action: "user.suspend", targetType: "user", targetId: req.params.id, reason: req.body.reason, meta: { until }, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/users/:id/unsuspend", { schema: { ...idParam, body: reasonBody() } }, async (req) => {
    await perm(req, "users.suspend");
    await outrank(req, req.params.id);
    await tx(db, async c => {
      await c.query("UPDATE users SET status = 'active', suspended_until = NULL WHERE id = $1 AND status = 'suspended'", [req.params.id]);
      await c.query("INSERT INTO moderation_actions (moderator_id, user_id, action, reason) VALUES ($1, $2, 'unsuspend', $3)", [req.auth.user.id, req.params.id, req.body.reason]);
      await audit(c, { actorId: req.auth.user.id, action: "user.unsuspend", targetType: "user", targetId: req.params.id, reason: req.body.reason, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/users/:id/revoke-sessions", { schema: { ...idParam, body: reasonBody() } }, async (req) => {
    await perm(req, "users.sessions");
    await outrank(req, req.params.id);
    await tx(db, async c => {
      await c.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]);
      await audit(c, { actorId: req.auth.user.id, action: "user.sessions_revoke", targetType: "user", targetId: req.params.id, reason: req.body.reason, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/users/:id/reset-mfa", { schema: { ...idParam, body: reasonBody() } }, async (req) => {
    await perm(req, "users.sessions");
    app.recentAuth(req);
    await outrank(req, req.params.id);
    await tx(db, async c => {
      await c.query("DELETE FROM user_mfa_methods WHERE user_id = $1", [req.params.id]);
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [req.params.id]);
      await c.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]);
      await notify(c, req.params.id, "security", { what: "mfa_reset" });
      await audit(c, { actorId: req.auth.user.id, action: "user.mfa_reset", targetType: "user", targetId: req.params.id, reason: req.body.reason, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/users/:id/username", { schema: { ...idParam, body: reasonBody({ username: { type: "string", maxLength: 24 } }, ["username", "reason"]) } }, async (req) => {
    await perm(req, "users.rename");
    await outrank(req, req.params.id);
    const p = usernameProblem(req.body.username);
    if (p) throw bad(p);
    await tx(db, async c => {
      const { rows: [u] } = await c.query("SELECT username FROM users WHERE id = $1 AND status <> 'deleted'", [req.params.id]);
      if (!u) throw new ApiError(404, "not_found");
      try {
        await c.query("UPDATE users SET username = $2, updated_at = now() WHERE id = $1", [req.params.id, req.body.username]);
      } catch (e) {
        if (e.code == "23505") throw new ApiError(409, "username_taken");
        throw e;
      }
      await audit(c, { actorId: req.auth.user.id, action: "user.rename", targetType: "user", targetId: req.params.id, reason: req.body.reason,
        meta: { from: u.username, to: req.body.username }, ip: req.ip });
      await notify(c, req.params.id, "security", { what: "username_changed", username: req.body.username });
    });
    return { ok: true };
  });

  app.post("/users/:id/notes", { schema: { ...idParam, body: { type: "object", required: ["body"], properties: { body: { type: "string", maxLength: 2000 } } } } }, async (req) => {
    await perm(req, "users.notes");
    const body = cleanText(req.body.body, 2000);
    if (!body) throw bad("body_required");
    await db.query("INSERT INTO admin_notes (user_id, author_id, body) VALUES ($1, $2, $3)", [req.params.id, req.auth.user.id, body]);
    return { ok: true };
  });

  app.post("/users/:id/roles", { schema: { ...idParam, body: reasonBody({ role: { enum: ["moderator", "administrator"] }, action: { enum: ["grant", "revoke"] } }, ["role", "action", "reason"]) } },
    async (req) => {
      const { role, action, reason } = req.body;
      await perm(req, role == "administrator" ? "roles.administrators" : "roles.moderators");
      app.recentAuth(req);
      await outrank(req, req.params.id);
      await tx(db, async c => {
        const { rows: [u] } = await c.query("SELECT status, email_verified_at FROM users WHERE id = $1", [req.params.id]);
        if (!u || u.status == "deleted") throw new ApiError(404, "not_found");
        if (action == "grant" && !u.email_verified_at) throw new ApiError(409, "email_unverified");
        if (action == "grant") {
          await c.query("INSERT INTO user_roles (user_id, role_id, granted_by) SELECT $1, id, $3 FROM roles WHERE key = $2 ON CONFLICT DO NOTHING",
            [req.params.id, role, req.auth.user.id]);
        } else {
          await c.query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE key = $2)", [req.params.id, role]);
        }
        await syncRoleBadges(c, req.params.id);
        await audit(c, { actorId: req.auth.user.id, action: `role.${action}`, targetType: "user", targetId: req.params.id, reason, meta: { role }, ip: req.ip });
      });
      return { ok: true };
    });

  app.post("/users/:id/badges", { schema: { ...idParam, body: reasonBody({ badge: { type: "string" }, action: { enum: ["award", "revoke"] } }, ["badge", "action", "reason"]) } },
    async (req) => {
      await perm(req, "badges.award");
      const badge = await badgeByKey(db, req.body.badge);
      if (!badge) throw new ApiError(404, "badge_not_found");
      const official = (await req.auth.perms()).has("badges.official");
      if (badge.official) {
        if (!official) throw new ApiError(403, "badge_official");
        app.recentAuth(req);
      }
      await tx(db, async c => {
        const { rows } = await c.query("SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", [req.params.id]);
        if (!rows.length) throw new ApiError(404, "not_found");
        const args = { userId: req.params.id, badgeKey: badge.key, source: "manual", actorId: req.auth.user.id, reason: req.body.reason, allowOfficial: official };
        const done = req.body.action == "award" ? await awardBadge(c, args) : await revokeBadge(c, args);
        if (!done) throw new ApiError(409, req.body.action == "award" ? "already_has_badge" : "badge_not_held");
        await audit(c, { actorId: req.auth.user.id, action: `badge.${req.body.action}`, targetType: "user", targetId: req.params.id,
          reason: req.body.reason, meta: { badge: badge.key }, ip: req.ip });
      });
      return { ok: true };
    });

  app.get("/badges", async (req) => {
    await perm(req, "badges.award");
    const { rows } = await db.query(
      `SELECT b.*, (SELECT COUNT(*)::int FROM user_badges ub WHERE ub.badge_id = b.id AND ub.revoked_at IS NULL) AS holders,
              (SELECT json_agg(json_build_object('type', r.rule_type, 'params', r.params, 'active', r.active)) FROM badge_rules r WHERE r.badge_id = b.id) AS rules
         FROM badges b ORDER BY b.official DESC, b.category_key, b.name`);
    const { rows: categories } = await db.query("SELECT key, name FROM badge_categories ORDER BY sort");
    return { badges: rows.map(({ id, ...b }) => b), categories };
  });

  const badgeFields = {
    name: { type: "string", minLength: 2, maxLength: 40 }, description: { type: "string", maxLength: 200 }, icon: { type: "string", pattern: "^[a-z0-9-]{2,40}$" },
    category_key: { type: "string" }, rarity: { enum: RARITIES }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, public: { type: "boolean" },
    manual_award: { type: "boolean" }, status: { enum: ["active", "disabled", "retired"] }, permanent: { type: "boolean" },
    duration_days: { type: ["integer", "null"], minimum: 1, maximum: 3650 }, condition: { type: "string", maxLength: 300 },
  };

  app.post("/badges", { schema: { body: { type: "object", additionalProperties: false, required: ["key", "name", "description", "icon", "category_key", "rarity", "color"],
    properties: { key: { type: "string", pattern: "^[a-z0-9_]{2,40}$" }, official: { type: "boolean" }, ...badgeFields } } } }, async (req, reply) => {
    await perm(req, "badges.manage");
    const b = req.body;
    if (b.official) {
      await perm(req, "badges.official");
      app.recentAuth(req);
    }
    if (b.category_key == "support" && !(await req.auth.perms()).has("donations.settings")) throw new ApiError(403, "forbidden");
    try {
      await tx(db, async c => {
        await c.query(
          `INSERT INTO badges (key, name, description, icon, category_key, rarity, color, official, manual_award, public, permanent, duration_days, condition)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [b.key, cleanText(b.name, 40), cleanText(b.description, 200) ?? "", b.icon, b.category_key, b.rarity, b.color, !!b.official,
            b.manual_award ?? true, b.public ?? true, b.permanent ?? true, b.duration_days ?? null, cleanText(b.condition ?? "", 300) ?? ""]);
        await audit(c, { actorId: req.auth.user.id, action: "badge.create", targetType: "badge", targetId: b.key, ip: req.ip });
      });
    } catch (e) {
      if (e.code == "23505") throw new ApiError(409, "badge_exists");
      if (e.code == "23503") throw bad("category_invalid");
      throw e;
    }
    return reply.code(201).send({ ok: true });
  });

  app.patch("/badges/:key", { schema: { body: { type: "object", additionalProperties: false, properties: badgeFields } } }, async (req) => {
    await perm(req, "badges.manage");
    const badge = await badgeByKey(db, req.params.key);
    if (!badge) throw new ApiError(404, "badge_not_found");
    if (badge.official || badge.protected) {
      await perm(req, "badges.official");
      app.recentAuth(req);
    }
    if (badge.category_key == "support") await perm(req, "donations.settings");
    if (badge.protected && (req.body.status && req.body.status != "active" || req.body.manual_award)) throw new ApiError(403, "badge_protected");
    const b = { ...req.body };
    if ("name" in b) b.name = cleanText(b.name, 40);
    if ("description" in b) b.description = cleanText(b.description, 200) ?? "";
    if ("condition" in b) b.condition = cleanText(b.condition, 300) ?? "";
    const keys = Object.keys(b);
    if (!keys.length) return { ok: true };
    await tx(db, async c => {
      await c.query(`UPDATE badges SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [badge.id, ...keys.map(k => b[k])]);
      await audit(c, { actorId: req.auth.user.id, action: "badge.update", targetType: "badge", targetId: badge.key, meta: b, ip: req.ip });
    });
    return { ok: true };
  });

  app.get("/badges/:key/holders", async (req) => {
    await perm(req, "badges.award");
    const badge = await badgeByKey(db, req.params.key);
    if (!badge) throw new ApiError(404, "badge_not_found");
    const { rows } = await db.query(
      `SELECT ub.id, ub.source, ub.awarded_at, u.id AS user_id, u.username FROM user_badges ub JOIN users u ON u.id = ub.user_id
        WHERE ub.badge_id = $1 AND ub.revoked_at IS NULL ORDER BY ub.awarded_at DESC LIMIT 200`, [badge.id]);
    const { rows: history } = await db.query(
      `SELECT e.action, e.source, e.reason, e.created_at, u.username, a.username AS actor FROM badge_award_events e
         LEFT JOIN users u ON u.id = e.user_id LEFT JOIN users a ON a.id = e.actor_id WHERE e.badge_id = $1 ORDER BY e.created_at DESC LIMIT 200`, [badge.id]);
    return { holders: rows, history };
  });

  app.get("/donations", async (req) => {
    await perm(req, "donations.read");
    const status = req.query.status || null;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const { rows } = await db.query(
      `SELECT d.id, d.amount_cents, d.refunded_cents, d.currency, d.status, d.recurring, d.purpose, d.public_anonymous, d.checkout_ref, d.payment_ref,
              d.invoice_ref, d.created_at, d.confirmed_at, u.username FROM donations d LEFT JOIN users u ON u.id = d.user_id
        WHERE ($1::text IS NULL OR d.status = $1) AND ($2::timestamptz IS NULL OR d.created_at >= $2) AND ($3::timestamptz IS NULL OR d.created_at < $3)
        ORDER BY d.created_at DESC LIMIT $4`, [status, from, to, intParam(req.query.limit, 100, 1, 500)]);
    const { rows: refunds } = await db.query("SELECT donation_id, provider_refund_id, amount_cents, status, created_at FROM refunds ORDER BY created_at DESC LIMIT 100");
    return { donations: rows, refunds };
  });

  app.get("/webhooks", async (req) => {
    await perm(req, "donations.read");
    const { rows } = await db.query(
      `SELECT id, type, status, error, attempts, received_at, processed_at FROM payment_webhook_events
        WHERE ($1::text IS NULL OR status = $1) ORDER BY received_at DESC LIMIT 200`, [req.query.status || null]);
    return { events: rows };
  });

  app.post("/webhooks/:id/retry", async (req) => {
    await perm(req, "donations.settings");
    const id = String(req.params.id);
    try {
      const status = await processEvent(db, id);
      await audit(db, { actorId: req.auth.user.id, action: "donation.webhook_retry", targetType: "webhook", targetId: id, meta: { status }, ip: req.ip });
      return { status };
    } catch (e) {
      await markFailed(db, id, e);
      throw new ApiError(500, "processing_failed");
    }
  });

  app.get("/donations/settings", async (req) => {
    await perm(req, "donations.read");
    const { rows: settings } = await db.query("SELECT key, value FROM app_settings WHERE key IN ('donation_amounts', 'donation_currency', 'early_supporter_until')");
    const { rows: tiers } = await db.query("SELECT key, badge_key, threshold_cents FROM supporter_tiers ORDER BY sort");
    return { ...Object.fromEntries(settings.map(s => [s.key, s.value])), tiers };
  });

  app.put("/donations/settings", { schema: { body: { type: "object", additionalProperties: false, properties: {
    donation_amounts: { type: "array", minItems: 1, maxItems: 6, items: { type: "integer", minimum: 100, maximum: 100000 } },
    early_supporter_until: { type: ["string", "null"], format: "date-time" },
    tiers: { type: "object", additionalProperties: { type: "integer", minimum: 100, maximum: 10000000 } },
  } } } }, async (req) => {
    await perm(req, "donations.settings");
    app.recentAuth(req);
    const b = req.body;
    await tx(db, async c => {
      const set = async (key, value) => c.query(
        "INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
        [key, JSON.stringify(value), req.auth.user.id]);
      if (b.donation_amounts) await set("donation_amounts", b.donation_amounts);
      if ("early_supporter_until" in b) await set("early_supporter_until", b.early_supporter_until);
      for (const [key, cents] of Object.entries(b.tiers ?? {})) {
        const { rowCount } = await c.query("UPDATE supporter_tiers SET threshold_cents = $2 WHERE key = $1", [key, cents]);
        if (!rowCount) throw bad("tier_invalid");
      }
      await audit(c, { actorId: req.auth.user.id, action: "donation.settings", meta: b, ip: req.ip });
    });
    return { ok: true };
  });

  app.get("/reports", async (req) => {
    await perm(req, "reports.read");
    const status = req.query.status || "open";
    const { rows } = await db.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.resolution, r.created_at, r.updated_at,
              rep.username AS reporter, h.username AS handled_by,
              CASE WHEN r.target_type = 'user' THEN (SELECT username FROM users WHERE id = r.target_id)
                   WHEN r.target_type = 'thread' THEN (SELECT title FROM forum_threads WHERE id = r.target_id)
                   WHEN r.target_type = 'post' THEN (SELECT left(body, 80) FROM forum_posts WHERE id = r.target_id)
                   ELSE (SELECT title FROM site_collections WHERE id = r.target_id) END AS target_label,
              CASE WHEN r.target_type = 'post' THEN (SELECT thread_id FROM forum_posts WHERE id = r.target_id) WHEN r.target_type = 'thread' THEN r.target_id END AS thread_id
         FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users h ON h.id = r.handled_by
        WHERE r.status = $1 ORDER BY r.created_at LIMIT 200`, [status]);
    return { reports: rows };
  });

  app.post("/reports/:id", { schema: { ...idParam, body: { type: "object", required: ["status"], properties: {
    status: { enum: ["reviewing", "resolved", "dismissed"] }, resolution: { type: ["string", "null"], maxLength: 500 } } } } }, async (req) => {
    await perm(req, "reports.handle");
    await tx(db, async c => {
      const { rows: [r] } = await c.query(
        "UPDATE reports SET status = $2, resolution = $3, handled_by = $4, updated_at = now() WHERE id = $1 RETURNING reporter_id",
        [req.params.id, req.body.status, cleanText(req.body.resolution ?? null, 500), req.auth.user.id]);
      if (!r) throw new ApiError(404, "not_found");
      if (r.reporter_id && req.body.status != "reviewing") await notify(c, r.reporter_id, "report_update", { report_id: req.params.id, status: req.body.status });
      await audit(c, { actorId: req.auth.user.id, action: `report.${req.body.status}`, targetType: "report", targetId: req.params.id, reason: req.body.resolution, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/moderation", { schema: { body: reasonBody({
    user_id: UUID, action: { enum: ["warn", "suspend_social", "hide_profile", "unhide_profile", "hide_collection"] },
    until: { type: ["string", "null"], format: "date-time" }, report_id: { type: ["string", "null"] }, collection_id: { type: ["string", "null"] },
  }, ["user_id", "action", "reason"]) } }, async (req) => {
    await perm(req, "moderation.act");
    const { user_id: userId, action, reason } = req.body;
    await outrank(req, userId);
    const until = req.body.until ? new Date(req.body.until) : null;
    if (action == "suspend_social" && !until) throw bad("until_required");
    await tx(db, async c => {
      if (action == "suspend_social") await c.query("UPDATE users SET social_suspended_until = $2 WHERE id = $1", [userId, until]);
      if (action == "hide_profile") await c.query("UPDATE users SET profile_hidden = true WHERE id = $1", [userId]);
      if (action == "unhide_profile") await c.query("UPDATE users SET profile_hidden = false WHERE id = $1", [userId]);
      if (action == "hide_collection") {
        const { rowCount } = await c.query("UPDATE site_collections SET hidden = true WHERE id = $1 AND user_id = $2", [req.body.collection_id, userId]);
        if (!rowCount) throw new ApiError(404, "not_found");
      }
      await c.query("INSERT INTO moderation_actions (moderator_id, user_id, action, reason, until, report_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [req.auth.user.id, userId, action, reason, until, req.body.report_id || null]);
      await notify(c, userId, "moderation", { action, reason, until });
      await audit(c, { actorId: req.auth.user.id, action: `moderation.${action}`, targetType: "user", targetId: userId, reason, meta: { until }, ip: req.ip });
    });
    return { ok: true };
  });

  app.get("/appeals", async (req) => {
    await perm(req, "reports.handle");
    const { rows } = await db.query(
      `SELECT m.id, m.action, m.reason, m.until, m.appeal_text, m.created_at, u.username, u.id AS user_id
         FROM moderation_actions m JOIN users u ON u.id = m.user_id WHERE m.appeal_status = 'pending' ORDER BY m.created_at`);
    return { appeals: rows };
  });

  app.post("/appeals/:id", { schema: { ...idParam, body: reasonBody({ decision: { enum: ["accepted", "rejected"] } }, ["decision", "reason"]) } }, async (req) => {
    await perm(req, "reports.handle");
    await tx(db, async c => {
      const { rows: [m] } = await c.query("UPDATE moderation_actions SET appeal_status = $2 WHERE id = $1 AND appeal_status = 'pending' RETURNING *",
        [req.params.id, req.body.decision]);
      if (!m) throw new ApiError(404, "not_found");
      await outrank(req, m.user_id);
      if (req.body.decision == "accepted") {
        if (m.action == "suspend") await c.query("UPDATE users SET status = 'active', suspended_until = NULL WHERE id = $1 AND status = 'suspended'", [m.user_id]);
        if (m.action == "suspend_social") await c.query("UPDATE users SET social_suspended_until = NULL WHERE id = $1", [m.user_id]);
        if (m.action == "hide_profile") await c.query("UPDATE users SET profile_hidden = false WHERE id = $1", [m.user_id]);
      }
      await notify(c, m.user_id, "moderation", { appeal: req.body.decision });
      await audit(c, { actorId: req.auth.user.id, action: `appeal.${req.body.decision}`, targetType: "user", targetId: m.user_id, reason: req.body.reason, ip: req.ip });
    });
    return { ok: true };
  });

  app.get("/audit", async (req) => {
    await perm(req, "audit.read");
    const before = req.query.before ? new Date(req.query.before) : null;
    const { rows } = await db.query(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.reason, a.meta, a.ip, a.created_at, x.username AS actor
         FROM admin_audit_logs a LEFT JOIN users x ON x.id = a.actor_id
        WHERE ($1::timestamptz IS NULL OR a.created_at < $1) AND ($2::text IS NULL OR a.action LIKE $2 || '%')
        ORDER BY a.created_at DESC LIMIT 100`, [before, req.query.action || null]);
    return { entries: rows };
  });

  app.get("/staff", async (req) => {
    await perm(req, "users.read");
    const { rows } = await db.query(
      `SELECT DISTINCT ON (u.id) u.id, r.key AS role FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
        WHERE r.key IN ('owner', 'administrator', 'moderator') ORDER BY u.id, r.rank DESC`);
    const c = await cards(db, rows.map(r => r.id));
    return { staff: c.map(x => ({ ...x, role: rows.find(r => r.id == x.id).role })) };
  });

}
