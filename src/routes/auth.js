// /api/v1/auth: sign-up, e-mail verification, sign-in (with 2FA), sessions,
// password reset. Error messages never say whether an account exists.
import { tx } from "../db.js";
import { ApiError, bad, usernameProblem, emailProblem, normalizeEmail, passwordProblem } from "../lib/validate.js";
import { newToken, hashToken, hashPassword, verifyPassword, burnPasswordCheck, totpVerify, decrypt, hashRecoveryCode } from "../lib/crypto.js";
import { MAILS } from "../services/mail.js";
import { notify, audit } from "../services/core.js";
import { SESSION_COOKIE } from "../app.js";

const DAY = 864e5;

export async function createSession(app, req, reply, userId, { remember = false, mfaPassed = true, cookie = true } = {}) {
  const token = newToken();
  const ttl = remember ? 30 * DAY : DAY;
  await app.db.query(
    `INSERT INTO user_sessions (user_id, token_hash, remember, mfa_passed, ip, user_agent, expires_at, reauth_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4 THEN now() END)`,
    [userId, hashToken(token), remember, mfaPassed, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 300), new Date(Date.now() + (mfaPassed ? ttl : 10 * 60_000))]);
  // Apps (mobile, the browser itself) send the token as a Bearer header instead.
  if (cookie) {
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/", httpOnly: true, sameSite: "lax", secure: app.cfg.cookieSecure,
      ...(remember ? { maxAge: 30 * 24 * 3600 } : {}),
    });
  }
  return token;
}

export function clearSessionCookie(app, reply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: app.cfg.cookieSecure });
}

async function sendVerification(app, db, user, purpose = "verify", email = user.email) {
  const token = newToken();
  await db.query(
    "INSERT INTO email_verification_tokens (user_id, token_hash, purpose, email, expires_at) VALUES ($1, $2, $3, $4, now() + interval '24 hours')",
    [user.id, hashToken(token), purpose, email]);
  const link = `${app.cfg.baseUrl}/${purpose == "verify" ? "verify" : "confirm-email"}?token=${token}`;
  await app.mailer.send({ to: email, ...(purpose == "verify" ? MAILS.verify(link) : MAILS.changeEmail(link)) });
}

async function securityMail(app, db, userId, what) {
  await notify(db, userId, "security", { what });
  const { rows: [u] } = await db.query(
    "SELECT u.email, COALESCE(p.email_security, true) AS on FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = $1", [userId]);
  if (u?.on) await app.mailer.send({ to: u.email, ...MAILS.security(what) }).catch(e => app.log.error(e, "security mail"));
}

// Brute-force limits: per account and per address, over 15 minutes.
async function tooManyAttempts(db, keys) {
  const { rows } = await db.query(
    `SELECT key, COUNT(*)::int AS n FROM login_attempts WHERE key = ANY($1) AND NOT success AND created_at > now() - interval '15 minutes' GROUP BY key`,
    [keys]);
  return rows.some(r => (r.key.startsWith("ip:") ? r.n >= 30 : r.n >= 8));
}

async function recordAttempt(db, keys, success) {
  for (const key of keys) await db.query("INSERT INTO login_attempts (key, success) VALUES ($1, $2)", [key, success]);
}

async function checkTurnstile(app, token, ip) {
  if (!app.cfg.turnstileSecret) return true;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: app.cfg.turnstileSecret, response: String(token ?? ""), remoteip: ip }),
    });
    return (await res.json()).success === true;
  } catch {
    return false;
  }
}

const strict = max => ({ config: { rateLimit: { max, timeWindow: "15 minutes" } } });

