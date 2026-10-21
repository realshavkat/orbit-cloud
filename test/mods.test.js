import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { setup, client, member, grantRole } from "./helpers.js";
import { prepareMod, checkMod, convertZen } from "../src/lib/mods.js";

const ZEN_ID = "a6335949-4465-4b71-926c-4a52d34bc9c0";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c70000000049454e44ae426082", "hex");
const zenFiles = {
  "theme.json": JSON.stringify({ id: ZEN_ID, name: "Nord Night", description: "Nord everywhere", version: "1.4.0",
    style: `https://raw.githubusercontent.com/zen-browser/theme-store/main/themes/${ZEN_ID}/chrome.css` }),
  "chrome.css": `#zen-sidebar-top-buttons { background: var(--zen-colors-primary); }
.zen-workspace-tabs-section .tabbrowser-tab { border-radius: var(--zen-border-radius); }
@media (-moz-bool-pref: "zen.theme.nord.glow") { #zen-essentials-container { color: var(--zen-theme-nord-accent); } }
:root[zen-theme-nord-variant="frost"] #zen-split-view-thing { color: red; }
@media (-moz-bool-pref: "zen.view.compact") { #navigator-toolbox { opacity: .9; } }`,
  "preferences.json": JSON.stringify([
    { property: "zen.theme.nord.glow", label: "Glow", type: "checkbox", defaultValue: true },
    { property: "zen.theme.nord.accent", label: "Accent", type: "string", defaultValue: "#88C0D0" },
    { property: "zen.theme.nord.variant", label: "Variant", type: "dropdown", options: [{ label: "Frost", value: "frost" }] },
  ]),
  "readme.md": "# Nord Night",
};

let ctx;
before(async () => (ctx = await setup({ zenFetch: async id => {
  if (id != ZEN_ID) throw Object.assign(new Error("nf"), { status: 404 });
  return { ...zenFiles };
}, zenImage: async () => PNG })));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

