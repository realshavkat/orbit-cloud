// Badge catalog, badge page, authenticity check.
import { h, icon, t, get, state, personCard, empty, fmtDate, RARITY, errorText, localBadge } from "../lib.js";

const CATEGORY = { official: t("Officiel", "Official"), support: t("Soutien et dons", "Support"), community: t("Communauté", "Community"), seniority: t("Ancienneté", "Seniority"),
  event: t("Événement", "Event"), contribution: t("Contribution", "Contribution"), creator: t("Création de contenu", "Content creation"), beta: t("Bêta-test", "Beta testing"),
  trust: t("Sécurité et confiance", "Security and trust"), special: t("Récompenses spéciales", "Special rewards") };

export async function catalog({ query }) {
  const { badges } = await get("/badges");
  const mine = new Set((state.me?.badges ?? []).map(b => b.key));
  const filter = query.f ?? "";
  const shown = badges.filter(b => !filter || (filter == "earned" ? mine.has(b.key) : b.category == filter));
  const groups = {};
  for (const b of shown) (groups[b.category] ??= []).push(b);
  const cats = [["", t("Tous", "All")], ...(state.me ? [["earned", t("Obtenus", "Earned")]] : []),
    ...[...new Set(badges.map(b => b.category))].map(c => [c, CATEGORY[c] ?? c])];
  return h("div", { class: "stack", style: { gap: "36px", maxWidth: "980px" } },
    h("div", { class: "stack", style: { gap: "12px" } }, h("h1", { style: { fontSize: "44px" } }, "Badges"),
      h("p", { class: "muted", style: { fontSize: "18px", maxWidth: "60ch" } },
        t("Chaque badge correspond à un critère réel. Aucun ne s'achète et aucun ne donne de droits.", "Each badge matches a real criterion. None can be bought and none grants rights."),
        state.me ? h("span", {}, " ", t("Tu en as ", "You have "), h("b", { style: { color: "var(--ink)", fontWeight: 600 } }, `${mine.size} / ${badges.length}`), ".") : null)),
    h("div", { class: "tabs", role: "tablist" }, cats.map(([k, l]) => h("a", { href: k ? `/badges?f=${k}` : "/badges", role: "tab", "aria-selected": String(k == filter) }, l))),
    Object.keys(groups).length ? Object.entries(groups).map(([cat, list]) => h("section", {},
      h("h2", { class: "section-title" }, CATEGORY[cat] ?? cat),
      h("div", { class: "list" }, list.map(raw => {
        const b = localBadge(raw);
        return h("a", { class: "badge-row", href: `/badges/${b.key}` }, h("span", { class: "medal", style: { "--c": b.color } }, icon(b.icon)),
          h("span", { class: "t" }, h("b", { style: { fontWeight: 600 } }, b.name), h("span", {}, b.description)),
          h("span", { class: "n hide-sm" }, b.holders ? `${b.holders.toLocaleString()} ${t("membre(s)", b.holders > 1 ? "members" : "member")}` : t("Personne", "Nobody yet")),
          mine.has(b.key) ? h("span", { class: "row", style: { gap: "6px", color: "var(--ok)", fontSize: "14px", fontWeight: 500, width: "92px", justifyContent: "flex-end" } }, icon("check"), t("Obtenu", "Earned"))
            : h("span", { class: "faint small", style: { width: "92px", textAlign: "right" } }, RARITY[b.rarity]));
      })))) : empty("award", t("Aucun badge ici.", "No badge here.")));
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
