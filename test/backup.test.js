import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { setup, member } from "./helpers.js";
import { dump, restore } from "../src/backup.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

test("a backup restores into an empty database with the same data", async () => {
  const a = await member(ctx);
  await a.patch("/api/v1/me/profile", { bio: "kept by the backup" });
  const url = new URL(process.env.DATABASE_URL);
  const conn = db => ({ host: url.hostname, port: Number(url.port), user: url.username, password: decodeURIComponent(url.password), database: db });
  const dir = mkdtempSync(join(tmpdir(), "orbit-backup-"));
  const admin = new pg.Client(conn("postgres"));
  await admin.connect();
  try {
    const folder = await dump(conn(url.pathname.slice(1)), dir);
    await admin.query("DROP DATABASE IF EXISTS orbit_restore_t");
    await admin.query("CREATE DATABASE orbit_restore_t");
    await restore(conn("orbit_restore_t"), folder);
    const r = new pg.Client(conn("orbit_restore_t"));
    await r.connect();
    const count = async (c, sql) => (await c.query(sql)).rows[0].n;
    for (const table of ["users", "user_badges", "badges", "admin_audit_logs", "schema_migrations", "roles"]) {
      assert.equal(await count(r, `SELECT COUNT(*)::int AS n FROM ${table}`), await count(ctx.pool, `SELECT COUNT(*)::int AS n FROM ${table}`), table);
    }
    assert.equal((await r.query("SELECT bio FROM user_profiles WHERE user_id = $1", [a.id])).rows[0].bio, "kept by the backup");
    // Ids keep counting after the restored rows, and the audit log is still append-only.
    await r.query("INSERT INTO admin_audit_logs (action) VALUES ('restore.test')");
    await assert.rejects(r.query("DELETE FROM admin_audit_logs"), /append-only/);
    await r.end();
  } finally {
    await admin.query("DROP DATABASE IF EXISTS orbit_restore_t");
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
