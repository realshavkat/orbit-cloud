import { useEffect, useRef, useState } from "react";
import { Navigate, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { t, errorText } from "../lib/i18n.js";
import { get, post } from "../lib/api.js";
import { loadMe, session, setMe, useMe } from "../lib/session.js";
import { Icon, Logo, Link, Field, ErrorBox } from "../components/ui.jsx";

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const safeNext = next => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

function Card({ title, sub, children }) {
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="stack" style={{ gap: 10 }}>
        <Link className="brand" to="/" aria-label="Orbit"><Logo size={34} /></Link>
        <h1 style={{ fontSize: 32, marginTop: 14 }}>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="stack" style={{ gap: 20 }}>{children}</div>
    </div>
  );
}

function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const onSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, onSubmit, setError };
}

export function Login() {
  const me = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    const r = await post("/auth/login", { login, password, remember });
    await loadMe();
    navigate(r.mfa_required ? `/mfa?next=${encodeURIComponent(next)}` : next, { viewTransition: true });
  });
  if (me && !me.mfa_pending) return <Navigate to={next} replace />;
  return (
    <Card title={t("Bon retour", "Welcome back")} sub={t("Connecte-toi à ton compte Orbit.", "Sign in to your Orbit account.")}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t("Pseudo ou e-mail", "Username or e-mail")}><input className="input" autoComplete="username" required value={login} onChange={e => setLogin(e.target.value)} /></Field>
        <Field label={t("Mot de passe", "Password")}><input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <div className="row between">
          <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>{t("Se souvenir de moi (30 jours)", "Remember me (30 days)")}</span></label>
          <Link className="link small" to="/forgot">{t("Mot de passe oublié ?", "Forgot password?")}</Link>
        </div>
        {error && <ErrorBox error={error} />}
        <button className="btn primary block" type="submit" disabled={busy}>{t("Se connecter", "Sign in")}</button>
      </form>
      <div className="alert"><Icon name="refresh-cw" /><span className="small">{t("Dans Orbit, connecte-toi à Firefox Sync : ton compte Orbit suit automatiquement.", "In Orbit, sign in to Firefox Sync: your Orbit account follows automatically.")}</span></div>
      <p className="muted small" style={{ textAlign: "center" }}>
        {t("Pas encore de compte ? ", "No account yet? ")}<Link className="link" to={`/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : ""}`}>{t("Créer un compte", "Sign up")}</Link>
      </p>
    </Card>
  );
}

const Terms = ({ checked, onChange }) => (
  <label className="check">
    <input type="checkbox" required checked={checked} onChange={e => onChange(e.target.checked)} />
    <span className="small">{t("J'accepte les ", "I accept the ")}<a className="link" href="/terms" target="_blank">{t("conditions d'utilisation", "terms of use")}</a>
      {t(" et la ", " and the ")}<a className="link" href="/privacy" target="_blank">{t("politique de confidentialité", "privacy policy")}</a>.</span>
  </label>
);

export function Register() {
  const me = useMe();
  const [params] = useSearchParams();
  const [f, setF] = useState({ username: "", email: "", pw: "", pw2: "", terms: false, website: "" });
  const [uHint, setUHint] = useState(null);
  const [sent, setSent] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.type == "checkbox" ? e.target.checked : e.target.value });
  const timer = useRef();
  useEffect(() => {
    clearTimeout(timer.current);
    if (!f.username) return setUHint(null);
    if (!USERNAME_RE.test(f.username)) return setUHint(["err", errorText("username_format")]);
    const v = f.username;
    timer.current = setTimeout(async () => {
      const r = await get(`/auth/username-available?name=${encodeURIComponent(v)}`).catch(() => null);
      if (r) setUHint(r.available ? ["ok", t("Disponible", "Available")] : ["err", errorText(r.reason)]);
    }, 350);
  }, [f.username]);
  const mismatch = f.pw2 && f.pw != f.pw2;
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (mismatch) return;
    await post("/auth/register", { username: f.username, email: f.email, password: f.pw, accept_terms: f.terms, website: f.website || undefined });
    await loadMe();
    setSent(f.email);
  });
  if (me && !sent) return <Navigate to="/" replace />;
  if (sent) {
    return (
      <Card title={t("Vérifie ta boîte mail", "Check your inbox")}>
        <div className="alert ok"><Icon name="mail" />{t(`Un lien de confirmation a été envoyé à ${sent}. Il est valable 24 heures.`, `A confirmation link was sent to ${sent}. It is valid for 24 hours.`)}</div>
        <p className="muted small">{t("Pas reçu ? Regarde dans les spams, ou renvoie-le depuis ton compte.", "Nothing? Check your spam, or resend it from your account.")}</p>
        <Link className="btn primary block" to={safeNext(params.get("next"))}>{t("Continuer", "Continue")}</Link>
      </Card>
    );
  }
  return (
    <Card title={t("Rejoindre Orbit", "Join Orbit")} sub={t("Un compte pour ton profil, tes badges, tes mods et l'accès à la bêta.", "One account for your profile, badges, mods and beta access.")}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t("Pseudo", "Username")} hint={<span className={`hint ${uHint?.[0] ?? ""}`}>{uHint?.[1] ?? t("3 à 24 caractères : lettres, chiffres, _ . -", "3 to 24 characters: letters, digits, _ . -")}</span>}>
          <input className="input" autoComplete="username" maxLength={24} required spellCheck="false" value={f.username} onChange={set("username")} />
        </Field>
        <Field label={t("Adresse e-mail", "E-mail address")} hint={t("Jamais affichée publiquement.", "Never shown publicly.")}>
          <input className="input" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
        </Field>
        <Field label={t("Mot de passe", "Password")}><input className="input" type="password" autoComplete="new-password" required minLength={10} value={f.pw} onChange={set("pw")} /></Field>
        <Field label={t("Confirme le mot de passe", "Confirm password")} hint={<span className={`hint ${mismatch ? "err" : ""}`}>{mismatch ? t("Les mots de passe ne correspondent pas.", "Passwords don't match.") : t("10 caractères minimum. Une phrase est idéale.", "At least 10 characters. A sentence is ideal.")}</span>}>
          <input className="input" type="password" autoComplete="new-password" required aria-invalid={mismatch || undefined} value={f.pw2} onChange={set("pw2")} />
        </Field>
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999 }} value={f.website} onChange={set("website")} />
        <Terms checked={f.terms} onChange={v => setF({ ...f, terms: v })} />
        {error && <ErrorBox error={error} />}
        <button className="btn primary block" type="submit" disabled={busy}>{t("Créer mon compte", "Create my account")}</button>
      </form>
      <p className="muted small" style={{ textAlign: "center" }}>{t("Déjà inscrit ? ", "Already a member? ")}<Link className="link" to="/login">{t("Se connecter", "Sign in")}</Link></p>
    </Card>
  );
}

