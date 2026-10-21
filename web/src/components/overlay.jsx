import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t, errorText } from "../lib/i18n.js";
import { post } from "../lib/api.js";
import { session } from "../lib/session.js";
import { Icon, ErrorBox } from "./ui.jsx";

let items = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach(l => l());
const push = item => {
  items = [...items, { id: nextId++, ...item }];
  emit();
};
const drop = id => {
  items = items.filter(i => i.id != id);
  emit();
};

let toastTimer;
export function toast(text, kind = "") {
  items = items.filter(i => i.type != "toast");
  push({ type: "toast", text, kind });
  clearTimeout(toastTimer);
  const id = nextId - 1;
  toastTimer = setTimeout(() => drop(id), 3500);
}

export const openModal = render => new Promise(resolve => push({ type: "modal", render, resolve }));
export const openDrawer = (title, render, footer) => new Promise(resolve => push({ type: "drawer", title, render, footer, resolve }));

export function confirmDialog({ title, text, action, danger = false, typed = null }) {
  return openModal(close => <Confirm {...{ title, text, action, danger, typed, close }} />);
}

function Confirm({ title, text, action, danger, typed, close }) {
  const [value, setValue] = useState("");
  return (
    <>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {typed && <input className="input" placeholder={typed} aria-label={typed} value={value} onChange={e => setValue(e.target.value)} autoFocus />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => close(false)}>{t("Annuler", "Cancel")}</button>
        <button className={`btn ${danger ? "danger solid" : "primary"}`} disabled={typed && value != typed} onClick={() => close(true)} autoFocus={!typed}>{action}</button>
      </div>
    </>
  );
}

export function promptDialog({ title, label, action, multiline = false }) {
  return openModal(close => <Prompt {...{ title, label, action, multiline, close }} />);
}

function Prompt({ title, label, action, multiline, close }) {
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const Tag = multiline ? "textarea" : "input";
  const submit = e => {
    e.preventDefault();
    if (value.trim().length < 3) return setBad(true);
    close(value.trim());
  };
  return (
    <form onSubmit={submit} style={{ display: "contents" }}>
      <h2>{title}</h2>
      <Tag className="input" aria-label={label} placeholder={label} value={value} aria-invalid={bad || undefined} onChange={e => setValue(e.target.value)} autoFocus />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={() => close(null)}>{t("Annuler", "Cancel")}</button>
        <button type="submit" className="btn primary">{action}</button>
      </div>
    </form>
  );
}

export const reauthDialog = () => openModal(close => <Reauth close={close} />);

function Reauth({ close }) {
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState(null);
  const mfa = session.me?.mfa_enabled;
  const submit = async e => {
    e.preventDefault();
    try {
      await post("/auth/reauth", { password: pw, ...(mfa ? { code } : {}) });
      close(true);
    } catch (x) {
      setErr(x);
    }
  };
  return (
    <form onSubmit={submit} style={{ display: "contents" }}>
      <h2>{t("Confirme que c'est toi", "Confirm it's you")}</h2>
      <p>{t("Action sensible : entre ton mot de passe.", "Sensitive action: enter your password.")}</p>
      <input className="input" type="password" autoComplete="current-password" placeholder={t("Mot de passe", "Password")} value={pw} onChange={e => setPw(e.target.value)} autoFocus />
      {mfa && <input className="input" inputMode="numeric" maxLength={6} placeholder={t("Code à 6 chiffres", "6-digit code")} value={code} onChange={e => setCode(e.target.value)} />}
      {err && <ErrorBox error={err} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={() => close(false)}>{t("Annuler", "Cancel")}</button>
        <button type="submit" className="btn primary">{t("Confirmer", "Confirm")}</button>
      </div>
    </form>
  );
}

export async function act(fn, { ok } = {}) {
  try {
    const out = await fn();
    if (ok) toast(ok, "ok");
    return out ?? true;
  } catch (e) {
    if (e.code == "reauth_required" && (await reauthDialog())) return act(fn, { ok });
    toast(errorText(e.code));
    return undefined;
  }
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn, opts) => {
    setBusy(true);
    try {
      return await act(fn, opts);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

function Layer({ item }) {
  const [closing, setClosing] = useState(false);
  const done = useRef(false);
  const close = value => {
    if (done.current) return;
    done.current = true;
    setClosing(true);
    setTimeout(() => {
      drop(item.id);
      item.resolve?.(value);
    }, 180);
  };
  useEffect(() => {
    const key = e => e.key == "Escape" && close(item.type == "modal" ? false : undefined);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  if (item.type == "toast") return <div className={`toast ${item.kind}`} role="status">{item.text}</div>;
  if (item.type == "modal") {
    return (
      <div className={`modal-bg${closing ? " closing" : ""}`} onClick={e => e.target == e.currentTarget && close(false)}>
        <div className="modal" role="dialog" aria-modal="true">{item.render(close)}</div>
      </div>
    );
  }
  return (
    <div className={`drawer-bg${closing ? " closing" : ""}`} onClick={e => e.target == e.currentTarget && close()}>
      <section className="drawer" role="dialog" aria-modal="true" aria-label={item.title}>
        <header><h2>{item.title}</h2><button className="icon-btn" aria-label={t("Fermer", "Close")} onClick={() => close()}><Icon name="x" /></button></header>
        <div className="body">{item.render(close)}</div>
        {item.footer && <footer>{item.footer(close)}</footer>}
      </section>
    </div>
  );
}

export function Overlays() {
  const list = useSyncExternalStore(cb => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, () => items);
  return list.map(i => <Layer key={i.id} item={i} />);
}
