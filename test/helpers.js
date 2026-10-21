import Stripe from "stripe";
import { randomBytes } from "node:crypto";
import { config } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { createMailer } from "../src/services/mail.js";

export const WEBHOOK_SECRET = "whsec_test_" + randomBytes(8).toString("hex");

export async function setup({ withStripe = true, mozilla, zenFetch, zenImage = async () => null, downloadsDir } = {}) {
  const cfg = config({ ...process.env, APP_BASE_URL: "http://localhost:8790", MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex") });
  if (downloadsDir) cfg.downloadsDir = downloadsDir;
  cfg.stripe.webhookSecret = WEBHOOK_SECRET;
  const pool = createPool(process.env.DATABASE_URL);
  await migrate(pool);
  const silent = { warn() {}, info() {}, error() {} };
  const mailer = createMailer(cfg, silent);
  const stripe = withStripe ? new Stripe("sk_test_dummy") : null;
  const app = await buildApp({ cfg, pool, logger: false, mailer, stripe, mozilla, zenFetch, zenImage });
  await app.ready();
  return { app, pool, cfg, mailer, stripe };
}

let n = 0;
export const uniq = (p = "user") => `${p}${Date.now().toString(36).slice(-5)}${n++}`;

export function client(app, ip = `10.${n % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  let cookie = null;
  n++;
  const call = async (method, url, body, headers = {}) => {
    const res = await app.inject({
      method, url, payload: body, remoteAddress: ip,
      headers: { "x-orbit-request": "1", ...(cookie ? { cookie } : {}), ...headers },
    });
    const set = res.headers["set-cookie"];
    if (set) {
      const c = (Array.isArray(set) ? set : [set]).find(s => s.startsWith("orbit_session="));
      if (c) cookie = /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c) ? null : c.split(";")[0];
    }
    let json = null;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, body: json, res };
  };
  return {
    get: (u, h) => call("GET", u, undefined, h),
    post: (u, b, h) => call("POST", u, b ?? {}, h),
    patch: (u, b) => call("PATCH", u, b ?? {}),
    put: (u, b) => call("PUT", u, b ?? {}),
    del: u => call("DELETE", u),
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
  };
}

export async function member(ctx, { username = uniq(), verify = true, password = "correct horse battery" } = {}) {
  const c = client(ctx.app);
  const email = `${username}@example.org`;
  const r = await c.post("/api/v1/auth/register", { username, email, password, accept_terms: true });
  if (r.status != 201) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  if (verify) {
    const mail = ctx.mailer.outbox.findLast(m => m.to == email);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
    const v = await c.post("/api/v1/auth/verify-email", { token });
    if (v.status != 200) throw new Error("verify failed");
  }
  const { rows: [u] } = await ctx.pool.query("SELECT id FROM users WHERE username = $1", [username]);
  return Object.assign(c, { id: u.id, username, email, password });
}

export async function grantRole(pool, userId, role) {
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2 ON CONFLICT DO NOTHING", [userId, role]);
}

export async function reauth(c) {
  const r = await c.post("/api/v1/auth/reauth", { password: c.password });
  if (r.status != 200) throw new Error(`reauth ${r.status}`);
}

export function signedEvent(stripe, event) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}
