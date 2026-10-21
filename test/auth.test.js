import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, uniq } from "./helpers.js";
import { totpCode, totpVerify, base32Encode } from "../src/lib/crypto.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

const tokenFrom = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

test("health and config answer", async () => {
  const c = client(ctx.app);
  assert.equal((await c.get("/api/health")).status, 200);
  assert.equal((await c.get("/api/v1/config")).body.donations, true);
});

test("valid sign-up creates an unverified account, then e-mail verification", async () => {
  const c = client(ctx.app);
  const username = uniq("Neo");
  const r = await c.post("/api/v1/auth/register", { username, email: `${username}@Example.org`, password: "correct horse battery", accept_terms: true });
  assert.equal(r.status, 201);
  let me = await c.get("/api/v1/me");
  assert.equal(me.body.verified, false);
  const mail = ctx.mailer.outbox.findLast(m => m.to == `${username}@Example.org`);
  assert.ok(mail, "verification mail sent");
  assert.equal((await c.post("/api/v1/auth/verify-email", { token: tokenFrom(mail) })).status, 200);
  me = await c.get("/api/v1/me");
  assert.equal(me.body.verified, true);
  // A verification link works once.
  assert.equal((await c.post("/api/v1/auth/verify-email", { token: tokenFrom(mail) })).status, 400);
});

test("sign-up rejects bad e-mails, taken and reserved usernames, weak passwords", async () => {
  const c = client(ctx.app);
  const base = { password: "correct horse battery", accept_terms: true };
  assert.equal((await c.post("/api/v1/auth/register", { ...base, username: uniq(), email: "not-an-email" })).body.error, "email_format");
  const taken = await member(ctx);
  assert.equal((await c.post("/api/v1/auth/register", { ...base, username: taken.username.toUpperCase(), email: `${uniq()}@example.org` })).body.error, "username_taken");
  assert.equal((await c.post("/api/v1/auth/register", { ...base, username: "Orbit_Team", email: `${uniq()}@example.org` })).body.error, "username_reserved");
  assert.equal((await c.post("/api/v1/auth/register", { ...base, username: "admin", email: `${uniq()}@example.org` })).body.error, "username_reserved");
  assert.equal((await c.post("/api/v1/auth/register", { username: uniq(), email: `${uniq()}@example.org`, password: "short", accept_terms: true })).body.error, "password_short");
  assert.equal((await c.post("/api/v1/auth/register", { ...base, username: uniq(), email: `${uniq()}@example.org`, accept_terms: false })).body.error, "terms_required");
  // Honeypot field filled: refused.
  assert.equal((await c.post("/api/v1/auth/register", { ...base, username: uniq(), email: `${uniq()}@example.org`, website: "http://spam" })).status, 400);
});

test("one account per mailbox, without telling the visitor", async () => {
  const a = await member(ctx);
  const c = client(ctx.app);
  const [local, domain] = a.email.split("@");
  const r = await c.post("/api/v1/auth/register", { username: uniq(), email: `${local.toUpperCase()}+x@${domain}`, password: "correct horse battery", accept_terms: true });
  assert.equal(r.status, 201, "same answer as a new account");
  assert.equal(c.cookie, null, "but no session");
  const { rows } = await ctx.pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email_normalized = $1", [a.email.toLowerCase()]);
  assert.equal(rows[0].n, 1);
});

test("username availability is checked live", async () => {
  const a = await member(ctx);
  const c = client(ctx.app);
  assert.equal((await c.get(`/api/v1/auth/username-available?name=${a.username}`)).body.available, false);
  assert.equal((await c.get(`/api/v1/auth/username-available?name=${uniq()}`)).body.available, true);
  assert.equal((await c.get("/api/v1/auth/username-available?name=a")).body.reason, "username_format");
});

