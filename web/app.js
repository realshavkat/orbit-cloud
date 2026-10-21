// Orbit community: the page shell and the router (paths handled in the browser).
import { h, icon, t, get, post, state, loadMe, spinner, errorBox, avatar, logo, LANG, setLang } from "./lib.js";
import * as auth from "./pages/auth.js";
import * as profile from "./pages/profile.js";
import * as me from "./pages/me.js";
import * as social from "./pages/social.js";
import * as badges from "./pages/badges.js";
import * as support from "./pages/support.js";
import * as admin from "./pages/admin.js";
import * as legal from "./pages/legal.js";
import * as mods from "./pages/mods.js";
import { landing } from "./pages/landing.js";

// [pattern, page, options]; :name captures one segment.
const ROUTES = [
  ["/", landing, { full: true }],
  ["/login", auth.login, { bare: true }],
  ["/register", auth.register, { bare: true }],
  ["/connect", auth.connect, { bare: true }],
  ["/verify", auth.verify, { bare: true }],
  ["/confirm-email", auth.verify, { bare: true }],
  ["/forgot", auth.forgot, { bare: true }],
  ["/reset", auth.reset, { bare: true }],
  ["/mfa", auth.mfa, { bare: true }],
  ["/u/:name", profile.page],
  ["/discover", social.discover],
  ["/search", social.search],
  ["/friends", social.friends, { auth: true }],
  ["/notifications", social.notifications, { auth: true }],
  ["/sites/:domain", social.site],
  ["/share", social.share, { auth: true }],
  ["/mods", mods.store],
  ["/mods/submit", mods.submit, { auth: true }],
  ["/mods/mine", mods.mine, { auth: true }],
  ["/mods/:slug", mods.detail],
  ["/badges", badges.catalog],
  ["/badges/:key", badges.detail],
  ["/award/:id", badges.award],
  ["/support", support.page],
  ["/me", me.page, { auth: true }],
  ["/me/:tab", me.page, { auth: true }],
  ["/admin", admin.page, { auth: true, admin: true }],
  ["/admin/:tab", admin.page, { auth: true, admin: true }],
  ["/admin/:tab/:id", admin.page, { auth: true, admin: true }],
  ["/terms", legal.terms],
  ["/privacy", legal.privacy],
];

