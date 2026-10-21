// Public profile: /u/:name
import { h, icon, t, get, post, patch, del, state, act, avatar, badgeCard, empty, fmtDate, ago, THEME, confirmDialog, errorText, liquid, localBadge } from "../lib.js";

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
  out.push(h("div", { style: { position: "relative" } }, (() => {
    let menu;
    const b = h("button", { class: "btn", style: { width: "40px", padding: "0" }, "aria-label": t("Plus d'actions", "More actions"), onclick: e => {
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
    } }, icon("ellipsis"));
    return b;
  })()));
  return out;
}

const SECTION_TITLES = { badges: t("Badges", "Badges"), sites: t("Sites partagés", "Shared sites"), collections: t("Collections", "Collections"),
  interests: t("Centres d'intérêt", "Interests"), links: t("Liens", "Links") };

const sec = (key, content, more = null) => h("section", { class: "p-section" }, h("header", {}, h("h2", {}, SECTION_TITLES[key]), more), content);

// Main column: badges, sites, collections. Side column: interests, links.
function section(key, p) {
  if (key == "badges") {
    if (!p.badges?.length) return null;
    return sec(key, h("div", { class: "badges-row" }, p.badges.map(b => badgeCard(b, { href: `/award/${b.award_id}` }))),
      h("a", { class: "link small", href: "/badges" }, t("Tous les badges", "All badges")));
  }
  if (key == "sites") {
    if (!p.sites?.length) return null;
    return sec(key, h("div", {}, p.sites.map(s => h("a", { class: "site-row", href: `/sites/${s.domain}` },
      h("span", { class: "favicon" }, s.domain[0].toUpperCase()),
      h("span", { style: { display: "flex", flexDirection: "column", minWidth: 0 } }, h("b", { style: { fontWeight: 500 } }, s.domain), s.note ? h("span", { class: "faint small" }, s.note) : null),
      icon("chevron-right")))));
  }
  if (key == "collections") {
    if (!p.collections?.length) return null;
    return sec(key, h("div", {}, p.collections.map(c => h("div", { class: "collection" },
      h("div", { class: "row between" }, h("h3", {}, c.title), state.me && !p.self ? h("button", { class: "icon-btn", onclick: () => reportDialog("collection", c.id), "aria-label": t("Signaler", "Report") }, icon("flag")) : null),
      c.description ? h("p", { class: "muted small", style: { margin: "4px 0 6px" } }, c.description) : null,
      h("div", {}, c.items.map(i => h("a", { class: "site-row", href: i.url, target: "_blank", rel: "noopener noreferrer nofollow" },
        icon("link"), h("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, i.title || i.url), icon("external-link"))))))));
  }
  if (key == "interests") {
    if (!p.interests?.length) return null;
    return sec(key, h("div", { class: "chips" }, p.interests.map(i => h("span", { class: "chip" }, i))));
  }
  if (key == "links") {
    if (!p.links?.length) return null;
    return sec(key, h("div", { class: "stack", style: { gap: "8px" } }, p.links.map(l => h("a", { class: "link", href: l.url, target: "_blank", rel: "noopener noreferrer nofollow me" },
      l.label || new URL(l.url).hostname))));
  }
  return null;
}

// The bio, editable in place on your own profile.
function bioBlock(p, rerender) {
  const view = p.bio ? h("p", { class: "bio" }, p.bio) : null;
  if (!p.self) return view;
  const box = h("div", {});
  const show = () => box.replaceChildren(...(view
    ? [view, h("button", { class: "bio-add", type: "button", style: { marginTop: "8px" }, onclick: edit }, icon("pencil"), t("Modifier la bio", "Edit bio"))]
    : [h("button", { class: "bio-add", type: "button", onclick: edit }, icon("plus"), t("Ajouter une bio", "Add a bio"))]));
  const edit = () => {
    const area = h("textarea", { class: "input", rows: 3, maxlength: 400, "aria-label": "Bio", placeholder: t("Quelques mots sur toi", "A few words about you") });
    area.value = p.bio ?? "";
    const count = h("span", { class: "hint" }, `${area.value.length} / 400`);
    area.addEventListener("input", () => (count.textContent = `${area.value.length} / 400`));
    const save = h("button", { class: "btn primary small", type: "submit" }, t("Enregistrer", "Save"));
    box.replaceChildren(h("form", { class: "bio-edit", onsubmit: async e => {
      e.preventDefault();
      if ((await act(save, () => patch("/me/profile", { bio: area.value.trim() || null }), { ok: t("Bio enregistrée", "Bio saved") })) !== undefined) rerender();
    } }, area, h("div", { class: "row" }, count, h("div", { style: { flex: 1 } }),
      h("button", { class: "btn quiet small", type: "button", onclick: show }, t("Annuler", "Cancel")), save)));
    area.focus();
  };
  show();
  return box;
}

const ROLE_COLORS = { founder: "#f5c518", administrator: "#ff8d97", moderator: "#7fd1ff", developer: "#c4b5ff", verified: "#3dd68c" };

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
    const banner = h("div", { class: "profile-banner" });
    if (p.banner_url) banner.style.backgroundImage = `url("${p.banner_url}")`;
    else banner.append(liquid("liquid", { a: color, b: "#0e1a3a" }));
    const official = (p.badges ?? []).filter(b => b.official).map(localBadge);
    const counts = [
      p.friend_count != null ? [p.friend_count, t("amis", "friends")] : null,
      [p.badges?.length ?? 0, "badges"],
      p.sites?.length ? [p.sites.length, t("sites partagés", "shared sites")] : null,
    ].filter(Boolean);
    const head = h("section", { class: "profile-head", "aria-label": t("Profil", "Profile") }, avatar(p, "avatar lg"),
      h("div", { class: "names" },
        h("h1", {}, p.display_name || p.username, ...official.map(b => h("span", { class: "role-tag", style: { "--c": ROLE_COLORS[b.key] ?? b.color } }, b.name))),
        h("span", { class: "handle" }, `@${p.username}`, p.created_at ? ` · ${t("Membre depuis", "Member since")} ${fmtDate(p.created_at)}` : "",
          p.last_active_at ? ` · ${t("actif", "active")} ${ago(p.last_active_at)}` : ""),
        p.private ? null : bioBlock(p, rerender),
        p.private ? null : h("div", { class: "counts" }, counts.map(([n, l]) => h("span", {}, h("b", {}, n), ` ${l}`)))),
      h("div", { class: "actions" }, p.self ? h("a", { class: "btn", href: "/me" }, icon("pencil"), t("Modifier le profil", "Edit profile")) : null, ...relationActions(p, rerender)));
    if (p.private) {
      return h("div", {}, banner, head, h("div", { style: { marginTop: "32px" } },
        empty("lock", t("Ce profil est privé.", "This profile is private."), state.me ? null : h("a", { class: "btn small", href: "/login" }, t("Se connecter", "Sign in")))));
    }
    const order = p.section_order ?? ["badges", "sites", "collections", "interests", "links"];
    const side = ["interests", "links"];
    const mainSecs = order.filter(k => !side.includes(k)).map(k => section(k, p)).filter(Boolean);
    const sideSecs = order.filter(k => side.includes(k)).map(k => section(k, p)).filter(Boolean);
    return h("div", {}, banner, head, h("div", { class: "profile-body" },
      h("div", { class: "main" }, mainSecs.length ? mainSecs : empty("compass", t("Rien à afficher pour l'instant.", "Nothing to show yet."))),
      sideSecs.length ? h("aside", {}, sideSecs) : null));
  };
  return render();
}
