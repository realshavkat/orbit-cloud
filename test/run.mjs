// npm test: starts a throwaway PostgreSQL (portable binaries), runs every
// test file against it, then removes it.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "orbit-pg-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const password = randomBytes(12).toString("hex");
const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password, port, persistent: false, onLog: () => {} });
let code = 1;
try {
  await server.initialise();
  await server.start();
  await server.createDatabase("orbit_test");
  const files = readdirSync(new URL(".", import.meta.url)).filter(f => f.endsWith(".test.js")).map(f => join("test", f));
  const only = process.argv.slice(2);
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...(only.length ? only : files)], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/orbit_test` },
  });
  code = r.status ?? 1;
} finally {
  await server.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
