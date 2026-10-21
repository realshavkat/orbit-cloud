import pg from "pg";
import { to as copyTo, from as copyFrom } from "pg-copy-streams";
import { createGzip, createGunzip } from "node:zlib";
import { createWriteStream, createReadStream, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { migrate } from "./db.js";

async function tablesOf(c) {
  const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return rows.map(r => r.tablename);
}

export async function dump(conn, root) {
  const dir = join(root, `orbit-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  const c = new pg.Client(conn);
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await tablesOf(c);
    for (const t of tables) {
      await pipeline(c.query(copyTo(`COPY "${t}" TO STDOUT`)), createGzip(), createWriteStream(join(dir, `${t}.copy.gz`)));
    }
    const { rows } = await c.query("SELECT version FROM schema_migrations ORDER BY version");
    await c.query("COMMIT");
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ created: new Date(), tables, migrations: rows.map(r => r.version) }, null, 1));
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw e;
  } finally {
    await c.end();
  }
  return dir;
}

export function listBackups(root) {
  try {
    return readdirSync(root).filter(f => f.startsWith("orbit-") && !f.endsWith(".dump")).sort();
  } catch {
    return [];
  }
}

export function prune(root, keep = 14) {
  for (const old of listBackups(root).slice(0, -keep)) rmSync(join(root, old), { recursive: true, force: true });
}

export async function restore(conn, dir) {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const pool = new pg.Pool({ ...conn, max: 1 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
  const c = new pg.Client(conn);
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    const tables = await tablesOf(c);
    await c.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(", ")} CASCADE`);
    for (const t of meta.tables) {
      if (!tables.includes(t)) continue;
      await pipeline(createReadStream(join(dir, `${t}.copy.gz`)), createGunzip(), c.query(copyFrom(`COPY "${t}" FROM STDIN`)));
    }
    const { rows: seqs } = await c.query(
      `SELECT c.relname AS t, a.attname AS col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0
          AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`);
    for (const s of seqs) await c.query(`SELECT setval($1, COALESCE((SELECT MAX("${s.col}") FROM "${s.t}"), 0) + 1, false)`, [s.seq]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  return meta;
}
