// Shared services: audit log, permissions, notifications.
import { ApiError } from "../lib/validate.js";

export async function audit(db, { actorId, action, targetType = null, targetId = null, reason = null, meta = {}, ip = null }) {
  await db.query(
    "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, reason, meta, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [actorId, action, targetType, targetId == null ? null : String(targetId), reason, meta, ip]);
}

// Permissions come only from user_roles -> role_permissions. Badges never count.
export async function permissionsOf(db, userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT rp.permission_key AS key FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1`, [userId]);
  return new Set(rows.map(r => r.key));
}

export async function rolesOf(db, userId) {
  const { rows } = await db.query(
    "SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.rank DESC", [userId]);
  return rows.map(r => r.key);
}

export function requirePermission(perms, key) {
  if (!perms.has(key)) throw new ApiError(403, "forbidden");
}

const NOTIFY_TYPES = ["friend_request", "friend_accepted", "badge", "support_badge", "contribution", "security", "report_update", "news", "moderation", "mod_review"];

// Stored server-side so they survive reconnections; the user's preferences can mute a type
// (security notifications cannot be muted).
export async function notify(db, userId, type, data = {}) {
  if (!NOTIFY_TYPES.includes(type)) throw new Error(`unknown notification type ${type}`);
  if (type != "security") {
    const { rows } = await db.query("SELECT notify FROM user_preferences WHERE user_id = $1", [userId]);
    if (rows[0]?.notify?.[type] === false) return;
  }
  await db.query("INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)", [userId, type, data]);
}

export async function getSetting(db, key, fallback = null) {
  const { rows } = await db.query("SELECT value FROM app_settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : fallback;
}

// Is one of the two users blocking the other?
export async function blockedBetween(db, a, b) {
  const { rows } = await db.query(
    "SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1", [a, b]);
  return rows.length > 0;
}
