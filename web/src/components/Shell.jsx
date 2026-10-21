import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { t, LANG, setLang } from "../lib/i18n.js";
import { get, post } from "../lib/api.js";
import { useMe, setMe } from "../lib/session.js";
import { Icon, Logo, Avatar, Link } from "./ui.jsx";
import { openModal } from "./overlay.jsx";

export const SLOGAN = () => t("Le navigateur qui gravite autour de toi.", "The browser that orbits you.");

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
      <button className="avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("Mon compte", "My account")} onClick={() => setOpen(!open)}>
        <Avatar user={me} className="avatar sm" />
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <div className="menu-head"><Avatar user={me} className="avatar sm" /><span><b>{me.display_name || me.username}</b><span>@{me.username}</span></span></div>
          <Link to={`/u/${me.username}`} role="menuitem"><Icon name="user" />{t("Mon profil", "My profile")}</Link>
          <Link to="/me" role="menuitem"><Icon name="settings" />{t("Mon compte", "Account")}</Link>
          <Link to="/friends" role="menuitem"><Icon name="users" />{t("Amis", "Friends")}</Link>
          <Link to="/forum/mine" role="menuitem"><Icon name="message-square" />{t("Mes discussions", "My threads")}</Link>
          <Link to="/mods/mine" role="menuitem"><Icon name="palette" />{t("Mes mods", "My mods")}</Link>
          <Link to="/me/payments" role="menuitem"><Icon name="key-round" />{t("Ma clé bêta", "My beta key")}</Link>
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

function SearchDialog({ close }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState({ users: [], mods: [], threads: [] });
  const [active, setActive] = useState(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setRes({ users: [], mods: [], threads: [] });
    const id = setTimeout(async () => {
      const q = encodeURIComponent(term);
      const [u, m, f] = await Promise.all([
        get(`/users/search?q=${q}`).catch(() => ({ users: [] })),
        get(`/mods?q=${q}`).catch(() => ({ mods: [] })),
        get(`/forum/threads?sort=top&q=${q}`).catch(() => ({ threads: [] })),
      ]);
      setRes({ users: u.users.slice(0, 4), mods: m.mods.slice(0, 3), threads: f.threads.slice(0, 4) });
      setActive(0);
    }, 180);
    return () => clearTimeout(id);
  }, [q]);
  const items = [
    ...res.threads.map(f => ({ key: `t${f.id}`, group: "Forum", to: `/forum/t/${f.id}`, icon: <span className="search-ic"><Icon name="message-square" /></span>, title: f.title, sub: `${f.category_name} · ${f.comment_count} ${t("réponses", "replies")}` })),
    ...res.users.map(u => ({ key: `u${u.id}`, group: t("Membres", "Members"), to: `/u/${u.username}`, icon: <Avatar user={u} className="avatar xs" />, title: u.display_name || u.username, sub: `@${u.username}` })),
    ...res.mods.map(m => ({ key: `m${m.slug}`, group: "Mods", to: `/mods/${m.slug}`, icon: <span className="search-ic"><Icon name="palette" /></span>, title: m.name, sub: `Mod · @${m.author}` })),
  ];
  const go = item => {
    close();
    navigate(item.to, { viewTransition: true });
  };
  return (
    <div className="search-box">
      <label className="search-input"><Icon name="search" />
        <input autoFocus placeholder={t("Chercher dans le forum, les membres, les mods", "Search the forum, members and mods")} aria-label={t("Rechercher", "Search")} value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => {
            if (e.key == "ArrowDown") (e.preventDefault(), setActive(a => Math.min(items.length - 1, a + 1)));
            if (e.key == "ArrowUp") (e.preventDefault(), setActive(a => Math.max(0, a - 1)));
            if (e.key == "Enter" && items[active]) go(items[active]);
          }} />
        <kbd>Esc</kbd>
      </label>
      {q.trim().length >= 2 && (
        <div className="search-results" role="listbox">
          {items.length ? items.map((it, i) => [
            it.group != items[i - 1]?.group && <div key={`g${it.group}`} className="group">{it.group}</div>,
            <button key={it.key} type="button" role="option" aria-selected={i == active} onMouseEnter={() => setActive(i)} onClick={() => go(it)}>
              {it.icon}<span className="sr-text"><b>{it.title}</b><span>{it.sub}</span></span><Icon name="arrow-right" />
            </button>,
          ]) : <p className="search-empty">{t("Aucun résultat.", "No results.")}</p>}
        </div>
      )}
    </div>
  );
}

