// Public profile: /u/:name
import { h, icon, t, get, post, del, state, act, avatar, badgeCard, badgeMini, empty, fmtDate, ago, THEME, confirmDialog, toast, errorText } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);

export function reportDialog(targetType, targetId) {
  const reasons = [["spam", t("Spam", "Spam")], ["harassment", t("Harcèlement", "Harassment")], ["impersonation", t("Usurpation d'identité", "Impersonation")],
    ["inappropriate", t("Contenu inapproprié", "Inappropriate content")], ["illegal", t("Contenu illégal", "Illegal content")], ["other", t("Autre", "Other")]];
  const select = h("select", { class: "input" }, ...reasons.map(([v, l]) => h("option", { value: v }, l)));
  const details = h("textarea", { class: "input", maxlength: 1000, placeholder: t("Détails (facultatif)", "Details (optional)") });
  const bg = h("div", { class: "modal-bg", onclick: e => e.target == bg && bg.remove() },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
      h("h2", {}, t("Signaler", "Report")),
      h("p", { class: "muted", style: { margin: 0 } }, t("L'équipe de modération examinera ton signalement. La personne signalée ne saura pas que c'est toi.",
        "The moderation team will review your report. The reported person won't know it was you.")),
      select, details,
      h("div", { class: "row", style: { justifyContent: "flex-end" } },
        h("button", { class: "btn", onclick: () => bg.remove() }, t("Annuler", "Cancel")),
        h("button", { class: "btn primary", onclick: async e => {
          const ok = await act(e.target, () => post("/reports", { target_type: targetType, target_id: targetId, reason: select.value, details: details.value || null }),
            { ok: t("Signalement envoyé. Merci.", "Report sent. Thank you.") });
          if (ok) bg.remove();
        } }, t("Envoyer", "Send")))));
  document.body.append(bg);
  select.focus();
}

function relationActions(p, rerender) {
  if (!state.me || p.self) return [];
  const out = [];
  const rel = p.relation;
  if (rel == "friend") {
    out.push(h("button", { class: "btn", onclick: async e => {
      if (await confirmDialog({ title: t("Retirer cet ami ?", "Remove this friend?"), action: t("Retirer", "Remove"), danger: true })) {
        await act(e.target, () => del(`/friends/${p.id}`));
        rerender();
      }
    } }, icon("user-check"), t("Ami", "Friend")));
  } else if (rel == "request_received") {
    out.push(h("a", { class: "btn primary", href: "/friends" }, icon("user-plus"), t("Répondre à sa demande", "Answer the request")));
  } else if (rel == "request_sent") {
    out.push(h("button", { class: "btn", disabled: true }, icon("clock"), t("Demande envoyée", "Request sent")));
  } else if (p.can_request) {
    out.push(h("button", { class: "btn primary", onclick: async e => {
      if (await act(e.target, () => post("/friends/requests", { user_id: p.id }), { ok: t("Demande envoyée", "Request sent") })) rerender();
    } }, icon("user-plus"), t("Ajouter en ami", "Add friend")));
  }
  out.push(h("div", { class: "row", style: { position: "relative" } }, (() => {
    let menu;
    const b = h("button", { class: "icon-btn", "aria-label": t("Plus d'actions", "More actions"), onclick: e => {
      e.stopPropagation();
      if (menu) return menu.remove(), (menu = null);
      menu = h("div", { class: "menu", role: "menu" },
        h("button", { role: "menuitem", onclick: () => reportDialog("user", p.id) }, icon("flag"), t("Signaler", "Report")),
        h("button", { role: "menuitem", onclick: async ev => {
          if (await confirmDialog({ title: t(`Bloquer @${p.username} ?`, `Block @${p.username}?`), text: t("Vous ne pourrez plus vous voir ni interagir. L'amitié et les demandes en cours sont supprimées.",
            "You won't see or reach each other anymore. Friendship and pending requests are removed."), action: t("Bloquer", "Block"), danger: true })) {
            if (await act(ev.target, () => post("/friends/blocks", { user_id: p.id }), { ok: t("Membre bloqué", "Member blocked") })) go("/friends");
          }
        } }, icon("ban"), t("Bloquer", "Block")));
      b.parentNode.append(menu);
      setTimeout(() => document.addEventListener("click", () => (menu?.remove(), (menu = null)), { once: true }), 0);
    } }, icon("chevron-down"));
    return b;
  })()));
  return out;
}

const SECTION_TITLES = { badges: t("Badges", "Badges"), sites: t("Sites partagés", "Shared sites"), collections: t("Collections", "Collections"),
  interests: t("Centres d'intérêt", "Interests"), links: t("Liens", "Links") };

