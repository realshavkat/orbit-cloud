import { publicBadgesOf } from "./badges.js";

export async function areFriends(db, a, b) {
  if (!a || !b || a == b) return false;
  const [x, y] = a < b ? [a, b] : [b, a];
  const { rows } = await db.query("SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2", [x, y]);
  return rows.length > 0;
}

export async function visibility(db, viewerId, target) {
  const { rows: [u] } = await db.query(
    `SELECT u.id, u.username, u.status, u.profile_hidden, u.created_at, u.last_active_at, s.*
       FROM users u JOIN user_privacy_settings s ON s.user_id = u.id
      WHERE ${/^[0-9a-f-]{36}$/i.test(target) ? "u.id = $1" : "u.username_lower = lower($1)"}`, [target]);
  if (!u || u.status != "active") return { user: null, level: null };
  if (viewerId == u.id) return { user: u, level: "self" };
  if (u.profile_hidden) return { user: null, level: null };
  if (viewerId) {
    const { rows } = await db.query(
      "SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)", [viewerId, u.id]);
    if (rows.length) return { user: null, level: null };
  }
  if (u.social_disabled) return { user: u, level: "private" };
  if (u.profile_public || (await areFriends(db, viewerId, u.id))) return { user: u, level: "full" };
  return { user: u, level: "private" };
}

export function mediaUrl(id) {
  return id ? `/api/v1/users/media/${id}` : null;
}

export async function cards(db, ids, viewerId = null) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT u.id, u.username, p.display_name, p.avatar_media_id, p.theme_color, s.show_badges, s.profile_public
       FROM users u JOIN user_profiles p ON p.user_id = u.id JOIN user_privacy_settings s ON s.user_id = u.id
      WHERE u.id = ANY($1) AND u.status = 'active'`, [ids]);
  const out = [];
  for (const r of rows) {
    const badges = r.show_badges ? (await publicBadgesOf(db, r.id)).slice(0, 3).map(({ key, name, icon, color, rarity, official }) => ({ key, name, icon, color, rarity, official })) : [];
    out.push({ id: r.id, username: r.username, display_name: r.display_name, avatar_url: mediaUrl(r.avatar_media_id), theme_color: r.theme_color, badges });
  }
  return ids.map(id => out.find(c => c.id == id)).filter(Boolean);
}

export async function fullProfile(db, viewerId, { user: u, level }) {
  const { rows: [p] } = await db.query("SELECT * FROM user_profiles WHERE user_id = $1", [u.id]);
  const base = { id: u.id, username: u.username, display_name: p.display_name, avatar_url: mediaUrl(p.avatar_media_id), theme_color: p.theme_color };
  if (level == "private") return { ...base, private: true };
  const self = level == "self";
  const show = key => self || u[key];
  const out = { ...base, private: false, self, bio: p.bio, banner_url: mediaUrl(p.banner_media_id), links: p.links, section_order: p.section_order,
    created_at: u.created_at, last_active_at: show("show_activity") ? u.last_active_at : null };
  out.badges = show("show_badges") ? await publicBadgesOf(db, u.id) : [];
  out.interests = show("show_interests") ? (await db.query("SELECT interest FROM user_interests WHERE user_id = $1 ORDER BY interest", [u.id])).rows.map(r => r.interest) : [];
  out.sites = (self || (u.show_sites && u.share_sites_enabled))
    ? (await db.query("SELECT domain, note, created_at FROM shared_sites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60", [u.id])).rows : [];
  out.collections = show("show_collections")
    ? (await db.query(
      `SELECT c.id, c.title, c.description, c.public, c.updated_at,
              COALESCE(json_agg(json_build_object('url', i.url, 'title', i.title) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
         FROM site_collections c LEFT JOIN site_collection_items i ON i.collection_id = c.id
        WHERE c.user_id = $1 AND (c.public OR $2) AND NOT c.hidden GROUP BY c.id ORDER BY c.updated_at DESC`, [u.id, self])).rows
    : [];
  if (show("show_friend_count")) {
    out.friend_count = (await db.query("SELECT COUNT(*)::int AS n FROM friendships WHERE user_a = $1 OR user_b = $1", [u.id])).rows[0].n;
  }
  if (viewerId && !self) {
    const friends = await areFriends(db, viewerId, u.id);
    const { rows: pending } = await db.query(
      "SELECT from_user FROM friend_requests WHERE status = 'pending' AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))", [viewerId, u.id]);
    out.relation = friends ? "friend" : pending.length ? (pending[0].from_user == viewerId ? "request_sent" : "request_received") : "none";
    out.can_request = !friends && !pending.length && u.allow_friend_requests;
  }
  return out;
}
