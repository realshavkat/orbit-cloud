import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, grantRole } from "./helpers.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

test("threads, replies, votes and notifications", async () => {
  const anon = client(ctx.app);
  const cats = (await anon.get("/api/v1/forum/categories")).body.categories;
  assert.ok(cats.some(c => c.slug == "suggestions" && c.kind == "suggestions"));

  const a = await member(ctx);
  const b = await member(ctx);
  assert.equal((await anon.post("/api/v1/forum/threads", { category: "general", title: "Hello there", body: "Hi" })).status, 401);
  assert.equal((await a.post("/api/v1/forum/threads", { category: "announcements", title: "Fake news", body: "x" })).status, 403, "staff only");
  assert.equal((await a.post("/api/v1/forum/threads", { category: "general", title: "Hi", body: "x" })).body.error, "title_short");

  const t = await a.post("/api/v1/forum/threads", { category: "general", title: "Vertical tabs tips", body: "Share yours" });
  assert.equal(t.status, 201);
  const id = t.body.id;
  let page = (await anon.get(`/api/v1/forum/threads/${id}`)).body;
  assert.equal(page.thread.score, 1, "author upvotes their own thread");
  assert.equal(page.thread.status, null);

  const r1 = await b.post(`/api/v1/forum/threads/${id}/posts`, { body: "Use Ctrl+Shift+E" });
  assert.equal(r1.status, 201);
  const r2 = await a.post(`/api/v1/forum/threads/${id}/posts`, { body: "Nice", parent_id: r1.body.id });
  assert.equal(r2.status, 201);
  assert.ok((await a.get("/api/v1/notifications")).body.notifications.some(n => n.type == "forum_reply"));
  assert.ok((await b.get("/api/v1/notifications")).body.notifications.some(n => n.type == "forum_reply"), "reply to a reply notifies its author");

  assert.equal((await b.post("/api/v1/forum/vote", { target_type: "thread", target_id: id, value: 1 })).body.score, 2);
  assert.equal((await b.post("/api/v1/forum/vote", { target_type: "thread", target_id: id, value: -1 })).body.score, 0);
  assert.equal((await b.post("/api/v1/forum/vote", { target_type: "thread", target_id: id, value: 0 })).body.score, 1);
  assert.equal((await a.post("/api/v1/forum/vote", { target_type: "post", target_id: r1.body.id, value: 1 })).body.score, 1);

  page = (await b.get(`/api/v1/forum/threads/${id}`)).body;
  assert.equal(page.thread.comment_count, 2);
  assert.equal(page.posts.length, 2);
  assert.equal(page.posts[1].parent_id, r1.body.id);
  assert.equal(page.posts[0].mine, true);

  assert.equal((await b.patch(`/api/v1/forum/threads/${id}`, { title: "Hijacked" })).status, 403);
  assert.equal((await b.del(`/api/v1/forum/posts/${r1.body.id}`)).status, 200);
  page = (await anon.get(`/api/v1/forum/threads/${id}`)).body;
  assert.equal(page.posts[0].body, null, "deleted reply keeps its place");
  assert.equal(page.posts[0].author, null);

  const list = (await anon.get("/api/v1/forum/threads?category=general&sort=new")).body;
  assert.ok(list.threads.some(x => x.id == id));
  assert.ok((await anon.get("/api/v1/forum/threads?sort=hot")).body.threads.length >= 1);
  assert.ok((await anon.get("/api/v1/forum/threads?q=vertical")).body.threads.some(x => x.id == id));
  assert.deepEqual((await anon.get(`/api/v1/forum/threads?author=${a.username.toUpperCase()}`)).body.threads.map(x => x.id), [id]);

  const rep = await b.post("/api/v1/reports", { target_type: "thread", target_id: id, reason: "spam", details: "test" });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
});

test("suggestions get a status; moderators pin, lock and hide", async () => {
  const a = await member(ctx);
  const m = await member(ctx);
  const s = await a.post("/api/v1/forum/threads", { category: "suggestions", title: "Split view for three tabs", body: "Please" });
  const id = s.body.id;
  const anon = client(ctx.app);
  assert.equal((await anon.get(`/api/v1/forum/threads/${id}`)).body.thread.status, "open");

  assert.equal((await m.post(`/api/v1/forum/threads/${id}/moderate`, { action: "status", value: "planned" })).status, 403);
  await grantRole(ctx.pool, m.id, "moderator");
  assert.equal((await m.post(`/api/v1/forum/threads/${id}/moderate`, { action: "status", value: "planned" })).status, 200);
  assert.ok((await a.get("/api/v1/notifications")).body.notifications.some(n => n.type == "suggestion_status" && n.data.status == "planned"));
  assert.ok((await anon.get("/api/v1/forum/threads?category=suggestions&status=planned")).body.threads.some(x => x.id == id));
  assert.ok((await anon.get("/api/v1/forum/suggestions/summary")).body.planned >= 1);

  await m.post(`/api/v1/forum/threads/${id}/moderate`, { action: "lock" });
  assert.equal((await a.post(`/api/v1/forum/threads/${id}/posts`, { body: "bump" })).status, 423);
  await m.post(`/api/v1/forum/threads/${id}/moderate`, { action: "hide" });
  assert.equal((await anon.get(`/api/v1/forum/threads/${id}`)).status, 404);
  assert.equal((await m.get(`/api/v1/forum/threads/${id}`)).status, 200, "moderators still see hidden threads");
  assert.equal((await m.post("/api/v1/forum/threads", { category: "announcements", title: "Orbit 158.0.6", body: "Out now" })).status, 201);
});
