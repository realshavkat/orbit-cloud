import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, client, member, signedEvent } from "./helpers.js";

let ctx;
before(async () => (ctx = await setup()));
after(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

let seq = 0;
const id = p => `${p}_${Date.now()}_${seq++}`;

async function send(event, { secret = true } = {}) {
  const { payload, header } = signedEvent(ctx.stripe, event);
  return ctx.app.inject({ method: "POST", url: "/api/v1/webhooks/stripe", payload,
    headers: { "content-type": "application/json", "stripe-signature": secret ? header : "t=1,v1=deadbeef" } });
}

// A pending donation as checkout would leave it (Stripe itself is not called in tests).
async function pending(user, cents, recurring = false) {
  const checkout = id("cs");
  await ctx.pool.query(
    "INSERT INTO donations (user_id, provider, checkout_ref, amount_cents, currency, status, recurring) VALUES ($1, 'stripe', $2, $3, 'eur', 'pending', $4)",
    [user.id, checkout, cents, recurring]);
  return checkout;
}

const completed = (checkout, cents, pi = id("pi")) => ({ id: id("evt"), type: "checkout.session.completed", data: { object: {
  id: checkout, mode: "payment", payment_status: "paid", amount_total: cents, currency: "eur", payment_intent: pi } } });

const badgesOf = async (u) => (await u.get("/api/v1/me")).body.badges.map(b => b.key);

test("returning from checkout gives nothing; only a signed webhook confirms a donation", async () => {
  const u = await member(ctx);
  await pending(u, 500);
  // The success page is just a page.
  assert.deepEqual(await badgesOf(u), []);
  assert.equal((await u.get("/api/v1/me/donations")).body.donations.length, 0);
});

test("invalid signature is refused and changes nothing", async () => {
  const u = await member(ctx);
  const checkout = await pending(u, 500);
  const r = await send(completed(checkout, 500), { secret: false });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(await badgesOf(u), []);
});

test("a confirmed payment gives the Supporter badge; the same event twice counts once", async () => {
  const u = await member(ctx);
  const checkout = await pending(u, 500);
  const event = completed(checkout, 500);
  assert.equal((await send(event)).statusCode, 200);
  const again = await send(event);
  assert.equal(again.json().duplicate, true);
  assert.ok((await badgesOf(u)).includes("supporter"));
  const { rows } = await ctx.pool.query("SELECT COUNT(*)::int AS n FROM payment_events WHERE provider_event_id = $1", [event.id]);
  assert.equal(rows[0].n, 1);
  const mine = await u.get("/api/v1/me/donations");
  assert.equal(mine.body.donations[0].status, "succeeded");
});

test("a failed payment gives nothing", async () => {
  const u = await member(ctx);
  const checkout = await pending(u, 500);
  await send({ id: id("evt"), type: "checkout.session.async_payment_failed", data: { object: { id: checkout, mode: "payment", payment_status: "unpaid" } } });
  assert.deepEqual(await badgesOf(u), []);
  const { rows } = await ctx.pool.query("SELECT status FROM donations WHERE checkout_ref = $1", [checkout]);
  assert.equal(rows[0].status, "failed");
});

test("tiers follow the net total; a refund takes them back", async () => {
  const u = await member(ctx);
  const checkout = await pending(u, 3000);
  const pi = id("pi");
  await send(completed(checkout, 3000, pi));
  let b = await badgesOf(u);
  assert.ok(b.includes("supporter") && b.includes("supporter_bronze"));
  assert.ok(!b.includes("supporter_silver"));
  // Partial refund: 3000 - 1000 = 2000 < bronze threshold (2500).
  await send({ id: id("evt"), type: "charge.refunded", data: { object: { payment_intent: pi, amount_refunded: 1000,
    refunds: { data: [{ id: id("re"), amount: 1000, status: "succeeded" }] } } } });
  b = await badgesOf(u);
  assert.ok(b.includes("supporter") && !b.includes("supporter_bronze"));
  // Full refund: nothing left.
  await send({ id: id("evt"), type: "charge.refunded", data: { object: { payment_intent: pi, amount_refunded: 3000,
    refunds: { data: [{ id: id("re"), amount: 2000, status: "succeeded" }] } } } });
  assert.deepEqual(await badgesOf(u), []);
});

test("a dispute suspends the donation's badges until it is won", async () => {
  const u = await member(ctx);
  const checkout = await pending(u, 500);
  const pi = id("pi");
  await send(completed(checkout, 500, pi));
  await send({ id: id("evt"), type: "charge.dispute.created", data: { object: { payment_intent: pi, status: "needs_response" } } });
  assert.deepEqual(await badgesOf(u), []);
  await send({ id: id("evt"), type: "charge.dispute.closed", data: { object: { payment_intent: pi, status: "won" } } });
  assert.ok((await badgesOf(u)).includes("supporter"));
});

test("monthly support: badge while the subscription is active, removed when it ends", async () => {
  const u = await member(ctx);
  const checkout = await pending(u, 500, true);
  const sub = id("sub");
  await send({ id: id("evt"), type: "checkout.session.completed", data: { object: { id: checkout, mode: "subscription", subscription: sub, payment_status: "paid" } } });
  assert.ok(!(await badgesOf(u)).includes("supporter_monthly"), "not before the money is confirmed");
  await send({ id: id("evt"), type: "invoice.paid", data: { object: { id: id("in"), subscription: sub, amount_paid: 500, currency: "eur", payment_intent: id("pi") } } });
  await send({ id: id("evt"), type: "customer.subscription.updated", data: { object: { id: sub, status: "active", metadata: { user_id: u.id }, items: { data: [] } } } });
  let b = await badgesOf(u);
  assert.ok(b.includes("supporter_monthly") && b.includes("supporter"));
  const { rows } = await ctx.pool.query("SELECT status FROM donations WHERE user_id = $1", [u.id]);
  assert.deepEqual(rows.map(r => r.status), ["succeeded"], "the first invoice completes the checkout donation");
  await send({ id: id("evt"), type: "customer.subscription.deleted", data: { object: { id: sub, status: "canceled", metadata: { user_id: u.id }, items: { data: [] } } } });
  b = await badgesOf(u);
  assert.ok(!b.includes("supporter_monthly"), "monthly badge removed");
  assert.ok(b.includes("supporter"), "the first-donation badge stays");
});

test("an unpaid renewal removes the monthly badge", async () => {
  const u = await member(ctx);
  const sub = id("sub");
  await send({ id: id("evt"), type: "customer.subscription.created", data: { object: { id: sub, status: "active", metadata: { user_id: u.id }, items: { data: [] } } } });
  assert.ok((await badgesOf(u)).includes("supporter_monthly"));
  await send({ id: id("evt"), type: "invoice.payment_failed", data: { object: { id: id("in"), subscription: sub } } });
  assert.ok(!(await badgesOf(u)).includes("supporter_monthly"));
});

test("checkout input is validated on the server", async () => {
  const u = await member(ctx);
  assert.equal((await u.post("/api/v1/donations/checkout", { amount_cents: 50 })).body.error, "amount_invalid");
  assert.equal((await u.post("/api/v1/donations/checkout", { amount_cents: "500" })).status, 400);
  const c = client(ctx.app);
  assert.equal((await c.post("/api/v1/donations/checkout", { amount_cents: 500 })).status, 401);
});

test("an admin cannot edit confirmed payments: there is no route for it", async () => {
  const r = await client(ctx.app).post("/api/v1/admin/donations/x", {});
  assert.equal(r.status, 404);
});