export const openSearch = () => openModal(close => <SearchDialog close={close} />, { variant: "search" });

export function Topbar() {
  const me = useMe();
  const unread = useUnread(me);
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    const key = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == "k") {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const nav = [["/forum", "Forum"], ["/mods", "Mods"], ["/discover", t("Membres", "People")], ["/badges", "Badges"], ["/support", t("Soutenir", "Support")]];
  return (
    <header className={`top${scrolled ? " scrolled" : ""}`}>
      <div className="top-in">
        <Link className="brand" to="/"><Logo /><span>Orbit</span></Link>
        <nav className={`nav${menu ? " open" : ""}`} aria-label={t("Principal", "Main")}>
          {nav.map(([to, label]) => <NavLink key={to} to={to} viewTransition>{label}</NavLink>)}
        </nav>
        <div className="grow" />
        <div className="top-right">
          <button className="search-btn" type="button" onClick={openSearch} aria-label={t("Rechercher", "Search")}>
            <Icon name="search" /><span>{t("Rechercher", "Search")}</span><kbd>Ctrl K</kbd>
          </button>
          <LangSwitch />
          <Link className="btn small accent download-btn" to="/beta"><Icon name="download" /><span>{t("Télécharger", "Download")}</span></Link>
          {me ? (
            <>
              <Link className="icon-btn" to="/notifications" aria-label="Notifications">
                <Icon name="bell" />{unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <AccountMenu me={me} />
            </>
          ) : (
            <>
              <Link className="btn small quiet" to="/login">{t("Se connecter", "Sign in")}</Link>
            </>
          )}
        </div>
        <button className="icon-btn menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
      </div>
    </header>
  );
}

export const Footer = () => (
  <footer className="foot">
    <div className="foot-brand">
      <Link className="brand" to="/"><Logo size={26} /><span>Orbit</span></Link>
      <p className="foot-slogan">{SLOGAN()}</p>
      <p className="faint small">{t("Bêta pour Windows. Gratuit pour tous à la version 1.0.", "Beta for Windows. Free for everyone at version 1.0.")}</p>
    </div>
    <nav className="foot-cols" aria-label={t("Liens", "Links")}>
      <div><h3>{t("Produit", "Product")}</h3><Link to="/beta">{t("Télécharger", "Download")}</Link><Link to="/#features">{t("Fonctionnalités", "Features")}</Link><Link to="/mods">Mods</Link></div>
      <div><h3>Forum</h3><Link to="/forum">{t("Discussions", "Discussions")}</Link><Link to="/forum/suggestions">Suggestions</Link><Link to="/forum/c/help">{t("Aide", "Help")}</Link></div>
      <div><h3>{t("Communauté", "Community")}</h3><Link to="/discover">{t("Membres", "People")}</Link><Link to="/badges">Badges</Link><Link to="/support">{t("Soutenir", "Support")}</Link></div>
      <div><h3>Orbit</h3><Link to="/terms">{t("Conditions", "Terms")}</Link><Link to="/privacy">{t("Confidentialité", "Privacy")}</Link><a href="https://github.com/realshavkat/orbit" target="_blank" rel="noopener">GitHub</a></div>
    </nav>
    <div className="foot-bottom"><span className="status-dot">{t("Tous les services fonctionnent", "All systems normal")}</span><span>© 2026 Orbit</span><LangSwitch /></div>
  </footer>
);
