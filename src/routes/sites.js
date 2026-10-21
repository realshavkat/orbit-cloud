import { tx } from "../db.js";
import { ApiError, bad, cleanDomain, cleanText, cleanUrl } from "../lib/validate.js";
import { cards } from "../services/profiles.js";

export const SITE_MIN_MEMBERS = 3;
const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };

export default async function siteRoutes(app) {
  const db = app.db;

  app.get("/mine", async (req) => {
    const me = app.user(req);
    const { rows: sites } = await db.query("SELECT id, domain, note, created_at FROM shared_sites WHERE user_id = $1 ORDER BY created_at DESC", [me.id]);
    const { rows: collections } = await db.query(
      `SELECT c.id, c.title, c.description, c.public, c.hidden, c.updated_at,
              COALESCE(json_agg(json_build_object('id', i.id, 'url', i.url, 'title', i.title) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
         FROM site_collections c LEFT JOIN site_collection_items i ON i.collection_id = c.id WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.updated_at DESC`, [me.id]);
    const { rows: [p] } = await db.query("SELECT share_sites_enabled FROM user_privacy_settings WHERE user_id = $1", [me.id]);
    return { sharing_enabled: p.share_sites_enabled, sites, collections };
  });

  app.post("/shared", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
    schema: { body: { type: "object", required: ["domain"], properties: { domain: { type: "string", maxLength: 300 }, note: { type: ["string", "null"] } } } } },
  async (req, reply) => {
    const me = app.user(req, { verified: true });
    app.socialAllowed(req);
    const { rows: [p] } = await db.query("SELECT share_sites_enabled, social_disabled FROM user_privacy_settings WHERE user_id = $1", [me.id]);
    if (!p.share_sites_enabled || p.social_disabled) throw new ApiError(403, "sharing_disabled");
    const domain = cleanDomain(req.body.domain);
    const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM shared_sites WHERE user_id = $1", [me.id]);
    if (n >= 200) throw bad("too_many_sites");
    const { rows } = await db.query(
      `INSERT INTO shared_sites (user_id, domain, note) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, domain) DO UPDATE SET note = EXCLUDED.note RETURNING id, domain, note, created_at`,
      [me.id, domain, cleanText(req.body.note ?? null, 140)]);
    return reply.code(201).send(rows[0]);
  });

  app.delete("/shared/:domain", async (req) => {
    const me = app.user(req);
    await db.query("DELETE FROM shared_sites WHERE user_id = $1 AND domain = $2", [me.id, String(req.params.domain).toLowerCase()]);
    return { ok: true };
  });

  app.get("/domain/:domain", async (req) => {
    let domain;
    try {
      domain = cleanDomain(req.params.domain);
    } catch (e) {
      if (e.code == "domain_sensitive") return { domain: null, sensitive: true, count: null, members: [] };
      throw e;
    }
    const me = req.auth?.session.mfaPassed ? req.auth.user.id : null;
    const { rows } = await db.query(
      `SELECT u.id FROM shared_sites ss JOIN users u ON u.id = ss.user_id JOIN user_privacy_settings s ON s.user_id = u.id
        WHERE ss.domain = $1 AND u.status = 'active' AND NOT u.profile_hidden AND s.share_sites_enabled AND s.show_sites
          AND s.profile_public AND NOT s.social_disabled
          AND ($2::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $2) OR (b.blocker_id = $2 AND b.blocked_id = u.id)))
        ORDER BY ss.created_at DESC LIMIT 60`, [domain, me]);
    const mine = me ? (await db.query("SELECT 1 FROM shared_sites WHERE user_id = $1 AND domain = $2", [me, domain])).rows.length > 0 : false;
    if (rows.length < SITE_MIN_MEMBERS) return { domain, count: null, members: [], shared_by_me: mine };
    return { domain, count: rows.length, members: await cards(db, rows.map(r => r.id), me), shared_by_me: mine };
  });

  const collectionBody = { type: "object", properties: {
    title: { type: "string", maxLength: 60 }, description: { type: ["string", "null"], maxLength: 280 }, public: { type: "boolean" },
    items: { type: "array", maxItems: 50, items: { type: "object", required: ["url"], properties: { url: { type: "string" }, title: { type: ["string", "null"] } } } },
  } };

  async function saveItems(c, collectionId, items) {
    await c.query("DELETE FROM site_collection_items WHERE collection_id = $1", [collectionId]);
    let i = 0;
    for (const it of items) {
      await c.query("INSERT INTO site_collection_items (collection_id, url, title, position) VALUES ($1, $2, $3, $4)",
        [collectionId, cleanUrl(it.url), cleanText(it.title ?? null, 120), i++]);
    }
  }

  app.post("/collections", { schema: { body: { ...collectionBody, required: ["title"] } } }, async (req, reply) => {
    const me = app.user(req, { verified: true });
    const title = cleanText(req.body.title, 60);
    if (!title) throw bad("title_required");
    const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM site_collections WHERE user_id = $1", [me.id]);
    if (n >= 30) throw bad("too_many_collections");
    const id = await tx(db, async c => {
      const { rows: [col] } = await c.query("INSERT INTO site_collections (user_id, title, description, public) VALUES ($1, $2, $3, $4) RETURNING id",
        [me.id, title, cleanText(req.body.description ?? null, 280), req.body.public ?? true]);
      if (req.body.items) await saveItems(c, col.id, req.body.items);
      return col.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/collections/:id", { schema: { params: { type: "object", properties: { id: UUID } }, body: collectionBody } }, async (req) => {
    const me = app.user(req);
    await tx(db, async c => {
      const { rows: [col] } = await c.query("SELECT id FROM site_collections WHERE id = $1 AND user_id = $2 FOR UPDATE", [req.params.id, me.id]);
      if (!col) throw new ApiError(404, "not_found");
      const b = req.body;
      await c.query(
        `UPDATE site_collections SET title = COALESCE($2, title), description = CASE WHEN $5 THEN $3 ELSE description END,
           public = COALESCE($4, public), updated_at = now() WHERE id = $1`,
        [col.id, b.title != null ? cleanText(b.title, 60) : null, cleanText(b.description ?? null, 280), b.public ?? null, "description" in b]);
      if (b.items) await saveItems(c, col.id, b.items);
    });
    return { ok: true };
  });

  app.delete("/collections/:id", { schema: { params: { type: "object", properties: { id: UUID } } } }, async (req) => {
    const me = app.user(req);
    const { rowCount } = await db.query("DELETE FROM site_collections WHERE id = $1 AND user_id = $2", [req.params.id, me.id]);
    if (!rowCount) throw new ApiError(404, "not_found");
    return { ok: true };
  });
}