function match(path) {
  for (const [pattern, page, opts = {}] of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), "([^/]+)"))}/?$`);
    const m = re.exec(path);
    if (m) return { page, opts, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", url);
  else {
    history.pushState(null, "", url);
    scrollTo({ top: 0, behavior: "instant" });
  }
  render();
}
window.orbitNavigate = navigate;

// Internal links stay in the page.
document.addEventListener("click", e => {
  const a = e.target.closest("a[href]");
  if (!a || a.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button != 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin != location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) return;
  if (url.pathname == location.pathname && url.hash) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener("popstate", () => render());

let unread = 0;
async function refreshCount() {
  if (!state.me) return;
  try {
    unread = (await get("/notifications/count")).unread;
    const el = document.querySelector("#notif-count");
    if (el) {
      el.textContent = unread > 99 ? "99+" : unread;
      el.hidden = !unread;
    }
  } catch {}
}
setInterval(refreshCount, 60_000);

export const langSwitch = () => h("div", { class: "lang", role: "group", "aria-label": "Language" },
  ...[["en", "EN"], ["fr", "FR"]].map(([k, label]) => h("button", { type: "button", "aria-pressed": String(LANG == k), onclick: () => LANG != k && setLang(k) }, label)));

export function accountMenu(anchor) {
  let menu = null;
  const close = () => {
    menu?.remove();
    menu = null;
  };
  return e => {
    e.stopPropagation();
    if (menu) return close();
    const isStaff = state.me.permissions?.length > 0;
    menu = h("div", { class: "menu", role: "menu" },
      h("a", { href: `/u/${state.me.username}`, role: "menuitem" }, icon("user"), t("Mon profil", "My profile")),
      h("a", { href: "/me", role: "menuitem" }, icon("settings"), t("Mon compte", "Account")),
      h("a", { href: "/friends", role: "menuitem" }, icon("users"), t("Amis", "Friends")),
      h("a", { href: "/mods/mine", role: "menuitem" }, icon("palette"), t("Mes mods", "My mods")),
      isStaff ? h("a", { href: "/admin", role: "menuitem" }, icon("layout-dashboard"), t("Administration", "Admin")) : null,
      h("hr"),
      h("button", { role: "menuitem", onclick: async () => {
        await post("/auth/logout").catch(() => {});
        state.me = null;
        navigate("/login");
      } }, icon("log-out"), t("Se déconnecter", "Sign out")));
    anchor.append(menu);
    setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
  };
}

function topbar(path) {
  const navLink = (href, label) => h("a", { href, "aria-current": path == href || path.startsWith(`${href}/`) ? "page" : null }, label);
  const nav = h("nav", { class: "nav", "aria-label": t("Principal", "Main") },
    navLink("/discover", t("Découvrir", "Discover")), navLink("/mods", "Mods"),
    navLink("/badges", "Badges"), navLink("/support", t("Soutenir", "Support")));
  const search = h("input", { type: "search", placeholder: t("Rechercher un membre", "Search members"), "aria-label": t("Rechercher", "Search") });
  const form = h("form", { class: "top-search", role: "search", onsubmit: e => (e.preventDefault(), search.value.trim() && navigate(`/search?q=${encodeURIComponent(search.value.trim())}`)) },
    icon("search"), search);
  const right = h("div", { class: "top-right" }, form, langSwitch());
  if (state.me) {
    const holder = h("div", { style: { position: "relative" } });
    holder.append(h("button", { class: "icon-btn", "aria-haspopup": "menu", "aria-label": t("Mon compte", "My account"), style: { width: "auto" }, onclick: accountMenu(holder) },
      avatar({ ...state.me, avatar_url: state.me.avatar_media_id ? `/api/v1/users/media/${state.me.avatar_media_id}` : null }, "avatar sm")));
    right.append(
      h("a", { class: "icon-btn", href: "/notifications", "aria-label": t("Notifications", "Notifications") }, icon("bell"),
        h("span", { class: "count", id: "notif-count", hidden: !unread }, String(unread))), holder);
  } else {
    right.append(h("a", { class: "btn small quiet", href: "/login" }, t("Se connecter", "Sign in")));
  }
  const burger = h("button", { class: "icon-btn menu-btn", "aria-label": "Menu", "aria-expanded": "false", onclick: () => {
    burger.setAttribute("aria-expanded", String(nav.classList.toggle("open")));
  } }, icon("menu"));
  return h("header", { class: "top" }, h("div", { class: "top-in" },
    h("a", { class: "brand", href: "/" }, logo(28), h("span", {}, "Orbit")), nav, h("div", { class: "grow" }), right, burger));
}

const footer = () => h("footer", {},
  h("div", { class: "row" }, h("span", { class: "brand" }, logo(22), h("span", {}, "Orbit")),
    h("span", {}, t("Le navigateur reste gratuit, avec ou sans compte.", "The browser stays free, with or without an account."))),
  h("nav", { class: "row", "aria-label": t("Liens", "Links") },
    h("a", { href: "/mods" }, "Mods"), h("a", { href: "/badges" }, "Badges"), h("a", { href: "/support" }, t("Soutenir", "Support")),
    h("a", { href: "/terms" }, t("Conditions", "Terms")), h("a", { href: "/privacy" }, t("Confidentialité", "Privacy")),
    h("a", { href: "https://github.com/realshavkat/orbit", target: "_blank", rel: "noopener" }, "GitHub")));

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const path = location.pathname;
  const route = match(path);
  if (state.me === null && !render.loaded) {
    render.loaded = true;
    await loadMe();
    state.config = await get("/config").catch(() => ({}));
  }
  const main = h("main", { class: route?.opts.bare ? "narrow" : route?.opts.full ? "full" : "" }, spinner());
  if (route?.opts.admin) document.body.replaceChildren(main);
  else document.body.replaceChildren(topbar(path), main, footer());
  if (!route) {
    main.replaceChildren(errorBox({ code: "not_found" }));
    return;
  }
  if (route.opts.auth && !state.me) return navigate(`/login?next=${encodeURIComponent(path + location.search)}`, { replace: true });
  if (state.me?.mfa_pending && path != "/mfa") return navigate("/mfa", { replace: true });
  try {
    const content = await route.page({ params: route.params, query: Object.fromEntries(new URLSearchParams(location.search)), main });
    if (seq != renderSeq) return;
    if (content) main.replaceChildren(...[content].flat());
    if (route.opts.admin && main.firstElementChild?.classList.contains("admin")) main.replaceWith(main.firstElementChild);
  } catch (e) {
    if (seq != renderSeq) return;
    main.replaceChildren(errorBox(e));
  }
  refreshCount();
  const h1 = document.querySelector("h1");
  document.title = path == "/" ? "Orbit" : `${h1?.firstChild?.nodeType == 3 ? h1.firstChild.textContent.trim() : h1?.textContent ?? "Orbit"} · Orbit`;
}

render();
