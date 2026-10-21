import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, uniq } from "./helpers.js";
import { createMozillaVerifier } from "../src/services/mozilla.js";
import { config } from "../src/config.js";
import { ApiError } from "../src/lib/validate.js";

const fakeMozilla = async token => {
  const m = /^moz:([^:]+):(.+)$/.exec(token);
  if (!m) throw new ApiError(401, "mozilla_token_invalid");
  return { uid: m[1], email: m[2] };
};

let ctx;
before(async () => (ctx = await setup({ mozilla: fakeMozilla })));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

const tok = (uid, email) => `moz:${uid}:${email}`;

test("new Mozilla identity asks for a username, then creates a verified account (app client)", async () => {
  const c = client(ctx.app);
  const uid = uniq("fxa"), email = `${uid}@moz.example`;
  const first = await c.post("/api/v1/auth/mozilla", { token: tok(uid, email), client: "app" });
  assert.equal(first.status, 200);
  assert.equal(first.body.needs_username, true);
  assert.equal(first.body.email, email);

  const username = uniq("Fox");
  const done = await c.post("/api/v1/auth/mozilla", { token: tok(uid, email), client: "app", username, accept_terms: true });
  assert.equal(done.status, 200);
  assert.equal(done.body.created, true);
  assert.ok(done.body.session, "app client gets a bearer token");
  assert.equal(c.cookie, null, "app client gets no cookie");

  const me = await c.get("/api/v1/me", { authorization: `Bearer ${done.body.session}` });
  assert.equal(me.body.username, username);
  assert.equal(me.body.verified, true);
  assert.equal(me.body.mozilla_linked, true);
  assert.equal(me.body.has_password, false);

  const again = await client(ctx.app).post("/api/v1/auth/mozilla", { token: tok(uid, email), client: "app" });
  assert.equal(again.body.ok, true);
  assert.equal(again.body.created, false);
});

test("web hand-off: browser gets a code, the site redeems it into a cookie session", async () => {
  const browser = client(ctx.app);
  const uid = uniq("fxa"), email = `${uid}@moz.example`;
  const h = await browser.post("/api/v1/auth/mozilla", { token: tok(uid, email) });
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.ok(h.body.code);
  assert.equal(h.body.session, undefined);

  const site = client(ctx.app);
  const ask = await site.post("/api/v1/auth/mozilla/redeem", { code: h.body.code });
  assert.equal(ask.body.needs_username, true);
  const ok = await site.post("/api/v1/auth/mozilla/redeem", { code: h.body.code, username: uniq("Web"), accept_terms: true });
  assert.equal(ok.body.ok, true);
  assert.ok(site.cookie, "site session cookie set");
  assert.equal(ok.body.session, undefined, "token never reaches page script");
  assert.equal((await site.get("/api/v1/me")).status, 200);
  assert.equal((await client(ctx.app).post("/api/v1/auth/mozilla/redeem", { code: h.body.code })).status, 400);
});

test("existing account: linked while signed in, or by the same verified e-mail", async () => {
  const m = await member(ctx);
  const uid = uniq("fxa");
  const h = await m.post("/api/v1/auth/mozilla", { token: tok(uid, `other-${uid}@moz.example`) });
  const r = await m.post("/api/v1/auth/mozilla/redeem", { code: h.body.code });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.created, false);
  const { rows } = await ctx.pool.query("SELECT user_id FROM oauth_accounts WHERE provider = 'mozilla' AND provider_user_id = $1", [uid]);
  assert.equal(rows[0].user_id, m.id);
  const fresh = await member(ctx);
  const bearer = { authorization: `Bearer ${fresh.cookie.split("=")[1]}` };
  const a = await fresh.post("/api/v1/auth/mozilla", { token: tok(uniq("fxa"), "x@moz.example"), client: "app" }, bearer);
  assert.equal(a.body.ok, true);
  assert.equal(a.body.created, false);
  const two = await fresh.post("/api/v1/auth/mozilla", { token: tok(uniq("fxa"), "y@moz.example"), client: "app" },
    { authorization: `Bearer ${a.body.session}` });
  assert.equal(two.status, 409);
  assert.equal(two.body.error, "mozilla_already_linked");
  const other = await member(ctx);
  const c2 = await other.post("/api/v1/auth/mozilla", { token: tok(uniq("fxa"), `w${uniq()}@moz.example`), client: "app" });
  assert.equal(c2.body.needs_username, true);

  const byMail = await member(ctx);
  const uid2 = uniq("fxa");
  const r2 = await client(ctx.app).post("/api/v1/auth/mozilla", { token: tok(uid2, byMail.email.toUpperCase()), client: "app" });
  assert.equal(r2.body.ok, true);
  assert.equal(r2.body.created, false);
  const { rows: [l] } = await ctx.pool.query("SELECT user_id FROM oauth_accounts WHERE provider_user_id = $1", [uid2]);
  assert.equal(l.user_id, byMail.id);
});