test("Zen mods are detected and their names moved to Orbit's", () => {
  const p = prepareMod(zenFiles, "nord-night");
  assert.equal(p.zen, true);
  assert.deepEqual(p.errors, []);
  const css = p.files["chrome.css"];
  assert.match(css, /#orbit-sidebar-header \{ background: var\(--orbit-accent\)/);
  assert.match(css, /#vertical-tabs \.tabbrowser-tab \{ border-radius: var\(--orbit-radius\)/);
  assert.match(css, /-moz-bool-pref: "orbit\.mod\.nord-night\.theme\.nord\.glow"/);
  assert.match(css, /var\(--orbit-mod-nord-night-theme-nord-accent\)/, "string pref variable follows the rename");
  assert.match(css, /:root\[orbit-mod-nord-night-theme-nord-variant="frost"\]/, "dropdown attribute follows the rename");
  assert.match(css, /-moz-bool-pref: "orbit\.view\.compact"/, "Zen's own pref maps to Orbit's");
  const prefs = JSON.parse(p.files["preferences.json"]);
  assert.deepEqual(prefs.map(x => x.property), ["orbit.mod.nord-night.theme.nord.glow", "orbit.mod.nord-night.theme.nord.accent", "orbit.mod.nord-night.theme.nord.variant"]);
  assert.ok(p.conversion.unsupported.includes("#zen-split-view-thing"));
  assert.ok(p.warnings.some(w => w.code == "zen_unsupported"));
  assert.ok(p.conversion.selectors >= 3 && p.conversion.variables >= 2);
});

test("checks refuse code, remote content and browser settings", () => {
  const css = c => checkMod({ "chrome.css": c }).errors.map(e => e.code);
  assert.deepEqual(css("#urlbar { color: red; }"), []);
  assert.ok(css("@import url(https://evil.example/x.css);").includes("remote_content"));
  assert.ok(css("#a { background: url('https://evil.example/track.png') }").includes("remote_content"));
  assert.ok(css("#a { background: url(//evil.example/x) }").includes("remote_content"));
  assert.ok(css("#a { -moz-binding: url(x.xml#b) }").includes("code_in_css"));
  assert.ok(css(`#a { background: url("data:image/svg+xml,<svg onload='alert(1)'/>") }`).includes("svg_script"));
  assert.deepEqual(css("#a { background: url(data:image/png;base64,AAAA) } #b { list-style-image: url(chrome://global/skin/x.svg) }"), []);
  assert.ok(checkMod({ "chrome.css": "a{}", "evil.js": "alert(1)" }).errors.some(e => e.code == "file_not_allowed"));
  const pref = checkMod({ "chrome.css": "a{}", "preferences.json": JSON.stringify([{ property: "network.proxy.http", type: "string" }]) });
  assert.ok(pref.errors.some(e => e.code == "pref_not_allowed"));
  const zenOdd = convertZen({ "chrome.css": "#zen-x{}", "preferences.json": JSON.stringify([{ property: "nord.glow", type: "checkbox" }]) }, "n");
  assert.equal(JSON.parse(zenOdd.files["preferences.json"])[0].property, "orbit.mod.n.nord.glow");
});

test("submit, review, list, install; rejected needs a note; packages only after approval", async () => {
  const author = await member(ctx);
  const noPic = await author.post("/api/v1/mods", { name: "No picture", category: "tabs", accept: true, files: { "chrome.css": "#urlbar { color: red; }" } });
  assert.equal(noPic.body.error, "images_required", "a mod needs at least one picture");
  const notPic = await author.post("/api/v1/mods", { name: "Fake", category: "tabs", accept: true, files: { "chrome.css": "a{}" }, images: [Buffer.from("<script>").toString("base64")] });
  assert.equal(notPic.body.error, "file_type");
  const bad = await author.post("/api/v1/mods", { name: "Evil", category: "tabs", accept: true, images: [PNG.toString("base64")],
    files: { "chrome.css": "@import url(https://evil.example/a.css);" } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error, "mod_unsafe");

  const check = await author.post("/api/v1/mods/check", { zen: `https://zen-browser.app/mods/${ZEN_ID}` });
  assert.equal(check.body.ok, true);
  assert.equal(check.body.zen, true);

  const sub = await author.post("/api/v1/mods", { name: "Nord Night", summary: "Nord everywhere", category: "colors", accept: true,
    zen: `https://zen-browser.app/mods/${ZEN_ID}` });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const slug = sub.body.slug;
  assert.equal(sub.body.version, "1.4.0");

  const anon = client(ctx.app);
  assert.equal((await anon.get(`/api/v1/mods/${slug}`)).status, 404, "pending mods are not public");
  assert.equal((await anon.get(`/api/v1/mods/${slug}/package`)).status, 404);
  assert.equal((await author.get(`/api/v1/mods/${slug}`)).status, 200, "the author sees it");

  const mod = await member(ctx);
  assert.equal((await mod.get("/api/v1/admin/mods")).status, 403);
  await grantRole(ctx.pool, mod.id, "moderator");
  const queue = await mod.get("/api/v1/admin/mods");
  const item = queue.body.versions.find(v => v.slug == slug);
  assert.ok(item);
  const full = await mod.get(`/api/v1/admin/mods/versions/${item.id}`);
  assert.match(full.body.original_css, /#zen-sidebar-top-buttons/, "reviewer sees the original");
  assert.equal((await mod.post(`/api/v1/admin/mods/versions/${item.id}/review`, { action: "reject" })).body.error, "note_required");
  assert.equal((await mod.post(`/api/v1/admin/mods/versions/${item.id}/review`, { action: "approve" })).status, 200);

  const list = await anon.get("/api/v1/mods?category=colors");
  assert.ok(list.body.mods.some(m => m.slug == slug));
  const pkg = await anon.get(`/api/v1/mods/${slug}/package`);
  assert.equal(pkg.status, 200);
  assert.match(pkg.body.files["chrome.css"], /#orbit-sidebar-header/);
  const page = (await anon.get(`/api/v1/mods/${slug}`)).body;
  assert.equal(page.installs, 1);
  assert.equal(page.images.length, 1, "Zen's picture came along");
  assert.equal((await anon.get(page.images[0])).res.headers["content-type"], "image/png");

  const notes = await author.get("/api/v1/notifications");
  assert.ok(JSON.stringify(notes.body).includes("mod_review"));

  const v2 = await author.post(`/api/v1/mods/${slug}/versions`, { version: "1.5.0", files: { "chrome.css": "#urlbar { color: red; }" } });
  assert.equal(v2.status, 201);
  assert.equal((await anon.get(`/api/v1/mods/${slug}/package`)).body.version, "1.4.0");
  const q2 = await mod.get("/api/v1/admin/mods");
  const item2 = q2.body.versions.find(v => v.slug == slug);
  assert.equal((await mod.post(`/api/v1/admin/mods/versions/${item2.id}/review`, { action: "reject", note: "Breaks the address bar" })).status, 200);
  assert.equal((await anon.get(`/api/v1/mods/${slug}/package`)).body.version, "1.4.0", "rejecting an update keeps the listed version");

  const other = await member(ctx);
  assert.equal((await other.post(`/api/v1/mods/${slug}/versions`, { files: { "chrome.css": "a{}" }, version: "9.0.0" })).status, 404);
});

test("Zen package endpoint converts on the fly and refuses unknown ids", async () => {
  const anon = client(ctx.app);
  const r = await anon.get(`/api/v1/mods/zen/${ZEN_ID}/package`);
  assert.equal(r.status, 200);
  assert.match(r.body.files["chrome.css"], /--orbit-accent/);
  assert.equal((await anon.get("/api/v1/mods/zen/not-an-id/package")).status, 400);
});

function makeZip(entries) {
  const { deflateRawSync, crc32 } = zlib;
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content), packed = deflateRawSync(data), nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, packed);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test(".zip upload: any mod (not only Zen), images inlined, junk and scripts handled", async () => {
  const author = await member(ctx);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c70000000049454e44ae426082", "hex");
  const zip = makeZip({
    "my-mod/theme.json": JSON.stringify({ name: "Quiet Toolbar", version: "0.3.0" }),
    "my-mod/chrome.css": "#nav-bar { background: url(./img/bg.png) no-repeat; }",
    "my-mod/img/bg.png": png,
    "my-mod/preview.png": png,
    "__MACOSX/my-mod/._chrome.css": "junk",
  });
  const r = await author.post("/api/v1/mods", { name: "Quiet Toolbar", category: "layout", accept: true, zip: zip.toString("base64") });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.zen, false, "a plain Orbit mod is not treated as Zen");
  assert.equal(r.body.version, "0.3.0");
  const { rows: [v] } = await ctx.pool.query("SELECT v.files, m.preview_media_id FROM mod_versions v JOIN mods m ON m.id = v.mod_id WHERE m.slug = $1", [r.body.slug]);
  assert.match(v.files["chrome.css"], /url\("data:image\/png;base64,/);
  assert.ok(v.preview_media_id, "preview.png became the store picture");

  const evil = makeZip({ "chrome.css": "a{}", "install.js": "alert(1)" });
  const e = await author.post("/api/v1/mods/check", { zip: evil.toString("base64") });
  assert.equal(e.body.ok, false);
  assert.ok(e.body.errors.some(x => x.code == "file_not_allowed" && x.file == "install.js"));
  assert.equal((await author.post("/api/v1/mods/check", { zip: Buffer.from("not a zip").toString("base64") })).body.error, "zip_invalid");
});
