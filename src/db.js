import pg from "pg";
import { readdir, readFile } from "node:fs/promises";

pg.types.setTypeParser(20, v => Number(v));

export function createPool(url) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on("error", e => console.error("database connection lost:", e.message));
  return pool;
}

export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate(pool, dir = new URL("../migrations/", import.meta.url)) {
  const files = (await readdir(dir)).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
  return tx(pool, async c => {
    await c.query("SELECT pg_advisory_xact_lock(727274)");
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query("SELECT version FROM schema_migrations")).rows.map(r => r.version));
    const applied = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query(await readFile(new URL(f, dir), "utf8"));
      await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [f]);
      applied.push(f);
    }
    return applied;
  });
}