test("login: wrong password and unknown account give the same error", async () => {
  const a = await member(ctx);
  const c = client(ctx.app);
  const wrong = await c.post("/api/v1/auth/login", { login: a.username, password: "wrong password!!" });
  const unknown = await c.post("/api/v1/auth/login", { login: uniq(), password: "wrong password!!" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  const ok = await c.post("/api/v1/auth/login", { login: a.email, password: a.password });
  assert.equal(ok.status, 200);
  assert.equal((await c.get("/api/v1/me")).body.username, a.username);
});

test("too many failed sign-ins are refused for a while", async () => {
  const a = await member(ctx);
  const c = client(ctx.app);
  for (let i = 0; i < 8; i++) await c.post("/api/v1/auth/login", { login: a.username, password: "nope nope nope" });
  const r = await c.post("/api/v1/auth/login", { login: a.username, password: a.password });
  assert.equal(r.status, 429);
});

test("state changes without the Orbit header are refused (CSRF)", async () => {
  const a = await member(ctx);
  const r = await ctx.app.inject({ method: "PATCH", url: "/api/v1/me/profile", payload: { bio: "x" }, headers: { cookie: a.cookie } });
  assert.equal(r.statusCode, 403);
  const other = await ctx.app.inject({ method: "PATCH", url: "/api/v1/me/profile", payload: { bio: "x" },
    headers: { cookie: a.cookie, "x-orbit-request": "1", origin: "https://evil.example" } });
  assert.equal(other.statusCode, 403);
});

test("password reset: one use, expires, signs out every session", async () => {
  const a = await member(ctx);
  const c = client(ctx.app);
  await c.post("/api/v1/auth/forgot", { email: a.email });
  const token = tokenFrom(ctx.mailer.outbox.findLast(m => m.to == a.email && /mot de passe|password/i.test(m.subject)));
  assert.equal((await c.post("/api/v1/auth/reset", { token, password: "a brand new passphrase" })).status, 200);
  assert.equal((await c.post("/api/v1/auth/reset", { token, password: "another new passphrase" })).body.error, "token_invalid");
  // The old session is gone.
  assert.equal((await a.get("/api/v1/me")).status, 401);
  assert.equal((await c.post("/api/v1/auth/login", { login: a.username, password: "a brand new passphrase" })).status, 200);
  // Unknown address: same answer.
  assert.equal((await c.post("/api/v1/auth/forgot", { email: `${uniq()}@example.org` })).status, 200);
  // Expired token.
  await c.post("/api/v1/auth/forgot", { email: a.email });
  const t2 = tokenFrom(ctx.mailer.outbox.findLast(m => m.to == a.email && /mot de passe|password/i.test(m.subject)));
  await ctx.pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
  assert.equal((await c.post("/api/v1/auth/reset", { token: t2, password: "yet another passphrase" })).body.error, "token_invalid");
});

test("sessions: list, revoke one, sign out everywhere", async () => {
  const a = await member(ctx);
  const b = client(ctx.app);
  await b.post("/api/v1/auth/login", { login: a.username, password: a.password, remember: true });
  const list = await a.get("/api/v1/me/sessions");
  assert.equal(list.body.sessions.length, 2);
  const other = list.body.sessions.find(s => !s.current);
  assert.equal((await a.del(`/api/v1/me/sessions/${other.id}`)).status, 200);
  assert.equal((await b.get("/api/v1/me")).status, 401);
  await a.post("/api/v1/auth/logout-all");
  assert.equal((await a.get("/api/v1/me")).status, 401);
});

test("TOTP matches RFC 6238 test vectors", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpCode(secret, Math.floor(59 / 30)), "287082");
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totpVerify(secret, "287082", 59_000), 1);
  assert.equal(totpVerify(secret, "287082", 59_000, 1), null, "a used step is refused");
});

test("two-factor sign-in with TOTP and a one-time recovery code", async () => {
  const a = await member(ctx);
  await a.post("/api/v1/auth/reauth", { password: a.password });
  const setupRes = await a.post("/api/v1/me/mfa/setup");
  assert.equal(setupRes.status, 200);
  const secret = setupRes.body.secret;
  const now = Date.now();
  const confirm = await a.post("/api/v1/me/mfa/confirm", { code: totpCode(secret, Math.floor(now / 30_000)) });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.recovery_codes.length, 10);
  const c = client(ctx.app);
  const login = await c.post("/api/v1/auth/login", { login: a.username, password: a.password });
  assert.equal(login.body.mfa_required, true);
  assert.equal((await c.get("/api/v1/me/sessions")).body.error, "mfa_required");
  assert.equal((await c.post("/api/v1/auth/mfa", { code: "000000" })).status, 401);
  assert.equal((await c.post("/api/v1/auth/mfa", { code: totpCode(secret, Math.floor(now / 30_000) + 1) })).status, 200);
  assert.equal((await c.get("/api/v1/me/sessions")).status, 200);
  const d = client(ctx.app);
  await d.post("/api/v1/auth/login", { login: a.username, password: a.password });
  const code = confirm.body.recovery_codes[0];
  assert.equal((await d.post("/api/v1/auth/mfa", { recovery_code: code })).status, 200);
  const e = client(ctx.app);
  await e.post("/api/v1/auth/login", { login: a.username, password: a.password });
  assert.equal((await e.post("/api/v1/auth/mfa", { recovery_code: code })).status, 401, "recovery codes work once");
});

test("sensitive changes need a fresh password check", async () => {
  const a = await member(ctx);
  await ctx.pool.query("UPDATE user_sessions SET reauth_at = now() - interval '1 hour' WHERE user_id = $1", [a.id]);
  assert.equal((await a.post("/api/v1/me/email", { email: `${uniq()}@example.org` })).body.error, "reauth_required");
  await a.post("/api/v1/auth/reauth", { password: a.password });
  assert.equal((await a.post("/api/v1/me/email", { email: `${uniq()}@example.org` })).status, 200);
});

test("account deletion removes the profile and signs out", async () => {
  const a = await member(ctx);
  assert.equal((await a.post("/api/v1/me/delete", { password: a.password, confirm: "wrong" })).body.error, "confirm_mismatch");
  assert.equal((await a.post("/api/v1/me/delete", { password: a.password, confirm: a.username })).status, 200);
  const c = client(ctx.app);
  assert.equal((await c.get(`/api/v1/users/${a.username}`)).status, 404);
  assert.equal((await c.post("/api/v1/auth/login", { login: a.username, password: a.password })).status, 401);
});
