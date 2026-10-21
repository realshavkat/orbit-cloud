// Home, discovery, search, friends, notifications, sites.
import { h, icon, t, get, post, del, state, act, personCard, empty, ago, fmtDate, errorText, confirmDialog, localBadge } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);

export async function home() {
  if (state.me) return discover();
  return h("div", { class: "stack", style: { gap: "28px", paddingTop: "40px" } },
    h("div", { class: "stack", style: { gap: "14px", maxWidth: "640px" } },
      h("h1", { style: { fontSize: "44px", lineHeight: 1.1 } }, t("La communauté du navigateur Orbit", "The Orbit browser community")),
      h("p", { class: "muted", style: { fontSize: "17px", margin: 0 } }, t("Un profil, des badges, des amis, des collections de sites. Facultatif : Orbit reste entièrement gratuit, avec ou sans compte.",
        "A profile, badges, friends, collections of sites. Optional: Orbit stays fully free, with or without an account.")),
      h("div", { class: "row" }, h("a", { class: "btn primary", href: "/register" }, t("Créer un compte", "Sign up")), h("a", { class: "btn", href: "/discover" }, t("Découvrir", "Discover")))),
    h("div", { class: "grid cols-3" },
      feature("award", t("Badges vérifiables", "Verifiable badges"), t("Chaque badge a une page qui prouve qu'il est authentique.", "Every badge has a page proving it is genuine.")),
      feature("lock", t("Privé par défaut", "Private by default"), t("Ton historique ne quitte jamais ton ordinateur. Tu partages seulement ce que tu choisis.", "Your history never leaves your computer. You share only what you choose.")),
      feature("heart", t("Soutenir Orbit", "Support Orbit"), t("Les dons financent le projet, sans rien débloquer de payant.", "Donations fund the project without unlocking anything paid."))));
}

const feature = (ic, title, text) => h("div", { class: "card stack", style: { gap: "8px" } },
  h("span", { class: "badge-mini", style: { "--c": "var(--accent)", width: "36px", height: "36px", borderRadius: "10px" } }, icon(ic)), h("h2", {}, title), h("p", { class: "muted", style: { margin: 0 } }, text));

export async function discover() {
  const d = await get("/users/discover");
  const block = (title, sub, list) => list.length ? h("section", { class: "stack" }, h("div", {}, h("h2", {}, title), sub ? h("p", { class: "muted small", style: { margin: "2px 0 0" } }, sub) : null),
    h("div", { class: "grid cols-3" }, list.map(u => personCard(u)))) : null;
  const sections = [
    block(t("Centres d'intérêt en commun", "Shared interests"), null, d.shared_interests),
    block(t("Membres actifs", "Active members"), t("Actifs cette semaine.", "Active this week."), d.active),
    block(t("Populaires", "Popular"), t("Les membres qui ont le plus d'amis.", "Members with the most friends."), d.popular),
    block(t("Nouveaux membres", "New members"), null, d.recent),
    d.collections.length ? h("section", { class: "stack" }, h("h2", {}, t("Collections", "Collections")),
      h("div", { class: "grid cols-3" }, d.collections.map(c => h("a", { class: "card", href: `/u/${c.username}` },
        h("h3", {}, c.title), c.description ? h("p", { class: "muted small", style: { margin: "4px 0" } }, c.description) : null,
        h("span", { class: "faint small" }, `@${c.username} · ${c.items} ${t("liens", "links")}`))))) : null,
  ].filter(Boolean);
  return [h("div", { class: "page-head" }, h("div", {}, h("h1", {}, t("Découvrir", "Discover")),
    h("p", {}, t("Seuls les membres qui ont choisi d'apparaître ici sont affichés.", "Only members who chose to appear here are shown.")))),
  sections.length ? h("div", { class: "stack", style: { gap: "28px" } }, sections) :
    h("div", { class: "card" }, empty("compass", t("Personne ici pour l'instant. Active « Apparaître dans les suggestions » dans ta confidentialité pour être le premier.",
      "Nobody here yet. Turn on \"Appear in suggestions\" in your privacy settings to be the first.")))];
}

export async function search({ query }) {
  const q = (query.q ?? "").trim();
  const input = h("input", { class: "input", value: q, placeholder: t("Pseudo", "Username"), autofocus: true });
  const form = h("form", { class: "row", onsubmit: e => (e.preventDefault(), go(`/search?q=${encodeURIComponent(input.value.trim())}`)) },
    input, h("button", { class: "btn primary", type: "submit" }, icon("search"), t("Rechercher", "Search")));
  let results = null;
  if (q.length >= 2) {
    try {
      const r = await get(`/users/search?q=${encodeURIComponent(q)}`);
      results = r.users.length ? h("div", { class: "grid cols-3" }, r.users.map(u => personCard(u))) : empty("search", t("Aucun membre trouvé.", "No member found."));
    } catch (e) {
      results = empty("search", errorText(e.code));
    }
  }
  return [h("div", { class: "page-head" }, h("h1", {}, t("Rechercher", "Search"))), form, results];
}

