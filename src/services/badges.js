// Badge engine. Every award and revocation goes through here, inside the
// caller's transaction, and leaves a badge_award_events row. The unique index
// on (user, badge) where not revoked makes a double award impossible.
import { ApiError } from "../lib/validate.js";
import { getSetting, notify } from "./core.js";

export async function badgeByKey(db, key) {
  const { rows } = await db.query("SELECT * FROM badges WHERE key = $1", [key]);
  return rows[0] ?? null;
}

// Badges past their end date are closed before any award, so they can be won again.
export async function expireBadges(db, userId = null) {
  const { rows } = await db.query(
    `UPDATE user_badges SET revoked_at = now(), revoke_reason = 'expired'
      WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now() ${userId ? "AND user_id = $1" : ""}
      RETURNING id, user_id, badge_id`, userId ? [userId] : []);
  for (const r of rows) {
    await db.query("INSERT INTO badge_award_events (user_badge_id, user_id, badge_id, action, source, reason) VALUES ($1,$2,$3,'expire','auto','expired')",
      [r.id, r.user_id, r.badge_id]);
  }
  return rows.length;
}

/**
 * source: auto | manual | payment | event | contribution | bootstrap | role
 * allowOfficial: the caller checked the badges.official permission.
 * Returns the new user_badges row, or null when the user already has the badge.
 */
export async function awardBadge(db, { userId, badgeKey, source, actorId = null, reason = null, allowOfficial = false, notifyUser = true }) {
  const badge = await badgeByKey(db, badgeKey);
  if (!badge) throw new ApiError(404, "badge_not_found");
  if (badge.status != "active") throw new ApiError(409, "badge_inactive");
  if (badge.protected && source != "bootstrap") throw new ApiError(403, "badge_protected");
  if (source == "manual") {
    if (!badge.manual_award) throw new ApiError(403, "badge_not_manual");
    if (badge.official && !allowOfficial) throw new ApiError(403, "badge_official");
  }
  await expireBadges(db, userId);
  const expires = badge.permanent || !badge.duration_days ? null : new Date(Date.now() + badge.duration_days * 864e5);
  const { rows } = await db.query(
    `INSERT INTO user_badges (user_id, badge_id, source, awarded_by, expires_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, badge_id) WHERE revoked_at IS NULL DO NOTHING RETURNING *`,
    [userId, badge.id, source, actorId, expires]);
  if (!rows.length) return null;
  await db.query(
    "INSERT INTO badge_award_events (user_badge_id, user_id, badge_id, action, actor_id, source, reason) VALUES ($1,$2,$3,'award',$4,$5,$6)",
    [rows[0].id, userId, badge.id, actorId, source, reason]);
  if (notifyUser) await notify(db, userId, badge.category_key == "support" ? "support_badge" : "badge", { badge: badge.key, name: badge.name });
  return rows[0];
}

export async function revokeBadge(db, { userId, badgeKey, source, actorId = null, reason, allowOfficial = false }) {
  const badge = await badgeByKey(db, badgeKey);
  if (!badge) throw new ApiError(404, "badge_not_found");
  if (badge.protected && source != "bootstrap") throw new ApiError(403, "badge_protected");
  if (source == "manual") {
    if (!reason) throw new ApiError(400, "reason_required");
    if (badge.official && !allowOfficial) throw new ApiError(403, "badge_official");
  }
  const { rows } = await db.query(
    `UPDATE user_badges SET revoked_at = now(), revoked_by = $3, revoke_reason = $4
      WHERE user_id = $1 AND badge_id = $2 AND revoked_at IS NULL RETURNING id`,
    [userId, badge.id, actorId, reason]);
  if (!rows.length) return false;
  await db.query(
    "INSERT INTO badge_award_events (user_badge_id, user_id, badge_id, action, actor_id, source, reason) VALUES ($1,$2,$3,'revoke',$4,$5,$6)",
    [rows[0].id, userId, badge.id, actorId, source, reason]);
  return true;
}

async function hasBadge(db, userId, key) {
  const { rows } = await db.query(
    `SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = $1 AND b.key = $2 AND ub.revoked_at IS NULL`, [userId, key]);
  return rows.length > 0;
}

// Award or revoke so the badge matches `want`. Only touches badges given by `source`.
async function ensure(db, userId, key, want, source, reason) {
  const badge = await badgeByKey(db, key);
  if (!badge || badge.status != "active") return;
  const has = await hasBadge(db, userId, key);
  if (want && !has) await awardBadge(db, { userId, badgeKey: key, source, reason });
  if (!want && has) {
    const { rows } = await db.query(
      `SELECT ub.source FROM user_badges ub WHERE ub.user_id = $1 AND ub.badge_id = $2 AND ub.revoked_at IS NULL`, [userId, badge.id]);
    if (rows[0]?.source == source) await revokeBadge(db, { userId, badgeKey: key, source, reason });
  }
}

/**
 * Supporter badges follow confirmed money only, net of refunds (the rule shown
 * on the support page). Disputed and pending payments count for nothing.
 */
export async function syncSupporterBadges(db, userId) {
  if (!userId) return;
  const { rows: [t] } = await db.query(
    `SELECT COALESCE(SUM(amount_cents - refunded_cents), 0)::int AS net,
            COUNT(*) FILTER (WHERE amount_cents - refunded_cents > 0)::int AS paid,
            MIN(confirmed_at) FILTER (WHERE amount_cents - refunded_cents > 0) AS first_at
       FROM donations WHERE user_id = $1 AND status IN ('succeeded', 'partially_refunded')`, [userId]);
  await ensure(db, userId, "supporter", t.paid > 0, "payment", "donation");
  const { rows: tiers } = await db.query("SELECT badge_key, threshold_cents FROM supporter_tiers ORDER BY sort");
  for (const tier of tiers) await ensure(db, userId, tier.badge_key, t.net >= tier.threshold_cents, "payment", "donation total");
  const { rows: subs } = await db.query(
    "SELECT 1 FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing') LIMIT 1", [userId]);
  await ensure(db, userId, "supporter_monthly", subs.length > 0, "payment", subs.length ? "monthly support" : "monthly support ended");
  // Early Supporter is permanent once earned within the period.
  const until = await getSetting(db, "early_supporter_until");
  if (until && t.first_at && t.first_at < new Date(until) && !(await hasBadge(db, userId, "early_supporter"))) {
    await awardBadge(db, { userId, badgeKey: "early_supporter", source: "payment", reason: "donation during the early period" });
  }
}

// Staff badges follow roles: they show the role, they never grant it.
export async function syncRoleBadges(db, userId) {
  const { rows } = await db.query("SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1", [userId]);
  const roles = new Set(rows.map(r => r.key));
  await ensure(db, userId, "administrator", roles.has("administrator") || roles.has("owner"), "role", "role");
  await ensure(db, userId, "moderator", roles.has("moderator"), "role", "role");
}

export async function publicBadgesOf(db, userId) {
  const { rows } = await db.query(
    `SELECT b.key, b.name, b.description, b.icon, b.rarity, b.color, b.category_key AS category, b.official,
            ub.id AS award_id, ub.awarded_at, ub.featured, ub.verified
       FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = $1 AND ub.revoked_at IS NULL AND (ub.expires_at IS NULL OR ub.expires_at > now())
        AND b.public AND b.status <> 'disabled'
      ORDER BY ub.featured DESC, b.official DESC,
        array_position(ARRAY['exclusive','legendary','epic','rare','common'], b.rarity), ub.awarded_at`, [userId]);
  return rows;
}
