// /api/v1/users: public profiles, search, discovery, profile images.
import { ApiError, bad } from "../lib/validate.js";
import { visibility, fullProfile, cards } from "../services/profiles.js";

export default async function userRoutes(app) {
  const db = app.db;
  const viewer = req => (req.auth?.session.mfaPassed ? req.auth.user.id : null);

  app.get("/search", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2 || q.length > 24 || !/^[a-z0-9_.-]+$/.test(q)) throw bad("query_invalid");
    const me = viewer(req);
    const { rows } = await db.query(
      `SELECT u.id FROM users u JOIN user_privacy_settings s ON s.user_id = u.id
        WHERE u.status = 'active' AND NOT u.profile_hidden AND NOT s.social_disabled AND u.username_lower LIKE $1 || '%'
          AND (s.profile_public OR s.discoverable)
          AND ($2::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $2) OR (b.blocker_id = $2 AND b.blocked_id = u.id)))
        ORDER BY (u.username_lower = $1) DESC, length(u.username) LIMIT 20`, [q.replace(/[%_\\]/g, "\\$&"), me]);
    return { users: await cards(db, rows.map(r => r.id), me) };
  });

  // Discovery shows only members who chose "appear in suggestions".
  app.get("/discover", async (req) => {
    const me = viewer(req);
    const visible = `u.status = 'active' AND NOT u.profile_hidden AND s.discoverable AND s.profile_public AND NOT s.social_disabled
      AND ($1::uuid IS NULL OR (u.id <> $1 AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $1) OR (b.blocker_id = $1 AND b.blocked_id = u.id))))`;
    const ids = async (sql) => (await db.query(sql, [me])).rows.map(r => r.id);
    const recent = await ids(`SELECT u.id FROM users u JOIN user_privacy_settings s ON s.user_id = u.id WHERE ${visible}
      AND u.created_at > now() - interval '30 days' ORDER BY u.created_at DESC LIMIT 12`);
    // "Popular" = most friends (documented in the README).
    const popular = await ids(`SELECT u.id FROM users u JOIN user_privacy_settings s ON s.user_id = u.id
      LEFT JOIN friendships f ON f.user_a = u.id OR f.user_b = u.id WHERE ${visible} GROUP BY u.id HAVING COUNT(f.*) > 0 ORDER BY COUNT(f.*) DESC LIMIT 12`);
    const active = await ids(`SELECT u.id FROM users u JOIN user_privacy_settings s ON s.user_id = u.id WHERE ${visible}
      AND s.show_activity AND u.last_active_at > now() - interval '7 days' ORDER BY u.last_active_at DESC LIMIT 12`);
    const interests = me ? await ids(`SELECT u.id FROM users u JOIN user_privacy_settings s ON s.user_id = u.id
      JOIN user_interests i ON i.user_id = u.id AND s.show_interests
      WHERE ${visible} AND i.interest IN (SELECT interest FROM user_interests WHERE user_id = $1)
      GROUP BY u.id ORDER BY COUNT(*) DESC LIMIT 12`) : [];
    const { rows: collections } = await db.query(
      `SELECT c.id, c.title, c.description, u.username, COUNT(i.*)::int AS items
         FROM site_collections c JOIN users u ON u.id = c.user_id JOIN user_privacy_settings s ON s.user_id = u.id
         JOIN site_collection_items i ON i.collection_id = c.id
        WHERE ${visible} AND c.public AND NOT c.hidden AND s.show_collections GROUP BY c.id, u.username ORDER BY COUNT(i.*) DESC, c.updated_at DESC LIMIT 12`, [me]);
    return {
      recent: await cards(db, recent, me), popular: await cards(db, popular, me), active: await cards(db, active, me),
      shared_interests: await cards(db, interests, me), collections,
    };
  });

  app.get("/media/:id", async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rows: [m] } = await db.query(
      "SELECT m.mime, m.bytes, m.owner_id, m.kind, m.sha256 FROM media m WHERE m.id = $1", [req.params.id]);
    if (!m || m.kind == "badge" || m.kind == "mod") {
      if (m) return sendMedia(reply, m);
      throw new ApiError(404, "not_found");
    }
    const { level } = await visibility(db, viewer(req), m.owner_id);
    // A private profile shows its avatar (as on its card), not its banner.
    if (!level || (level == "private" && m.kind != "avatar")) throw new ApiError(404, "not_found");
    return sendMedia(reply, m);
  });

  app.get("/:name", async (req) => {
    const me = viewer(req);
    const v = await visibility(db, me, req.params.name);
    if (!v.level) throw new ApiError(404, "not_found");
    return fullProfile(db, me, v);
  });
}

function sendMedia(reply, m) {
  reply.header("Content-Type", m.mime);
  reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
  reply.header("Content-Disposition", "inline");
  reply.header("Cache-Control", "private, max-age=300");
  reply.header("ETag", `"${m.sha256}"`);
  return reply.send(m.bytes);
}
