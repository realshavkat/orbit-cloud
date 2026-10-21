import { createHash } from "node:crypto";
import { tx } from "../db.js";
import { ApiError, bad, cleanText } from "../lib/validate.js";
import { prepareMod, slugify, filesFromZip, MOD_FILES, CATEGORIES } from "../lib/mods.js";
import { readZip } from "../lib/zip.js";
import { audit, notify } from "../services/core.js";
import { mediaUrl } from "../services/profiles.js";
import { sniffImage } from "./me.js";

const ZEN_STORE = "https://raw.githubusercontent.com/zen-browser/theme-store/main/themes";
const UUID_RE = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
const BIG = { bodyLimit: 1536 * 1024 };
const HUGE = { bodyLimit: 26 * 1024 * 1024 };
const MAX_IMAGES = 6;
const IMAGE_MAX = 3 * 1024 * 1024;

export function createZenFetcher(fetchImpl = fetch) {
  const get = async (url, max) => {
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new ApiError(502, "zen_unreachable");
    }
    if (res.status == 404) return null;
    if (!res.ok) throw new ApiError(502, "zen_unreachable");
    const text = await res.text();
    if (text.length > max) throw bad("file_too_big");
    return text;
  };
  return async id => {
    const base = `${ZEN_STORE}/${id}`;
    const theme = await get(`${base}/theme.json`, 16 * 1024);
    if (theme == null) throw new ApiError(404, "zen_mod_not_found");
    const files = { "theme.json": theme };
    for (const [name, max] of [["chrome.css", 512 * 1024], ["preferences.json", 64 * 1024], ["readme.md", 64 * 1024]]) {
      const text = await get(`${base}/${name}`, max);
      if (text != null) files[name] = text;
    }
    return files;
  };
}

