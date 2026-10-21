// /api/v1/me: the signed-in member's own account, profile, privacy and security.
import { createHash, randomBytes } from "node:crypto";
import { tx } from "../db.js";
import { ApiError, bad, cleanText, cleanUrl, emailProblem, normalizeEmail, passwordProblem, INTEREST_RE, THEME_COLORS, usernameProblem } from "../lib/validate.js";
import { hashPassword, verifyPassword, encrypt, base32Encode, newRecoveryCodes, hashRecoveryCode, totpVerify, decrypt } from "../lib/crypto.js";
import { publicBadgesOf } from "../services/badges.js";
import { audit } from "../services/core.js";
import { sendVerification, securityMail, clearSessionCookie } from "./auth.js";

const PRIVACY_KEYS = ["profile_public", "show_badges", "show_activity", "show_collections", "show_interests", "show_sites", "show_friend_count",
  "allow_friend_requests", "discoverable", "share_sites_enabled", "show_stats", "social_disabled"];
const SECTIONS = ["badges", "sites", "collections", "interests", "links"];

// Real image type from the first bytes, never from the file name or the browser.
export function sniffImage(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] == 0xff && buf[1] == 0xd8 && buf[2] == 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) == "RIFF" && buf.toString("ascii", 8, 12) == "WEBP") return "image/webp";
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

