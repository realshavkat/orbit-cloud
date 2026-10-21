import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const auto = process.env.AUTO_UPDATE == "1" && existsSync(join(root, ".git"));
const branch = process.env.BRANCH || "main";
const every = Math.max(30, Number(process.env.UPDATE_INTERVAL_SECONDS) || 120) * 1000;
const log = msg => console.log(JSON.stringify({ level: 30, time: Date.now(), msg: `updater: ${msg}` }));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function sync() {
  try {
    git("fetch", "--quiet", "origin", branch);
    const head = git("rev-parse", "HEAD");
    const target = git("rev-parse", `origin/${branch}`);
    if (head == target && !git("status", "--porcelain", "--untracked-files=no")) return false;
    const deps = head != target && git("diff", "--name-only", head, target, "--", "package.json", "package-lock.json") != "";
    git("reset", "--hard", target);
    log(`now at ${target.slice(0, 7)} (was ${head.slice(0, 7)})`);
    if (deps) execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
    return true;
  } catch (e) {
    log(`update failed: ${e.stderr?.toString().trim() || e.message}`);
    return false;
  }
}

let child = null;
let stopping = false;
let restarting = false;

function start() {
  child = spawn(process.execPath, [...process.execArgv, join(root, "server.mjs")], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return process.exit(0);
    if (restarting) {
      restarting = false;
      return start();
    }
    log(`app stopped (${code ?? signal}), starting again in 5 s`);
    setTimeout(start, 5000);
  });
}

function restart() {
  if (!child) return start();
  restarting = true;
  child.kill("SIGTERM");
}

function stop() {
  stopping = true;
  if (child) child.kill("SIGTERM");
  else process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("data", d => String(d).trim() == "stop" && stop());

if (auto) sync();
start();
if (auto) setInterval(() => sync() && restart(), every);
