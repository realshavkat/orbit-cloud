import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, grantRole, signedEvent } from "./helpers.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

let seq = 0;
const id = p => `${p}_${Date.now()}_${seq++}`;
const send = event => {
  const { payload, header } = signedEvent(ctx.stripe, event);
  return ctx.app.inject({ method: "POST", url: "/api/v1/webhooks/stripe", payload, headers: { "content-type": "application/json", "stripe-signature": header } });
};
const setPaywall = (paywall, price = 200) => ctx.pool.query("UPDATE app_settings SET value = $1 WHERE key = 'beta'", [{ paywall, price_cents: price }]);

test("license: required during the paid beta, active once paid; refunds take it back", async () => {
  await setPaywall(true);
  const u = await member(ctx);
  assert.equal((await client(ctx.app).get("/api/v1/license")).status, 401);
  let lic = (await u.get("/api/v1/license")).body;
  assert.deepEqual([lic.required, lic.active], [true, false]);
  assert.equal((await client(ctx.app).get("/api/v1/config")).body.beta.price_cents, 200);

  const checkout = id("cs"), pi = id("pi");
  await ctx.pool.query("INSERT INTO donations (user_id, provider, checkout_ref, amount_cents, currency, status, purpose) VALUES ($1, 'stripe', $2, 200, 'eur', 'pending', 'beta')", [u.id, checkout]);
  assert.equal((await send({ id: id("evt"), type: "checkout.session.completed", data: { object: { id: checkout, mode: "payment", payment_status: "paid", amount_total: 200, currency: "eur", payment_intent: pi } } })).statusCode, 200);
  lic = (await u.get("/api/v1/license")).body;
  assert.equal(lic.active, true);
  const me = (await u.get("/api/v1/me")).body;
  assert.ok(me.badges.some(b => b.key == "beta_tester"), "beta tester badge");
  assert.ok(!me.badges.some(b => b.key == "supporter"), "buying the beta is not a donation");
  assert.equal((await u.get("/api/v1/beta")).body.owned, true);

  await send({ id: id("evt"), type: "charge.refunded", data: { object: { payment_intent: pi, amount_refunded: 200, refunds: { data: [{ id: id("re"), amount: 200, status: "succeeded" }] } } } });
  assert.equal((await u.get("/api/v1/license")).body.active, false);
});

test("staff grant beta by hand; the free period opens it to everyone", async () => {
  await setPaywall(true);
  const admin = await member(ctx);
  await grantRole(ctx.pool, admin.id, "administrator");
  const u = await member(ctx);
  const plain = await member(ctx);
  assert.equal((await plain.post(`/api/v1/admin/beta/users/${u.id}`, { action: "grant", reason: "tester" })).status, 403);
  assert.equal((await admin.post(`/api/v1/admin/beta/users/${u.id}`, { action: "grant", reason: "early tester" })).body.granted, true);
  assert.equal((await u.get("/api/v1/license")).body.active, true);
  assert.equal((await admin.get("/api/v1/license")).body.active, true, "staff always have access");
  assert.equal((await admin.post(`/api/v1/admin/beta/users/${u.id}`, { action: "revoke", reason: "test over" })).body.granted, false);
  assert.equal((await u.get("/api/v1/license")).body.active, false);

  await setPaywall(false);
  const lic = (await plain.get("/api/v1/license")).body;
  assert.deepEqual([lic.required, lic.active], [false, true]);
  assert.equal((await plain.post("/api/v1/beta/checkout")).body.error, "beta_free");
  await setPaywall(true);
});
