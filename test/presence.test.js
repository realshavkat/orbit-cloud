import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member } from "./helpers.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

test("site presence is opt-in, keeps only the domain and respects privacy", async () => {
  const a = await member(ctx);
  const b = await member(ctx);
  const c = await member(ctx);

  assert.equal((await a.post("/api/v1/sites/presence", { domain: "github.com" })).body.error, "presence_disabled", "off by default");
  assert.equal((await client(ctx.app).get("/api/v1/sites/people?domain=github.com")).status, 401);

  for (const m of [a, b]) await m.patch("/api/v1/me/privacy", { share_presence: true });
  assert.equal((await a.post("/api/v1/sites/presence", { domain: "https://www.GitHub.com/realshavkat/orbit?tab=1" })).body.ok, true);
  assert.equal((await b.post("/api/v1/sites/presence", { domain: "github.com" })).body.ok, true);
  assert.equal((await a.post("/api/v1/sites/presence", { domain: "my-bank.com" })).body.sensitive, true, "sensitive sites are never stored");
  const { rows } = await ctx.pool.query("SELECT domain FROM site_presence WHERE user_id = $1", [a.id]);
  assert.deepEqual(rows.map(r => r.domain), ["github.com"], "only the domain, never the page");

  await ctx.pool.query("UPDATE site_presence SET seen_at = now() - interval '2 hours' WHERE user_id = $1", [b.id]);
  await c.patch("/api/v1/me/privacy", { share_sites_enabled: true });
  await c.post("/api/v1/sites/shared", { domain: "github.com" });

  const seen = (await c.get("/api/v1/sites/people?domain=github.com")).body;
  assert.deepEqual(seen.here.map(u => u.username), [a.username]);
  assert.deepEqual(seen.recent.map(u => u.username), [b.username]);
  assert.equal(seen.favorites.length, 0, "the viewer is not listed to themself");
  assert.equal(seen.shared_by_me, true);
  assert.deepEqual((await a.get("/api/v1/sites/people?domain=github.com")).body.favorites.map(u => u.username), [c.username]);
  assert.equal((await a.get("/api/v1/sites/people?domain=pornhub.com")).body.sensitive, true);

  await a.patch("/api/v1/me/privacy", { share_presence: false });
  assert.equal((await ctx.pool.query("SELECT 1 FROM site_presence WHERE user_id = $1", [a.id])).rows.length, 0, "turning it off erases the trace");
  assert.equal((await c.get("/api/v1/sites/people?domain=github.com")).body.here.length, 0);
});
