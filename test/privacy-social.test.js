import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, grantRole } from "./helpers.js";
import { cleanDomain, isSensitiveDomain } from "../src/lib/validate.js";
import { sniffImage } from "../src/routes/me.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

test("a member can only change their own profile", async () => {
  const a = await member(ctx);
  const b = await member(ctx);
  await a.patch("/api/v1/me/profile", { bio: "hello" });
  assert.equal((await b.get(`/api/v1/users/${a.username}`)).body.bio, "hello");
  // There is no route that takes another member's id for profile edits.
  assert.equal((await b.patch(`/api/v1/users/${a.username}`, { bio: "pwned" })).status, 404);
});

test("profile text is stored as plain text and links must be http(s)", async () => {
  const a = await member(ctx);
  await a.patch("/api/v1/me/profile", { bio: "<script>alert(1)</script>‮evil" });
  const p = await a.get(`/api/v1/users/${a.username}`);
  assert.equal(p.body.bio, "<script>alert(1)</script>evil", "kept as text, the page renders it with textContent");
  assert.equal((await a.patch("/api/v1/me/profile", { links: [{ url: "javascript:alert(1)" }] })).body.error, "url_invalid");
  assert.equal((await a.patch("/api/v1/me/profile", { links: [{ url: "http://127.0.0.1/admin" }] })).body.error, "url_invalid");
  assert.equal((await a.patch("/api/v1/me/profile", { links: [{ label: "Site", url: "https://example.org/me" }] })).status, 200);
});

test("a private profile shows nothing but its name to visitors; friends see it", async () => {
  const a = await member(ctx);
  const visitor = client(ctx.app);
  const friend = await member(ctx);
  await a.patch("/api/v1/me/profile", { bio: "secret bio" });
  await a.patch("/api/v1/me/privacy", { profile_public: false });
  const seen = await visitor.get(`/api/v1/users/${a.username}`);
  assert.equal(seen.body.private, true);
  assert.equal(seen.body.bio, undefined);
  assert.equal(seen.body.badges, undefined);
  // Friends see it.
  const req = await friend.post("/api/v1/friends/requests", { user_id: a.id });
  await a.post(`/api/v1/friends/requests/${req.body.id}/accept`);
  assert.equal((await friend.get(`/api/v1/users/${a.username}`)).body.bio, "secret bio");
});

test("hidden fields are not sent at all", async () => {
  const a = await member(ctx);
  await a.patch("/api/v1/me/profile", { interests: ["music", "games"] });
  await a.patch("/api/v1/me/privacy", { show_interests: false, show_activity: false, show_friend_count: false });
  const p = await client(ctx.app).get(`/api/v1/users/${a.username}`);
  assert.deepEqual(p.body.interests, []);
  assert.equal(p.body.last_active_at, null);
  assert.equal(p.body.friend_count, undefined);
  assert.equal(p.body.email, undefined, "never an e-mail");
});

test("search and discovery never expose e-mails and respect opt-in", async () => {
  const a = await member(ctx);
  const r = await client(ctx.app).get(`/api/v1/users/search?q=${a.username}`);
  assert.ok(r.body.users.some(u => u.username == a.username));
  assert.ok(!JSON.stringify(r.body).includes("@"));
  let d = await client(ctx.app).get("/api/v1/users/discover");
  assert.ok(!d.body.recent.some(u => u.id == a.id), "not discoverable by default");
  await a.patch("/api/v1/me/privacy", { discoverable: true });
  d = await client(ctx.app).get("/api/v1/users/discover");
  assert.ok(d.body.recent.some(u => u.id == a.id));
});

test("friend requests: no duplicates, not to oneself, blocked means unavailable", async () => {
  const a = await member(ctx);
  const b = await member(ctx);
  assert.equal((await a.post("/api/v1/friends/requests", { user_id: a.id })).status, 400);
  const first = await a.post("/api/v1/friends/requests", { user_id: b.id });
  assert.equal(first.status, 201);
  assert.equal((await a.post("/api/v1/friends/requests", { user_id: b.id })).body.error, "request_exists");
  const notes = await b.get("/api/v1/notifications");
  assert.ok(notes.body.notifications.some(n => n.type == "friend_request"));
  await b.post("/api/v1/friends/blocks", { user_id: a.id });
  assert.equal((await a.post("/api/v1/friends/requests", { user_id: b.id })).body.error, "request_unavailable");
  assert.equal((await a.get(`/api/v1/users/${b.username}`)).status, 404, "a blocked member cannot see the profile");
  await b.del(`/api/v1/friends/blocks/${a.id}`);
  assert.equal((await a.post("/api/v1/friends/requests", { user_id: b.id })).status, 201);
});

test("requests to suspended accounts are refused", async () => {
  const a = await member(ctx);
  const b = await member(ctx);
  await ctx.pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [b.id]);
  assert.equal((await a.post("/api/v1/friends/requests", { user_id: b.id })).body.error, "request_unavailable");
});

