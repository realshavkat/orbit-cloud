import { tx } from "../db.js";
import { ApiError, bad, cleanText } from "../lib/validate.js";
import { audit, notify } from "../services/core.js";
import { mediaUrl } from "../services/profiles.js";

const UUID = /^[0-9a-f-]{36}$/i;
const STATUSES = ["open", "planned", "in_progress", "done", "declined"];
const AUTHOR = `json_build_object('username', u.username, 'display_name', p.display_name, 'avatar_media_id', p.avatar_media_id, 'theme_color', p.theme_color,
  'staff', EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key IN ('moderator', 'administrator', 'owner')))`;

const person = a => (a ? { username: a.username, display_name: a.display_name, avatar_url: mediaUrl(a.avatar_media_id), theme_color: a.theme_color, staff: a.staff } : null);

export default async function forumRoutes(app) {
  const db = app.db;
  const mod = async req => req.auth && (await req.auth.perms()).has("forum.moderate");
  const writer = req => {
    const user = app.user(req, { verified: true });
    app.socialAllowed(req);
    return user;
  };

  app.get("/categories", async () => {
    const { rows } = await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM forum_threads t WHERE t.category_id = c.id AND NOT t.hidden AND NOT t.deleted) AS threads,
              (SELECT MAX(t.last_activity_at) FROM forum_threads t WHERE t.category_id = c.id AND NOT t.hidden AND NOT t.deleted) AS last_activity_at
         FROM forum_categories c ORDER BY c.sort`);
    return { categories: rows };
  });

  app.get("/threads", async (req) => {
    const { category, sort = "hot", status, q, author } = req.query;
    const page = Math.max(0, Math.min(100, Number.parseInt(req.query.page ?? "0", 10) || 0));
    const isMod = await mod(req);
    const where = [isMod ? "NOT t.deleted" : "NOT t.hidden AND NOT t.deleted"];
    const args = [req.auth?.user.id ?? null];
    if (category) where.push(`c.slug = $${args.push(String(category))}`);
    if (typeof author == "string" && author) where.push(`u.username_lower = $${args.push(author.toLowerCase())}`);
    if (STATUSES.includes(status)) where.push(`t.status = $${args.push(status)}`);
    if (typeof q == "string" && q.trim()) where.push(`t.title ILIKE $${args.push(`%${q.trim().slice(0, 60).replace(/[%_\\]/g, "\\$&")}%`)}`);
    const order = sort == "new" ? "t.created_at DESC" : sort == "top" ? "t.score DESC, t.created_at DESC"
      : sort == "active" ? "t.last_activity_at DESC"
        : "(t.score + t.comment_count * 0.5 + 1) / power(EXTRACT(EPOCH FROM (now() - t.created_at)) / 3600 + 2, 1.4) DESC";
    const { rows } = await db.query(
      `SELECT t.id, t.title, left(t.body, 280) AS excerpt, t.score, t.comment_count, t.status, t.pinned, t.locked, t.hidden, t.created_at, t.last_activity_at,
              c.slug AS category, c.name AS category_name, c.color AS category_color, c.kind,
              ${AUTHOR} AS author, (SELECT value FROM forum_votes v WHERE v.user_id = $1 AND v.target_type = 'thread' AND v.target_id = t.id) AS my_vote,
              COUNT(*) OVER ()::int AS total
         FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
         LEFT JOIN users u ON u.id = t.author_id LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE ${where.join(" AND ")}
        ORDER BY ${category ? "t.pinned DESC, " : ""}${order} LIMIT 25 OFFSET ${page * 25}`, args);
    return { threads: rows.map(r => ({ ...r, author: r.author.username ? person(r.author) : null, total: undefined })), total: rows[0]?.total ?? 0 };
  });

  app.get("/threads/:id", async (req) => {
    if (!UUID.test(req.params.id)) throw new ApiError(404, "not_found");
    const isMod = await mod(req);
    const me = req.auth?.user.id ?? null;
    const { rows: [t] } = await db.query(
      `SELECT t.*, c.slug AS category, c.name AS category_name, c.color AS category_color, c.kind, ${AUTHOR} AS author,
              (SELECT value FROM forum_votes v WHERE v.user_id = $2 AND v.target_type = 'thread' AND v.target_id = t.id) AS my_vote
         FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
         LEFT JOIN users u ON u.id = t.author_id LEFT JOIN user_profiles p ON p.user_id = u.id WHERE t.id = $1`, [req.params.id, me]);
    if (!t || t.deleted || (t.hidden && !isMod)) throw new ApiError(404, "not_found");
    const { rows: posts } = await db.query(
      `SELECT f.id, f.parent_id, f.body, f.score, f.hidden, f.deleted, f.created_at, f.edited_at, f.author_id, ${AUTHOR} AS author,
              (SELECT value FROM forum_votes v WHERE v.user_id = $2 AND v.target_type = 'post' AND v.target_id = f.id) AS my_vote
         FROM forum_posts f LEFT JOIN users u ON u.id = f.author_id LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE f.thread_id = $1 ORDER BY f.created_at`, [req.params.id, me]);
    return {
      thread: { ...t, author: t.author.username ? person(t.author) : null, author_id: undefined, mine: !!me && t.author_id == me },
      posts: posts.map(f => {
        const gone = f.deleted || (f.hidden && !isMod);
        return { id: f.id, parent_id: f.parent_id, score: f.score, created_at: f.created_at, edited_at: f.edited_at, my_vote: f.my_vote, hidden: f.hidden, deleted: f.deleted,
          body: gone ? null : f.body, author: gone || !f.author.username ? null : person(f.author), mine: !!me && f.author_id == me };
      }),
      can_moderate: !!isMod,
    };
  });

  app.post("/threads", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } }, schema: { body: { type: "object", required: ["category", "title", "body"], properties: {
    category: { type: "string", maxLength: 32 }, title: { type: "string", maxLength: 140 }, body: { type: "string", maxLength: 20000 } } } } }, async (req, reply) => {
    const user = writer(req);
    const { rows: [c] } = await db.query("SELECT * FROM forum_categories WHERE slug = $1", [req.body.category]);
    if (!c) throw new ApiError(404, "not_found");
    if (c.staff_only && !(await mod(req))) throw new ApiError(403, "forbidden");
    const title = cleanText(req.body.title, 140);
    const body = cleanText(req.body.body, 20000);
    if (!title || title.length < 4) throw bad("title_short");
    if (!body) throw bad("body_empty");
    const { rows: [t] } = await db.query(
      "INSERT INTO forum_threads (category_id, author_id, title, body, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [c.id, user.id, title, body, c.kind == "suggestions" ? "open" : null]);
    await db.query("INSERT INTO forum_votes (user_id, target_type, target_id, value) VALUES ($1, 'thread', $2, 1)", [user.id, t.id]);
    await db.query("UPDATE forum_threads SET score = 1 WHERE id = $1", [t.id]);
    return reply.code(201).send({ id: t.id });
  });

  async function ownThread(req) {
    const user = writer(req);
    if (!UUID.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rows: [t] } = await db.query("SELECT * FROM forum_threads WHERE id = $1 AND NOT deleted", [req.params.id]);
    if (!t) throw new ApiError(404, "not_found");
    if (t.author_id != user.id) throw new ApiError(403, "forbidden");
    return t;
  }

  app.patch("/threads/:id", { schema: { body: { type: "object", properties: { title: { type: "string", maxLength: 140 }, body: { type: "string", maxLength: 20000 } } } } }, async (req) => {
    const t = await ownThread(req);
    if (t.locked) throw new ApiError(423, "thread_locked");
    const title = req.body.title != null ? cleanText(req.body.title, 140) : t.title;
    const body = req.body.body != null ? cleanText(req.body.body, 20000) : t.body;
    if (!title || title.length < 4) throw bad("title_short");
    if (!body) throw bad("body_empty");
    await db.query("UPDATE forum_threads SET title = $2, body = $3, edited_at = now() WHERE id = $1", [t.id, title, body]);
    return { ok: true };
  });

  app.delete("/threads/:id", async (req) => {
    const t = await ownThread(req);
    await db.query("UPDATE forum_threads SET deleted = true WHERE id = $1", [t.id]);
    return { ok: true };
  });

  app.post("/threads/:id/posts", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } }, schema: { body: { type: "object", required: ["body"], properties: {
    body: { type: "string", maxLength: 10000 }, parent_id: { type: ["string", "null"] } } } } }, async (req, reply) => {
    const user = writer(req);
    if (!UUID.test(req.params.id)) throw new ApiError(404, "not_found");
    const body = cleanText(req.body.body, 10000);
    if (!body) throw bad("body_empty");
    const out = await tx(db, async c => {
      const { rows: [t] } = await c.query("SELECT id, author_id, title, locked, hidden, deleted FROM forum_threads WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!t || t.deleted || t.hidden) throw new ApiError(404, "not_found");
      if (t.locked) throw new ApiError(423, "thread_locked");
      let parent = null;
      if (req.body.parent_id) {
        if (!UUID.test(req.body.parent_id)) throw bad("invalid_input");
        ({ rows: [parent] } = await c.query("SELECT id, author_id FROM forum_posts WHERE id = $1 AND thread_id = $2", [req.body.parent_id, t.id]));
        if (!parent) throw new ApiError(404, "not_found");
      }
      const { rows: [p] } = await c.query("INSERT INTO forum_posts (thread_id, parent_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id", [t.id, parent?.id ?? null, user.id, body]);
      await c.query("UPDATE forum_threads SET comment_count = comment_count + 1, last_activity_at = now() WHERE id = $1", [t.id]);
      const to = parent ? parent.author_id : t.author_id;
      if (to && to != user.id) await notify(c, to, "forum_reply", { thread: t.id, title: t.title, username: user.username });
      return p;
    });
    return reply.code(201).send({ id: out.id });
  });

  async function ownPost(req) {
    const user = writer(req);
    if (!UUID.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rows: [p] } = await db.query("SELECT f.*, t.locked FROM forum_posts f JOIN forum_threads t ON t.id = f.thread_id WHERE f.id = $1 AND NOT f.deleted", [req.params.id]);
    if (!p) throw new ApiError(404, "not_found");
    if (p.author_id != user.id) throw new ApiError(403, "forbidden");
    return p;
  }

  app.patch("/posts/:id", { schema: { body: { type: "object", required: ["body"], properties: { body: { type: "string", maxLength: 10000 } } } } }, async (req) => {
    const p = await ownPost(req);
    if (p.locked) throw new ApiError(423, "thread_locked");
    const body = cleanText(req.body.body, 10000);
    if (!body) throw bad("body_empty");
    await db.query("UPDATE forum_posts SET body = $2, edited_at = now() WHERE id = $1", [p.id, body]);
    return { ok: true };
  });

  app.delete("/posts/:id", async (req) => {
    const p = await ownPost(req);
    await db.query("UPDATE forum_posts SET deleted = true WHERE id = $1", [p.id]);
    return { ok: true };
  });

  app.post("/vote", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { body: { type: "object", required: ["target_type", "target_id", "value"], properties: {
    target_type: { enum: ["thread", "post"] }, target_id: { type: "string" }, value: { enum: [-1, 0, 1] } } } } }, async (req) => {
    const user = writer(req);
    const { target_type: type, target_id: id, value } = req.body;
    if (!UUID.test(id)) throw new ApiError(404, "not_found");
    const table = type == "thread" ? "forum_threads" : "forum_posts";
    return tx(db, async c => {
      const { rows: [row] } = await c.query(`SELECT id, author_id FROM ${table} WHERE id = $1 AND NOT deleted AND NOT hidden FOR UPDATE`, [id]);
      if (!row) throw new ApiError(404, "not_found");
      const { rows: [old] } = await c.query("SELECT value FROM forum_votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3", [user.id, type, id]);
      const delta = value - (old?.value ?? 0);
      if (value == 0) await c.query("DELETE FROM forum_votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3", [user.id, type, id]);
      else await c.query(`INSERT INTO forum_votes (user_id, target_type, target_id, value) VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET value = EXCLUDED.value, created_at = now()`, [user.id, type, id, value]);
      const { rows: [n] } = await c.query(`UPDATE ${table} SET score = score + $2 WHERE id = $1 RETURNING score`, [id, delta]);
      return { score: n.score, my_vote: value || null };
    });
  });

  app.post("/threads/:id/moderate", { schema: { body: { type: "object", required: ["action"], properties: {
    action: { enum: ["pin", "unpin", "lock", "unlock", "hide", "unhide", "move", "status"] }, value: { type: "string", maxLength: 32 }, reason: { type: "string", maxLength: 500 } } } } }, async (req) => {
    await app.perm(req, "forum.moderate");
    if (!UUID.test(req.params.id)) throw new ApiError(404, "not_found");
    const { action, value } = req.body;
    await tx(db, async c => {
      const { rows: [t] } = await c.query("SELECT id, author_id, title, status FROM forum_threads WHERE id = $1 AND NOT deleted", [req.params.id]);
      if (!t) throw new ApiError(404, "not_found");
      if (action == "move") {
        const { rows: [cat] } = await c.query("SELECT id, kind FROM forum_categories WHERE slug = $1", [value]);
        if (!cat) throw new ApiError(404, "not_found");
        await c.query("UPDATE forum_threads SET category_id = $2, status = CASE WHEN $3 = 'suggestions' THEN COALESCE(status, 'open') ELSE NULL END WHERE id = $1", [t.id, cat.id, cat.kind]);
      } else if (action == "status") {
        if (!STATUSES.includes(value)) throw bad("invalid_input");
        await c.query("UPDATE forum_threads SET status = $2, last_activity_at = now() WHERE id = $1", [t.id, value]);
        if (t.author_id && t.status != value) await notify(c, t.author_id, "suggestion_status", { thread: t.id, title: t.title, status: value });
      } else {
        const [col, on] = { pin: ["pinned", true], unpin: ["pinned", false], lock: ["locked", true], unlock: ["locked", false], hide: ["hidden", true], unhide: ["hidden", false] }[action];
        await c.query(`UPDATE forum_threads SET ${col} = $2 WHERE id = $1`, [t.id, on]);
      }
      await audit(c, { actorId: req.auth.user.id, action: `forum.${action}`, targetType: "thread", targetId: t.id, reason: cleanText(req.body.reason ?? "", 500) || null, meta: value ? { value } : {}, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/posts/:id/moderate", { schema: { body: { type: "object", required: ["action"], properties: { action: { enum: ["hide", "unhide"] }, reason: { type: "string", maxLength: 500 } } } } }, async (req) => {
    await app.perm(req, "forum.moderate");
    if (!UUID.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rowCount } = await db.query("UPDATE forum_posts SET hidden = $2 WHERE id = $1", [req.params.id, req.body.action == "hide"]);
    if (!rowCount) throw new ApiError(404, "not_found");
    await audit(db, { actorId: req.auth.user.id, action: `forum.post_${req.body.action}`, targetType: "post", targetId: req.params.id, reason: cleanText(req.body.reason ?? "", 500) || null, ip: req.ip });
    return { ok: true };
  });

  app.get("/suggestions/summary", async () => {
    const { rows } = await db.query(
      `SELECT t.status, COUNT(*)::int AS n FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
        WHERE c.kind = 'suggestions' AND NOT t.hidden AND NOT t.deleted GROUP BY t.status`);
    return Object.fromEntries(STATUSES.map(s => [s, rows.find(r => r.status == s)?.n ?? 0]));
  });
}
