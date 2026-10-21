import { getSetting } from "./core.js";
import { syncBadge } from "./badges.js";

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

export async function syncBetaBadge(db, userId) {
  if (userId) await syncBadge(db, userId, "beta_tester", await hasBeta(db, userId), "payment", "beta access");
}