test("sharing a site needs the setting on, takes only a domain, and can be removed", async () => {
  const a = await member(ctx);
  assert.equal((await a.post("/api/v1/sites/shared", { domain: "example.org" })).body.error, "sharing_disabled");
  await a.patch("/api/v1/me/privacy", { share_sites_enabled: true });
  const r = await a.post("/api/v1/sites/shared", { domain: "https://www.Example.org/private/page?q=secret" });
  assert.equal(r.status, 201);
  assert.equal(r.body.domain, "example.org", "path and query are dropped");
  assert.equal((await a.post("/api/v1/sites/shared", { domain: "ameli.fr" })).body.error, "domain_sensitive");
  await a.del("/api/v1/sites/shared/example.org");
  assert.equal((await a.get("/api/v1/sites/mine")).body.sites.length, 0);
  // Turning sharing off hides what was shared and refuses new shares.
  await a.post("/api/v1/sites/shared", { domain: "example.org" });
  await a.patch("/api/v1/me/privacy", { share_sites_enabled: false });
  assert.deepEqual((await client(ctx.app).get(`/api/v1/users/${a.username}`)).body.sites, []);
  assert.equal((await a.post("/api/v1/sites/shared", { domain: "example.net" })).body.error, "sharing_disabled");
});

test("site members: hidden under the threshold, listed above it", async () => {
  const domain = `site${Date.now()}.example.com`;
  const members = [];
  for (let i = 0; i < 3; i++) {
    const m = await member(ctx);
    await m.patch("/api/v1/me/privacy", { share_sites_enabled: true });
    await m.post("/api/v1/sites/shared", { domain });
    members.push(m);
    const r = await client(ctx.app).get(`/api/v1/sites/domain/${domain}`);
    if (i < 2) assert.equal(r.body.count, null);
    else assert.equal(r.body.count, 3);
  }
});

test("the server has no route that receives browsing history", async () => {
  const a = await member(ctx);
  for (const url of ["/api/v1/history", "/api/v1/sites/history", "/api/v1/me/history", "/api/v1/sites/visits"]) {
    assert.equal((await a.post(url, { urls: ["https://example.org"] })).status, 404, url);
  }
});

test("domain rules", () => {
  assert.equal(cleanDomain("HTTPS://WWW.GitHub.com/x"), "github.com");
  assert.throws(() => cleanDomain("localhost"), e => e.code == "domain_invalid");
  assert.ok(isSensitiveDomain("my-bank.com"));
  assert.ok(isSensitiveDomain("impots.gouv.fr"));
  assert.ok(!isSensitiveDomain("github.com"));
});

test("images are recognised by content, not by name", () => {
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(Buffer.from("GIF89a......")), "image/gif");
});

test("reports, moderation and appeals", async () => {
  const a = await member(ctx);
  const bad = await member(ctx);
  const mod = await member(ctx);
  await grantRole(ctx.pool, mod.id, "moderator");
  const r = await a.post("/api/v1/reports", { target_type: "user", target_id: bad.id, reason: "spam", details: "ads" });
  assert.equal(r.status, 201);
  assert.equal((await a.post("/api/v1/reports", { target_type: "user", target_id: bad.id, reason: "spam" })).body.error, "report_exists");
  const list = await mod.get("/api/v1/admin/reports");
  assert.ok(list.body.reports.some(x => x.id == r.body.id));
  // Moderators see reports, not e-mails, money or the audit log.
  assert.equal((await mod.get("/api/v1/admin/users")).status, 403);
  assert.equal((await mod.get("/api/v1/admin/donations")).status, 403);
  assert.equal((await mod.get("/api/v1/admin/audit")).status, 403);
  const until = new Date(Date.now() + 864e5).toISOString();
  assert.equal((await mod.post("/api/v1/admin/moderation", { user_id: bad.id, action: "suspend_social", reason: "spam", until, report_id: r.body.id })).status, 200);
  assert.equal((await bad.post("/api/v1/friends/requests", { user_id: a.id })).body.error, "social_suspended");
  await mod.post(`/api/v1/admin/reports/${r.body.id}`, { status: "resolved", resolution: "suspended" });
  assert.ok((await a.get("/api/v1/notifications")).body.notifications.some(n => n.type == "report_update"));
  const decisions = await bad.get("/api/v1/reports/decisions");
  const d = decisions.body.decisions[0];
  assert.equal((await bad.post(`/api/v1/reports/decisions/${d.id}/appeal`, { text: "sorry" })).status, 200);
  assert.equal((await mod.post(`/api/v1/admin/appeals/${d.id}`, { decision: "accepted", reason: "first time" })).status, 200);
  assert.equal((await bad.post("/api/v1/friends/requests", { user_id: a.id })).status, 201);
});

test("notifications: read one, read all, archive", async () => {
  const a = await member(ctx);
  const b = await member(ctx);
  await b.post("/api/v1/friends/requests", { user_id: a.id });
  let n = await a.get("/api/v1/notifications/count");
  assert.ok(n.body.unread >= 1);
  await a.post("/api/v1/notifications/read", { all: true });
  assert.equal((await a.get("/api/v1/notifications/count")).body.unread, 0);
  const list = await a.get("/api/v1/notifications");
  await a.del(`/api/v1/notifications/${list.body.notifications[0].id}`);
  assert.equal((await a.get("/api/v1/notifications")).body.notifications.length, list.body.notifications.length - 1);
});

test("data export contains the member's data and no password hash", async () => {
  const a = await member(ctx);
  const r = await a.get("/api/v1/me/export");
  assert.equal(r.status, 200);
  assert.equal(r.body.account.username, a.username);
  assert.ok(!JSON.stringify(r.body).includes("argon2"));
});
