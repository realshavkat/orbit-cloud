import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, client } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "orbit-dl-"));
let ctx;
before(async () => (ctx = await setup({ downloadsDir: dir })));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
  rmSync(dir, { recursive: true, force: true });
});

test("the installer is served by the site, newest version first", async () => {
  const anon = client(ctx.app);
  assert.equal((await anon.get("/api/v1/download")).body.error, "download_unavailable");
  assert.equal((await anon.get("/download")).res.headers.location, "/beta?download=unavailable");

  writeFileSync(join(dir, "Orbit-Setup-158.0.5.exe"), "old");
  writeFileSync(join(dir, "Orbit-Setup-158.0.10.exe"), "newest");
  writeFileSync(join(dir, "Orbit-Setup-158.0.6.exe"), "mid");
  writeFileSync(join(dir, "notes.txt"), "ignored");

  const info = (await anon.get("/api/v1/download")).body;
  assert.equal(info.version, "158.0.10");
  assert.equal(info.size, 6);
  assert.equal(info.url, "/download");

  const file = await anon.get("/download");
  assert.equal(file.status, 200);
  assert.match(file.res.headers["content-disposition"], /attachment; filename="Orbit-Setup-158\.0\.10\.exe"/);
  assert.equal(file.res.body, "newest");
});
