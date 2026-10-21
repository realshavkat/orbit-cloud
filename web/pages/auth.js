// Sign-up, sign-in, e-mail verification, password reset, second factor.
import { h, icon, t, post, get, state, loadMe, errorBox, errorText, field, logo } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

function card(title, sub, ...body) {
  return h("div", { class: "stack", style: { gap: "28px" } },
    h("div", { class: "stack", style: { gap: "10px" } },
      h("a", { class: "brand", href: "/", "aria-label": "Orbit" }, logo(34)),
      h("h1", { style: { fontSize: "32px", marginTop: "14px" } }, title), sub ? h("p", { class: "muted" }, sub) : null),
    h("div", { class: "stack", style: { gap: "20px" } }, ...body));
}

// After sign-in: back where the visitor was going.
const next = (query) => (query.next && query.next.startsWith("/") && !query.next.startsWith("//") ? query.next : "/");

export async function login({ query }) {
  if (state.me && !state.me.mfa_pending) return go(next(query), { replace: true });
  const loginInput = h("input", { class: "input", autocomplete: "username", required: true });
  const pw = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true });
  const remember = h("input", { type: "checkbox" });
  const err = h("div");
  const submit = h("button", { class: "btn primary block", type: "submit" }, t("Se connecter", "Sign in"));
  const form = h("form", { class: "stack", onsubmit: async e => {
    e.preventDefault();
    submit.disabled = true;
    err.replaceChildren();
    try {
      const r = await post("/auth/login", { login: loginInput.value, password: pw.value, remember: remember.checked });
      await loadMe();
      go(r.mfa_required ? `/mfa?next=${encodeURIComponent(next(query))}` : next(query));
    } catch (x) {
      err.replaceChildren(errorBox(x));
    } finally {
      submit.disabled = false;
    }
  } },
  field(t("Pseudo ou e-mail", "Username or e-mail"), loginInput),
  field(t("Mot de passe", "Password"), pw),
  h("div", { class: "row between" },
    h("label", { class: "check" }, remember, h("span", {}, t("Se souvenir de moi (30 jours)", "Remember me (30 days)"))),
    h("a", { class: "link small", href: "/forgot" }, t("Mot de passe oublié ?", "Forgot password?"))),
  err, submit);
  return card(t("Bon retour", "Welcome back"), t("Connecte-toi à ton compte Orbit.", "Sign in to your Orbit account."),
    form, h("div", { class: "alert" }, icon("refresh-cw"), h("span", { class: "small" },
      t("Dans Orbit, connecte-toi à Firefox Sync : ton compte Orbit suit automatiquement.", "In Orbit, sign in to Firefox Sync: your Orbit account follows automatically."))), h("p", { class: "muted small", style: { textAlign: "center", margin: 0 } }, t("Pas encore de compte ? ", "No account yet? "),
      h("a", { class: "link", href: `/register${query.next ? `?next=${encodeURIComponent(query.next)}` : ""}` }, t("Créer un compte", "Sign up"))));
}