function section(key, p) {
  const box = (content) => h("section", { class: "card stack" }, h("h2", {}, SECTION_TITLES[key]), content);
  if (key == "badges") {
    if (!p.badges?.length) return null;
    return box(h("div", { class: "grid cols-2" }, p.badges.map(b => badgeCard(b, { href: `/award/${b.award_id}`, extra: h("span", { class: "faint small" }, fmtDate(b.awarded_at)) }))));
  }
  if (key == "sites") {
    if (!p.sites?.length) return null;
    return box(h("div", {}, p.sites.map(s => h("a", { class: "site-row", href: `/sites/${s.domain}` },
      h("span", { class: "favicon" }, s.domain[0].toUpperCase()), h("span", { style: { flex: 1 } }, h("b", {}, s.domain), s.note ? h("div", { class: "muted small" }, s.note) : null),
      icon("chevron-right")))));
  }
  if (key == "collections") {
    if (!p.collections?.length) return null;
    return box(h("div", { class: "stack" }, p.collections.map(c => h("div", { class: "card", style: { background: "var(--card-2)" } },
      h("div", { class: "row between" }, h("h3", {}, c.title), state.me && !p.self ? h("button", { class: "btn small", onclick: () => reportDialog("collection", c.id), "aria-label": t("Signaler", "Report") }, icon("flag")) : null),
      c.description ? h("p", { class: "muted small", style: { margin: "4px 0 8px" } }, c.description) : null,
      h("div", {}, c.items.map(i => h("a", { class: "site-row", href: i.url, target: "_blank", rel: "noopener noreferrer nofollow" },
        icon("link"), h("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, i.title || i.url), icon("external-link"))))))));
  }
  if (key == "interests") {
    if (!p.interests?.length) return null;
    return box(h("div", { class: "chips" }, p.interests.map(i => h("span", { class: "chip" }, `#${i}`))));
  }
  if (key == "links") {
    if (!p.links?.length) return null;
    return box(h("div", {}, p.links.map(l => h("a", { class: "site-row", href: l.url, target: "_blank", rel: "noopener noreferrer nofollow me" },
      icon("globe"), h("span", { style: { flex: 1 } }, l.label || new URL(l.url).hostname), icon("external-link")))));
  }
  return null;
}

export async function page({ params }) {
  const render = async () => {
    let p;
    try {
      p = await get(`/users/${encodeURIComponent(params.name)}`);
    } catch (e) {
      return empty("user-x", e.code == "not_found" ? t("Ce profil n'existe pas ou n'est pas visible.", "This profile doesn't exist or isn't visible.") : errorText(e.code));
    }
    const color = THEME[p.theme_color] ?? THEME.violet;
    const rerender = async () => document.querySelector("main").replaceChildren(await render());
    const banner = h("div", { class: "profile-banner", style: { "--pc": color } });
    if (p.banner_url) banner.style.backgroundImage = `url("${p.banner_url}")`;
    const official = (p.badges ?? []).filter(b => b.official);
    const featured = (p.badges ?? []).filter(b => b.featured);
    const head = h("div", { class: "profile-head" }, avatar(p, "avatar lg"),
      h("div", { class: "names" },
        h("h1", {}, p.display_name || p.username, ...official.map(badgeMini)),
        h("div", { class: "muted" }, `@${p.username}`, p.created_at ? ` · ${t("membre depuis", "member since")} ${fmtDate(p.created_at)}` : "",
          p.last_active_at ? ` · ${t("actif", "active")} ${ago(p.last_active_at)}` : "")),
      h("div", { class: "row wrap" }, p.self ? h("a", { class: "btn", href: "/me" }, icon("pencil"), t("Modifier le profil", "Edit profile")) : null, ...relationActions(p, rerender)));
    if (p.private) {
      return h("div", {}, banner, head, h("div", { class: "card", style: { marginTop: "22px" } },
        empty("lock", t("Ce profil est privé.", "This profile is private."), state.me ? null : h("a", { class: "btn small", href: "/login" }, t("Se connecter", "Sign in")))));
    }
    const order = p.section_order ?? ["badges", "sites", "collections", "interests", "links"];
    const main = order.map(k => section(k, p)).filter(Boolean);
    const aside = h("aside", { class: "stack" },
      p.bio ? h("section", { class: "card" }, h("h2", {}, t("À propos", "About")), h("p", { style: { whiteSpace: "pre-wrap", margin: "8px 0 0" } }, p.bio)) : null,
      featured.length ? h("section", { class: "card stack" }, h("h2", {}, t("Mis en avant", "Featured")), ...featured.map(b => badgeCard(b, { href: `/award/${b.award_id}` }))) : null,
      h("section", { class: "card stack" },
        p.friend_count != null ? h("div", { class: "row" }, icon("users"), h("b", {}, p.friend_count), t(" amis", " friends")) : null,
        h("div", { class: "row muted small" }, icon("award"), `${p.badges.length} badge${p.badges.length > 1 ? "s" : ""}`)));
    return h("div", {}, banner, head, h("div", { class: "profile-body" },
      h("div", { class: "stack" }, main.length ? main : h("div", { class: "card" }, empty("compass", t("Rien à afficher pour l'instant.", "Nothing to show yet.")))), aside));
  };
  return render();
}
