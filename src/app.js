import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { fileURLToPath } from "node:url";
import { ApiError } from "./lib/validate.js";
import { hashToken } from "./lib/crypto.js";
import { permissionsOf, rolesOf } from "./services/core.js";
import { createMailer } from "./services/mail.js";
import { createStripe } from "./services/payments.js";
import { createMozillaVerifier } from "./services/mozilla.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import userRoutes from "./routes/users.js";
import badgeRoutes from "./routes/badges.js";
import friendRoutes from "./routes/friends.js";
import notificationRoutes from "./routes/notifications.js";
import siteRoutes from "./routes/sites.js";
import donationRoutes, { webhookRoutes } from "./routes/donations.js";
import reportRoutes from "./routes/reports.js";
import adminRoutes from "./routes/admin.js";
import modRoutes, { modAdminRoutes, createZenFetcher, createZenImageFetcher } from "./routes/mods.js";
import betaRoutes, { licenseRoutes, betaAdminRoutes } from "./routes/beta.js";
import forumRoutes from "./routes/forum.js";
import { betaSettings, setKeySecret } from "./services/beta.js";

export const SESSION_COOKIE = "orbit_session";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp({ cfg, pool, logger = true, mailer, stripe, mozilla, zenFetch, zenImage }) {
  const app = Fastify({
    logger: logger && { level: cfg.env == "test" ? "warn" : "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"] },
    trustProxy: cfg.trustProxy,
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.decorate("cfg", cfg);
  app.decorate("db", pool);
  app.decorate("mailer", mailer ?? createMailer(cfg, app.log));
  app.decorate("stripe", stripe === undefined ? createStripe(cfg) : stripe);
  app.decorate("mozilla", mozilla ?? createMozillaVerifier(cfg));
  setKeySecret(cfg.mfaKey);
  app.decorate("zenFetch", zenFetch ?? createZenFetcher());
  app.decorate("zenImage", zenImage ?? createZenImageFetcher());

  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 4 } });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (!reply.getHeader("Content-Security-Policy")) {
      const turnstile = cfg.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
      reply.header("Content-Security-Policy",
        `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'${turnstile}; frame-src${turnstile || " 'none'"}; ` +
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    }
    if (cfg.cookieSecure) reply.header("Strict-Transport-Security", "max-age=31536000");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, ...(err.extra ?? {}) });
    if (err.validation) return reply.code(400).send({ error: "invalid_input", field: err.validation[0]?.instancePath || err.validation[0]?.params?.missingProperty });
    if (err.statusCode == 429) return reply.code(429).send({ error: "rate_limited" });
    if (String(err.type ?? "").startsWith("Stripe")) {
      req.log.error({ type: err.type, code: err.code }, "payment provider error");
      return reply.code(502).send({ error: "payment_provider_error" });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code?.toLowerCase?.() ?? "bad_request" });
    req.log.error(err);
    return reply.code(500).send({ error: "server_error" });
  });

  app.decorateRequest("auth", null);
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    const bearer = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? "")?.[1];
    const token = bearer ?? req.cookies[SESSION_COOKIE];
    if (!SAFE.has(req.method) && !bearer && !req.url.startsWith("/api/v1/webhooks/")) {
      if (req.headers["x-orbit-request"] != "1") throw new ApiError(403, "csrf");
      const origin = req.headers.origin;
      const noCookieAuth = ["/api/v1/auth/mozilla", "/api/v1/license/activate"].includes(req.url.split("?")[0]);
      if (origin && origin != new URL(cfg.baseUrl).origin && !noCookieAuth) throw new ApiError(403, "csrf");
    }
    if (!token) return;
    const { rows: [s] } = await pool.query(
      `SELECT s.id, s.user_id, s.mfa_passed, s.reauth_at, s.expires_at, s.remember, s.last_seen_at,
              u.username, u.email, u.status, u.suspended_until, u.social_suspended_until, u.email_verified_at, u.last_active_at
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [hashToken(token)]);
    if (!s) return;
    if (s.status == "suspended" && s.suspended_until && s.suspended_until <= new Date()) {
      await pool.query("UPDATE users SET status = 'active', suspended_until = NULL WHERE id = $1", [s.user_id]);
      s.status = "active";
    }
    if (s.status != "active") return;
    const now = Date.now();
    if (now - s.last_seen_at > 5 * 60_000) {
      await pool.query(
        `UPDATE user_sessions SET last_seen_at = now(),
           expires_at = CASE WHEN remember THEN now() + interval '30 days' ELSE expires_at END WHERE id = $1`, [s.id]);
      await pool.query("UPDATE users SET last_active_at = now() WHERE id = $1", [s.user_id]);
    }
    let perms = null;
    let roles = null;
    req.auth = {
      session: { id: s.id, mfaPassed: s.mfa_passed, reauthAt: s.reauth_at },
      user: { id: s.user_id, username: s.username, email: s.email, verified: !!s.email_verified_at,
        socialSuspendedUntil: s.social_suspended_until },
      async perms() {
        return (perms ??= await permissionsOf(pool, s.user_id));
      },
      async roles() {
        return (roles ??= await rolesOf(pool, s.user_id));
      },
    };
  });

  app.decorate("user", (req, { mfa = true, verified = false } = {}) => {
    if (!req.auth) throw new ApiError(401, "unauthenticated");
    if (mfa && !req.auth.session.mfaPassed) throw new ApiError(401, "mfa_required");
    if (verified && !req.auth.user.verified) throw new ApiError(403, "email_unverified");
    return req.auth.user;
  });
  app.decorate("perm", async (req, key) => {
    app.user(req);
    if (!(await req.auth.perms()).has(key)) throw new ApiError(403, "forbidden");
  });
  app.decorate("recentAuth", req => {
    const at = req.auth?.session.reauthAt;
    if (!at || Date.now() - new Date(at) > 10 * 60_000) throw new ApiError(403, "reauth_required");
  });
  app.decorate("socialAllowed", req => {
    const until = req.auth.user.socialSuspendedUntil;
    if (until && new Date(until) > new Date()) throw new ApiError(403, "social_suspended");
  });

  const api = async (instance) => {
    await instance.register(authRoutes, { prefix: "/auth" });
    await instance.register(meRoutes, { prefix: "/me" });
    await instance.register(userRoutes, { prefix: "/users" });
    await instance.register(badgeRoutes, { prefix: "/badges" });
    await instance.register(friendRoutes, { prefix: "/friends" });
    await instance.register(notificationRoutes, { prefix: "/notifications" });
    await instance.register(siteRoutes, { prefix: "/sites" });
    await instance.register(donationRoutes, { prefix: "/donations" });
    await instance.register(webhookRoutes, { prefix: "/webhooks" });
    await instance.register(reportRoutes, { prefix: "/reports" });
    await instance.register(adminRoutes, { prefix: "/admin" });
    await instance.register(modRoutes, { prefix: "/mods" });
    await instance.register(modAdminRoutes, { prefix: "/admin/mods" });
    await instance.register(betaRoutes, { prefix: "/beta" });
    await instance.register(forumRoutes, { prefix: "/forum" });
    await instance.register(licenseRoutes, { prefix: "/license" });
    await instance.register(betaAdminRoutes, { prefix: "/admin/beta" });
  };
  await app.register(api, { prefix: "/api/v1" });

  app.get("/api/health", { config: { rateLimit: false } }, async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });
  app.get("/api/v1/config", async () => ({
    baseUrl: cfg.baseUrl,
    turnstileSiteKey: cfg.turnstileSiteKey,
    donations: !!app.stripe,
    mail: app.mailer.configured,
    beta: await betaSettings(pool),
  }));

  const web = fileURLToPath(new URL("../web/dist/", import.meta.url));
  await app.register(fastifyStatic, { root: `${web}assets`, prefix: "/assets/", index: false, maxAge: "7d" });
  app.setNotFoundHandler((req, reply) => {
    if (req.method == "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/assets/")) return reply.header("Cache-Control", "no-cache").sendFile("index.html", web);
    return reply.code(404).send({ error: "not_found" });
  });
  return app;
}
