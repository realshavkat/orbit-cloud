import Stripe from "stripe";
import { tx } from "../db.js";
import { syncSupporterBadges } from "./badges.js";
import { syncBeta } from "./beta.js";

export const MIN_CENTS = 100;
export const MAX_CENTS = 100_000;

export function createStripe(cfg) {
  if (!cfg.stripe.secretKey || !cfg.stripe.webhookSecret) return null;
  return new Stripe(cfg.stripe.secretKey);
}

export async function createCheckout(stripe, db, cfg, { user, amountCents, recurring, anonymous, currency, purpose = "donation" }) {
  const { rows: [donation] } = await db.query(
    `INSERT INTO donations (user_id, provider, amount_cents, currency, status, recurring, public_anonymous, purpose)
     VALUES ($1, 'stripe', $2, $3, 'pending', $4, $5, $6) RETURNING id`, [user.id, amountCents, currency, recurring, anonymous, purpose]);
  const name = purpose == "beta" ? "Orbit beta access" : recurring ? "Monthly support for Orbit" : "Donation to Orbit";
  const price = { currency, unit_amount: amountCents, product_data: { name } };
  const back = purpose == "beta" ? "beta" : "support";
  if (recurring) price.recurring = { interval: "month" };
  const session = await stripe.checkout.sessions.create({
    mode: recurring ? "subscription" : "payment",
    line_items: [{ price_data: price, quantity: 1 }],
    customer_email: user.email,
    client_reference_id: donation.id,
    metadata: { donation_id: donation.id, user_id: user.id },
    ...(recurring ? { subscription_data: { metadata: { user_id: user.id } } } : { payment_intent_data: { metadata: { donation_id: donation.id, user_id: user.id } } }),
    success_url: `${cfg.baseUrl}/${back}?thanks=1`,
    cancel_url: `${cfg.baseUrl}/${back}?canceled=1`,
  }, { idempotencyKey: `donation-${donation.id}` });
  await db.query("UPDATE donations SET checkout_ref = $2 WHERE id = $1", [donation.id, session.id]);
  return session.url;
}

export async function recordWebhook(db, event) {
  const { rowCount } = await db.query(
    "INSERT INTO payment_webhook_events (id, provider, type, payload) VALUES ($1, 'stripe', $2, $3) ON CONFLICT (id) DO NOTHING",
    [event.id, event.type, event]);
  return rowCount == 1;
}

async function log(db, donationId, type, amount, eventId) {
  await db.query("INSERT INTO payment_events (donation_id, type, amount_cents, provider_event_id) VALUES ($1,$2,$3,$4)",
    [donationId, type, amount, eventId]);
}

async function donationBy(db, column, value) {
  if (!value) return null;
  const { rows } = await db.query(`SELECT * FROM donations WHERE ${column} = $1 FOR UPDATE`, [value]);
  return rows[0] ?? null;
}

async function upsertSubscription(db, sub, userId) {
  const item = sub.items?.data?.[0];
  const { rows: [row] } = await db.query(
    `INSERT INTO subscriptions (user_id, provider, provider_sub_id, status, amount_cents, currency, current_period_end, canceled_at)
     VALUES ($1, 'stripe', $2, $3, $4, $5, to_timestamp($6), CASE WHEN $3 = 'canceled' THEN now() END)
     ON CONFLICT (provider_sub_id) DO UPDATE SET status = EXCLUDED.status,
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       canceled_at = CASE WHEN EXCLUDED.status = 'canceled' THEN COALESCE(subscriptions.canceled_at, now()) END,
       user_id = COALESCE(subscriptions.user_id, EXCLUDED.user_id), updated_at = now()
     RETURNING *`,
    [userId, sub.id, sub.status, item?.price?.unit_amount ?? null, item?.price?.currency ?? null, item?.current_period_end ?? sub.current_period_end ?? null]);
  return row;
}

