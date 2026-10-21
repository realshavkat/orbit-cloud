// /api/v1/badges: public catalog, badge pages and authenticity checks.
import { ApiError } from "../lib/validate.js";
import { cards, visibility } from "../services/profiles.js";

const RARITY_ORDER = "array_position(ARRAY['exclusive','legendary','epic','rare','common'], b.rarity)";

export default async function badgeRoutes(app) {
  const db = app.db;

  app.get("/", async () => {
    const { rows } = await db.query(
      `SELECT b.key, b.name, b.description, b.icon, b.rarity, b.color, b.category_key AS category, b.official, b.status,
              b.permanent, b.condition, c.name AS category_name, c.sort,
              (SELECT COUNT(*)::int FROM user_badges ub WHERE ub.badge_id = b.id AND ub.revoked_at IS NULL) AS holders
         FROM badges b JOIN badge_categories c ON c.key = b.category_key
        WHERE b.public AND b.status <> 'disabled' ORDER BY c.sort, ${RARITY_ORDER}, b.name`);
    return { badges: rows };
  });

  app.get("/:key", async (req) => {
    const { rows: [b] } = await db.query(
      `SELECT b.id, b.key, b.name, b.description, b.icon, b.rarity, b.color, b.category_key AS category, b.official, b.status,
              b.permanent, b.duration_days, b.condition, b.created_at, c.name AS category_name
         FROM badges b JOIN badge_categories c ON c.key = b.category_key WHERE b.key = $1 AND b.public AND b.status <> 'disabled'`, [req.params.key]);
    if (!b) throw new ApiError(404, "not_found");
    const { rows: holders } = await db.query(
      `SELECT ub.user_id FROM user_badges ub JOIN users u ON u.id = ub.user_id JOIN user_privacy_settings s ON s.user_id = u.id
        WHERE ub.badge_id = $1 AND ub.revoked_at IS NULL AND u.status = 'active' AND NOT u.profile_hidden
          AND s.profile_public AND s.show_badges AND NOT s.social_disabled
        ORDER BY ub.awarded_at LIMIT 48`, [b.id]);
    const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM user_badges WHERE badge_id = $1 AND revoked_at IS NULL", [b.id]);
    const { id, ...badge } = b;
    return { badge, holders_count: n, holders: await cards(db, holders.map(h => h.user_id)) };
  });

  // Is this award real? Anyone can check a badge shown on a profile.
  app.get("/awards/:id", async (req) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rows: [a] } = await db.query(
      `SELECT ub.user_id, ub.awarded_at, ub.revoked_at, ub.expires_at, ub.verified, ub.source, b.key, b.name, b.official
         FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.id = $1 AND b.public`, [req.params.id]);
    if (!a) throw new ApiError(404, "not_found");
    const v = await visibility(db, req.auth?.user.id ?? null, a.user_id);
    const shown = v.level == "self" || (v.level == "full" && v.user.show_badges);
    if (!shown) throw new ApiError(404, "not_found");
    const valid = !a.revoked_at && (!a.expires_at || a.expires_at > new Date());
    // The source says how it was earned, never an amount.
    return { valid, badge: { key: a.key, name: a.name, official: a.official }, username: v.user.username,
      awarded_at: a.awarded_at, verified: a.verified, source: a.source == "role" ? "official" : a.source };
  });
}