export async function verifyLoader({ request }) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return { error: { code: "token_invalid" } };
  try {
    await post("/auth/verify-email", { token });
    await loadMe();
    return { ok: true };
  } catch (e) {
    return { error: e };
  }
}

export function Verify() {
  const { ok, error } = useLoaderData();
  const me = useMe();
  const [resent, setResent] = useState(false);
  if (ok) {
    return (
      <Card title={t("Adresse confirmée", "Address confirmed")}>
        <div className="alert ok"><Icon name="circle-check" />{t("Merci ! Ton adresse e-mail est confirmée.", "Thanks! Your e-mail address is confirmed.")}</div>
        <Link className="btn primary block" to={me ? "/me" : "/login"}>{me ? t("Compléter mon profil", "Complete my profile") : t("Se connecter", "Sign in")}</Link>
      </Card>
    );
  }
  return (
    <Card title={t("Lien invalide", "Invalid link")}>
      <ErrorBox error={error} />
      {me && <button className="btn block" disabled={resent} onClick={async () => {
        await post("/auth/resend-verification").catch(() => {});
        setResent(true);
      }}>{resent ? t("Nouveau lien envoyé", "New link sent") : t("Renvoyer un lien", "Send a new link")}</button>}
    </Card>
  );
}

export function Forgot() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await post("/auth/forgot", { email });
    setDone(true);
  });
  return (
    <Card title={t("Mot de passe oublié", "Forgot password")} sub={t("On t'envoie un lien pour en choisir un nouveau.", "We'll send you a link to choose a new one.")}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t("Adresse e-mail", "E-mail address")}><input className="input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
        {done && <div className="alert ok"><Icon name="mail" />{t("Si un compte utilise cette adresse, un lien valable 30 minutes vient d'être envoyé.", "If an account uses this address, a link valid for 30 minutes was just sent.")}</div>}
        {error && <ErrorBox error={error} />}
        <button className="btn primary block" type="submit" disabled={busy}>{t("Envoyer le lien", "Send the link")}</button>
      </form>
      <p className="muted small">{t("Tu as perdu l'accès à ta validation en deux étapes ? Utilise un code de récupération à la connexion. Sans code, écris à l'équipe : on vérifiera ton identité avant de la réinitialiser.",
        "Lost your two-step verification? Use a recovery code when signing in. Without one, write to the team: we'll check your identity before resetting it.")}</p>
    </Card>
  );
}