export async function processEvent(pool, eventId) {
  return tx(pool, async db => {
    const { rows: [rec] } = await db.query("SELECT * FROM payment_webhook_events WHERE id = $1 FOR UPDATE", [eventId]);
    if (!rec || rec.status == "processed" || rec.status == "ignored") return rec?.status ?? "missing";
    const event = rec.payload;
    const o = event.data.object;
    const users = new Set();
    let handled = true;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed": {
        const d = await donationBy(db, "checkout_ref", o.id);
        if (!d) break;
        if (o.mode == "subscription") {
          if (o.subscription) {
            await db.query(
              `INSERT INTO subscriptions (user_id, provider, provider_sub_id, status) VALUES ($1, 'stripe', $2, 'incomplete')
               ON CONFLICT (provider_sub_id) DO UPDATE SET user_id = COALESCE(subscriptions.user_id, EXCLUDED.user_id)`, [d.user_id, o.subscription]);
            const { rows: [sub] } = await db.query("SELECT id FROM subscriptions WHERE provider_sub_id = $1", [o.subscription]);
            await db.query("UPDATE donations SET subscription_id = $2, updated_at = now() WHERE id = $1", [d.id, sub.id]);
            const { rows: paid } = await db.query(
              "SELECT 1 FROM donations WHERE subscription_id = $1 AND status = 'succeeded' AND id <> $2 LIMIT 1", [sub.id, d.id]);
            if (paid.length && d.status == "pending") await db.query("UPDATE donations SET status = 'canceled', updated_at = now() WHERE id = $1", [d.id]);
          }
          if (event.type == "checkout.session.async_payment_failed") await db.query("UPDATE donations SET status = 'failed' WHERE id = $1", [d.id]);
          break;
        }
        const paid = o.payment_status == "paid" && event.type != "checkout.session.async_payment_failed";
        const failed = event.type == "checkout.session.async_payment_failed";
        if (paid && d.status == "pending") {
          await db.query(
            `UPDATE donations SET status = 'succeeded', confirmed_at = now(), amount_cents = $2, currency = $3,
               payment_ref = $4, updated_at = now() WHERE id = $1`, [d.id, o.amount_total, o.currency, o.payment_intent]);
          await log(db, d.id, "succeeded", o.amount_total, event.id);
        } else if (failed && d.status == "pending") {
          await db.query("UPDATE donations SET status = 'failed', updated_at = now() WHERE id = $1", [d.id]);
          await log(db, d.id, "failed", null, event.id);
        }
        users.add(d.user_id);
        break;
      }
      case "checkout.session.expired": {
        const d = await donationBy(db, "checkout_ref", o.id);
        if (d?.status == "pending") await db.query("UPDATE donations SET status = 'canceled', updated_at = now() WHERE id = $1", [d.id]);
        break;
      }
      case "invoice.paid": {
        const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
        if (!subId || !o.amount_paid) break;
        const { rows: [sub] } = await db.query("SELECT * FROM subscriptions WHERE provider_sub_id = $1", [subId]);
        const userId = sub?.user_id ?? o.subscription_details?.metadata?.user_id ?? o.parent?.subscription_details?.metadata?.user_id ?? null;
        const payRef = o.payment_intent ?? o.charge ?? null;
        let { rows: [d] } = sub ? await db.query(
          `UPDATE donations SET status = 'succeeded', invoice_ref = $2, payment_ref = $3, amount_cents = $4, currency = $5,
             confirmed_at = now(), updated_at = now()
           WHERE id = (SELECT id FROM donations WHERE subscription_id = $1 AND status = 'pending' ORDER BY created_at LIMIT 1)
             AND NOT EXISTS (SELECT 1 FROM donations WHERE invoice_ref = $2) RETURNING id`,
          [sub.id, o.id, payRef, o.amount_paid, o.currency]) : { rows: [] };
        if (!d) {
          ({ rows: [d] } = await db.query(
            `INSERT INTO donations (user_id, provider, invoice_ref, payment_ref, subscription_id, amount_cents, currency, status, recurring, confirmed_at)
             VALUES ($1, 'stripe', $2, $3, $4, $5, $6, 'succeeded', true, now()) ON CONFLICT (invoice_ref) DO NOTHING RETURNING id`,
            [userId, o.id, payRef, sub?.id ?? null, o.amount_paid, o.currency]));
        }
        if (d) await log(db, d.id, "succeeded", o.amount_paid, event.id);
        if (sub) await db.query("UPDATE subscriptions SET status = 'active', updated_at = now() WHERE id = $1", [sub.id]);
        users.add(userId);
        break;
      }
      case "invoice.payment_failed": {
        const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
        const { rows } = await db.query("UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE provider_sub_id = $1 RETURNING user_id", [subId]);
        if (rows[0]) users.add(rows[0].user_id);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = await upsertSubscription(db, o, o.metadata?.user_id ?? null);
        users.add(sub.user_id);
        break;
      }
      case "charge.refunded": {
        const d = await donationBy(db, "payment_ref", o.payment_intent);
        if (!d) break;
        for (const r of o.refunds?.data ?? []) {
          await db.query(
            `INSERT INTO refunds (donation_id, provider_refund_id, amount_cents, status) VALUES ($1,$2,$3,$4)
             ON CONFLICT (provider_refund_id) DO UPDATE SET status = EXCLUDED.status`, [d.id, r.id, r.amount, r.status]);
        }
        const refunded = Math.min(d.amount_cents, o.amount_refunded);
        await db.query(
          `UPDATE donations SET refunded_cents = $2, status = CASE WHEN $2 >= amount_cents THEN 'refunded' ELSE 'partially_refunded' END,
             updated_at = now() WHERE id = $1`, [d.id, refunded]);
        await log(db, d.id, "refunded", refunded, event.id);
        users.add(d.user_id);
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const d = await donationBy(db, "payment_ref", o.payment_intent);
        if (!d) break;
        const lost = event.type == "charge.dispute.created" || o.status == "lost";
        await db.query("UPDATE donations SET status = $2, updated_at = now() WHERE id = $1",
          [d.id, lost ? "disputed" : (d.refunded_cents ? "partially_refunded" : "succeeded")]);
        await log(db, d.id, lost ? "disputed" : "dispute_won", null, event.id);
        users.add(d.user_id);
        break;
      }
      default:
        handled = false;
    }
    for (const u of users) {
      await syncSupporterBadges(db, u);
      await syncBeta(db, u);
    }
    await db.query("UPDATE payment_webhook_events SET status = $2, processed_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1",
      [eventId, handled ? "processed" : "ignored"]);
    return handled ? "processed" : "ignored";
  });
}

export async function markFailed(pool, eventId, err) {
  await pool.query("UPDATE payment_webhook_events SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1",
    [eventId, String(err?.message ?? err).slice(0, 500)]);
}