export function createZenImageFetcher(fetchImpl = fetch) {
  return async id => {
    try {
      const res = await fetchImpl(`${ZEN_STORE}/${id}/image.png`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length <= IMAGE_MAX ? buf : null;
    } catch {
      return null;
    }
  };
}

const metaOf = files => {
  try {
    const m = JSON.parse(files["theme.json"] ?? "{}");
    return m && typeof m == "object" ? m : {};
  } catch {
    return {};
  }
};

const card = r => ({
  slug: r.slug, name: r.name, summary: r.summary, category: r.category, source: r.source, installs: r.installs,
  author: r.username, preview_url: mediaUrl(r.preview_media_id), version: r.version ?? null, updated_at: r.updated_at,
});

export default async function modRoutes(app) {
  const db = app.db;
  const zenCache = new Map();

  const filesSchema = { type: "object", additionalProperties: { type: "string" }, maxProperties: 8 };
  const sourceProps = { zip: { type: "string", maxLength: 1400 * 1024 }, files: filesSchema, zen: { type: "string", maxLength: 200 },
    images: { type: "array", maxItems: MAX_IMAGES, items: { type: "string", maxLength: Math.ceil(IMAGE_MAX / 3) * 4 + 4 } } };

  async function loadSource(body) {
    let out;
    if (body.zen) {
      const id = UUID_RE.exec(body.zen)?.[0]?.toLowerCase();
      if (!id) throw bad("zen_link_invalid");
      const image = await app.zenImage(id);
      out = { files: await app.zenFetch(id), zenId: id, shots: image ? [image] : [] };
    } else if (body.zip) {
      const { files, shots } = filesFromZip(readZip(Buffer.from(body.zip, "base64")));
      out = { files, zenId: null, shots };
    } else if (body.files) out = { files: body.files, zenId: null, shots: [] };
    else throw bad("files_missing");
    const sent = (body.images ?? []).map(b => Buffer.from(b, "base64"));
    const images = [...sent, ...out.shots];
    for (const buf of images) {
      if (buf.length > IMAGE_MAX) throw bad("file_too_large");
      if (!sniffImage(buf)) throw bad("file_type");
    }
    if (images.length > MAX_IMAGES) throw bad("too_many_images");
    return { ...out, images };
  }

  async function setImages(c, mod, bufs) {
    const { rows: old } = await c.query("SELECT media_id FROM mod_images WHERE mod_id = $1", [mod.id]);
    await c.query("DELETE FROM mod_images WHERE mod_id = $1", [mod.id]);
    if (old.length) await c.query("DELETE FROM media WHERE id = ANY($1)", [old.map(r => r.media_id)]);
    const ids = [];
    for (const [i, buf] of bufs.entries()) {
      const { rows: [m] } = await c.query(
        "INSERT INTO media (owner_id, kind, mime, bytes, size, sha256) VALUES ($1, 'mod', $2, $3, $4, $5) RETURNING id",
        [mod.owner_id, sniffImage(buf), buf, buf.length, createHash("sha256").update(buf).digest("hex")]);
      await c.query("INSERT INTO mod_images (mod_id, media_id, position) VALUES ($1, $2, $3)", [mod.id, m.id, i]);
      ids.push(m.id);
    }
    await c.query("UPDATE mods SET preview_media_id = $2, updated_at = now() WHERE id = $1", [mod.id, ids[0] ?? null]);
  }

  const summary = p => ({
    ok: p.errors.length == 0, zen: p.zen, conversion: p.conversion, errors: p.errors, warnings: p.warnings,
    name: p.meta.name ?? null, description: p.meta.description ?? null, version: p.meta.version ?? null,
  });

  app.get("/", async (req) => {
    const { category, q, sort = "popular" } = req.query;
    const page = Math.max(0, Math.min(50, Number.parseInt(req.query.page ?? "0", 10) || 0));
    const where = ["m.status = 'listed'", "m.current_version_id IS NOT NULL"];
    const args = [];
    if (CATEGORIES.includes(category)) where.push(`m.category = $${args.push(category)}`);
    if (typeof q == "string" && q.trim()) where.push(`(m.name ILIKE $${args.push(`%${q.trim().slice(0, 60).replace(/[%_\\]/g, "\\$&")}%`)} OR m.summary ILIKE $${args.length})`);
    const order = sort == "new" ? "m.listed_at DESC" : sort == "updated" ? "v.reviewed_at DESC" : "m.installs DESC, m.listed_at DESC";
    const { rows } = await db.query(
      `SELECT m.*, u.username, v.version, COUNT(*) OVER ()::int AS total
         FROM mods m JOIN users u ON u.id = m.owner_id JOIN mod_versions v ON v.id = m.current_version_id
        WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 24 OFFSET ${page * 24}`, args);
    return { mods: rows.map(card), total: rows[0]?.total ?? 0 };
  });

  app.get("/mine", async (req) => {
    const user = app.user(req);
    const { rows } = await db.query(
      `SELECT m.*, u.username, v.version,
              (SELECT json_build_object('version', l.version, 'status', l.status, 'note', l.review_note, 'created_at', l.created_at)
                 FROM mod_versions l WHERE l.mod_id = m.id ORDER BY l.created_at DESC LIMIT 1) AS latest
         FROM mods m JOIN users u ON u.id = m.owner_id LEFT JOIN mod_versions v ON v.id = m.current_version_id
        WHERE m.owner_id = $1 ORDER BY m.updated_at DESC`, [user.id]);
    return { mods: rows.map(r => ({ ...card(r), status: r.status, latest: r.latest })) };
  });

  async function modBySlug(slug) {
    const { rows: [m] } = await db.query(
      `SELECT m.*, u.username, v.version, v.files, v.checks, v.reviewed_at
         FROM mods m JOIN users u ON u.id = m.owner_id LEFT JOIN mod_versions v ON v.id = m.current_version_id
        WHERE m.slug = $1`, [String(slug).slice(0, 48)]);
    return m;
  }

  const canSee = async (req, m) => m && ((m.status == "listed" && m.current_version_id)
    || (req.auth && (req.auth.user.id == m.owner_id || (await req.auth.perms()).has("mods.review"))));

  app.get("/:slug", async (req) => {
    const m = await modBySlug(req.params.slug);
    if (!(await canSee(req, m))) throw new ApiError(404, "not_found");
    const files = m.files ?? {};
    let prefs = [];
    try {
      prefs = JSON.parse(files["preferences.json"] ?? "[]");
    } catch {}
    const meta = metaOf(files);
    const { rows: imgs } = await db.query("SELECT media_id FROM mod_images WHERE mod_id = $1 ORDER BY position", [m.id]);
    return {
      images: imgs.map(r => mediaUrl(r.media_id)),
      ...card(m), status: m.status, created_at: m.created_at, listed_at: m.listed_at, zen: !!m.checks?.zen,
      author_url: `/u/${m.username}`, homepage: typeof meta.homepage == "string" && /^https:\/\//.test(meta.homepage) ? meta.homepage : null,
      readme: files["readme.md"] ?? "", preferences: Array.isArray(prefs) ? prefs.map(p => ({ property: p.property, label: p.label, type: p.type, options: p.options, defaultValue: p.defaultValue })) : [],
      owner: req.auth?.user.id == m.owner_id,
    };
  });

  app.get("/:slug/package", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const m = await modBySlug(req.params.slug);
    if (!m || m.status != "listed" || !m.current_version_id) throw new ApiError(404, "not_found");
    await db.query("UPDATE mods SET installs = installs + 1 WHERE id = $1", [m.id]);
    return { id: `orbit-${m.slug}`, slug: m.slug, name: m.name, version: m.version, files: m.files };
  });

  app.get("/zen/:id/package", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const id = UUID_RE.exec(req.params.id)?.[0]?.toLowerCase();
    if (!id || id != req.params.id.toLowerCase()) throw bad("zen_link_invalid");
    const hit = zenCache.get(id);
    if (hit && hit.at > Date.now() - 10 * 60_000) return hit.out;
    const p = prepareMod(await app.zenFetch(id), `zen-${id.slice(0, 8)}`);
    if (p.errors.length) throw new ApiError(422, "mod_unsafe", undefined, { errors: p.errors });
    const out = { id, name: p.meta.name ?? id, version: p.meta.version ?? "", files: p.files, conversion: p.conversion };
    zenCache.set(id, { at: Date.now(), out });
    if (zenCache.size > 500) zenCache.delete(zenCache.keys().next().value);
    return out;
  });

  app.post("/check", { ...BIG, config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
    schema: { body: { type: "object", properties: sourceProps } } }, async (req) => {
    app.user(req);
    const { files, images } = await loadSource(req.body);
    return { ...summary(prepareMod(files, "preview")), images: images.length };
  });

  async function addVersion(c, mod, { files, zenId }, version) {
    const p = prepareMod(files, mod.slug);
    if (p.errors.length) throw new ApiError(422, "mod_unsafe", undefined, { errors: p.errors });
    const v = version ?? (typeof p.meta.version == "string" ? p.meta.version : "1.0.0");
    if (!/^[0-9A-Za-z.+-]{1,20}$/.test(v)) throw bad("version_invalid");
    const kept = Object.fromEntries(Object.entries(p.files).filter(([k]) => MOD_FILES.includes(k)));
    const { rows: [row] } = await c.query(
      `INSERT INTO mod_versions (mod_id, version, files, original_css, checks) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mod_id, version) DO NOTHING RETURNING id`,
      [mod.id, v, kept, p.zen ? p.original["chrome.css"] ?? null : null, { zen: p.zen, zen_id: zenId, conversion: p.conversion, warnings: p.warnings }]);
    if (!row) throw new ApiError(409, "version_exists");
    return { version_id: row.id, version: v, ...summary(p) };
  }

  app.post("/", { ...HUGE, config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    schema: { body: { type: "object", required: ["name", "category", "accept"], properties: {
      ...sourceProps, name: { type: "string", maxLength: 60 }, summary: { type: "string", maxLength: 160 },
      category: { enum: CATEGORIES }, version: { type: "string", maxLength: 20 }, accept: { type: "boolean" } } } } }, async (req, reply) => {
    const user = app.user(req, { verified: true });
    app.socialAllowed(req);
    if (!req.body.accept) throw bad("terms_required");
    const name = cleanText(req.body.name, 60);
    if (!name || name.length < 2) throw bad("name_invalid");
    const source = await loadSource(req.body);
    if (!source.images.length) throw bad("images_required");
    const out = await tx(db, async c => {
      let slug = slugify(name);
      const { rows: taken } = await c.query("SELECT slug FROM mods WHERE slug = $1 OR slug LIKE $2", [slug, `${slug}-%`]);
      if (taken.length) slug = `${slug}-${taken.length + 1}`;
      const { rows: [mod] } = await c.query(
        `INSERT INTO mods (slug, owner_id, name, summary, category, source, zen_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, slug`,
        [slug, user.id, name, cleanText(req.body.summary ?? "", 160) ?? "", req.body.category, source.zenId ? "zen" : "upload", source.zenId]);
      const out = { slug: mod.slug, ...(await addVersion(c, mod, source, req.body.version)) };
      await setImages(c, { id: mod.id, owner_id: user.id }, source.images);
      return out;
    });
    return reply.code(201).send(out);
  });

  async function ownMod(req) {
    const user = app.user(req, { verified: true });
    const m = await modBySlug(req.params.slug);
    if (!m || m.owner_id != user.id) throw new ApiError(404, "not_found");
    if (m.status == "removed") throw new ApiError(403, "mod_removed");
    return m;
  }

  app.post("/:slug/versions", { ...HUGE, config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    schema: { body: { type: "object", properties: { ...sourceProps, version: { type: "string", maxLength: 20 } } } } }, async (req, reply) => {
    const m = await ownMod(req);
    const source = await loadSource(req.body);
    const out = await tx(db, async c => {
      await c.query("UPDATE mods SET updated_at = now(), status = CASE WHEN status = 'rejected' THEN 'pending' ELSE status END WHERE id = $1", [m.id]);
      const out = await addVersion(c, m, source, req.body.version);
      if (source.images.length) await setImages(c, m, source.images);
      return out;
    });
    return reply.code(201).send(out);
  });

  app.delete("/:slug", async (req) => {
    const m = await ownMod(req);
    await db.query("DELETE FROM mods WHERE id = $1", [m.id]);
    return { ok: true };
  });
}