export async function register({ query }) {
  if (state.me) return go("/", { replace: true });
  const username = h("input", { class: "input", autocomplete: "username", maxlength: 24, required: true, spellcheck: "false" });
  const uHint = h("div", { class: "hint" }, t("3 à 24 caractères : lettres, chiffres, _ . -", "3 to 24 characters: letters, digits, _ . -"));
  const email = h("input", { class: "input", type: "email", autocomplete: "email", required: true });
  const pw = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true, minlength: 10 });
  const pw2 = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true });
  const pwHint = h("div", { class: "hint" }, t("10 caractères minimum. Une phrase est idéale.", "At least 10 characters. A sentence is ideal."));
  const terms = h("input", { type: "checkbox", required: true });
  // Hidden from people (and from screen readers); bots fill it.
  const trap = h("input", { name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true", style: { position: "absolute", left: "-9999px" } });
  const err = h("div");
  const submit = h("button", { class: "btn primary block", type: "submit" }, t("Créer mon compte", "Create my account"));

  let timer;
  username.addEventListener("input", () => {
    clearTimeout(timer);
    const v = username.value;
    if (!USERNAME_RE.test(v)) {
      uHint.className = "hint err";
      uHint.textContent = errorText("username_format");
      return;
    }
    timer = setTimeout(async () => {
      try {
        const r = await get(`/auth/username-available?name=${encodeURIComponent(v)}`);
        if (username.value != v) return;
        uHint.className = r.available ? "hint ok" : "hint err";
        uHint.textContent = r.available ? t("Disponible", "Available") : errorText(r.reason);
      } catch {}
    }, 350);
  });
  const checkPw = () => {
    const bad = pw2.value && pw.value != pw2.value;
    pw2.setAttribute("aria-invalid", bad ? "true" : "false");
    pwHint.className = bad ? "hint err" : "hint";
    pwHint.textContent = bad ? t("Les mots de passe ne correspondent pas.", "Passwords don't match.") : t("10 caractères minimum. Une phrase est idéale.", "At least 10 characters. A sentence is ideal.");
  };
  pw.addEventListener("input", checkPw);
  pw2.addEventListener("input", checkPw);

  const form = h("form", { class: "stack", onsubmit: async e => {
    e.preventDefault();
    if (pw.value != pw2.value) return checkPw();
    submit.disabled = true;
    err.replaceChildren();
    try {
      await post("/auth/register", { username: username.value, email: email.value, password: pw.value, accept_terms: terms.checked, website: trap.value || undefined });
      await loadMe();
      document.querySelector("main").replaceChildren(card(t("Vérifie ta boîte mail", "Check your inbox"), null,
        h("div", { class: "alert ok" }, icon("mail"), t(`Un lien de confirmation a été envoyé à ${email.value}. Il est valable 24 heures.`,
          `A confirmation link was sent to ${email.value}. It is valid for 24 hours.`)),
        h("p", { class: "muted small", style: { margin: 0 } }, t("Pas reçu ? Regarde dans les spams, ou renvoie-le depuis ton compte.", "Nothing? Check your spam, or resend it from your account.")),
        h("a", { class: "btn primary block", href: next(query) }, t("Continuer", "Continue"))));
    } catch (x) {
      err.replaceChildren(errorBox(x));
    } finally {
      submit.disabled = false;
    }
  } },
  field(t("Pseudo", "Username"), username, uHint),
  field(t("Adresse e-mail", "E-mail address"), email, h("div", { class: "hint" }, t("Jamais affichée publiquement.", "Never shown publicly."))),
  field(t("Mot de passe", "Password"), pw),
  field(t("Confirme le mot de passe", "Confirm password"), pw2, pwHint),
  trap,
  h("label", { class: "check" }, terms, h("span", { class: "small" }, t("J'accepte les ", "I accept the "),
    h("a", { class: "link", href: "/terms", target: "_blank" }, t("conditions d'utilisation", "terms of use")), t(" et la ", " and the "),
    h("a", { class: "link", href: "/privacy", target: "_blank" }, t("politique de confidentialité", "privacy policy")), ".")),
  err, submit);
  return card(t("Rejoindre Orbit", "Join Orbit"), t("Un compte pour ton profil, tes badges et tes amis. Le navigateur reste gratuit sans compte.",
    "An account for your profile, badges and friends. The browser stays free without one."),
  form, h("p", { class: "muted small", style: { textAlign: "center", margin: 0 } }, t("Déjà inscrit ? ", "Already a member? "), h("a", { class: "link", href: "/login" }, t("Se connecter", "Sign in"))));
}

export async function verify({ query }) {
  if (!query.token) return card(t("Lien incomplet", "Incomplete link"), null, errorBox({ code: "token_invalid" }));
  try {
    await post("/auth/verify-email", { token: query.token });
    await loadMe();
    return card(t("Adresse confirmée", "Address confirmed"), null,
      h("div", { class: "alert ok" }, icon("circle-check"), t("Merci ! Ton adresse e-mail est confirmée.", "Thanks! Your e-mail address is confirmed.")),
      h("a", { class: "btn primary block", href: state.me ? "/me" : "/login" }, state.me ? t("Compléter mon profil", "Complete my profile") : t("Se connecter", "Sign in")));
  } catch (e) {
    return card(t("Lien invalide", "Invalid link"), null, errorBox(e),
      state.me ? h("button", { class: "btn block", onclick: async ev => {
        ev.target.disabled = true;
        await post("/auth/resend-verification").catch(() => {});
        ev.target.textContent = t("Nouveau lien envoyé", "New link sent");
      } }, t("Renvoyer un lien", "Send a new link")) : null);
  }
}

export async function forgot() {
  const email = h("input", { class: "input", type: "email", autocomplete: "email", required: true });
  const out = h("div");
  const submit = h("button", { class: "btn primary block", type: "submit" }, t("Envoyer le lien", "Send the link"));
  return card(t("Mot de passe oublié", "Forgot password"), t("On t'envoie un lien pour en choisir un nouveau.", "We'll send you a link to choose a new one."),
    h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await post("/auth/forgot", { email: email.value });
        out.replaceChildren(h("div", { class: "alert ok" }, icon("mail"),
          t("Si un compte utilise cette adresse, un lien valable 30 minutes vient d'être envoyé.", "If an account uses this address, a link valid for 30 minutes was just sent.")));
      } catch (x) {
        out.replaceChildren(errorBox(x));
      } finally {
        submit.disabled = false;
      }
    } }, field(t("Adresse e-mail", "E-mail address"), email), out, submit),
    h("p", { class: "muted small", style: { margin: 0 } }, t("Tu as perdu l'accès à ta validation en deux étapes ? Utilise un code de récupération à la connexion. Sans code, écris à l'équipe : on vérifiera ton identité avant de la réinitialiser.",
      "Lost your two-step verification? Use a recovery code when signing in. Without one, write to the team: we'll check your identity before resetting it.")));
}