test("unverified e-mail is never taken over; bad tokens and suspended accounts are refused", async () => {
  const squatter = await member(ctx, { verify: false });
  const r = await client(ctx.app).post("/api/v1/auth/mozilla", { token: tok(uniq("fxa"), squatter.email), client: "app" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "email_in_use");

  assert.equal((await client(ctx.app).post("/api/v1/auth/mozilla", { token: "not-a-mozilla-token" })).status, 401);

  const m = await member(ctx);
  const uid = uniq("fxa");
  await client(ctx.app).post("/api/v1/auth/mozilla", { token: tok(uid, m.email), client: "app" });
  await ctx.pool.query("UPDATE users SET status = 'suspended', suspended_until = now() + interval '1 day' WHERE id = $1", [m.id]);
  const s = await client(ctx.app).post("/api/v1/auth/mozilla", { token: tok(uid, m.email), client: "app" });
  assert.equal(s.status, 403);
  assert.equal(s.body.error, "account_suspended");
});

test("account without password: reauth says so, password reset creates one", async () => {
  const c = client(ctx.app);
  const uid = uniq("fxa"), email = `${uid}@moz.example`;
  const r = await c.post("/api/v1/auth/mozilla", { token: tok(uid, email), client: "app", username: uniq("Np"), accept_terms: true });
  const bearer = { authorization: `Bearer ${r.body.session}` };
  const re = await c.post("/api/v1/auth/reauth", { password: "whatever whatever" }, bearer);
  assert.equal(re.body.error, "no_password");

  await client(ctx.app).post("/api/v1/auth/forgot", { email });
  const mail = ctx.mailer.outbox.findLast(m => m.to == email);
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
  assert.equal((await client(ctx.app).post("/api/v1/auth/reset", { token, password: "a brand new passphrase" })).status, 200);
  const { rows } = await ctx.pool.query("SELECT 1 FROM user_credentials c JOIN users u ON u.id = c.user_id WHERE u.email = $1", [email]);
  assert.equal(rows.length, 1);
});

test("real verifier: checks client id and scope, and that both answers are the same user", async () => {
  const cfg = config({});
  const fetchFor = (verify, profile) => async (url) => ({
    ok: true, status: 200, json: async () => (url.endsWith("/v1/verify") ? verify : profile),
  });
  const good = { user: "abc", client_id: "5882386c6d801776", scope: ["profile"] };
  const v = createMozillaVerifier(cfg, fetchFor(good, { uid: "abc", email: "a@b.example" }));
  assert.deepEqual(await v("t"), { uid: "abc", email: "a@b.example" });
  for (const [verify, profile] of [
    [{ ...good, client_id: "some-other-site" }, { uid: "abc", email: "a@b.example" }],
    [{ ...good, scope: ["openid"] }, { uid: "abc", email: "a@b.example" }],
    [good, { uid: "zzz", email: "a@b.example" }],
  ]) {
    await assert.rejects(createMozillaVerifier(cfg, fetchFor(verify, profile))("t"), e => e.status == 401);
  }
  const down = createMozillaVerifier(cfg, async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(down("t"), e => e.status == 502);
});