export default async function meRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    const user = app.user(req, { mfa: false });
    const { rows: [u] } = await db.query(
      `SELECT u.id, u.username, u.email, u.email_verified_at, u.created_at, u.status,
              p.display_name, p.bio, p.theme_color, p.links, p.section_order, p.avatar_media_id, p.banner_media_id,
              EXISTS (SELECT 1 FROM user_mfa_methods m WHERE m.user_id = u.id AND m.confirmed_at IS NOT NULL) AS mfa_enabled
         FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`, [user.id]);
    const { rows: privacy } = await db.query("SELECT * FROM user_privacy_settings WHERE user_id = $1", [user.id]);
    const { rows: prefs } = await db.query("SELECT notify, email_security, email_news FROM user_preferences WHERE user_id = $1", [user.id]);
    const { rows: interests } = await db.query("SELECT interest FROM user_interests WHERE user_id = $1 ORDER BY interest", [user.id]);
    return {
      ...u,
      verified: !!u.email_verified_at,
      mfa_pending: !req.auth.session.mfaPassed,
      roles: await req.auth.roles(),
      permissions: [...(await req.auth.perms())],
      privacy: privacy[0],
      preferences: prefs[0],
      interests: interests.map(i => i.interest),
      badges: await publicBadgesOf(db, user.id),
    };
  });

  app.patch("/profile", { schema: { body: { type: "object", additionalProperties: false, properties: {
    display_name: { type: ["string", "null"] }, bio: { type: ["string", "null"] }, theme_color: { type: "string" },
    links: { type: "array", maxItems: 6, items: { type: "object", required: ["url"], properties: { label: { type: "string" }, url: { type: "string" } } } },
    section_order: { type: "array", maxItems: 5, items: { type: "string" } },
    interests: { type: "array", maxItems: 12, items: { type: "string" } },
  } } } }, async (req) => {
    const user = app.user(req);
    const b = req.body;
    const set = {};
    if ("display_name" in b) set.display_name = cleanText(b.display_name, 40);
    if ("bio" in b) set.bio = cleanText(b.bio, 400);
    if ("theme_color" in b) {
      if (!THEME_COLORS.includes(b.theme_color)) throw bad("theme_invalid");
      set.theme_color = b.theme_color;
    }
    if ("links" in b) set.links = JSON.stringify(b.links.map(l => ({ label: cleanText(l.label ?? "", 30), url: cleanUrl(l.url) })));
    if ("section_order" in b) {
      if (new Set(b.section_order).size != b.section_order.length || b.section_order.some(s => !SECTIONS.includes(s))) throw bad("sections_invalid");
      set.section_order = JSON.stringify([...b.section_order, ...SECTIONS.filter(s => !b.section_order.includes(s))]);
    }
    await tx(db, async c => {
      const keys = Object.keys(set);
      if (keys.length) {
        await c.query(`UPDATE user_profiles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE user_id = $1`,
          [user.id, ...keys.map(k => set[k])]);
      }
      if (b.interests) {
        const list = [...new Set(b.interests.map(i => String(i).trim().toLowerCase()))];
        if (list.some(i => !INTEREST_RE.test(i))) throw bad("interest_invalid");
        await c.query("DELETE FROM user_interests WHERE user_id = $1", [user.id]);
        for (const i of list) await c.query("INSERT INTO user_interests (user_id, interest) VALUES ($1, $2)", [user.id, i]);
      }
    });
    return { ok: true };
  });

  // Avatar or banner: PNG, JPEG, WebP or GIF, checked by content, 2 MB / 4 MB at most.
  app.post("/media/:kind", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => {
    const user = app.user(req, { verified: true });
    const kind = req.params.kind;
    if (!["avatar", "banner"].includes(kind)) throw bad("kind_invalid");
    const file = await req.file();
    if (!file) throw bad("file_missing");
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > (kind == "avatar" ? 2 : 4) * 1024 * 1024) throw bad("file_too_large");
    const mime = sniffImage(buf);
    if (!mime) throw bad("file_type");
    const id = await tx(db, async c => {
      const { rows: [old] } = await c.query(`SELECT ${kind}_media_id AS id FROM user_profiles WHERE user_id = $1`, [user.id]);
      const { rows: [m] } = await c.query(
        "INSERT INTO media (owner_id, kind, mime, bytes, size, sha256) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [user.id, kind, mime, buf, buf.length, createHash("sha256").update(buf).digest("hex")]);
      await c.query(`UPDATE user_profiles SET ${kind}_media_id = $2, updated_at = now() WHERE user_id = $1`, [user.id, m.id]);
      if (old.id) await c.query("DELETE FROM media WHERE id = $1", [old.id]);
      return m.id;
    });
    return { ok: true, id };
  });

  app.delete("/media/:kind", async (req) => {
    const user = app.user(req);
    const kind = req.params.kind;
    if (!["avatar", "banner"].includes(kind)) throw bad("kind_invalid");
    await tx(db, async c => {
      const { rows: [old] } = await c.query(`SELECT ${kind}_media_id AS id FROM user_profiles WHERE user_id = $1`, [user.id]);
      await c.query(`UPDATE user_profiles SET ${kind}_media_id = NULL WHERE user_id = $1`, [user.id]);
      if (old.id) await c.query("DELETE FROM media WHERE id = $1", [old.id]);
    });
    return { ok: true };
  });

  app.patch("/privacy", { schema: { body: { type: "object", additionalProperties: false,
    properties: Object.fromEntries(PRIVACY_KEYS.map(k => [k, { type: "boolean" }])) } } }, async (req) => {
    const user = app.user(req);
    const keys = Object.keys(req.body);
    if (!keys.length) return { ok: true };
    await db.query(`UPDATE user_privacy_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE user_id = $1`,
      [user.id, ...keys.map(k => req.body[k])]);
    return { ok: true };
  });

  app.patch("/preferences", { schema: { body: { type: "object", additionalProperties: false, properties: {
    notify: { type: "object", additionalProperties: { type: "boolean" } }, email_security: { type: "boolean" }, email_news: { type: "boolean" },
  } } } }, async (req) => {
    const user = app.user(req);
    const b = req.body;
    await db.query(
      `UPDATE user_preferences SET notify = COALESCE($2, notify), email_security = COALESCE($3, email_security),
         email_news = COALESCE($4, email_news), updated_at = now() WHERE user_id = $1`,
      [user.id, b.notify ? JSON.stringify(b.notify) : null, b.email_security ?? null, b.email_news ?? null]);
    return { ok: true };
  });

  app.put("/featured-badges", { schema: { body: { type: "object", required: ["keys"], properties: { keys: { type: "array", maxItems: 3, items: { type: "string" } } } } } },
    async (req) => {
      const user = app.user(req);
      await tx(db, async c => {
        await c.query("UPDATE user_badges SET featured = false WHERE user_id = $1", [user.id]);
        await c.query(
          `UPDATE user_badges ub SET featured = true FROM badges b
            WHERE b.id = ub.badge_id AND ub.user_id = $1 AND ub.revoked_at IS NULL AND b.key = ANY($2)`, [user.id, req.body.keys]);
      });
      return { ok: true };
    });

  app.get("/badges", async (req) => {
    const user = app.user(req);
    const { rows } = await db.query(
      `SELECT e.action, e.source, e.reason, e.created_at, b.key, b.name, b.icon, b.color, b.rarity
         FROM badge_award_events e JOIN badges b ON b.id = e.badge_id WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT 200`, [user.id]);
    return { current: await publicBadgesOf(db, user.id), history: rows };
  });

  // ---- sessions
  app.get("/sessions", async (req) => {
    const user = app.user(req);
    const { rows } = await db.query(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at, remember FROM user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [user.id]);
    return { sessions: rows.map(s => ({ ...s, current: s.id == req.auth.session.id })) };
  });

  app.delete("/sessions/:id", async (req) => {
    const user = app.user(req);
    const { rowCount } = await db.query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [req.params.id, user.id]);
    if (!rowCount) throw new ApiError(404, "not_found");
    return { ok: true };
  });

  // ---- password and e-mail
  app.post("/password", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    schema: { body: { type: "object", required: ["current", "password"], properties: { current: { type: "string", maxLength: 256 }, password: { type: "string", maxLength: 256 } } } } },
  async (req) => {
    const user = app.user(req);
    const { rows: [c] } = await db.query("SELECT password_hash FROM user_credentials WHERE user_id = $1", [user.id]);
    if (!(await verifyPassword(c.password_hash, req.body.current))) throw new ApiError(401, "invalid_credentials");
    const p = passwordProblem(req.body.password, user);
    if (p) throw bad(p);
    await tx(db, async t => {
      await t.query("UPDATE user_credentials SET password_hash = $2, password_changed_at = now() WHERE user_id = $1", [user.id, await hashPassword(req.body.password)]);
      // Other devices sign in again; this one stays.
      await t.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [user.id, req.auth.session.id]);
    });
    await securityMail(app, db, user.id, "Le mot de passe de ton compte Orbit a été changé. / Your Orbit password was changed.");
    return { ok: true };
  });

  app.post("/email", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    schema: { body: { type: "object", required: ["email"], properties: { email: { type: "string", maxLength: 254 } } } } }, async (req) => {
    const user = app.user(req);
    app.recentAuth(req);
    if (emailProblem(req.body.email)) throw bad("email_format");
    const { rows } = await db.query("SELECT 1 FROM users WHERE email_normalized = $1", [normalizeEmail(req.body.email)]);
    // A taken address gets the same answer; the link simply never comes.
    if (!rows.length) await sendVerification(app, db, user, "change", req.body.email.trim());
    return { ok: true };
  });

  app.post("/username", { schema: { body: { type: "object", required: ["username"], properties: { username: { type: "string", maxLength: 24 } } } } }, async (req) => {
    const user = app.user(req);
    app.recentAuth(req);
    const p = usernameProblem(req.body.username);
    if (p) throw bad(p);
    try {
      await db.query("UPDATE users SET username = $2, updated_at = now() WHERE id = $1", [user.id, req.body.username]);
    } catch (e) {
      if (e.code == "23505") throw new ApiError(409, "username_taken");
      throw e;
    }
    return { ok: true };
  });

  // ---- two-factor authentication (TOTP)
  app.post("/mfa/setup", async (req) => {
    const user = app.user(req);
    app.recentAuth(req);
    if (!app.cfg.mfaKey) throw new ApiError(503, "mfa_unavailable");
    const secret = base32Encode(randomBytes(20));
    await db.query(
      `INSERT INTO user_mfa_methods (user_id, type, secret_enc) VALUES ($1, 'totp', $2)
       ON CONFLICT (user_id, type) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, confirmed_at = NULL, last_step = NULL
       WHERE user_mfa_methods.confirmed_at IS NULL`, [user.id, encrypt(app.cfg.mfaKey, secret)]);
    const { rows: [m] } = await db.query("SELECT confirmed_at FROM user_mfa_methods WHERE user_id = $1 AND type = 'totp'", [user.id]);
    if (m.confirmed_at) throw new ApiError(409, "mfa_already_enabled");
    const label = encodeURIComponent(`Orbit:${user.username}`);
    return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=Orbit&algorithm=SHA1&digits=6&period=30` };
  });

  app.post("/mfa/confirm", { schema: { body: { type: "object", required: ["code"], properties: { code: { type: "string", maxLength: 6 } } } } }, async (req) => {
    const user = app.user(req);
    const { rows: [m] } = await db.query("SELECT id, secret_enc FROM user_mfa_methods WHERE user_id = $1 AND type = 'totp' AND confirmed_at IS NULL", [user.id]);
    if (!m) throw new ApiError(409, "mfa_not_pending");
    const step = totpVerify(decrypt(app.cfg.mfaKey, m.secret_enc), req.body.code);
    if (step == null) throw bad("invalid_code");
    const codes = newRecoveryCodes();
    await tx(db, async c => {
      await c.query("UPDATE user_mfa_methods SET confirmed_at = now(), last_step = $2 WHERE id = $1", [m.id, step]);
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [user.id]);
      for (const code of codes) await c.query("INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [user.id, hashRecoveryCode(code)]);
    });
    await securityMail(app, db, user.id, "La validation en deux étapes a été activée. / Two-step verification was turned on.");
    return { ok: true, recovery_codes: codes };
  });

  app.post("/mfa/recovery-codes", async (req) => {
    const user = app.user(req);
    app.recentAuth(req);
    const { rows } = await db.query("SELECT 1 FROM user_mfa_methods WHERE user_id = $1 AND confirmed_at IS NOT NULL", [user.id]);
    if (!rows.length) throw new ApiError(409, "mfa_not_enabled");
    const codes = newRecoveryCodes();
    await tx(db, async c => {
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [user.id]);
      for (const code of codes) await c.query("INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [user.id, hashRecoveryCode(code)]);
    });
    return { recovery_codes: codes };
  });

  app.delete("/mfa", async (req) => {
    const user = app.user(req);
    app.recentAuth(req);
    await tx(db, async c => {
      await c.query("DELETE FROM user_mfa_methods WHERE user_id = $1", [user.id]);
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [user.id]);
    });
    await securityMail(app, db, user.id, "La validation en deux étapes a été désactivée. / Two-step verification was turned off.");
    return { ok: true };
  });

  // ---- donations of this member
  app.get("/donations", async (req) => {
    const user = app.user(req);
    const { rows } = await db.query(
      `SELECT id, amount_cents, refunded_cents, currency, status, recurring, public_anonymous, created_at, confirmed_at
         FROM donations WHERE user_id = $1 AND status <> 'pending' ORDER BY created_at DESC LIMIT 200`, [user.id]);
    const { rows: subs } = await db.query(
      "SELECT status, amount_cents, currency, current_period_end, canceled_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
    return { donations: rows, subscriptions: subs };
  });

  // ---- data export and account deletion (GDPR)
  app.get("/export", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const user = app.user(req);
    const q = async (sql) => (await db.query(sql, [user.id])).rows;
    const data = {
      exported_at: new Date(),
      account: (await q("SELECT id, username, email, email_verified_at, created_at, last_active_at FROM users WHERE id = $1"))[0],
      profile: (await q("SELECT display_name, bio, theme_color, links, section_order FROM user_profiles WHERE user_id = $1"))[0],
      privacy: (await q("SELECT * FROM user_privacy_settings WHERE user_id = $1"))[0],
      preferences: (await q("SELECT notify, email_security, email_news FROM user_preferences WHERE user_id = $1"))[0],
      interests: await q("SELECT interest FROM user_interests WHERE user_id = $1"),
      badges: await q("SELECT b.key, e.action, e.source, e.created_at FROM badge_award_events e JOIN badges b ON b.id = e.badge_id WHERE e.user_id = $1"),
      shared_sites: await q("SELECT domain, note, created_at FROM shared_sites WHERE user_id = $1"),
      collections: await q("SELECT c.title, c.description, c.public, i.url, i.title AS item_title FROM site_collections c LEFT JOIN site_collection_items i ON i.collection_id = c.id WHERE c.user_id = $1"),
      friends: await q("SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend_id, created_at FROM friendships WHERE user_a = $1 OR user_b = $1"),
      blocks: await q("SELECT blocked_id, created_at FROM user_blocks WHERE blocker_id = $1"),
      notifications: await q("SELECT type, data, read_at, created_at FROM notifications WHERE user_id = $1"),
      sessions: await q("SELECT ip, user_agent, created_at, last_seen_at FROM user_sessions WHERE user_id = $1"),
      donations: await q("SELECT amount_cents, refunded_cents, currency, status, recurring, created_at FROM donations WHERE user_id = $1"),
      reports_made: await q("SELECT target_type, reason, status, created_at FROM reports WHERE reporter_id = $1"),
    };
    reply.header("Content-Disposition", "attachment; filename=orbit-account.json");
    return data;
  });

  // Deletion keeps only what the law asks to keep (payments, unlinked from the
  // person's profile) and the audit log; everything social goes away now.
  app.post("/delete", { schema: { body: { type: "object", required: ["password", "confirm"], properties: {
    password: { type: "string", maxLength: 256 }, confirm: { type: "string" }, code: { type: "string" } } } } }, async (req, reply) => {
    const user = app.user(req);
    if (req.body.confirm != user.username) throw bad("confirm_mismatch");
    const { rows: [c] } = await db.query("SELECT password_hash FROM user_credentials WHERE user_id = $1", [user.id]);
    if (!(await verifyPassword(c.password_hash, req.body.password))) throw new ApiError(401, "invalid_credentials");
    const { rows: owner } = await db.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.key = 'owner'", [user.id]);
    if (owner.length) throw new ApiError(409, "owner_cannot_delete");
    await tx(db, async t => {
      const gone = `deleted-${user.id.slice(0, 8)}`;
      await t.query(
        `UPDATE users SET status = 'deleted', deleted_at = now(), username = $2, email = $3, email_normalized = $3, updated_at = now() WHERE id = $1`,
        [user.id, gone, `${gone}@deleted.invalid`]);
      for (const table of ["user_sessions", "user_credentials", "user_mfa_methods", "user_recovery_codes", "oauth_accounts", "user_interests", "shared_sites",
        "site_collections", "notifications", "user_badges", "email_verification_tokens", "password_reset_tokens", "media"]) {
        await t.query(`DELETE FROM ${table} WHERE ${table == "media" ? "owner_id" : "user_id"} = $1`, [user.id]);
      }
      await t.query("DELETE FROM friendships WHERE user_a = $1 OR user_b = $1", [user.id]);
      await t.query("DELETE FROM friend_requests WHERE from_user = $1 OR to_user = $1", [user.id]);
      await t.query("DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1", [user.id]);
      await t.query("DELETE FROM user_roles WHERE user_id = $1", [user.id]);
      await t.query("UPDATE user_profiles SET display_name = NULL, bio = NULL, links = '[]', avatar_media_id = NULL, banner_media_id = NULL WHERE user_id = $1", [user.id]);
      await t.query("UPDATE user_privacy_settings SET profile_public = false, discoverable = false, share_sites_enabled = false WHERE user_id = $1", [user.id]);
      await audit(t, { actorId: user.id, action: "account.delete", targetType: "user", targetId: user.id, ip: req.ip });
    });
    clearSessionCookie(app, reply);
    return { ok: true };
  });
}
