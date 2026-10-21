import { ApiError, bad } from "../lib/validate.js";
import { getSetting } from "../services/core.js";
import { createCheckout, recordWebhook, processEvent, markFailed, MIN_CENTS, MAX_CENTS } from "../services/payments.js";

export default async function donationRoutes(app) {
  const db = app.db;

  app.get("/info", async () => {
    const { rows: tiers } = await db.query(
      "SELECT t.key, t.threshold_cents, b.name, b.icon, b.color FROM supporter_tiers t JOIN badges b ON b.key = t.badge_key ORDER BY t.sort");
    return {
      enabled: !!app.stripe,
      currency: await getSetting(db, "donation_currency", "eur"),
      suggested: await getSetting(db, "donation_amounts", [200, 500, 1000, 2500]),
      min_cents: MIN_CENTS,
      max_cents: MAX_CENTS,
      monthly: true,
      tiers,
      rule: "net",
    };
  });

  app.post("/checkout", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    schema: { body: { type: "object", required: ["amount_cents"], properties: {
      amount_cents: { type: "integer" }, recurring: { type: "boolean" }, anonymous: { type: "boolean" } } } } },
  async (req) => {
    const user = app.user(req, { verified: true });
    if (!app.stripe) throw new ApiError(503, "donations_not_configured");
    const amount = req.body.amount_cents;
    if (amount < MIN_CENTS || amount > MAX_CENTS) throw bad("amount_invalid", undefined, { min: MIN_CENTS, max: MAX_CENTS });
    const currency = await getSetting(db, "donation_currency", "eur");
    const url = await createCheckout(app.stripe, db, app.cfg, { user, amountCents: amount, recurring: !!req.body.recurring, anonymous: !!req.body.anonymous, currency });
    return { url };
  });

  app.post("/portal", async (req) => {
    const user = app.user(req);
    if (!app.stripe) throw new ApiError(503, "donations_not_configured");
    const customers = await app.stripe.customers.list({ email: user.email, limit: 1 });
    if (!customers.data.length) throw new ApiError(404, "no_customer");
    const s = await app.stripe.billingPortal.sessions.create({ customer: customers.data[0].id, return_url: `${app.cfg.baseUrl}/me/donations` });
    return { url: s.url };
  });
}

export async function webhookRoutes(app) {
  const db = app.db;
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => done(null, body));
  app.post("/stripe", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } }, bodyLimit: 1024 * 1024 }, async (req, reply) => {
    if (!app.stripe) return reply.code(503).send({ error: "donations_not_configured" });
    let event;
    try {
      event = app.stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], app.cfg.stripe.webhookSecret);
    } catch {
      return reply.code(400).send({ error: "signature_invalid" });
    }
    const fresh = await recordWebhook(db, event);
    if (!fresh) {
      const { rows: [r] } = await db.query("SELECT status FROM payment_webhook_events WHERE id = $1", [event.id]);
      if (r.status != "failed" && r.status != "pending") return { received: true, duplicate: true };
    }
    try {
      await processEvent(db, event.id);
    } catch (e) {
      req.log.error(e, "webhook processing failed");
      await markFailed(db, event.id, e);
      return reply.code(500).send({ error: "processing_failed" });
    }
    return { received: true };
  });
}
