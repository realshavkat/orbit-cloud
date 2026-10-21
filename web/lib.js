// Shared helpers for the Orbit community pages. All user text is inserted
// with textContent (h() never parses HTML), so profiles cannot inject markup.

export const LANG = (navigator.language || "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
document.documentElement.lang = LANG;

// Error codes from the API, in plain words.
const ERRORS = {
  fr: {
    invalid_credentials: "Identifiant ou mot de passe incorrect.", invalid_credentials_or_code: "Mot de passe ou code incorrect.",
    too_many_attempts: "Trop de tentatives. Réessaie dans quelques minutes.", rate_limited: "Doucement : réessaie dans un instant.",
    username_taken: "Ce pseudo est déjà pris.", username_reserved: "Ce pseudo est réservé.", username_format: "3 à 24 caractères : lettres, chiffres, _ . -",
    email_format: "Adresse e-mail invalide.", password_short: "10 caractères minimum.", password_long: "256 caractères maximum.",
    password_personal: "N'utilise pas ton pseudo ou ton e-mail dans le mot de passe.", password_weak: "Mot de passe trop simple.",
    terms_required: "Accepte les conditions pour continuer.", token_invalid: "Ce lien est expiré ou a déjà servi.", captcha_failed: "Vérification anti-robot échouée.",
    account_suspended: "Ce compte est suspendu.", mfa_required: "Entre ton code de validation.", invalid_code: "Code incorrect.",
    reauth_required: "Confirme ton mot de passe pour continuer.", email_unverified: "Confirme d'abord ton adresse e-mail.",
    forbidden: "Tu n'as pas l'autorisation de faire ça.", unauthenticated: "Connecte-toi pour continuer.", not_found: "Introuvable.",
    request_unavailable: "Impossible d'envoyer une demande à ce membre.", request_exists: "Une demande est déjà en cours.", already_friends: "Vous êtes déjà amis.",
    social_suspended: "Tes fonctions communautaires sont suspendues pour le moment.", social_disabled: "Tu as désactivé les fonctions sociales.",
    sharing_disabled: "Active d'abord le partage de sites dans ta confidentialité.", domain_invalid: "Nom de domaine invalide.",
    domain_sensitive: "Ce site est protégé : il ne peut pas être partagé.", url_invalid: "Lien invalide (http ou https uniquement).",
    donations_not_configured: "Les dons ne sont pas encore ouverts.", amount_invalid: "Montant invalide.", payment_provider_error: "Le service de paiement ne répond pas.",
    file_type: "Image PNG, JPEG, WebP ou GIF uniquement.", file_too_large: "Image trop lourde.", report_exists: "Tu as déjà signalé cet élément.",
    badge_protected: "Ce badge est protégé.", badge_official: "Badge officiel : réservé au propriétaire.", already_has_badge: "Ce membre a déjà ce badge.",
    badge_not_held: "Ce membre n'a pas ce badge.", rank_too_low: "Ton rôle ne permet pas d'agir sur ce compte.", not_on_self: "Impossible sur ton propre compte.",
    confirm_mismatch: "Le pseudo ne correspond pas.", owner_cannot_delete: "Le compte propriétaire ne peut pas être supprimé.",
    mfa_unavailable: "La validation en deux étapes n'est pas encore configurée sur le serveur.", csrf: "Requête refusée.",
    invalid_input: "Vérifie les champs.", server_error: "Erreur du serveur. Réessaie.", network: "Connexion au serveur impossible.",
  },
  en: {
    invalid_credentials: "Wrong login or password.", invalid_credentials_or_code: "Wrong password or code.",
    too_many_attempts: "Too many attempts. Try again in a few minutes.", rate_limited: "Slow down: try again in a moment.",
    username_taken: "This username is taken.", username_reserved: "This username is reserved.", username_format: "3 to 24 characters: letters, digits, _ . -",
    email_format: "Invalid e-mail address.", password_short: "At least 10 characters.", password_long: "256 characters at most.",
    password_personal: "Don't use your username or e-mail in the password.", password_weak: "Password too simple.",
    terms_required: "Accept the terms to continue.", token_invalid: "This link has expired or was already used.", captcha_failed: "Bot check failed.",
    account_suspended: "This account is suspended.", mfa_required: "Enter your verification code.", invalid_code: "Wrong code.",
    reauth_required: "Confirm your password to continue.", email_unverified: "Confirm your e-mail address first.",
    forbidden: "You are not allowed to do that.", unauthenticated: "Sign in to continue.", not_found: "Not found.",
    request_unavailable: "You can't send a request to this member.", request_exists: "A request is already pending.", already_friends: "You are already friends.",
    social_suspended: "Your community features are suspended for now.", social_disabled: "You turned social features off.",
    sharing_disabled: "Turn on site sharing in your privacy settings first.", domain_invalid: "Invalid domain name.",
    domain_sensitive: "This site is protected: it can't be shared.", url_invalid: "Invalid link (http or https only).",
    donations_not_configured: "Donations are not open yet.", amount_invalid: "Invalid amount.", payment_provider_error: "The payment service is not answering.",
    file_type: "PNG, JPEG, WebP or GIF images only.", file_too_large: "Image too large.", report_exists: "You already reported this.",
    badge_protected: "This badge is protected.", badge_official: "Official badge: owner only.", already_has_badge: "This member already has this badge.",
    badge_not_held: "This member doesn't have this badge.", rank_too_low: "Your role can't act on this account.", not_on_self: "Not on your own account.",
    confirm_mismatch: "The username doesn't match.", owner_cannot_delete: "The owner account can't be deleted.",
    mfa_unavailable: "Two-step verification is not set up on the server yet.", csrf: "Request refused.",
    invalid_input: "Check the fields.", server_error: "Server error. Try again.", network: "Can't reach the server.",
  },
};

export const t = (fr, en) => (LANG == "fr" ? fr : en ?? fr);
export const errorText = code => ERRORS[LANG][code] ?? ERRORS[LANG].server_error;

export function h(tag, attrs = {}, ...children) {
  const svg = tag == "svg" || tag == "use";
  const el = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v == "function") el.addEventListener(k.slice(2), v);
    // CSSOM, not a style attribute: allowed by the page's CSP.
    else if (k == "style" && typeof v == "object") for (const [p, x] of Object.entries(v)) p.startsWith("--") ? el.style.setProperty(p, x) : (el.style[p] = x);
    else if (k == "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(name, cls = "i") {
  const s = h("svg", { class: cls, "aria-hidden": "true" });
  s.append(h("use", { href: `/assets/icons.svg#i-${name}` }));
  return s;
}

// ---- API: cookies carry the session; the header proves the call is ours.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? "server_error");
    this.status = status;
    this.code = body?.error ?? "server_error";
    this.body = body;
  }
}

