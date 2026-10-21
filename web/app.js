// Orbit community: the page shell and the router (paths handled in the browser).
import { h, icon, t, get, post, state, loadMe, spinner, errorBox, avatar } from "./lib.js";
import * as auth from "./pages/auth.js";
import * as profile from "./pages/profile.js";
import * as me from "./pages/me.js";
import * as social from "./pages/social.js";
import * as badges from "./pages/badges.js";
import * as support from "./pages/support.js";
import * as admin from "./pages/admin.js";
import * as legal from "./pages/legal.js";

// [pattern, page, options]; :name captures one segment.
const ROUTES = [
  ["/", social.home],
  ["/login", auth.login, { bare: true }],
  ["/register", auth.register, { bare: true }],
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
  ["/badges", badges.catalog],
  ["/badges/:key", badges.detail],
  ["/award/:id", badges.award],
  ["/support", support.page],
  ["/me", me.page, { auth: true }],
  ["/me/:tab", me.page, { auth: true }],
  ["/admin", admin.page, { auth: true }],
  ["/admin/:tab", admin.page, { auth: true }],
  ["/admin/:tab/:id", admin.page, { auth: true }],
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
  else history.pushState(null, "", url);
  render();
}
window.orbitNavigate = navigate;

// Internal links stay in the page.
document.addEventListener("click", e => {
  const a = e.target.closest("a[href]");
  if (!a || a.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button != 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin != location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) return;
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

function topbar(path) {
  const navLink = (href, ic, label) => h("a", { href, "aria-current": path == href || (href != "/" && path.startsWith(href)) ? "page" : null }, icon(ic), h("span", {}, label));
  const search = h("input", { type: "search", placeholder: t("Rechercher un membre", "Search members"), "aria-label": t("Rechercher", "Search") });
  const form = h("form", { class: "top-search", role: "search", onsubmit: e => (e.preventDefault(), search.value.trim() && navigate(`/search?q=${encodeURIComponent(search.value.trim())}`)) },
    icon("search"), search);
  const right = h("div", { class: "row" });
  if (state.me) {
    let menu = null;
    const toggle = h("button", { class: "icon-btn", "aria-haspopup": "menu", "aria-label": t("Mon compte", "My account"), style: { width: "auto", padding: "0 4px" } },
      avatar({ ...state.me, avatar_url: state.me.avatar_media_id ? `/api/v1/users/media/${state.me.avatar_media_id}` : null }, "avatar sm"));
    const close = () => {
      menu?.remove();
      menu = null;
    };
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      if (menu) return close();
      const isStaff = state.me.permissions?.length > 0;
      menu = h("div", { class: "menu", role: "menu" },
        h("a", { href: `/u/${state.me.username}`, role: "menuitem" }, icon("user"), t("Mon profil", "My profile")),
        h("a", { href: "/me", role: "menuitem" }, icon("pencil"), t("Modifier le profil", "Edit profile")),
        h("a", { href: "/friends", role: "menuitem" }, icon("users"), t("Amis", "Friends")),
        h("a", { href: "/me/badges", role: "menuitem" }, icon("award"), t("Mes badges", "My badges")),
        h("a", { href: "/me/privacy", role: "menuitem" }, icon("eye"), t("Confidentialité", "Privacy")),
        h("a", { href: "/me/security", role: "menuitem" }, icon("lock"), t("Sécurité", "Security")),
        isStaff ? h("a", { href: "/admin", role: "menuitem" }, icon("shield-check"), t("Administration", "Administration")) : null,
        h("hr"),
        h("button", { role: "menuitem", onclick: async () => {
          await post("/auth/logout").catch(() => {});
          state.me = null;
          navigate("/login");
        } }, icon("log-out"), t("Se déconnecter", "Sign out")));
      toggle.parentNode.style.position = "relative";
      toggle.parentNode.append(menu);
      setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    });
    right.append(
      h("a", { class: "icon-btn", href: "/notifications", "aria-label": t("Notifications", "Notifications") }, icon("bell"),
        h("span", { class: "count", id: "notif-count", hidden: !unread }, String(unread))),
      h("div", {}, toggle));
  } else {
    right.append(h("a", { class: "btn small", href: "/login" }, t("Se connecter", "Sign in")),
      h("a", { class: "btn small primary", href: "/register" }, t("Créer un compte", "Sign up")));
  }
  return h("header", { class: "top" },
    h("a", { class: "brand", href: "/" }, h("span", { class: "dot" }), "Orbit"),
    h("nav", { class: "nav", "aria-label": t("Principal", "Main") },
      navLink("/discover", "compass", t("Découvrir", "Discover")),
      navLink("/badges", "award", t("Badges", "Badges")),
      navLink("/support", "heart", t("Soutenir", "Support"))),
    h("div", { class: "grow" }), form, right);
}

const footer = () => h("footer", {}, "Orbit · ",
  h("a", { href: "/terms" }, t("Conditions", "Terms")), " · ", h("a", { href: "/privacy" }, t("Confidentialité", "Privacy")), " · ",
  t("Le navigateur reste gratuit, avec ou sans compte.", "The browser stays free, with or without an account."));

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
  const main = h("main", { class: route?.opts.bare ? "narrow" : "" }, spinner());
  document.body.replaceChildren(topbar(path), main, footer());
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
  } catch (e) {
    if (seq != renderSeq) return;
    main.replaceChildren(errorBox(e));
  }
  refreshCount();
  const h1 = document.querySelector("main h1");
  document.title = `${h1?.firstChild?.nodeType == 3 ? h1.firstChild.textContent : h1?.textContent ?? "Orbit"} · Orbit`;
}

render();
