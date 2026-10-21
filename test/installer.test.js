import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncInstaller } from "../src/services/installer.js";

const release = (name, body) => async url => {
  if (url.includes("/releases/latest")) {
    return Response.json({ assets: [{ name: "windows.mar", size: 1, browser_download_url: "x" }, { name, size: body.length, browser_download_url: `https://dl/${name}` }] });
  }
  return new Response(body);
};

test("the newest GitHub installer is downloaded once, older ones are pruned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-inst-"));
  try {
    writeFileSync(join(dir, "Orbit-Setup-158.0.4.exe"), "a");
    writeFileSync(join(dir, "Orbit-Setup-158.0.5.exe"), "bb");
    const first = await syncInstaller({ dir, repo: "o/r", fetchImpl: release("Orbit-Setup-158.0.6.exe", "setup-bytes") });
    assert.deepEqual(first, { file: "Orbit-Setup-158.0.6.exe", fresh: true });
    assert.equal(readFileSync(join(dir, "Orbit-Setup-158.0.6.exe"), "utf8"), "setup-bytes");
    assert.deepEqual(readdirSync(dir).sort(), ["Orbit-Setup-158.0.5.exe", "Orbit-Setup-158.0.6.exe"]);

    let downloads = 0;
    const again = await syncInstaller({ dir, repo: "o/r", fetchImpl: async (url, o) => (url.startsWith("https://dl/") && downloads++, release("Orbit-Setup-158.0.6.exe", "setup-bytes")(url, o)) });
    assert.equal(again.fresh, false);
    assert.equal(downloads, 0, "same size: nothing downloaded");

    await assert.rejects(syncInstaller({ dir, repo: "o/r", fetchImpl: async url => (url.includes("latest")
      ? Response.json({ assets: [{ name: "Orbit-Setup-158.0.7.exe", size: 999, browser_download_url: "https://dl/x" }] }) : new Response("short")) }), /incomplete/);
    assert.ok(!readdirSync(dir).some(f => f.endsWith(".part") || f.includes("158.0.7")), "a broken download leaves nothing behind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
