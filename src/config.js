import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadDotEnv(file = new URL("../.env", import.meta.url)) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function config(env = process.env) {
  const baseUrl = (env.APP_BASE_URL || "http://localhost:8790").replace(/\/$/, "");
  const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : baseUrl.startsWith("https://");
  return {
    env: env.NODE_ENV || "development",
    port: Number(env.PORT || env.SERVER_PORT || 8790),
    host: env.HOST || "0.0.0.0",
    baseUrl,
    databaseUrl: env.DATABASE_URL,
    cookieSecure: secure,
    mfaKey: env.MFA_ENCRYPTION_KEY || null,
    downloadsDir: env.DOWNLOADS_DIR || fileURLToPath(new URL("../downloads/", import.meta.url)),
    trustProxy: env.TRUST_PROXY === "true",
    initialOwnerId: env.INITIAL_OWNER_ID || null,
    mail: {
      host: env.SMTP_HOST || null,
      port: Number(env.SMTP_PORT || 587),
      user: env.SMTP_USER || null,
      pass: env.SMTP_PASSWORD || null,
      from: env.MAIL_FROM || "Orbit <no-reply@localhost>",
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY || null,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    },
    mozilla: {
      oauthUrl: (env.MOZILLA_OAUTH_URL || "https://oauth.accounts.firefox.com").replace(/\/$/, ""),
      profileUrl: (env.MOZILLA_PROFILE_URL || "https://profile.accounts.firefox.com").replace(/\/$/, ""),
      clientIds: (env.MOZILLA_CLIENT_IDS || "5882386c6d801776").split(",").map(s => s.trim()).filter(Boolean),
    },
    turnstileSecret: env.TURNSTILE_SECRET || null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  };
}
