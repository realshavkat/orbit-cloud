// Restore test: loads the newest dump of ./backups into a scratch database,
// counts the rows of the main tables, then drops the scratch database.
// Run on the database server: node scripts/restore-check.mjs
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { loadDotEnv } from "../src/config.js";

loadDotEnv();
const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const PORT = Number(process.env.SERVER_PORT || process.env.PG_PORT || 5432);
const SUPER = process.env.PG_SUPERUSER_PASSWORD;
const pkg = `@embedded-postgres/${process.platform == "win32" ? "windows" : process.platform}-${process.arch}`;
const bin = name => join(ROOT, "node_modules", pkg, "native", "bin", process.platform == "win32" ? `${name}.exe` : name);

const dumps = readdirSync(join(ROOT, "backups")).filter(f => f.endsWith(".dump")).sort();
if (!dumps.length) throw new Error("no dump in ./backups (type `backup` in the console first)");
const file = join(ROOT, "backups", dumps.at(-1));
const admin = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: SUPER, database: "postgres" });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS orbit_restore_check");
await admin.query("CREATE DATABASE orbit_restore_check");
try {
  const r = spawnSync(bin("pg_restore"), ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", "orbit_restore_check", "--no-owner", file],
    { env: { ...process.env, PGPASSWORD: SUPER }, stdio: "inherit" });
  if (r.status != 0) throw new Error(`pg_restore exited with ${r.status}`);
  const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: SUPER, database: "orbit_restore_check" });
  await c.connect();
  for (const table of ["users", "user_badges", "donations", "admin_audit_logs", "schema_migrations"]) {
    const { rows } = await c.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    console.log(`${table}: ${rows[0].n}`);
  }
  await c.end();
  console.log(`restore OK from ${dumps.at(-1)}`);
} finally {
  await admin.query("DROP DATABASE IF EXISTS orbit_restore_check");
  await admin.end();
}