export async function modAdminRoutes(app) {
  const db = app.db;
  const guard = req => app.perm(req, "mods.review");

  app.get("/", async (req) => {
    await guard(req);
    const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
    const { rows } = await db.query(
      `SELECT v.id, v.version, v.status, v.created_at, v.checks->'zen' AS zen, jsonb_array_length(v.checks->'warnings') AS warnings,
              m.slug, m.name, m.status AS mod_status, u.username
         FROM mod_versions v JOIN mods m ON m.id = v.mod_id JOIN users u ON u.id = m.owner_id
        WHERE v.status = $1 ORDER BY v.created_at ${status == "pending" ? "ASC" : "DESC"} LIMIT 100`, [status]);
    const { rows: [n] } = await db.query("SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending FROM mod_versions");
    return { versions: rows, pending: n.pending };
  });

  app.get("/versions/:id", async (req) => {
    await guard(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new ApiError(404, "not_found");
    const { rows: [v] } = await db.query(
      `SELECT v.*, m.slug, m.name, m.summary, m.category, m.source, m.status AS mod_status, u.username
         FROM mod_versions v JOIN mods m ON m.id = v.mod_id JOIN users u ON u.id = m.owner_id WHERE v.id = $1`, [req.params.id]);
    if (!v) throw new ApiError(404, "not_found");
    const { rows: imgs } = await db.query("SELECT media_id FROM mod_images WHERE mod_id = $1 ORDER BY position", [v.mod_id]);
    return { ...v, images: imgs.map(r => mediaUrl(r.media_id)) };
  });

  app.post("/versions/:id/review", { schema: { body: { type: "object", required: ["action"], properties: {
    action: { enum: ["approve", "reject"] }, note: { type: "string", maxLength: 1000 } } } } }, async (req) => {
    await guard(req);
    const note = cleanText(req.body.note ?? "", 1000) || null;
    if (req.body.action == "reject" && !note) throw bad("note_required");
    const done = await tx(db, async c => {
      const { rows: [v] } = await c.query(
        `SELECT v.id, v.mod_id, v.version, m.owner_id, m.name, m.slug, m.current_version_id FROM mod_versions v JOIN mods m ON m.id = v.mod_id
          WHERE v.id = $1 AND v.status = 'pending' FOR UPDATE OF v`, [req.params.id]);
      if (!v) throw new ApiError(409, "not_pending");
      if (req.body.action == "approve") {
        await c.query("UPDATE mod_versions SET status = 'superseded' WHERE mod_id = $1 AND status = 'approved'", [v.mod_id]);
        await c.query("UPDATE mod_versions SET status = 'approved', review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1",
          [v.id, note, req.auth.user.id]);
        await c.query(
          `UPDATE mods SET current_version_id = $2, status = 'listed', listed_at = COALESCE(listed_at, now()), updated_at = now() WHERE id = $1`,
          [v.mod_id, v.id]);
      } else {
        await c.query("UPDATE mod_versions SET status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1",
          [v.id, note, req.auth.user.id]);
        if (!v.current_version_id) await c.query("UPDATE mods SET status = 'rejected', updated_at = now() WHERE id = $1", [v.mod_id]);
      }
      await audit(c, { actorId: req.auth.user.id, action: `mod.${req.body.action}`, targetType: "mod", targetId: v.slug,
        reason: note, meta: { version: v.version }, ip: req.ip });
      await notify(c, v.owner_id, "mod_review", { mod: v.slug, name: v.name, version: v.version, approved: req.body.action == "approve", note });
      return { ok: true };
    });
    return done;
  });

  app.post("/:slug/remove", { schema: { body: { type: "object", required: ["reason"], properties: { reason: { type: "string", maxLength: 1000 } } } } },
    async (req) => {
      await guard(req);
      const reason = cleanText(req.body.reason, 1000);
      if (!reason) throw bad("reason_required");
      const { rows: [m] } = await db.query("UPDATE mods SET status = 'removed', updated_at = now() WHERE slug = $1 RETURNING owner_id, name, slug", [req.params.slug]);
      if (!m) throw new ApiError(404, "not_found");
      await audit(db, { actorId: req.auth.user.id, action: "mod.remove", targetType: "mod", targetId: m.slug, reason, ip: req.ip });
      await notify(db, m.owner_id, "mod_review", { mod: m.slug, name: m.name, removed: true, note: reason });
      return { ok: true };
    });
}
