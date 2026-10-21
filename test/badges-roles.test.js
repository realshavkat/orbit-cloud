import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, grantRole, reauth } from "./helpers.js";
import { bootstrapOwner } from "../src/services/bootstrap.js";
import { awardBadge } from "../src/services/badges.js";

let ctx;
let owner;
const log = { info() {}, warn() {}, error() {} };
before(async () => {
  ctx = await setup();
  owner = await member(ctx);
  assert.equal(await bootstrapOwner(ctx.pool, owner.id, log), "done");
});
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

const badgesOf = async (c, name) => (await c.get(`/api/v1/users/${name}`)).body.badges.map(b => b.key);

test("owner bootstrap gives Owner and Founder once, never again", async () => {
  assert.ok((await badgesOf(owner, owner.username)).includes("founder"));
  assert.ok((await badgesOf(owner, owner.username)).includes("administrator"));
  const other = await member(ctx);
  assert.equal(await bootstrapOwner(ctx.pool, other.id, log), "already_done");
  const { rows } = await ctx.pool.query("SELECT COUNT(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'owner'");
  assert.equal(rows[0].n, 1);
});

test("Founder cannot be awarded by anyone through the API, not even the owner", async () => {
  const target = await member(ctx);
  await reauth(owner);
  const r = await owner.post(`/api/v1/admin/users/${target.id}/badges`, { badge: "founder", action: "award", reason: "test" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "badge_protected");
  await assert.rejects(ctx.pool.query("BEGIN").then(() => awardBadge(ctx.pool, { userId: target.id, badgeKey: "founder", source: "manual", allowOfficial: true })),
    e => e.code == "badge_protected");
  await ctx.pool.query("ROLLBACK");
});

test("an ordinary member cannot award badges or roles to anyone, themselves included", async () => {
  const a = await member(ctx);
  for (const [url, body] of [
    [`/api/v1/admin/users/${a.id}/badges`, { badge: "beta_tester", action: "award", reason: "for me" }],
    [`/api/v1/admin/users/${a.id}/roles`, { role: "administrator", action: "grant", reason: "for me" }],
    ["/api/v1/admin/stats", undefined],
  ]) {
    const r = body ? await a.post(url, body) : await a.get(url);
    assert.equal(r.status, 403, url);
  }
  const p = await a.patch("/api/v1/me/profile", { isAdmin: true, badges: ["founder"] });
  assert.equal(p.status, 400);
  assert.deepEqual(await badgesOf(a, a.username), []);
});

test("administrator awards ordinary badges, not official ones; no duplicates; revocation needs a reason", async () => {
  const admin = await member(ctx);
  const target = await member(ctx);
  await grantRole(ctx.pool, admin.id, "administrator");
  assert.equal((await admin.post(`/api/v1/admin/users/${target.id}/badges`, { badge: "beta_tester", action: "award", reason: "beta 1" })).status, 200);
  const dup = await admin.post(`/api/v1/admin/users/${target.id}/badges`, { badge: "beta_tester", action: "award", reason: "beta 1" });
  assert.equal(dup.body.error, "already_has_badge");
  assert.equal((await admin.post(`/api/v1/admin/users/${target.id}/badges`, { badge: "verified", action: "award", reason: "because" })).body.error, "badge_official");
  assert.equal((await admin.post(`/api/v1/admin/users/${target.id}/badges`, { badge: "beta_tester", action: "revoke" })).status, 400);
  assert.equal((await admin.post(`/api/v1/admin/users/${target.id}/badges`, { badge: "beta_tester", action: "revoke", reason: "mistake" })).status, 200);
  const { rows } = await ctx.pool.query(
    "SELECT action FROM badge_award_events e JOIN badges b ON b.id = e.badge_id WHERE e.user_id = $1 AND b.key = 'beta_tester' ORDER BY e.id", [target.id]);
  assert.deepEqual(rows.map(r => r.action), ["award", "revoke"]);
});

test("concurrent awards of one badge leave one copy", async () => {
  const target = await member(ctx);
  const tries = await Promise.allSettled(Array.from({ length: 5 }, async () => {
    const c = await ctx.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await awardBadge(c, { userId: target.id, badgeKey: "bug_hunter", source: "contribution", notifyUser: false });
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }));
  const { rows } = await ctx.pool.query(
    "SELECT COUNT(*)::int AS n FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = $1 AND b.key = 'bug_hunter' AND ub.revoked_at IS NULL", [target.id]);
  assert.equal(rows[0].n, 1);
  assert.ok(tries.some(t => t.status == "fulfilled" && t.value));
});

test("the Administrator badge follows the role and grants nothing by itself", async () => {
  const target = await member(ctx);
  await ctx.pool.query("INSERT INTO user_badges (user_id, badge_id, source) SELECT $1, id, 'manual' FROM badges WHERE key = 'administrator'", [target.id]);
  assert.equal((await target.get("/api/v1/admin/stats")).status, 403);
  await ctx.pool.query("UPDATE user_badges SET revoked_at = now() WHERE user_id = $1", [target.id]);
  await reauth(owner);
  assert.equal((await owner.post(`/api/v1/admin/users/${target.id}/roles`, { role: "administrator", action: "grant", reason: "team" })).status, 200);
  assert.ok((await badgesOf(owner, target.username)).includes("administrator"));
  assert.equal((await target.get("/api/v1/admin/stats")).status, 200);
  assert.equal((await owner.post(`/api/v1/admin/users/${target.id}/roles`, { role: "administrator", action: "revoke", reason: "left" })).status, 200);
  assert.ok(!(await badgesOf(owner, target.username)).includes("administrator"));
  assert.equal((await target.get("/api/v1/admin/stats")).status, 403);
});

test("nobody can become Owner; an administrator cannot promote anyone to administrator or act on peers", async () => {
  const admin = await member(ctx);
  const peer = await member(ctx);
  const mod = await member(ctx);
  await grantRole(ctx.pool, admin.id, "administrator");
  await grantRole(ctx.pool, peer.id, "administrator");
  await grantRole(ctx.pool, mod.id, "moderator");
  await reauth(admin);
  assert.equal((await admin.post(`/api/v1/admin/users/${mod.id}/roles`, { role: "owner", action: "grant", reason: "because" })).status, 400);
  assert.equal((await admin.post(`/api/v1/admin/users/${mod.id}/roles`, { role: "administrator", action: "grant", reason: "because" })).status, 403);
  assert.equal((await admin.post(`/api/v1/admin/users/${admin.id}/roles`, { role: "moderator", action: "grant", reason: "because" })).status, 403);
  assert.equal((await admin.post(`/api/v1/admin/users/${peer.id}/suspend`, { reason: "peer" })).body.error, "rank_too_low");
  assert.equal((await admin.post(`/api/v1/admin/users/${owner.id}/suspend`, { reason: "coup" })).body.error, "rank_too_low");
  assert.equal((await mod.post(`/api/v1/admin/users/${mod.id}/roles`, { role: "moderator", action: "grant", reason: "because" })).status, 403);
  const newMod = await member(ctx);
  assert.equal((await admin.post(`/api/v1/admin/users/${newMod.id}/roles`, { role: "moderator", action: "grant", reason: "help" })).status, 200);
});

test("the audit log records actions and cannot be changed or deleted", async () => {
  const { rows } = await ctx.pool.query("SELECT id FROM admin_audit_logs WHERE action = 'role.grant' LIMIT 1");
  assert.ok(rows.length);
  await assert.rejects(ctx.pool.query("UPDATE admin_audit_logs SET reason = 'edited' WHERE id = $1", [rows[0].id]), /append-only/);
  await assert.rejects(ctx.pool.query("DELETE FROM admin_audit_logs WHERE id = $1", [rows[0].id]), /append-only/);
  const admin = await member(ctx);
  await grantRole(ctx.pool, admin.id, "administrator");
  assert.equal((await admin.get("/api/v1/admin/audit")).status, 403, "administrators have no audit access by default");
  assert.equal((await owner.get("/api/v1/admin/audit")).status, 200);
});

test("admin routes stay closed to direct calls without a session", async () => {
  const c = client(ctx.app);
  for (const url of ["/api/v1/admin/stats", "/api/v1/admin/users", "/api/v1/admin/audit", "/api/v1/admin/donations"]) {
    assert.equal((await c.get(url)).status, 401, url);
  }
});

test("badge catalog, detail page and authenticity check", async () => {
  const c = client(ctx.app);
  const list = await c.get("/api/v1/badges");
  assert.ok(list.body.badges.some(b => b.key == "founder"));
  const founder = await c.get("/api/v1/badges/founder");
  assert.equal(founder.body.holders_count, 1);
  const profile = await c.get(`/api/v1/users/${owner.username}`);
  const award = profile.body.badges.find(b => b.key == "founder");
  const check = await c.get(`/api/v1/badges/awards/${award.award_id}`);
  assert.equal(check.body.valid, true);
  assert.equal(check.body.username, owner.username);
});

test("rename: members change their own @, admins change someone else's with a reason", async () => {
  const admin = await member(ctx);
  await grantRole(ctx.pool, admin.id, "administrator");
  const u = await member(ctx);
  const name = `ren${Date.now().toString(36).slice(-6)}`;
  assert.equal((await u.post(`/api/v1/admin/users/${admin.id}/username`, { username: "nope_123", reason: "test" })).status, 403);
  assert.equal((await admin.post(`/api/v1/admin/users/${u.id}/username`, { username: name, reason: "asked by the member" })).status, 200);
  assert.equal((await u.get("/api/v1/me")).body.username, name);
  assert.equal((await admin.post(`/api/v1/admin/users/${u.id}/username`, { username: admin.username, reason: "clash" })).body.error, "username_taken");
  assert.equal((await admin.post(`/api/v1/admin/users/${u.id}/username`, { username: "a", reason: "bad" })).body.error, "username_format");
});
