// Badge catalog, badge page, authenticity check.
import { h, icon, t, get, badgeCard, personCard, empty, fmtDate, RARITY, errorText, localBadge } from "../lib.js";

const CATEGORY = { official: t("Officiel", "Official"), support: t("Soutien et dons", "Support"), community: t("Communauté", "Community"), seniority: t("Ancienneté", "Seniority"),
  event: t("Événement", "Event"), contribution: t("Contribution", "Contribution"), creator: t("Création de contenu", "Content creation"), beta: t("Bêta-test", "Beta testing"),
  trust: t("Sécurité et confiance", "Security and trust"), special: t("Récompenses spéciales", "Special rewards") };

export async function catalog() {
  const { badges } = await get("/badges");
  const groups = {};
  for (const b of badges) (groups[b.category] ??= []).push(b);
  return [h("div", { class: "page-head" }, h("div", {}, h("h1", {}, t("Badges", "Badges")),
    h("p", {}, t("Chaque badge correspond à un critère réel. Aucun ne s'achète et aucun ne donne de droits.", "Each badge matches a real criterion. None can be bought and none grants rights.")))),
  h("div", { class: "stack", style: { gap: "26px" } }, Object.entries(groups).map(([cat, list]) => h("section", { class: "stack" },
    h("h2", {}, CATEGORY[cat] ?? cat),
    h("div", { class: "grid cols-3" }, list.map(b => badgeCard(b, { extra: h("span", { class: "faint small" }, b.holders ? `${b.holders} ${t("membre(s)", "member(s)")}` : t("Personne pour l'instant", "Nobody yet")) }))))))];
}

export async function detail({ params }) {
  const r = await get(`/badges/${encodeURIComponent(params.key)}`);
  const { holders, holders_count: count } = r;
  const b = localBadge(r.badge);
  return h("div", { class: "stack", style: { gap: "22px" } },
    h("div", { class: "card row", style: { gap: "22px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: "badge", "data-rarity": b.rarity, style: { "--c": b.color, padding: 0, boxShadow: "none", background: "none" } }, h("span", { class: "medal xl" }, icon(b.icon))),
      h("div", { class: "stack", style: { gap: "6px", flex: 1, minWidth: "220px" } },
        h("span", { class: "rarity", style: { "--c": b.color } }, `${RARITY[b.rarity]} · ${CATEGORY[b.category] ?? b.category}`),
        h("h1", {}, b.name), h("p", { class: "muted", style: { margin: 0 } }, b.description),
        b.status == "retired" ? h("span", { class: "tag warn" }, t("Retiré : n'est plus attribué", "Retired: no longer awarded")) : null)),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card stack" }, h("h2", {}, t("Comment l'obtenir", "How to earn it")), h("p", { class: "muted", style: { margin: 0 } }, b.condition || "—"),
        h("div", { class: "chips" },
          h("span", { class: "chip" }, b.permanent ? t("Permanent", "Permanent") : b.duration_days ? t(`Valable ${b.duration_days} jours`, `Valid ${b.duration_days} days`) : t("Temporaire", "Temporary")),
          b.official ? h("span", { class: "chip" }, icon("shield-check"), t("Officiel", "Official")) : null,
          h("span", { class: "chip" }, t("Ne donne aucun droit", "Grants no rights")))),
      h("section", { class: "card stack" }, h("h2", {}, t("Détenteurs", "Holders")), h("div", { class: "stat", style: { boxShadow: "none", padding: 0 } }, h("b", {}, count),
        h("span", {}, t(`depuis le ${fmtDate(b.created_at)}`, `since ${fmtDate(b.created_at)}`))))),
    holders.length ? h("section", { class: "stack" }, h("h2", {}, t("Profils publics", "Public profiles")), h("div", { class: "grid cols-3" }, holders.map(u => personCard(u)))) : null);
}

export async function award({ params }) {
  let a;
  try {
    a = await get(`/badges/awards/${encodeURIComponent(params.id)}`);
  } catch (e) {
    return h("div", { class: "card" }, empty("circle-alert", e.code == "not_found" ? t("Badge introuvable ou non visible.", "Badge not found or not visible.") : errorText(e.code)));
  }
  const SOURCE = { auto: t("automatique", "automatic"), manual: t("attribué par l'équipe", "awarded by the team"), payment: t("don confirmé", "confirmed donation"),
    event: t("événement", "event"), contribution: t("contribution validée", "validated contribution"), bootstrap: t("fondateur d'Orbit", "Orbit founder"), official: t("rôle officiel", "official role") };
  return h("div", { class: "card stack", style: { maxWidth: "520px", margin: "30px auto" } },
    h("div", { class: `alert ${a.valid ? "ok" : "err"}` }, icon(a.valid ? "shield-check" : "circle-alert"),
      a.valid ? t("Badge authentique, délivré par Orbit.", "Genuine badge, issued by Orbit.") : t("Ce badge n'est plus valide.", "This badge is no longer valid.")),
    h("h1", {}, localBadge(a.badge).name),
    h("div", { class: "stack", style: { gap: "6px" } },
      h("div", { class: "row between" }, h("span", { class: "muted" }, t("Membre", "Member")), h("a", { class: "link", href: `/u/${a.username}` }, `@${a.username}`)),
      h("div", { class: "row between" }, h("span", { class: "muted" }, t("Obtenu le", "Earned on")), h("span", {}, fmtDate(a.awarded_at))),
      h("div", { class: "row between" }, h("span", { class: "muted" }, t("Origine", "Origin")), h("span", {}, SOURCE[a.source] ?? a.source)),
      h("div", { class: "row between" }, h("span", { class: "muted" }, t("Référence", "Reference")), h("span", { class: "mono" }, params.id))),
    h("a", { class: "btn", href: `/badges/${a.badge.key}` }, t("À propos de ce badge", "About this badge")));
}
