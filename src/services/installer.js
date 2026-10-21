import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SETUP = /^Orbit-Setup-(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?\.exe$/;
const order = name => SETUP.exec(name).slice(1).map(x => Number(x ?? 0));
const newer = (a, b) => order(b).reduce((d, x, i) => d || x - order(a)[i], 0);
const headers = { accept: "application/vnd.github+json", "user-agent": "orbit-cloud" };

export async function syncInstaller({ dir, repo, log, fetchImpl = fetch, keep = 2 }) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const asset = (await res.json()).assets?.find(a => SETUP.test(a.name));
  if (!asset) return null;
  await mkdir(dir, { recursive: true });
  const target = join(dir, asset.name);
  if ((await stat(target).catch(() => null))?.size == asset.size) return { file: asset.name, fresh: false };

  const file = await fetchImpl(asset.browser_download_url, { headers: { "user-agent": "orbit-cloud" }, redirect: "follow" });
  if (!file.ok || !file.body) throw new Error(`download answered ${file.status}`);
  const part = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(file.body), createWriteStream(part));
    if ((await stat(part)).size != asset.size) throw new Error("incomplete download");
    await rename(part, target);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
  const old = (await readdir(dir)).filter(f => SETUP.test(f)).sort(newer).slice(keep);
  await Promise.all(old.map(f => rm(join(dir, f), { force: true })));
  log?.info({ file: asset.name }, "installer updated from GitHub");
  return { file: asset.name, fresh: true };
}
