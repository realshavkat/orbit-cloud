// Local development: a persistent PostgreSQL in ./.dev-pg and the API on :8790.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const dir = new URL("../.dev-pg", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const fresh = !existsSync(`${dir}/PG_VERSION`);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "dev-only-password", port: 54329, persistent: true, onLog: () => {} });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("orbit");
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const api = spawn(process.execPath, [`${root}api.mjs`], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: "postgres://postgres:dev-only-password@127.0.0.1:54329/orbit", APP_BASE_URL: "http://localhost:8790",
    MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? randomBytes(32).toString("hex"), PORT: "8790" },
});
const stop = async () => {
  api.kill();
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", stop);