export async function api(method, path, body, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: { "x-orbit-request": "1", ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "network" });
  }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = p => api("GET", p);
export const post = (p, b) => api("POST", p, b ?? {});
export const patch = (p, b) => api("PATCH", p, b);
export const put = (p, b) => api("PUT", p, b);
export const del = p => api("DELETE", p);

// ---- session state
export const state = { me: null, config: null };

export async function loadMe() {
  try {
    state.me = await get("/me");
  } catch {
    state.me = null;
  }
  return state.me;
}

// ---- UI bits
export function toast(text, kind = "") {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast ${kind}`, role: "status" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

export function errorBox(e) {
  return h("div", { class: "alert err", role: "alert" }, icon("circle-alert"), errorText(e.code ?? e.message));
}

// A confirmation dialog; resolves true/false. `typed` asks to retype a word.
export function confirmDialog({ title, text, action, danger = false, typed = null }) {
  return new Promise(resolve => {
    const input = typed ? h("input", { class: "input", placeholder: typed, "aria-label": typed }) : null;
    const go = h("button", { class: `btn ${danger ? "danger solid" : "primary"}`, disabled: !!typed }, action);
    const close = v => {
      bg.remove();
      document.removeEventListener("keydown", key);
      resolve(v);
    };
    const key = e => e.key == "Escape" && close(false);
    input?.addEventListener("input", () => (go.disabled = input.value != typed));
    go.addEventListener("click", () => close(true));
    const bg = h("div", { class: "modal-bg", onclick: e => e.target == bg && close(false) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h2", {}, title), text ? h("p", { class: "muted", style: { margin: 0 } }, text) : null, input,
        h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", onclick: () => close(false) }, t("Annuler", "Cancel")), go)));
    document.addEventListener("keydown", key);
    document.body.append(bg);
    (input ?? go).focus();
  });
}

// Asks for a reason (admin actions).
export function promptDialog({ title, label, action, multiline = false }) {
  return new Promise(resolve => {
    const input = h(multiline ? "textarea" : "input", { class: "input", "aria-label": label, placeholder: label });
    const close = v => {
      bg.remove();
      resolve(v);
    };
    const bg = h("div", { class: "modal-bg", onclick: e => e.target == bg && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", {}, title), input,
        h("div", { class: "row", style: { justifyContent: "flex-end" } },
          h("button", { class: "btn", onclick: () => close(null) }, t("Annuler", "Cancel")),
          h("button", { class: "btn primary", onclick: () => input.value.trim().length >= 3 ? close(input.value.trim()) : input.setAttribute("aria-invalid", "true") }, action))));
    document.body.append(bg);
    input.focus();
  });
}

// Runs an API action from a button: disables it, shows errors, handles re-auth.
export async function act(button, fn, { ok } = {}) {
  if (button) button.disabled = true;
  try {
    const out = await fn();
    if (ok) toast(ok, "ok");
    return out;
  } catch (e) {
    if (e.code == "reauth_required" && (await reauthDialog())) return act(button, fn, { ok });
    toast(errorText(e.code));
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

export function reauthDialog() {
  return new Promise(resolve => {
    const pw = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: t("Mot de passe", "Password") });
    const code = state.me?.mfa_enabled ? h("input", { class: "input", inputmode: "numeric", maxlength: 6, placeholder: t("Code à 6 chiffres", "6-digit code") }) : null;
    const err = h("div");
    const close = v => {
      bg.remove();
      resolve(v);
    };
    const submit = async () => {
      try {
        await post("/auth/reauth", { password: pw.value, ...(code ? { code: code.value } : {}) });
        close(true);
      } catch (e) {
        err.replaceChildren(errorBox(e));
      }
    };
    const bg = h("div", { class: "modal-bg" },
      h("form", { class: "modal", onsubmit: e => (e.preventDefault(), submit()) },
        h("h2", {}, t("Confirme que c'est toi", "Confirm it's you")),
        h("p", { class: "muted", style: { margin: 0 } }, t("Action sensible : entre ton mot de passe.", "Sensitive action: enter your password.")),
        pw, code, err,
        h("div", { class: "row", style: { justifyContent: "flex-end" } },
          h("button", { class: "btn", type: "button", onclick: () => close(false) }, t("Annuler", "Cancel")),
          h("button", { class: "btn primary", type: "submit" }, t("Confirmer", "Confirm")))));
    document.body.append(bg);
    pw.focus();
  });
}

export const fmtDate = d => (d ? new Intl.DateTimeFormat(LANG, { dateStyle: "medium" }).format(new Date(d)) : "");
export const fmtDateTime = d => (d ? new Intl.DateTimeFormat(LANG, { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)) : "");
export const fmtMoney = (cents, cur = "eur") => new Intl.NumberFormat(LANG, { style: "currency", currency: cur.toUpperCase() }).format(cents / 100);
export const ago = d => {
  const s = (Date.now() - new Date(d)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), "day");
  return fmtDate(d);
};

export const THEME = { violet: "#7c86ff", blue: "#4f8cff", cyan: "#22c3e6", green: "#3ddc97", amber: "#f5c518", orange: "#ff9f43", rose: "#ff6bcb", red: "#ff5d5d", slate: "#8a8a99" };

export function avatar(user, cls = "avatar") {
  if (user?.avatar_url) return h("img", { class: cls, src: user.avatar_url, alt: "", loading: "lazy" });
  return h("span", { class: cls, style: { "--c": THEME[user?.theme_color] ?? THEME.violet }, "aria-hidden": "true" }, (user?.display_name || user?.username || "?")[0].toUpperCase());
}

// French names of the built-in badges (their catalog rows are in English).
const BADGES_FR = {
  founder: ["Fondateur", "A créé Orbit.", "Donné une seule fois, au propriétaire d'origine d'Orbit, à la mise en service. Il ne s'achète pas, ne se transfère pas et aucun administrateur ne peut le donner."],
  administrator: ["Administrateur", "Membre de l'équipe d'administration d'Orbit.", "Suit le rôle d'administrateur : ajouté avec lui, retiré avec lui. Le badge lui-même ne donne aucun droit."],
  moderator: ["Modérateur", "Veille sur la communauté Orbit.", "Suit le rôle de modérateur. Le badge lui-même ne donne aucun droit."],
  developer: ["Développeur", "Développeur reconnu officiellement par Orbit.", "Donné par le propriétaire aux développeurs reconnus."],
  verified: ["Vérifié", "Identité ou statut officiel vérifié par l'équipe Orbit.", "Donné après une vérification d'identité manuelle. Jamais pour un don."],
  early_supporter: ["Soutien de la première heure", "A soutenu Orbit à ses débuts.", "Un don confirmé pendant la période de lancement fixée par le propriétaire."],
  beta_tester: ["Bêta-testeur", "A participé à une bêta officielle d'Orbit.", "Participation enregistrée à une bêta officielle."],
  bug_hunter: ["Chasseur de bugs", "A signalé un bug ou une faille valide.", "Un signalement confirmé par l'équipe."],
  contributor: ["Contributeur", "A contribué de façon importante à Orbit.", "Une contribution examinée par l'équipe."],
  supporter: ["Soutien", "Soutient Orbit par un don.", "Un premier don confirmé, non remboursé en totalité."],
  supporter_bronze: ["Soutien Bronze", "Un soutien généreux pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Bronze."],
  supporter_silver: ["Soutien Argent", "Un soutien fort pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Argent."],
  supporter_gold: ["Soutien Or", "Un soutien majeur pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Or."],
  supporter_platinum: ["Soutien Platine", "Un soutien exceptionnel pour Orbit.", "Le total des dons confirmés, remboursements déduits, atteint le palier Platine."],
  supporter_monthly: ["Soutien mensuel", "Soutient Orbit chaque mois.", "Un don mensuel actif. Retiré quand il s'arrête ou n'est pas payé."],
  supporter_lifetime: ["Soutien à vie", "Un merci spécial de l'équipe Orbit.", "Donné par le propriétaire, pour un soutien dans la durée."],
};
// Badge texts in the page's language (built-in badges only; custom ones as written).
export function localBadge(b) {
  const fr = LANG == "fr" && BADGES_FR[b.key];
  return fr ? { ...b, name: fr[0], description: fr[1], condition: fr[2] } : b;
}

export const RARITY = { common: t("Commun", "Common"), rare: t("Rare", "Rare"), epic: t("Épique", "Epic"), legendary: t("Légendaire", "Legendary"), exclusive: t("Exclusif", "Exclusive") };

// Small badge icon with its name and description on hover.
export function badgeMini(b) {
  b = localBadge(b);
  return h("span", { class: "tooltip-wrap", tabindex: "0", "aria-label": b.name },
    h("span", { class: "badge-mini", style: { "--c": b.color } }, icon(b.icon)),
    h("span", { class: "tip", role: "tooltip" }, h("b", {}, b.name), b.description ? h("div", { class: "muted" }, b.description) : null));
}

export function badgeCard(b, { href = `/badges/${b.key}`, extra = null } = {}) {
  b = localBadge(b);
  return h("a", { class: "badge", href, "data-rarity": b.rarity, style: { "--c": b.color } },
    h("span", { class: "medal" }, icon(b.icon)),
    h("span", { class: "t" }, h("b", {}, b.name), h("span", { class: "rarity" }, RARITY[b.rarity]), extra));
}

export function personCard(u, extra = null) {
  return h("a", { class: "person", href: `/u/${u.username}` }, avatar(u),
    h("span", { class: "who" },
      h("span", { class: "name" }, u.display_name || u.username, ...(u.badges ?? []).slice(0, 3).map(badgeMini)),
      h("span", { class: "handle" }, `@${u.username}`)),
    extra);
}

export const empty = (ic, text, action = null) => h("div", { class: "empty" }, icon(ic), h("div", {}, text), action);
export const spinner = () => h("div", { class: "spinner", role: "progressbar", "aria-label": t("Chargement", "Loading") });

export function field(label, input, hint = null) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h("div", { class: "field" }, h("label", { for: id }, label), input, hint);
}

export function switchRow(title, desc, checked, onchange) {
  const input = h("input", { type: "checkbox", class: "switch", role: "switch", "aria-label": title });
  input.checked = checked;
  input.addEventListener("change", () => onchange(input.checked, input));
  return h("label", { class: "switch-row" }, h("span", {}, h("b", {}, title), desc ? h("div", { class: "muted small" }, desc) : null), input);
}
