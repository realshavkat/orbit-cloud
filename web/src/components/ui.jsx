import { cloneElement, isValidElement, useId } from "react";
import { Link as RouterLink } from "react-router";
import { t, errorText } from "../lib/i18n.js";
import { THEME, RARITY, localBadge } from "../lib/format.js";

export const Link = props => <RouterLink viewTransition {...props} />;

export const Icon = ({ name, className = "i", style }) => (
  <svg className={className} aria-hidden="true" style={style}><use href={`/assets/icons.svg#i-${name}`} /></svg>
);

export const Logo = ({ size = 28 }) => <img src="/assets/logo.svg" alt="" width={size} height={Math.round((size * 251) / 331)} />;

export function Avatar({ user, className = "avatar" }) {
  const url = user?.avatar_url ?? (user?.avatar_media_id ? `/api/v1/users/media/${user.avatar_media_id}` : null);
  if (url) return <img className={className} src={url} alt="" loading="lazy" />;
  return (
    <span className={className} style={{ "--c": THEME[user?.theme_color] ?? THEME.violet }} aria-hidden="true">
      {(user?.display_name || user?.username || "?")[0].toUpperCase()}
    </span>
  );
}

export const Spinner = () => <div className="spinner" role="progressbar" aria-label={t("Chargement", "Loading")} />;

export const Empty = ({ icon, children, action }) => (
  <div className="empty"><Icon name={icon} /><div>{children}</div>{action}</div>
);

export const ErrorBox = ({ error }) => (
  <div className="alert err" role="alert"><Icon name="circle-alert" />{errorText(error?.code ?? error?.message ?? error)}</div>
);

export function Field({ label, hint, children }) {
  const id = useId();
  const child = Array.isArray(children) ? children : [children];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {child.map((c, i) => (i == 0 && isValidElement(c) ? cloneElement(c, { id, key: "f" }) : c))}
      {hint && (typeof hint == "string" ? <span className="hint">{hint}</span> : hint)}
    </div>
  );
}

export function SwitchRow({ title, desc, checked, onChange, disabled }) {
  return (
    <label className="switch-row">
      <span><b>{title}</b>{desc && <div className="hint">{desc}</div>}</span>
      <input type="checkbox" className="switch" role="switch" aria-label={title} checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

export function BadgeMini({ badge }) {
  const b = localBadge(badge);
  return (
    <span className="tooltip-wrap" tabIndex={0} aria-label={b.name}>
      <span className="badge-mini" style={{ "--c": b.color }}><Icon name={b.icon} /></span>
      <span className="tip" role="tooltip"><b>{b.name}</b>{b.description && <div className="muted">{b.description}</div>}</span>
    </span>
  );
}

export function BadgeCard({ badge, to, extra }) {
  const b = localBadge(badge);
  return (
    <Link className="badge" to={to ?? `/badges/${b.key}`} data-rarity={b.rarity} style={{ "--c": b.color }}>
      <span className="medal"><Icon name={b.icon} /></span>
      <span className="t"><b>{b.name}</b><span>{extra ?? RARITY[b.rarity]}</span></span>
    </Link>
  );
}

export function PersonCard({ user, extra }) {
  return (
    <Link className="person" to={`/u/${user.username}`}>
      <Avatar user={user} />
      <span className="who">
        <span className="name">{user.display_name || user.username}{(user.badges ?? []).slice(0, 3).map(b => <BadgeMini key={b.key} badge={b} />)}</span>
        <span className="handle">@{user.username}</span>
      </span>
      {extra}
    </Link>
  );
}

export const PageHero = ({ eyebrow, title, sub, children, style }) => (
  <header className="page-hero" style={style}>
    <div className="ph-text">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    {children && <div className="ph-actions">{children}</div>}
  </header>
);

export const PageHead = PageHero;

export function NotFound() {
  return (
    <div className="not-found">
      <span className="nf-code">404</span>
      <h1>{t("Cette page a quitté l'orbite.", "This page left orbit.")}</h1>
      <p>{t("Le lien est peut-être ancien, ou la page a été déplacée.", "The link may be old, or the page has moved.")}</p>
      <div className="row wrap" style={{ justifyContent: "center" }}>
        <Link className="btn primary" to="/">{t("Retour à l'accueil", "Back home")}</Link>
        <Link className="btn" to="/mods">{t("Voir les mods", "Browse mods")}</Link>
      </div>
    </div>
  );
}

export const Tabs = ({ items, current, label }) => (
  <div className="tabs" role="tablist" aria-label={label}>
    {items.map(([to, text, key]) => <Link key={to} to={to} role="tab" aria-selected={String((key ?? to) == current)}>{text}</Link>)}
  </div>
);