export async function reset({ query }) {
  const pw = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true, minlength: 10 });
  const pw2 = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true });
  const out = h("div");
  const submit = h("button", { class: "btn primary block", type: "submit" }, t("Changer le mot de passe", "Change password"));
  return card(t("Nouveau mot de passe", "New password"), t("Toutes tes sessions seront déconnectées.", "All your sessions will be signed out."),
    h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      if (pw.value != pw2.value) return out.replaceChildren(h("div", { class: "alert err" }, t("Les mots de passe ne correspondent pas.", "Passwords don't match.")));
      submit.disabled = true;
      try {
        await post("/auth/reset", { token: query.token ?? "", password: pw.value });
        state.me = null;
        out.replaceChildren(h("div", { class: "alert ok" }, icon("circle-check"), t("C'est fait. Connecte-toi avec ton nouveau mot de passe.", "Done. Sign in with your new password.")),
          h("a", { class: "btn primary block", href: "/login" }, t("Se connecter", "Sign in")));
        submit.remove();
      } catch (x) {
        out.replaceChildren(errorBox(x));
        submit.disabled = false;
      }
    } }, field(t("Nouveau mot de passe", "New password"), pw), field(t("Confirme", "Confirm"), pw2), out, submit));
}

export async function mfa({ query }) {
  if (!state.me) return go("/login", { replace: true });
  if (!state.me.mfa_pending) return go(next(query), { replace: true });
  const code = h("input", { class: "input", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, pattern: "[0-9]{6}", placeholder: "123456" });
  const recovery = h("input", { class: "input", placeholder: "abcde-fghij", hidden: true });
  const err = h("div");
  let useRecovery = false;
  const toggle = h("button", { class: "btn small", type: "button", onclick: () => {
    useRecovery = !useRecovery;
    code.hidden = useRecovery;
    recovery.hidden = !useRecovery;
    toggle.textContent = useRecovery ? t("Utiliser l'application", "Use the app") : t("Utiliser un code de récupération", "Use a recovery code");
    (useRecovery ? recovery : code).focus();
  } }, t("Utiliser un code de récupération", "Use a recovery code"));
  setTimeout(() => code.focus(), 0);
  return card(t("Validation en deux étapes", "Two-step verification"), t("Entre le code à 6 chiffres de ton application d'authentification.", "Enter the 6-digit code from your authenticator app."),
    h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      try {
        await post("/auth/mfa", useRecovery ? { recovery_code: recovery.value } : { code: code.value });
        await loadMe();
        go(next(query));
      } catch (x) {
        err.replaceChildren(errorBox(x));
      }
    } }, code, recovery, err, h("button", { class: "btn primary block", type: "submit" }, t("Valider", "Verify")), toggle));
}

