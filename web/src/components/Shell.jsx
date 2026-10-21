import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { t, LANG, setLang } from "../lib/i18n.js";
import { get, post } from "../lib/api.js";
import { useMe, setMe } from "../lib/session.js";
import { Icon, Logo, Avatar, Link } from "./ui.jsx";

export const LangSwitch = () => (
  <div className="lang" role="group" aria-label="Language">
    {[["en", "EN"], ["fr", "FR"]].map(([k, label]) => (
      <button key={k} type="button" aria-pressed={String(LANG == k)} onClick={() => LANG != k && setLang(k)}>{label}</button>
    ))}
  </div>
);

export function useClickAway(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => !ref.current?.contains(e.target) && setOpen(false);
    const key = e => e.key == "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return ref;
}

function AccountMenu({ me }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, setOpen);
  const navigate = useNavigate();
  const staff = me.permissions?.length > 0;
  const signOut = async () => {
    await post("/auth/logout").catch(() => {});
    setMe(null);
    navigate("/login", { viewTransition: true });
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("Mon compte", "My account")} style={{ width: "auto" }} onClick={() => setOpen(!open)}>
        <Avatar user={me} className="avatar sm" />
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <Link to={`/u/${me.username}`} role="menuitem"><Icon name="user" />{t("Mon profil", "My profile")}</Link>
          <Link to="/me" role="menuitem"><Icon name="settings" />{t("Mon compte", "Account")}</Link>
          <Link to="/friends" role="menuitem"><Icon name="users" />{t("Amis", "Friends")}</Link>
          <Link to="/mods/mine" role="menuitem"><Icon name="palette" />{t("Mes mods", "My mods")}</Link>
          {staff && <Link to="/admin" role="menuitem"><Icon name="layout-dashboard" />{t("Administration", "Admin")}</Link>}
          <hr />
          <button role="menuitem" onClick={signOut}><Icon name="log-out" />{t("Se déconnecter", "Sign out")}</button>
        </div>
      )}
    </div>
  );
}

function useUnread(me) {
  const [n, setN] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = () => get("/notifications/count").then(r => alive && setN(r.unread)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [me?.id, pathname]);
  return n;
}

export function Topbar() {
  const me = useMe();
  const unread = useUnread(me);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [pathname]);
  const nav = [["/discover", t("Découvrir", "Discover")], ["/mods", "Mods"], ["/badges", "Badges"], ["/support", t("Soutenir", "Support")]];
  return (
    <header className="top">
      <div className="top-in">
        <Link className="brand" to="/"><Logo /><span>Orbit</span></Link>
        <nav className={`nav${menu ? " open" : ""}`} aria-label={t("Principal", "Main")}>
          {nav.map(([to, label]) => <NavLink key={to} to={to} viewTransition>{label}</NavLink>)}
        </nav>
        <div className="grow" />
        <div className="top-right">
          <form className="top-search" role="search" onSubmit={e => {
            e.preventDefault();
            if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`, { viewTransition: true });
          }}>
            <Icon name="search" />
            <input type="search" placeholder={t("Rechercher un membre", "Search members")} aria-label={t("Rechercher", "Search")} value={q} onChange={e => setQ(e.target.value)} />
          </form>
          <LangSwitch />
          {me ? (
            <>
              <Link className="icon-btn" to="/notifications" aria-label={t("Notifications", "Notifications")}>
                <Icon name="bell" />{unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <AccountMenu me={me} />
            </>
          ) : (
            <Link className="btn small quiet" to="/login">{t("Se connecter", "Sign in")}</Link>
          )}
        </div>
        <button className="icon-btn menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
      </div>
    </header>
  );
}

export const Footer = () => (
  <footer>
    <div className="row"><span className="brand"><Logo size={22} /><span>Orbit</span></span>
      <span>{t("Gratuit pour tous à la version 1.0.", "Free for everyone at version 1.0.")}</span></div>
    <nav className="row" aria-label={t("Liens", "Links")}>
      <Link to="/mods">Mods</Link><Link to="/badges">Badges</Link><Link to="/beta">{t("Bêta", "Beta")}</Link><Link to="/support">{t("Soutenir", "Support")}</Link>
      <Link to="/terms">{t("Conditions", "Terms")}</Link><Link to="/privacy">{t("Confidentialité", "Privacy")}</Link>
      <a href="https://github.com/realshavkat/orbit" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </footer>
);
