import { randomBytes } from "node:crypto";
import { getSetting, notify } from "./core.js";
import { syncBadge } from "./badges.js";
import { hashToken, encrypt, decrypt } from "../lib/crypto.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let secret = null;

export const setKeySecret = key => (secret = key);

export function newKey() {
  const bytes = randomBytes(20);
  const chars = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join("");
  return `ORBIT-${chars.match(/.{5}/g).join("-")}`;
}

export const normalizeKey = raw => {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.startsWith("ORBIT") ? s.slice(5) : s;
  return /^[A-Z0-9]{20}$/.test(body) ? `ORBIT-${body.match(/.{5}/g).join("-")}` : null;
};

const seal = key => (secret ? encrypt(secret, key) : `plain:${key}`);
export const openKey = enc => (enc.startsWith("plain:") ? enc.slice(6) : decrypt(secret, enc));

export async function betaSettings(db) {
  const s = await getSetting(db, "beta", {});
  return { paywall: s.paywall !== false, price_cents: Number.isInteger(s.price_cents) ? s.price_cents : 200 };
}

export async function betaAccess(db, userId) {
  if (!userId) return { paid: false, granted: false };
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM donations WHERE user_id = $1 AND purpose = 'beta' AND status IN ('succeeded', 'partially_refunded')) AS paid,
            EXISTS (SELECT 1 FROM beta_grants WHERE user_id = $1 AND revoked_at IS NULL) AS granted`, [userId]);
  return r;
}

export async function hasBeta(db, userId) {
  const a = await betaAccess(db, userId);
  return a.paid || a.granted;
}

export async function createKey(db, { userId = null, source, note = null, createdBy = null, maxDevices = 3 }) {
  const key = newKey();
  const { rows: [row] } = await db.query(
    `INSERT INTO beta_keys (key_hash, key_enc, last4, user_id, source, note, created_by, max_devices) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [hashToken(key), seal(key), key.slice(-4), userId, source, note, createdBy, maxDevices]);
  return { id: row.id, key };
}

export async function userKey(db, userId) {
  const { rows: [k] } = await db.query(
    `SELECT k.id, k.key_enc, k.last4, k.source, k.max_devices, k.created_at, (SELECT COUNT(*)::int FROM beta_activations a WHERE a.key_id = k.id) AS devices
       FROM beta_keys k WHERE k.user_id = $1 AND k.revoked_at IS NULL ORDER BY k.created_at DESC LIMIT 1`, [userId]);
  return k ? { id: k.id, key: openKey(k.key_enc), last4: k.last4, source: k.source, devices: k.devices, max_devices: k.max_devices, created_at: k.created_at } : null;
}

export async function syncBeta(db, userId) {
  if (!userId) return;
  const access = await betaAccess(db, userId);
  const has = access.paid || access.granted;
  await syncBadge(db, userId, "beta_tester", has, "payment", "beta access");
  const current = await userKey(db, userId);
  if (has && !current) {
    await createKey(db, { userId, source: access.paid ? "payment" : "grant" });
    await notify(db, userId, "beta_key", {});
  } else if (!has && current) {
    await db.query("UPDATE beta_keys SET revoked_at = now(), revoke_reason = 'access ended' WHERE user_id = $1 AND revoked_at IS NULL AND source IN ('payment', 'grant')", [userId]);
  }
}

export async function checkKey(db, rawKey, device) {
  const s = await betaSettings(db);
  const key = normalizeKey(rawKey);
  if (!key) return { status: 400, error: "key_invalid" };
  const { rows: [k] } = await db.query(
    `SELECT k.id, k.revoked_at, k.max_devices, u.username, u.status FROM beta_keys k LEFT JOIN users u ON u.id = k.user_id WHERE k.key_hash = $1`, [hashToken(key)]);
  if (!k) return { status: 404, error: "key_invalid" };
  if (k.revoked_at || (k.status && k.status != "active")) return { status: 403, error: "key_revoked" };
  if (device) {
    const dh = hashToken(`device:${device}`);
    const { rowCount } = await db.query("UPDATE beta_activations SET last_seen = now() WHERE key_id = $1 AND device_hash = $2", [k.id, dh]);
    if (!rowCount) {
      const { rows: [n] } = await db.query("SELECT COUNT(*)::int AS n FROM beta_activations WHERE key_id = $1", [k.id]);
      if (n.n >= k.max_devices) return { status: 403, error: "key_device_limit", max: k.max_devices };
      await db.query("INSERT INTO beta_activations (key_id, device_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING", [k.id, dh]);
    }
  }
  return { status: 200, body: { active: true, required: s.paywall, username: k.username ?? null } };
}