export function Reset() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit, setError } = useSubmit(async () => {
    if (pw != pw2) return setError({ code: "invalid_input" });
    await post("/auth/reset", { token: params.get("token") ?? "", password: pw });
    setMe(null);
    setDone(true);
  });
  return (
    <Card title={t("Nouveau mot de passe", "New password")} sub={t("Toutes tes sessions seront déconnectées.", "All your sessions will be signed out.")}>
      {done ? (
        <>
          <div className="alert ok"><Icon name="circle-check" />{t("C'est fait. Connecte-toi avec ton nouveau mot de passe.", "Done. Sign in with your new password.")}</div>
          <Link className="btn primary block" to="/login">{t("Se connecter", "Sign in")}</Link>
        </>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          <Field label={t("Nouveau mot de passe", "New password")}><input className="input" type="password" autoComplete="new-password" required minLength={10} value={pw} onChange={e => setPw(e.target.value)} /></Field>
          <Field label={t("Confirme", "Confirm")}><input className="input" type="password" autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></Field>
          {error && <ErrorBox error={error} />}
          <button className="btn primary block" type="submit" disabled={busy}>{t("Changer le mot de passe", "Change password")}</button>
        </form>
      )}
    </Card>
  );
}

export function Mfa() {
  const me = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState("");
  const { busy, error, onSubmit } = useSubmit(async () => {
    await post("/auth/mfa", recovery ? { recovery_code: value } : { code: value });
    await loadMe();
    navigate(safeNext(params.get("next")), { viewTransition: true });
  });
  if (!me) return <Navigate to="/login" replace />;
  if (!me.mfa_pending) return <Navigate to={safeNext(params.get("next"))} replace />;
  return (
    <Card title={t("Validation en deux étapes", "Two-step verification")} sub={t("Entre le code à 6 chiffres de ton application d'authentification.", "Enter the 6-digit code from your authenticator app.")}>
      <form className="stack" onSubmit={onSubmit}>
        {recovery
          ? <input key="r" className="input" placeholder="abcde-fghij" aria-label={t("Code de récupération", "Recovery code")} value={value} onChange={e => setValue(e.target.value)} autoFocus />
          : <input key="c" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="123456" aria-label={t("Code", "Code")} value={value} onChange={e => setValue(e.target.value)} autoFocus />}
        {error && <ErrorBox error={error} />}
        <button className="btn primary block" type="submit" disabled={busy}>{t("Valider", "Verify")}</button>
        <button className="btn small quiet" type="button" onClick={() => (setRecovery(!recovery), setValue(""))}>
          {recovery ? t("Utiliser l'application", "Use the app") : t("Utiliser un code de récupération", "Use a recovery code")}
        </button>
      </form>
    </Card>
  );
}

export function Connect() {
  const navigate = useNavigate();
  const [code] = useState(() => new URLSearchParams(location.hash.slice(1)).get("code"));
  const [state, setState] = useState({ phase: code ? "loading" : "missing" });
  const [username, setUsername] = useState("");
  const [terms, setTerms] = useState(false);
  const started = useRef(false);
  const done = async () => {
    await loadMe();
    navigate(session.me ? `/u/${session.me.username}` : "/", { replace: true, viewTransition: true });
  };
  useEffect(() => {
    history.replaceState(null, "", "/connect");
    if (!code || started.current) return;
    started.current = true;
    post("/auth/mozilla/redeem", { code }).then(r => {
      if (r.ok) return done();
      setUsername((r.email ?? "").split("@")[0].replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24));
      setState({ phase: "username", email: r.email });
    }, error => setState({ phase: "error", error }));
  }, []);
  const { busy, error, onSubmit, setError } = useSubmit(async () => {
    if (!USERNAME_RE.test(username)) return setError({ code: "username_format" });
    await post("/auth/mozilla/redeem", { code, username, accept_terms: terms });
    await done();
  });
  if (state.phase == "missing") {
    return (
      <Card title={t("Lien expiré", "Link expired")} sub={t("Reconnecte-toi à Firefox Sync dans Orbit pour réessayer.", "Sign in to Firefox Sync in Orbit again to retry.")}>
        <Link className="btn primary block" to="/login">{t("Se connecter autrement", "Sign in another way")}</Link>
      </Card>
    );
  }
  if (state.phase == "error") {
    return (
      <Card title={t("Connexion impossible", "Couldn't sign you in")}>
        <ErrorBox error={state.error} />
        <Link className="btn block" to="/login">{t("Se connecter autrement", "Sign in another way")}</Link>
      </Card>
    );
  }
  if (state.phase == "loading") return <Card title={t("Connexion…", "Signing you in…")} />;
  return (
    <Card title={t("Bienvenue sur Orbit", "Welcome to Orbit")}
      sub={t(`Ton compte Mozilla (${state.email}) devient ton compte Orbit. Choisis ton pseudo.`, `Your Mozilla account (${state.email}) becomes your Orbit account. Pick a username.`)}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t("Pseudo", "Username")} hint={t("3 à 24 caractères : lettres, chiffres, _ . -", "3 to 24 characters: letters, digits, _ . -")}>
          <input className="input" autoComplete="username" maxLength={24} required spellCheck="false" value={username} onChange={e => setUsername(e.target.value)} />
        </Field>
        <Terms checked={terms} onChange={setTerms} />
        {error && <ErrorBox error={error} />}
        <button className="btn primary block" type="submit" disabled={busy}>{t("Créer mon compte", "Create my account")}</button>
      </form>
    </Card>
  );
}