export async function friends() {
  const d = await get("/friends");
  const answer = (r, verb) => async e => {
    if ((await act(e.target, () => post(`/friends/requests/${r.id}/${verb}`))) !== undefined) go("/friends", { replace: true });
  };
  return [h("div", { class: "page-head" }, h("h1", {}, t("Amis", "Friends")), h("a", { class: "btn", href: "/discover" }, icon("user-plus"), t("Trouver des membres", "Find members"))),
    d.incoming.length ? h("section", { class: "stack" }, h("h2", {}, t("Demandes reçues", "Requests received")),
      h("div", { class: "grid cols-2" }, d.incoming.map(r => personCard(r.user, h("span", { class: "row", onclick: e => e.preventDefault() },
        h("button", { class: "btn small primary", onclick: answer(r, "accept") }, t("Accepter", "Accept")),
        h("button", { class: "btn small", onclick: answer(r, "decline") }, t("Refuser", "Decline"))))))) : null,
    h("section", { class: "stack" }, h("h2", {}, `${t("Mes amis", "My friends")} (${d.friends.length})`),
      d.friends.length ? h("div", { class: "grid cols-3" }, d.friends.map(u => personCard(u))) : h("div", { class: "card" }, empty("users", t("Pas encore d'amis.", "No friends yet.")))),
    d.outgoing.length ? h("section", { class: "stack" }, h("h2", {}, t("Demandes envoyées", "Requests sent")),
      h("div", { class: "grid cols-2" }, d.outgoing.map(r => personCard(r.user, h("button", { class: "btn small", onclick: e => (e.preventDefault(), answer(r, "cancel")(e)) }, t("Annuler", "Cancel")))))) : null,
    d.blocked.length ? h("section", { class: "stack" }, h("h2", {}, t("Membres bloqués", "Blocked members")),
      h("div", { class: "grid cols-2" }, d.blocked.map(u => h("div", { class: "person" }, h("span", { class: "who" }, h("span", { class: "name" }, u.username)),
        h("button", { class: "btn small", onclick: async e => {
          if ((await act(e.target, () => del(`/friends/blocks/${u.id}`))) !== undefined) go("/friends", { replace: true });
        } }, t("Débloquer", "Unblock")))))) : null];
}

const NOTIF = {
  friend_request: n => [icon("user-plus"), t(`@${n.data.username} veut être ton ami.`, `@${n.data.username} wants to be your friend.`), "/friends"],
  friend_accepted: n => [icon("user-check"), t(`@${n.data.username} a accepté ta demande.`, `@${n.data.username} accepted your request.`), `/u/${n.data.username}`],
  badge: n => [icon("award"), t(`Nouveau badge : ${localBadge({ key: n.data.badge, name: n.data.name }).name}`, `New badge: ${n.data.name}`), "/me/badges"],
  support_badge: n => [icon("heart"), t(`Merci ! Badge de soutien : ${localBadge({ key: n.data.badge, name: n.data.name }).name}`, `Thank you! Support badge: ${n.data.name}`), "/me/badges"],
  contribution: () => [icon("git-branch"), t("Ta contribution a été reconnue.", "Your contribution was recognised."), "/me/badges"],
  security: n => [icon("shield-alert"), securityText(n.data.what), "/me/security"],
  report_update: n => [icon("flag"), n.data.status == "resolved" ? t("Ton signalement a été traité. Merci.", "Your report was handled. Thank you.") : t("Ton signalement a été examiné.", "Your report was reviewed."), null],
  moderation: n => [icon("shield"), n.data.appeal ? (n.data.appeal == "accepted" ? t("Ta contestation a été acceptée.", "Your appeal was accepted.") : t("Ta contestation a été refusée.", "Your appeal was rejected."))
    : t(`Décision de modération : ${n.data.reason ?? ""}`, `Moderation decision: ${n.data.reason ?? ""}`), "/me/data"],
  news: n => [icon("info"), n.data.title ?? t("Actualité d'Orbit", "Orbit news"), null],
};
function securityText(what) {
  return { email_changed: t("Ton adresse e-mail a été changée.", "Your e-mail address was changed."), mfa_reset: t("Ta validation en deux étapes a été réinitialisée par l'équipe.", "Your two-step verification was reset by the team.") }[what] ?? what;
}