export default async function authRoutes(app) {
  const db = app.db;

  app.get("/username-available", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const name = String(req.query.name ?? "");
    const problem = usernameProblem(name);
    if (problem) return { available: false, reason: problem };
    const { rows } = await db.query("SELECT 1 FROM users WHERE username_lower = lower($1)", [name]);
    return { available: rows.length == 0, reason: rows.length ? "username_taken" : null };
  });

  app.post("/register", {
    ...strict(10),
    schema: { body: { type: "object", required: ["username", "email", "password", "accept_terms"], properties: {
      username: { type: "string", maxLength: 24 }, email: { type: "string", maxLength: 254 }, password: { type: "string", maxLength: 256 },
      accept_terms: { type: "boolean" }, website: { type: "string" }, turnstile: { type: "string" } } } },
  }, async (req, reply) => {
    const { username, email, password, accept_terms: accepted, website, turnstile } = req.body;
    // A field people never see: only robots fill it.
    if (website) throw bad("rejected");
    if (!accepted) throw bad("terms_required");
    const p = usernameProblem(username) ?? emailProblem(email) ?? passwordProblem(password, { username, email });
    if (p) throw bad(p);
    if (!(await checkTurnstile(app, turnstile, req.ip))) throw bad("captcha_failed");
    const hash = await hashPassword(password);
    const user = await tx(db, async c => {
      const { rows: taken } = await c.query("SELECT username_lower = lower($1) AS name FROM users WHERE username_lower = lower($1) OR email_normalized = $2",
        [username, normalizeEmail(email)]);
      if (taken.some(t => t.name)) throw new ApiError(409, "username_taken");
      // Same answer as success when the e-mail is taken: the address owner gets a hint by mail instead.
      if (taken.length) return null;
      const { rows: [u] } = await c.query(
        "INSERT INTO users (username, email, email_normalized) VALUES ($1, $2, $3) RETURNING id, username, email",
        [username, email.trim(), normalizeEmail(email)]);
      await c.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)", [u.id, hash]);
      await c.query("INSERT INTO user_profiles (user_id) VALUES ($1)", [u.id]);
      await c.query("INSERT INTO user_privacy_settings (user_id) VALUES ($1)", [u.id]);
      await c.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [u.id]);
      await c.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'user'", [u.id]);
      await sendVerification(app, c, u);
      return u;
    });
    if (!user) {
      await app.mailer.send({ to: email, subject: "Orbit — compte existant / existing account",
        text: "Quelqu'un a voulu créer un compte Orbit avec ton adresse, qui en a déjà un. Si c'était toi, connecte-toi ou réinitialise ton mot de passe.\n\n" +
          "Someone tried to sign up to Orbit with your address, which already has an account. If it was you, sign in or reset your password." });
      return reply.code(201).send({ ok: true, verify: true });
    }
    await createSession(app, req, reply, user.id);
    return reply.code(201).send({ ok: true, verify: true });
  });

  app.post("/verify-email", { ...strict(30), schema: { body: { type: "object", required: ["token"], properties: { token: { type: "string", maxLength: 100 } } } } },
    async (req) => tx(db, async c => {
      const { rows: [t] } = await c.query(
        `UPDATE email_verification_tokens SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, purpose, email`, [hashToken(req.body.token)]);
      if (!t) throw bad("token_invalid");
      if (t.purpose == "verify") {
        await c.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1 AND email = $2", [t.user_id, t.email]);
      } else {
        const { rows: clash } = await c.query("SELECT 1 FROM users WHERE email_normalized = $1 AND id <> $2", [normalizeEmail(t.email), t.user_id]);
        if (clash.length) throw bad("token_invalid");
        const { rows: [old] } = await c.query("SELECT email FROM users WHERE id = $1", [t.user_id]);
        await c.query("UPDATE users SET email = $2, email_normalized = $3, email_verified_at = now(), updated_at = now() WHERE id = $1",
          [t.user_id, t.email, normalizeEmail(t.email)]);
        await app.mailer.send({ to: old.email, ...MAILS.security("L'adresse e-mail de ton compte Orbit a été changée. / Your Orbit e-mail address was changed.") });
        await notify(c, t.user_id, "security", { what: "email_changed" });
      }
      return { ok: true };
    }));

  app.post("/resend-verification", strict(5), async (req) => {
    const user = app.user(req, { mfa: false });
    const { rows: [u] } = await db.query("SELECT id, email, email_verified_at FROM users WHERE id = $1", [user.id]);
    if (!u.email_verified_at) await sendVerification(app, db, u);
    return { ok: true };
  });

  app.post("/login", {
    ...strict(20),
    schema: { body: { type: "object", required: ["login", "password"], properties: {
      login: { type: "string", maxLength: 254 }, password: { type: "string", maxLength: 256 }, remember: { type: "boolean" } } } },
  }, async (req, reply) => {
    const login = req.body.login.trim();
    const keys = [`ip:${req.ip}`, `acct:${login.toLowerCase()}`];
    if (await tooManyAttempts(db, keys)) throw new ApiError(429, "too_many_attempts");
    const { rows: [u] } = await db.query(
      `SELECT u.id, u.status, u.suspended_until, c.password_hash,
              EXISTS (SELECT 1 FROM user_mfa_methods m WHERE m.user_id = u.id AND m.confirmed_at IS NOT NULL) AS mfa
         FROM users u JOIN user_credentials c ON c.user_id = u.id
        WHERE ${login.includes("@") ? "u.email_normalized = $1" : "u.username_lower = lower($1)"}`,
      [login.includes("@") ? normalizeEmail(login) : login]);
    const ok = u ? await verifyPassword(u.password_hash, req.body.password) : (await burnPasswordCheck(req.body.password), false);
    await recordAttempt(db, keys, ok);
    if (!ok || u.status == "deleted") throw new ApiError(401, "invalid_credentials");
    if (u.status == "suspended" && (!u.suspended_until || u.suspended_until > new Date())) {
      throw new ApiError(403, "account_suspended", undefined, { until: u.suspended_until });
    }
    await createSession(app, req, reply, u.id, { remember: !!req.body.remember, mfaPassed: !u.mfa });
    const { rows: staff } = await db.query(
      "SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.key IN ('moderator', 'administrator', 'owner')", [u.id]);
    if (staff.length) await audit(db, { actorId: u.id, action: "admin.login", targetType: "user", targetId: u.id, ip: req.ip, meta: { mfa: u.mfa } });
    return { ok: true, mfa_required: u.mfa };
  });

  // Second step: a TOTP code, or a one-time recovery code.
  app.post("/mfa", {
    ...strict(20),
    schema: { body: { type: "object", properties: { code: { type: "string", maxLength: 6 }, recovery_code: { type: "string", maxLength: 20 } } } },
  }, async (req) => {
    if (!req.auth) throw new ApiError(401, "unauthenticated");
    const userId = req.auth.user.id;
    const keys = [`mfa:${userId}`];
    if (await tooManyAttempts(db, keys)) throw new ApiError(429, "too_many_attempts");
    const ok = await checkSecondFactor(app, db, userId, req.body);
    await recordAttempt(db, keys, ok);
    if (!ok) throw new ApiError(401, "invalid_code");
    await db.query(
      `UPDATE user_sessions SET mfa_passed = true, reauth_at = now(),
         expires_at = now() + CASE WHEN remember THEN interval '30 days' ELSE interval '1 day' END WHERE id = $1`, [req.auth.session.id]);
    if (req.body.recovery_code) await securityMail(app, db, userId, "Un code de récupération a été utilisé pour te connecter. / A recovery code was used to sign in.");
    return { ok: true };
  });

  // Confirms the password again before a sensitive action (10 minutes).
  app.post("/reauth", {
    ...strict(20),
    schema: { body: { type: "object", required: ["password"], properties: { password: { type: "string", maxLength: 256 }, code: { type: "string", maxLength: 6 } } } },
  }, async (req) => {
    const user = app.user(req);
    const keys = [`reauth:${user.id}`];
    if (await tooManyAttempts(db, keys)) throw new ApiError(429, "too_many_attempts");
    const { rows: [c] } = await db.query("SELECT password_hash FROM user_credentials WHERE user_id = $1", [user.id]);
    // Accounts made with a Mozilla account confirm by signing in again from Orbit.
    if (!c) throw new ApiError(403, "no_password");
    const { rows: mfa } = await db.query("SELECT 1 FROM user_mfa_methods WHERE user_id = $1 AND confirmed_at IS NOT NULL", [user.id]);
    let ok = await verifyPassword(c.password_hash, req.body.password);
    if (ok && mfa.length) ok = await checkSecondFactor(app, db, user.id, { code: req.body.code });
    await recordAttempt(db, keys, ok);
    if (!ok) throw new ApiError(401, mfa.length ? "invalid_credentials_or_code" : "invalid_credentials");
    await db.query("UPDATE user_sessions SET reauth_at = now() WHERE id = $1", [req.auth.session.id]);
    return { ok: true };
  });

  // ---- Mozilla account (Firefox Sync)
  // Signs in, links or creates the Orbit account tied to a verified Mozilla identity.
  // An unlinked identity goes, in order, to: the Orbit account signed in now, the
  // account with the same verified e-mail, or a new account (needs a username).
  async function mozillaSignIn(req, reply, { uid, email }, body, { cookie, current }) {
    const outcome = await tx(db, async c => {
      const { rows: [linked] } = await c.query(
        "SELECT user_id FROM oauth_accounts WHERE provider = 'mozilla' AND provider_user_id = $1", [uid]);
      if (linked) return { userId: linked.user_id };
      let userId = current?.session.mfaPassed ? current.user.id : null;
      if (!userId) {
        const { rows: [same] } = await c.query("SELECT id, email_verified_at FROM users WHERE email_normalized = $1", [normalizeEmail(email)]);
        // Anyone can sign up with an address they do not own: only a verified one is trusted.
        if (same && !same.email_verified_at) throw new ApiError(409, "email_in_use");
        userId = same?.id ?? null;
      }
      let created = false;
      if (!userId) {
        if (!body.username) return { needsUsername: true };
        if (!body.accept_terms) throw bad("terms_required");
        const p = usernameProblem(body.username);
        if (p) throw bad(p);
        const { rows: taken } = await c.query("SELECT 1 FROM users WHERE username_lower = lower($1)", [body.username]);
        if (taken.length) throw new ApiError(409, "username_taken");
        const { rows: [u] } = await c.query(
          "INSERT INTO users (username, email, email_normalized, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id",
          [body.username, email.trim(), normalizeEmail(email)]);
        await c.query("INSERT INTO user_profiles (user_id) VALUES ($1)", [u.id]);
        await c.query("INSERT INTO user_privacy_settings (user_id) VALUES ($1)", [u.id]);
        await c.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [u.id]);
        await c.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'user'", [u.id]);
        userId = u.id;
        created = true;
      } else {
        const { rows: other } = await c.query("SELECT 1 FROM oauth_accounts WHERE provider = 'mozilla' AND user_id = $1", [userId]);
        if (other.length) throw new ApiError(409, "mozilla_already_linked");
      }
      await c.query("INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES ($1, 'mozilla', $2)", [userId, uid]);
      return { userId, created, linked: !created };
    });
    if (outcome.needsUsername) return { ok: false, needs_username: true, email };

    const { rows: [u] } = await db.query(
      `SELECT u.status, u.suspended_until,
              EXISTS (SELECT 1 FROM user_mfa_methods m WHERE m.user_id = u.id AND m.confirmed_at IS NOT NULL) AS mfa
         FROM users u WHERE u.id = $1`, [outcome.userId]);
    if (u.status == "deleted") throw new ApiError(401, "invalid_credentials");
    if (u.status == "suspended" && (!u.suspended_until || u.suspended_until > new Date())) {
      throw new ApiError(403, "account_suspended", undefined, { until: u.suspended_until });
    }
    if (outcome.linked) {
      await securityMail(app, db, outcome.userId, "Un compte Mozilla a été lié à ton compte Orbit. / A Mozilla account was linked to your Orbit account.");
    }
    if (current) await db.query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1", [current.session.id]);
    const token = await createSession(app, req, reply, outcome.userId, { remember: body.remember !== false, mfaPassed: !u.mfa, cookie });
    return { ok: true, created: !!outcome.created, mfa_required: u.mfa, ...(cookie ? {} : { session: token }) };
  }

  const mozillaBody = { username: { type: "string", maxLength: 24 }, accept_terms: { type: "boolean" }, remember: { type: "boolean" } };

  // Called by the browser (or a mobile app) with a Mozilla OAuth token.
  //   client "app": signs in right away and answers with a Bearer session token.
  //   client "web" (default): answers with a one-time code the browser opens on
  //   the site (/connect?code=...), so the session lands in the site's cookie.
  app.post("/mozilla", {
    ...strict(20),
    schema: { body: { type: "object", required: ["token"], properties: {
      token: { type: "string", minLength: 10, maxLength: 4096 }, client: { enum: ["web", "app"] }, ...mozillaBody } } },
  }, async (req, reply) => {
    const identity = await app.mozilla(req.body.token);
    // Cookies are ignored here (this call skips the Origin check): only a Bearer session links.
    const bearer = /^Bearer /.test(req.headers.authorization ?? "") ? req.auth : null;
    if (req.body.client == "app") return mozillaSignIn(req, reply, identity, req.body, { cookie: false, current: bearer });
    const code = newToken();
    await db.query("DELETE FROM auth_handoffs WHERE expires_at < now()");
    await db.query(
      "INSERT INTO auth_handoffs (token_hash, provider, provider_user_id, email, expires_at) VALUES ($1, 'mozilla', $2, $3, now() + interval '10 minutes')",
      [hashToken(code), identity.uid, identity.email]);
    return { ok: true, code };
  });

  // The site side of the hand-off. Not spent while a username is still needed.
  app.post("/mozilla/redeem", {
    ...strict(30),
    schema: { body: { type: "object", required: ["code"], properties: { code: { type: "string", maxLength: 100 }, ...mozillaBody } } },
  }, async (req, reply) => {
    const { rows: [h] } = await db.query(
      "SELECT provider_user_id, email FROM auth_handoffs WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()", [hashToken(req.body.code)]);
    if (!h) throw bad("token_invalid");
    const out = await mozillaSignIn(req, reply, { uid: h.provider_user_id, email: h.email }, req.body, { cookie: true, current: req.auth });
    if (out.ok) await db.query("UPDATE auth_handoffs SET used_at = now() WHERE token_hash = $1", [hashToken(req.body.code)]);
    return out;
  });

  app.post("/logout", async (req, reply) => {
    if (req.auth) await db.query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1", [req.auth.session.id]);
    clearSessionCookie(app, reply);
    return { ok: true };
  });

  app.post("/logout-all", async (req, reply) => {
    const user = app.user(req, { mfa: false });
    await db.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
    clearSessionCookie(app, reply);
    return { ok: true };
  });

  app.post("/forgot", { ...strict(5), schema: { body: { type: "object", required: ["email"], properties: { email: { type: "string", maxLength: 254 } } } } },
    async (req) => {
      if (emailProblem(req.body.email)) throw bad("email_format");
      const { rows: [u] } = await db.query("SELECT id, email FROM users WHERE email_normalized = $1 AND status <> 'deleted'", [normalizeEmail(req.body.email)]);
      if (u) {
        const token = newToken();
        await db.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')",
          [u.id, hashToken(token)]);
        await app.mailer.send({ to: u.email, ...MAILS.reset(`${app.cfg.baseUrl}/reset?token=${token}`) });
      }
      // Same answer whether the address is known or not.
      return { ok: true };
    });

  app.post("/reset", {
    ...strict(10),
    schema: { body: { type: "object", required: ["token", "password"], properties: { token: { type: "string", maxLength: 100 }, password: { type: "string", maxLength: 256 } } } },
  }, async (req, reply) => {
    const userId = await tx(db, async c => {
      const { rows: [t] } = await c.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
        [hashToken(req.body.token)]);
      if (!t) throw bad("token_invalid");
      const { rows: [u] } = await c.query("SELECT username, email FROM users WHERE id = $1", [t.user_id]);
      const p = passwordProblem(req.body.password, u);
      if (p) throw bad(p);
      // Also how an account made with a Mozilla account gets its first password.
      await c.query(
        `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = now()`,
        [t.user_id, await hashPassword(req.body.password)]);
      // Every other reset link and every session ends with the old password.
      await c.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [t.user_id]);
      await c.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [t.user_id]);
      return t.user_id;
    });
    clearSessionCookie(app, reply);
    await securityMail(app, db, userId, "Le mot de passe de ton compte Orbit a été changé. / Your Orbit password was changed.");
    return { ok: true };
  });
}

export async function checkSecondFactor(app, db, userId, { code, recovery_code: recovery }) {
  if (recovery) {
    const { rowCount } = await db.query(
      `UPDATE user_recovery_codes SET used_at = now()
        WHERE id = (SELECT id FROM user_recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)`,
      [userId, hashRecoveryCode(recovery)]);
    return rowCount == 1;
  }
  const { rows: [m] } = await db.query("SELECT id, secret_enc, last_step FROM user_mfa_methods WHERE user_id = $1 AND confirmed_at IS NOT NULL", [userId]);
  if (!m || !app.cfg.mfaKey) return false;
  const step = totpVerify(decrypt(app.cfg.mfaKey, m.secret_enc), code, Date.now(), m.last_step == null ? null : Number(m.last_step));
  if (step == null) return false;
  // A code works once.
  const { rowCount } = await db.query("UPDATE user_mfa_methods SET last_step = $2 WHERE id = $1 AND (last_step IS NULL OR last_step < $2)", [m.id, step]);
  return rowCount == 1;
}

export { sendVerification, securityMail };
