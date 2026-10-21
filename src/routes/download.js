import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "../lib/validate.js";

const NAME = /^Orbit-Setup-(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?\.exe$/;

export async function latestSetup(dir) {
  const files = await readdir(dir).catch(() => []);
  const found = files.map(file => [file, NAME.exec(file)]).filter(([, m]) => m)
    .map(([file, m]) => ({ file, version: m.slice(1).filter(Boolean).join("."), key: m.slice(1).map(x => Number(x ?? 0)) }))
    .sort((a, b) => a.key.reduce((d, x, i) => d || b.key[i] - x, 0));
  if (!found.length) return null;
  const s = await stat(join(dir, found[0].file));
  return { file: found[0].file, version: found[0].version, size: s.size, updated_at: s.mtime };
}

export default async function downloadRoutes(app, { dir }) {
  app.get("/api/v1/download", async () => {
    const setup = await latestSetup(dir);
    if (!setup) throw new ApiError(404, "download_unavailable");
    return { ...setup, url: "/download" };
  });

  app.get("/download", async (req, reply) => {
    const setup = await latestSetup(dir);
    if (!setup) return reply.redirect("/beta?download=unavailable");
    return reply
      .header("Content-Type", "application/vnd.microsoft.portable-executable")
      .header("Content-Disposition", `attachment; filename="${setup.file}"`)
      .header("Content-Length", setup.size)
      .header("Cache-Control", "no-cache")
      .send(createReadStream(join(dir, setup.file)));
  });
}
