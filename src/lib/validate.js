// Input rules shared by the routes. Everything users type is checked here,
// on the server; the pages only repeat the same rules for comfort.

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const bad = (code, message, extra) => new ApiError(400, code, message, extra);

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

// Names a member cannot take: system words and anything posing as Orbit or its staff.
const RESERVED = new Set(["admin", "administrator", "admins", "root", "system", "support", "help", "moderator", "mod", "mods",
  "staff", "team", "official", "security", "orbit", "orbitbrowser", "orbit-browser", "orbit_team", "orbitteam", "owner", "founder",
  "api", "www", "mail", "noreply", "no-reply", "null", "undefined", "anonymous", "deleted", "me", "settings", "login", "logout",
  "register", "signup", "signin", "auth", "u", "user", "users", "badges", "admin-panel", "abuse", "billing", "donate", "verify"]);

export function usernameProblem(name) {
  if (typeof name != "string" || !USERNAME_RE.test(name)) return "username_format";
  const n = name.toLowerCase();
  const squashed = n.replace(/[._-]/g, "");
  if (RESERVED.has(n) || RESERVED.has(squashed)) return "username_reserved";
  if (/^(orbit|admin|mod|staff|official|support)/.test(squashed) || /(admin|official|staff)$/.test(squashed)) return "username_reserved";
  if (/^[._-]|[._-]$|[._-]{2}/.test(name)) return "username_format";
  return null;
}

const EMAIL_RE = /^[^\s@"(),:;<>[\]\\]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function emailProblem(email) {
  return typeof email == "string" && email.length <= 254 && EMAIL_RE.test(email) ? null : "email_format";
}

// One account per mailbox: case-insensitive, and Gmail ignores dots and "+tags".
export function normalizeEmail(email) {
  let [local, domain] = email.trim().toLowerCase().split("@");
  if (domain == "googlemail.com") domain = "gmail.com";
  local = local.replace(/\+.*$/, "");
  if (domain == "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function passwordProblem(password, { username, email } = {}) {
  if (typeof password != "string" || password.length < 10) return "password_short";
  if (password.length > 256) return "password_long";
  const p = password.toLowerCase();
  if ((username && p.includes(username.toLowerCase())) || (email && p.includes(email.split("@")[0].toLowerCase()))) return "password_personal";
  if (new Set(password).size < 5) return "password_weak";
  return null;
}

// Plain text only: control characters removed, length capped. Pages render it
// with textContent, so markup never runs; this keeps stored data clean too.
export function cleanText(value, max) {
  if (value == null) return null;
  if (typeof value != "string") throw bad("text_type");
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "").trim();
  if (s.length > max) throw bad("text_long", undefined, { max });
  return s || null;
}

// http(s) only, no credentials, no local addresses.
export function cleanUrl(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    throw bad("url_invalid");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw bad("url_invalid");
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(u.hostname) || !u.hostname.includes(".")) throw bad("url_invalid");
  if (u.href.length > 2000) throw bad("url_invalid");
  return u.href;
}

// A shareable site is a registrable host name, never a full URL.
export function cleanDomain(value) {
  let host = String(value ?? "").trim().toLowerCase();
  try {
    if (host.includes("/")) host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    throw bad("domain_invalid");
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 253) throw bad("domain_invalid");
  if (isSensitiveDomain(host)) throw bad("domain_sensitive");
  return host;
}

// Sites nobody should be able to advertise visiting: health, banking, dating,
// adult content, religion, politics, job loss, legal trouble, local networks.
const SENSITIVE_WORDS = ["health", "sante", "clinic", "hospital", "hopital", "doctolib", "therapy", "mental", "hiv", "cancer",
  "bank", "banque", "credit", "loan", "pret", "casino", "bet", "poker", "dating", "rencontre", "tinder", "grindr", "meetic",
  "porn", "xxx", "sex", "onlyfans", "escort", "church", "eglise", "mosque", "synagog", "party", "parti", "union", "syndicat",
  "pole-emploi", "francetravail", "unemployment", "chomage", "lawyer", "avocat", "court", "tribunal", "police", "rehab", "addiction"];
const SENSITIVE_EXACT = new Set(["ameli.fr", "impots.gouv.fr", "caf.fr", "mutuelle.fr", "paypal.com", "boursorama.com", "revolut.com",
  "pornhub.com", "xvideos.com", "chaturbate.com", "tinder.com", "bumble.com", "grindr.com", "hinge.co"]);

export function isSensitiveDomain(host) {
  if (SENSITIVE_EXACT.has(host)) return true;
  if (/\.(gouv|gov)(\.[a-z]+)?$|\.(local|internal|lan|home|corp)$/.test(host)) return true;
  return SENSITIVE_WORDS.some(w => host.split(/[.-]/).some(part => part == w || part.startsWith(w)));
}

export const INTEREST_RE = /^[a-z0-9-]{2,30}$/;
export const THEME_COLORS = ["violet", "blue", "cyan", "green", "amber", "orange", "rose", "red", "slate"];

export function intParam(v, def, min, max) {
  const n = v == null || v === "" ? def : Number(v);
  if (!Number.isInteger(n)) throw bad("param_invalid");
  return Math.min(max, Math.max(min, n));
}
