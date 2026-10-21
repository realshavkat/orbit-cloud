// /api/v1/friends: requests, friendships and blocks.
import { tx } from "../db.js";
import { ApiError } from "../lib/validate.js";
import { notify, blockedBetween } from "../services/core.js";
import { cards } from "../services/profiles.js";

const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };
const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export default async function friendRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    const me = app.user(req);
    const { rows } = await db.query(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS id FROM friendships WHERE user_a = $1 OR user_b = $1 ORDER BY created_at DESC`, [me.id]);
    const { rows: incoming } = await db.query(
      "SELECT id, from_user, created_at FROM friend_requests WHERE to_user = $1 AND status = 'pending' ORDER BY created_at DESC", [me.id]);
    const { rows: outgoing } = await db.query(
      "SELECT id, to_user, created_at FROM friend_requests WHERE from_user = $1 AND status = 'pending' ORDER BY created_at DESC", [me.id]);
    const { rows: blocked } = await db.query("SELECT blocked_id FROM user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC", [me.id]);
    const inCards = await cards(db, incoming.map(r => r.from_user));
    const outCards = await cards(db, outgoing.map(r => r.to_user));
    return {
      friends: await cards(db, rows.map(r => r.id)),
      incoming: incoming.map(r => ({ id: r.id, created_at: r.created_at, user: inCards.find(c => c.id == r.from_user) })).filter(r => r.user),
      outgoing: outgoing.map(r => ({ id: r.id, created_at: r.created_at, user: outCards.find(c => c.id == r.to_user) })).filter(r => r.user),
      blocked: await cards(db, blocked.map(r => r.blocked_id)),
    };
  });

  app.post("/requests", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    schema: { body: { type: "object", required: ["user_id"], properties: { user_id: UUID } } } }, async (req, reply) => {
    const me = app.user(req, { verified: true });
    app.socialAllowed(req);
    const to = req.body.user_id;
    if (to == me.id) throw new ApiError(400, "self_request");
    const id = await tx(db, async c => {
      const { rows: [t] } = await c.query(
        `SELECT u.status, s.allow_friend_requests, s.social_disabled, u.profile_hidden FROM users u JOIN user_privacy_settings s ON s.user_id = u.id WHERE u.id = $1`, [to]);
      // Blocked, suspended or closed accounts all answer "unavailable".
      if (!t || t.status != "active" || t.profile_hidden || t.social_disabled || !t.allow_friend_requests || (await blockedBetween(c, me.id, to))) {
        throw new ApiError(403, "request_unavailable");
      }
      const { rows: [mine] } = await c.query("SELECT social_disabled FROM user_privacy_settings WHERE user_id = $1", [me.id]);
      if (mine.social_disabled) throw new ApiError(403, "social_disabled");
      const [a, b] = pair(me.id, to);
      if ((await c.query("SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2", [a, b])).rows.length) throw new ApiError(409, "already_friends");
      // The other person already asked: this accepts it.
      const { rows: [back] } = await c.query("SELECT id FROM friend_requests WHERE from_user = $1 AND to_user = $2 AND status = 'pending' FOR UPDATE", [to, me.id]);
      if (back) {
        await c.query("UPDATE friend_requests SET status = 'accepted', responded_at = now() WHERE id = $1", [back.id]);
        await c.query("INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a, b]);
        await notify(c, to, "friend_accepted", { user_id: me.id, username: me.username });
        return back.id;
      }
      try {
        const { rows: [r] } = await c.query("INSERT INTO friend_requests (from_user, to_user) VALUES ($1, $2) RETURNING id", [me.id, to]);
        await notify(c, to, "friend_request", { user_id: me.id, username: me.username, request_id: r.id });
        return r.id;
      } catch (e) {
        if (e.code == "23505") throw new ApiError(409, "request_exists");
        throw e;
      }
    });
    return reply.code(201).send({ ok: true, id });
  });

  const respond = (action) => async (req) => {
    const me = app.user(req);
    return tx(db, async c => {
      const { rows: [r] } = await c.query("SELECT * FROM friend_requests WHERE id = $1 AND status = 'pending' FOR UPDATE", [req.params.id]);
      const mineToAnswer = r && r.to_user == me.id;
      const mineToCancel = r && r.from_user == me.id;
      if (!(action == "cancel" ? mineToCancel : mineToAnswer)) throw new ApiError(404, "not_found");
      const status = { accept: "accepted", decline: "declined", cancel: "canceled" }[action];
      await c.query("UPDATE friend_requests SET status = $2, responded_at = now() WHERE id = $1", [r.id, status]);
      if (action == "accept") {
        if (await blockedBetween(c, r.from_user, r.to_user)) throw new ApiError(403, "request_unavailable");
        const [a, b] = pair(r.from_user, r.to_user);
        await c.query("INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a, b]);
        await notify(c, r.from_user, "friend_accepted", { user_id: me.id, username: me.username });
      }
      return { ok: true };
    });
  };
  const idParams = { schema: { params: { type: "object", properties: { id: UUID } } } };
  app.post("/requests/:id/accept", idParams, respond("accept"));
  app.post("/requests/:id/decline", idParams, respond("decline"));
  app.post("/requests/:id/cancel", idParams, respond("cancel"));

  app.delete("/:userId", { schema: { params: { type: "object", properties: { userId: UUID } } } }, async (req) => {
    const me = app.user(req);
    const [a, b] = pair(me.id, req.params.userId);
    const { rowCount } = await db.query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2", [a, b]);
    if (!rowCount) throw new ApiError(404, "not_found");
    return { ok: true };
  });

  // Blocking ends the friendship and any pending request, both ways.
  app.post("/blocks", { schema: { body: { type: "object", required: ["user_id"], properties: { user_id: UUID } } } }, async (req) => {
    const me = app.user(req);
    const other = req.body.user_id;
    if (other == me.id) throw new ApiError(400, "self_block");
    await tx(db, async c => {
      const { rows } = await c.query("SELECT 1 FROM users WHERE id = $1", [other]);
      if (!rows.length) throw new ApiError(404, "not_found");
      await c.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me.id, other]);
      const [a, b] = pair(me.id, other);
      await c.query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2", [a, b]);
      await c.query(
        `UPDATE friend_requests SET status = 'canceled', responded_at = now()
          WHERE status = 'pending' AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))`, [me.id, other]);
    });
    return { ok: true };
  });

  app.delete("/blocks/:userId", { schema: { params: { type: "object", properties: { userId: UUID } } } }, async (req) => {
    const me = app.user(req);
    await db.query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [me.id, req.params.userId]);
    return { ok: true };
  });
}