export async function notifications() {
  const d = await get("/notifications");
  const list = h("div", { class: "card flat" }, d.notifications.length ? d.notifications.map(n => {
    const [ic, text, href] = (NOTIF[n.type] ?? (() => [icon("bell"), n.type, null]))(n);
    const row = h(href ? "a" : "div", { class: "switch-row", href, style: { opacity: n.read_at ? 0.65 : 1 } },
      h("span", { class: "row" }, ic, h("span", {}, text, h("div", { class: "faint small" }, ago(n.created_at)))),
      h("button", { class: "icon-btn", "aria-label": t("Supprimer", "Delete"), onclick: async e => {
        e.preventDefault();
        if ((await act(null, () => del(`/notifications/${n.id}`))) !== undefined) row.remove();
      } }, icon("x")));
    return row;
  }) : empty("bell", t("Aucune notification.", "No notifications.")));
  if (d.notifications.some(n => !n.read_at)) post("/notifications/read", { all: true }).catch(() => {});
  return [h("div", { class: "page-head" }, h("h1", {}, t("Notifications", "Notifications")),
    h("a", { class: "btn small", href: "/me/notifications" }, icon("settings"), t("Préférences", "Preferences"))), list];
}

// Members who shared a domain (only above the privacy threshold).
export async function site({ params }) {
  const d = await get(`/sites/domain/${encodeURIComponent(params.domain)}`);
  if (d.sensitive) return h("div", { class: "card" }, empty("lock", t("Ce site est protégé : on n'affiche pas qui le visite.", "This site is protected: we don't show who visits it.")));
  const shareBtn = state.me ? (d.shared_by_me
    ? h("button", { class: "btn", onclick: async e => {
      if ((await act(e.target, () => del(`/sites/shared/${d.domain}`), { ok: t("Retiré de ton profil", "Removed from your profile") })) !== undefined) go(location.pathname, { replace: true });
    } }, icon("check"), t("Partagé sur mon profil", "Shared on my profile"))
    : h("a", { class: "btn primary", href: `/share?domain=${encodeURIComponent(d.domain)}` }, icon("plus"), t("Partager sur mon profil", "Share on my profile"))) : null;
  return [h("div", { class: "page-head" }, h("div", { class: "row" }, h("span", { class: "favicon", style: { width: "40px", height: "40px", fontSize: "16px" } }, d.domain[0].toUpperCase()),
    h("div", {}, h("h1", {}, d.domain), h("p", {}, d.count ? t(`${d.count} membres l'ont partagé`, `${d.count} members shared it`) : t("Pas encore assez de membres pour l'afficher.", "Not enough members yet to show it.")))), shareBtn),
  d.members.length ? h("div", { class: "grid cols-3" }, d.members.map(u => personCard(u)))
    : h("div", { class: "card" }, empty("users", t("Pour protéger chacun, la liste n'apparaît qu'à partir de 3 membres.", "To protect everyone, the list only shows from 3 members.")))];
}

// Explicit consent page opened from the browser ("Share this site").
export async function share({ query }) {
  const domain = (query.domain ?? "").toLowerCase();
  const note = h("input", { class: "input", maxlength: 140, placeholder: t("Pourquoi tu l'aimes (facultatif)", "Why you like it (optional)") });
  const privacy = state.me.privacy;
  return h("div", { class: "narrow", style: { maxWidth: "480px", margin: "40px auto" } }, h("div", { class: "card stack" },
    h("h1", {}, t("Partager ce site ?", "Share this site?")),
    h("div", { class: "row" }, h("span", { class: "favicon" }, (domain[0] ?? "?").toUpperCase()), h("b", {}, domain || "—")),
    h("p", { class: "muted", style: { margin: 0 } }, t("Seul le nom du site sera ajouté à ton profil : pas la page, pas ton historique. Tu peux le retirer à tout moment.",
      "Only the site's name is added to your profile: not the page, not your history. You can remove it any time.")),
    !privacy.share_sites_enabled ? h("div", { class: "alert warn" }, icon("info"), t("Le partage de sites est désactivé. Le confirmer l'active.", "Site sharing is off. Confirming turns it on.")) : null,
    note,
    h("div", { class: "row", style: { justifyContent: "flex-end" } },
      h("a", { class: "btn", href: "/" }, t("Annuler", "Cancel")),
      h("button", { class: "btn primary", disabled: !domain, onclick: async e => {
        const ok = await act(e.target, async () => {
          if (!privacy.share_sites_enabled) await (await import("../lib.js")).patch("/me/privacy", { share_sites_enabled: true });
          return post("/sites/shared", { domain, note: note.value || null });
        }, { ok: t("Site partagé", "Site shared") });
        if (ok) go(`/sites/${ok.domain}`);
      } }, t("Partager", "Share")))));
}

export { fmtDate, confirmDialog };