// /connect#code=...: the Orbit browser hands over a signed-in Mozilla account
// (Firefox Sync). The code is in the fragment, so it never reaches a server log.
export async function connect() {
  const code = new URLSearchParams(location.hash.slice(1)).get("code");
  history.replaceState(null, "", "/connect");
  if (!code) return card(t("Lien expiré", "Link expired"), t("Reconnecte-toi à Firefox Sync dans Orbit pour réessayer.", "Sign in to Firefox Sync in Orbit again to retry."),
    h("a", { class: "btn primary block", href: "/login" }, t("Se connecter autrement", "Sign in another way")));
  const done = async () => {
    await loadMe();
    go(state.me ? `/u/${state.me.username}` : "/", { replace: true });
  };
  let first;
  try {
    first = await post("/auth/mozilla/redeem", { code });
  } catch (e) {
    return card(t("Connexion impossible", "Couldn't sign you in"), null, errorBox(e), h("a", { class: "btn block", href: "/login" }, t("Se connecter autrement", "Sign in another way")));
  }
  if (first.ok) return void (await done());
  // First time with this Mozilla account: pick a username.
  const username = h("input", { class: "input", autocomplete: "username", maxlength: 24, required: true, spellcheck: "false",
    value: (first.email ?? "").split("@")[0].replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24) });
  const terms = h("input", { type: "checkbox", required: true });
  const err = h("div");
  const submit = h("button", { class: "btn primary block", type: "submit" }, t("Créer mon compte", "Create my account"));
  return card(t("Bienvenue sur Orbit", "Welcome to Orbit"),
    t(`Ton compte Mozilla (${first.email}) devient ton compte Orbit. Choisis ton pseudo.`, `Your Mozilla account (${first.email}) becomes your Orbit account. Pick a username.`),
    h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      if (!USERNAME_RE.test(username.value)) return err.replaceChildren(errorBox({ code: "username_format" }));
      submit.disabled = true;
      err.replaceChildren();
      try {
        await post("/auth/mozilla/redeem", { code, username: username.value, accept_terms: terms.checked });
        await done();
      } catch (x) {
        err.replaceChildren(errorBox(x));
      } finally {
        submit.disabled = false;
      }
    } },
    field(t("Pseudo", "Username"), username, h("div", { class: "hint" }, t("3 à 24 caractères : lettres, chiffres, _ . -", "3 to 24 characters: letters, digits, _ . -"))),
    h("label", { class: "check" }, terms, h("span", {}, t("J'accepte les ", "I accept the "), h("a", { class: "link", href: "/terms", target: "_blank" }, t("conditions", "terms")),
      t(" et la ", " and the "), h("a", { class: "link", href: "/privacy", target: "_blank" }, t("politique de confidentialité", "privacy policy")))),
    err, submit));
}
