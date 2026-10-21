import { ApiError, cleanText } from "../lib/validate.js";

const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };

export default async function reportRoutes(app) {
  const db = app.db;

  app.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    schema: { body: { type: "object", required: ["target_type", "target_id", "reason"], properties: {
      target_type: { enum: ["user", "collection", "thread", "post"] }, target_id: UUID,
      reason: { enum: ["spam", "harassment", "impersonation", "inappropriate", "illegal", "other"] }, details: { type: ["string", "null"] } } } } },
  async (req, reply) => {
    const me = app.user(req, { verified: true });
    const { target_type: type, target_id: id } = req.body;
    const sql = { user: "SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", collection: "SELECT 1 FROM site_collections WHERE id = $1",
      thread: "SELECT 1 FROM forum_threads WHERE id = $1 AND NOT deleted", post: "SELECT 1 FROM forum_posts WHERE id = $1 AND NOT deleted" }[type];
    const exists = (await db.query(sql, [id])).rows.length;
    if (!exists) throw new ApiError(404, "not_found");
    if (type == "user" && id == me.id) throw new ApiError(400, "self_report");
    const { rows: open } = await db.query(
      "SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status IN ('open', 'reviewing')", [me.id, type, id]);
    if (open.length) throw new ApiError(409, "report_exists");
    const { rows: [r] } = await db.query(
      "INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [me.id, type, id, req.body.reason, cleanText(req.body.details ?? null, 1000)]);
    return reply.code(201).send({ id: r.id });
  });

  app.get("/mine", async (req) => {
    const me = app.user(req);
    const { rows } = await db.query(
      "SELECT id, target_type, reason, status, created_at, updated_at FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100", [me.id]);
    return { reports: rows };
  });

  app.get("/decisions", async (req) => {
    const me = app.user(req, { mfa: false });
    const { rows } = await db.query(
      "SELECT id, action, reason, until, appeal_status, created_at FROM moderation_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [me.id]);
    return { decisions: rows };
  });

  app.post("/decisions/:id/appeal", { config: { rateLimit: { max: 5, timeWindow: "1 day" } },
    schema: { params: { type: "object", properties: { id: UUID } }, body: { type: "object", required: ["text"], properties: { text: { type: "string" } } } } },
  async (req) => {
    const me = app.user(req, { mfa: false });
    const text = cleanText(req.body.text, 1000);
    if (!text) throw new ApiError(400, "text_required");
    const { rowCount } = await db.query(
      `UPDATE moderation_actions SET appeal_text = $3, appeal_status = 'pending'
        WHERE id = $1 AND user_id = $2 AND appeal_status IS NULL AND action <> 'unsuspend' AND action <> 'unhide_profile'`, [req.params.id, me.id, text]);
    if (!rowCount) throw new ApiError(409, "appeal_unavailable");
    return { ok: true };
  });
}
