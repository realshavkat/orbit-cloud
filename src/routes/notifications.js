import { ApiError, intParam } from "../lib/validate.js";

export default async function notificationRoutes(app) {
  const db = app.db;

  app.get("/", async (req) => {
    const me = app.user(req);
    const limit = intParam(req.query.limit, 30, 1, 100);
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && isNaN(before)) throw new ApiError(400, "param_invalid");
    const { rows } = await db.query(
      `SELECT id, type, data, read_at, created_at FROM notifications
        WHERE user_id = $1 AND archived_at IS NULL AND ($2::timestamptz IS NULL OR created_at < $2)
        ORDER BY created_at DESC LIMIT $3`, [me.id, before, limit]);
    return { notifications: rows, next: rows.length == limit ? rows.at(-1).created_at : null };
  });

  app.get("/count", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const me = app.user(req);
    const { rows: [r] } = await db.query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND archived_at IS NULL", [me.id]);
    return { unread: r.n };
  });

  app.post("/read", { schema: { body: { type: "object", properties: { ids: { type: "array", maxItems: 100, items: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } }, all: { type: "boolean" } } } } },
    async (req) => {
      const me = app.user(req);
      if (req.body.all) await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [me.id]);
      else await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL", [me.id, req.body.ids ?? []]);
      return { ok: true };
    });

  app.delete("/:id", { schema: { params: { type: "object", properties: { id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } } }, async (req) => {
    const me = app.user(req);
    const { rowCount } = await db.query("UPDATE notifications SET archived_at = now() WHERE id = $1 AND user_id = $2", [req.params.id, me.id]);
    if (!rowCount) throw new ApiError(404, "not_found");
    return { ok: true };
  });
}
