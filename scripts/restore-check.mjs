import { join, dirname } from "node:path";
import pg from "pg";
import { loadDotEnv } from "../src/config.js";
import { restore, listBackups } from "../src/backup.js";

loadDotEnv();
const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const PORT = Number(process.env.SERVER_PORT || process.env.PG_PORT || 5432);
const conn = db => ({ host: "127.0.0.1", port: PORT, user: "postgres", password: process.env.PG_SUPERUSER_PASSWORD, database: db });
const into = process.argv.includes("--into-orbit");
const name = process.argv.slice(2).find(a => !a.startsWith("--")) ?? listBackups(join(ROOT, "backups")).at(-1);
if (!name) throw new Error("no backup in ./backups (type `backup` in the console first)");
if (into && process.env.CONFIRM_RESTORE != "orbit") throw new Error("set CONFIRM_RESTORE=orbit to replace the live database");
const target = into ? "orbit" : "orbit_restore_check";

const admin = new pg.Client(conn("postgres"));
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${target}${into ? " OWNER orbit" : ""}`);
try {
  const meta = await restore(conn(target), join(ROOT, "backups", name));
  const c = new pg.Client(conn(target));
  await c.connect();
  for (const table of ["users", "user_badges", "donations", "admin_audit_logs", "schema_migrations"]) {
    const { rows } = await c.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    console.log(`${table}: ${rows[0].n}`);
  }
  if (into) {
    await c.query(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO orbit', r.tablename); END LOOP;
      FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO orbit', r.f); END LOOP;
    END $$`);
  }
  await c.end();
  console.log(`restore OK from ${name} (${meta.tables.length} tables, backup of ${meta.created})`);
} finally {
  if (!into) await admin.query(`DROP DATABASE IF EXISTS ${target}`);
  await admin.end();
}
