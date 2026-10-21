// PostgreSQL for Orbit, run from portable binaries (the embedded-postgres
// package) so it works on a plain Node.js server without root.
// First start: creates the cluster, the "orbit" database and its own role
// (not a superuser), scram-sha-256 passwords, connections only from private
// networks. Then: a dump every night, the 14 last kept in ./backups.
//
// Variables (Pelican panel, never in Git):
//   PG_SUPERUSER_PASSWORD  admin password, used only here
//   PG_APP_PASSWORD        password of the "orbit" role the API uses
//   SERVER_PORT            port given by Pelican (the allocation)
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, statSync } from "node:fs";
import { readFile, symlink } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { loadDotEnv } from "./src/config.js";

loadDotEnv();
const ROOT = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const DATA = join(ROOT, "pgdata");
const BACKUPS = join(ROOT, "backups");
const PORT = Number(process.env.SERVER_PORT || process.env.PG_PORT || 5432);
const SUPER = process.env.PG_SUPERUSER_PASSWORD;
const APP = process.env.PG_APP_PASSWORD;
if (!SUPER || SUPER.length < 24 || !APP || APP.length < 24) {
  console.error("PG_SUPERUSER_PASSWORD and PG_APP_PASSWORD must be set (24+ characters).");
  process.exit(1);
}

// The binaries for this platform, from the embedded-postgres package.
const pkg = `@embedded-postgres/${process.platform == "win32" ? "windows" : process.platform}-${process.arch}`;
const NATIVE = join(ROOT, "node_modules", pkg, "native");
const bin = name => join(NATIVE, "bin", process.platform == "win32" ? `${name}.exe` : name);

// npm may skip the package's install script; its library links are rebuilt here.
async function hydrateSymlinks() {
  const file = join(NATIVE, "pg-symlinks.json");
  if (!existsSync(file)) return;
  // Paths are relative to the package folder; each link sits next to its library.
  const base = dirname(NATIVE);
  for (const { source, target } of JSON.parse(await readFile(file, "utf8"))) {
    const link = join(base, target);
    if (!existsSync(link)) await symlink(relative(dirname(link), join(base, source)), link).catch(() => {});
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
    p.on("exit", code => (code == 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

async function initCluster() {
  const pw = join(ROOT, ".pwfile");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(pw, SUPER, { mode: 0o600 });
  try {
    await run(bin("initdb"), ["-D", DATA, "-U", "postgres", "--pwfile", pw, "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", "-E", "UTF8", "--locale=C"]);
  } finally {
    rmSync(pw, { force: true });
  }
  const { appendFile, writeFile: write } = await import("node:fs/promises");
  // Only private addresses (the Docker network between Pelican servers) may connect.
  await write(join(DATA, "pg_hba.conf"), [
    "# TYPE  DATABASE  USER      ADDRESS          METHOD",
    "local   all       all                        scram-sha-256",
    "host    all       postgres  127.0.0.1/32     scram-sha-256",
    "host    orbit     orbit     127.0.0.1/32     scram-sha-256",
    "host    orbit     orbit     10.0.0.0/8       scram-sha-256",
    "host    orbit     orbit     172.16.0.0/12    scram-sha-256",
    "host    orbit     orbit     192.168.0.0/16   scram-sha-256",
    "",
  ].join("\n"));
  await appendFile(join(DATA, "postgresql.conf"), [
    "",
    "# Orbit",
    "listen_addresses = '*'",
    "password_encryption = scram-sha-256",
    "max_connections = 50",
    "shared_buffers = 128MB",
    "log_connections = off",
    "log_min_duration_statement = 2000",
    "",
  ].join("\n"));
}

let server;
function startPostgres() {
  server = spawn(bin("postgres"), ["-D", DATA, "-p", String(PORT), "-c", `unix_socket_directories=${process.platform == "win32" ? "" : DATA}`],
    { stdio: ["ignore", "inherit", "inherit"] });
  server.on("exit", code => {
    console.log(`postgres exited (${code})`);
    process.exit(code ?? 1);
  });
}

async function connect(user, password, database = "postgres") {
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ host: "127.0.0.1", port: PORT, user, password, database });
    try {
      await c.connect();
      return c;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error("postgres did not start");
}

// The application role owns only its database and has no other right.
async function ensureAppDatabase() {
  const c = await connect("postgres", SUPER);
  try {
    const role = await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'orbit'");
    const lit = c.escapeLiteral(APP);
    if (!role.rows.length) await c.query(`CREATE ROLE orbit LOGIN PASSWORD ${lit} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30`);
    else await c.query(`ALTER ROLE orbit PASSWORD ${lit}`);
    await c.query(`ALTER ROLE postgres PASSWORD ${c.escapeLiteral(SUPER)}`);
    const db = await c.query("SELECT 1 FROM pg_database WHERE datname = 'orbit'");
    if (!db.rows.length) await c.query("CREATE DATABASE orbit OWNER orbit ENCODING 'UTF8' TEMPLATE template0");
    await c.query("REVOKE ALL ON DATABASE orbit FROM PUBLIC");
    await c.query("GRANT CONNECT, TEMPORARY ON DATABASE orbit TO orbit");
  } finally {
    await c.end();
  }
  const d = await connect("postgres", SUPER, "orbit");
  try {
    await d.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await d.query("ALTER SCHEMA public OWNER TO orbit");
  } finally {
    await d.end();
  }
}

// Nightly pg_dump (custom format), 14 kept. Tested with scripts/restore-check.mjs.
export async function backup() {
  mkdirSync(BACKUPS, { recursive: true });
  const file = join(BACKUPS, `orbit-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  await run(bin("pg_dump"), ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", "orbit", "-F", "c", "-f", file],
    { env: { ...process.env, PGPASSWORD: SUPER } });
  const dumps = readdirSync(BACKUPS).filter(f => f.endsWith(".dump")).sort();
  for (const old of dumps.slice(0, -14)) rmSync(join(BACKUPS, old));
  console.log(`backup ${file} (${statSync(file).size} bytes)`);
}

await hydrateSymlinks();
const fresh = !existsSync(join(DATA, "PG_VERSION"));
if (fresh) await initCluster();
// A crash can leave this file; postgres refuses to start with a stale one.
const pid = join(DATA, "postmaster.pid");
if (existsSync(pid)) {
  const other = Number(readFileSync(pid, "utf8").split("\n")[0]);
  let alive = false;
  try {
    process.kill(other, 0);
    alive = true;
  } catch {}
  if (!alive) rmSync(pid);
}
startPostgres();
await ensureAppDatabase();
const { networkInterfaces } = await import("node:os");
const addrs = Object.values(networkInterfaces()).flat().filter(a => a.family == "IPv4" && !a.internal).map(a => a.address);
console.log(`Orbit PostgreSQL ready on port ${PORT}${fresh ? " (new cluster)" : ""}; container address ${addrs.join(", ")}`);

const msToNight = () => {
  const n = new Date();
  const t = new Date(n);
  t.setUTCHours(3, 0, 0, 0);
  if (t <= n) t.setUTCDate(t.getUTCDate() + 1);
  return t - n;
};
const schedule = () => setTimeout(async () => {
  await backup().catch(e => console.error("backup failed", e));
  schedule();
}, msToNight());
schedule();

// Pelican's "stop" (stdin) and signals: a clean, fast shutdown.
const stop = () => server?.kill("SIGINT");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("data", d => {
  const cmd = String(d).trim();
  if (cmd == "stop") stop();
  if (cmd == "backup") backup().catch(e => console.error("backup failed", e));
});
