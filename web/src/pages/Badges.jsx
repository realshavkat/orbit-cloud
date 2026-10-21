import { useLoaderData, useSearchParams } from "react-router";
import { t, errorText } from "../lib/i18n.js";
import { get } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { fmtDate, RARITY, localBadge } from "../lib/format.js";
import { Icon, Link, PersonCard, Empty, Tabs } from "../components/ui.jsx";

const CATEGORY = { official: t("Officiel", "Official"), support: t("Soutien", "Supporter"), community: t("Communauté", "Community"), seniority: t("Ancienneté", "Seniority"),
  event: t("Événement", "Event"), contribution: "Contribution", creator: t("Création de contenu", "Content creation"), beta: t("Bêta-test", "Beta testing"),
  trust: t("Sécurité et confiance", "Security and trust"), special: t("Récompenses spéciales", "Special rewards") };

export const catalogLoader = () => get("/badges");

export function Catalog() {
  const { badges } = useLoaderData();
  const me = useMe();
  const [params] = useSearchParams();
  const filter = params.get("f") ?? "";
  const mine = new Set((me?.badges ?? []).map(b => b.key));
  const shown = badges.filter(b => !filter || (filter == "earned" ? mine.has(b.key) : b.category == filter));
  const groups = {};
  for (const b of shown) (groups[b.category] ??= []).push(b);
  const tabs = [["/badges", t("Tous", "All"), ""], ...(me ? [["/badges?f=earned", t("Obtenus", "Earned"), "earned"]] : []),
    ...[...new Set(badges.map(b => b.category))].map(c => [`/badges?f=${c}`, CATEGORY[c] ?? c, c])];
  return (
    <div className="stack" style={{ gap: 36, maxWidth: 980 }}>
      <div className="stack" style={{ gap: 12 }}>
        <h1 style={{ fontSize: 44 }}>Badges</h1>
        <p className="muted" style={{ fontSize: 18, maxWidth: "60ch" }}>
          {t("Chaque badge correspond à un critère réel. Aucun ne s'achète et aucun ne donne de droits.", "Each badge matches a real criterion. None can be bought and none grants rights.")}
          {me && <> {t("Tu en as ", "You have ")}<b style={{ color: "var(--ink)", fontWeight: 600 }}>{mine.size} / {badges.length}</b>.</>}
        </p>
      </div>
      <Tabs items={tabs} current={filter} label={t("Filtrer", "Filter")} />
      {Object.keys(groups).length ? Object.entries(groups).map(([cat, list]) => (
        <section key={cat}>
          <h2 className="section-title">{CATEGORY[cat] ?? cat}</h2>
          <div className="list">{list.map(raw => {
            const b = localBadge(raw);
            return (
              <Link key={b.key} className="badge-row" to={`/badges/${b.key}`}>
                <span className="medal" style={{ "--c": b.color }}><Icon name={b.icon} /></span>
                <span className="t"><b style={{ fontWeight: 600 }}>{b.name}</b><span>{b.description}</span></span>
                <span className="n hide-sm">{b.holders ? `${b.holders.toLocaleString()} ${b.holders > 1 ? t("membres", "members") : t("membre", "member")}` : t("Personne", "Nobody yet")}</span>
                {mine.has(b.key)
                  ? <span className="row" style={{ gap: 6, color: "var(--ok)", fontSize: 14, fontWeight: 500, width: 92, justifyContent: "flex-end" }}><Icon name="check" />{t("Obtenu", "Earned")}</span>
                  : <span className="faint small" style={{ width: 92, textAlign: "right" }}>{RARITY[b.rarity]}</span>}
              </Link>
            );
          })}</div>
        </section>
      )) : <Empty icon="award">{t("Aucun badge ici.", "No badge here.")}</Empty>}
    </div>
  );
}

export const detailLoader = ({ params }) => get(`/badges/${encodeURIComponent(params.key)}`);

export function Detail() {
  const r = useLoaderData();
  const b = localBadge(r.badge);
  return (
    <div className="stack" style={{ gap: 40, maxWidth: 980 }}>
      <Link className="row muted" to="/badges" style={{ width: "fit-content" }}><Icon name="arrow-left" />{t("Tous les badges", "All badges")}</Link>
      <div className="row wrap" style={{ gap: 28 }}>
        <span className="medal xl" style={{ "--c": b.color }}><Icon name={b.icon} /></span>
        <div className="stack" style={{ gap: 8, flex: 1, minWidth: 240 }}>
          <span className="muted small">{RARITY[b.rarity]} · {CATEGORY[b.category] ?? b.category}</span>
          <h1>{b.name}</h1>
          <p className="muted" style={{ fontSize: 17 }}>{b.description}</p>
          {b.status == "retired" && <span className="tag warn" style={{ width: "fit-content" }}>{t("Retiré : n'est plus attribué", "Retired: no longer awarded")}</span>}
        </div>
      </div>
      <dl className="facts" style={{ maxWidth: 640 }}>
        <div><dt>{t("Comment l'obtenir", "How to earn it")}</dt><dd>{b.condition || "—"}</dd></div>
        <div><dt>{t("Durée", "Duration")}</dt><dd>{b.permanent ? t("Permanent", "Permanent") : b.duration_days ? t(`${b.duration_days} jours`, `${b.duration_days} days`) : t("Temporaire", "Temporary")}</dd></div>
        <div><dt>{t("Détenteurs", "Holders")}</dt><dd>{r.holders_count.toLocaleString()}</dd></div>
        <div><dt>{t("Créé le", "Created")}</dt><dd>{fmtDate(b.created_at)}</dd></div>
      </dl>
      {r.holders.length > 0 && (
        <section className="stack"><h2>{t("Profils publics", "Public profiles")}</h2>
          <div className="grid cols-3">{r.holders.map(u => <PersonCard key={u.id ?? u.username} user={u} />)}</div>
        </section>
      )}
    </div>
  );
}

export async function awardLoader({ params }) {
  try {
    return { award: await get(`/badges/awards/${encodeURIComponent(params.id)}`), id: params.id };
  } catch (e) {
    return { error: e };
  }
}

export function Award() {
  const { award: a, id, error } = useLoaderData();
  if (error) return <Empty icon="circle-alert">{error.code == "not_found" ? t("Badge introuvable ou non visible.", "Badge not found or not visible.") : errorText(error.code)}</Empty>;
  const SOURCE = { auto: t("automatique", "automatic"), manual: t("attribué par l'équipe", "awarded by the team"), payment: t("paiement confirmé", "confirmed payment"),
    event: t("événement", "event"), contribution: t("contribution validée", "validated contribution"), bootstrap: t("fondateur d'Orbit", "Orbit founder"), official: t("rôle officiel", "official role") };
  const b = localBadge(a.badge);
  return (
    <div className="stack" style={{ maxWidth: 520, margin: "24px auto", gap: 24 }}>
      <div className={`alert ${a.valid ? "ok" : "err"}`}><Icon name={a.valid ? "shield-check" : "circle-alert"} />
        {a.valid ? t("Badge authentique, délivré par Orbit.", "Genuine badge, issued by Orbit.") : t("Ce badge n'est plus valide.", "This badge is no longer valid.")}</div>
      <div className="row" style={{ gap: 16 }}><span className="medal xl" style={{ "--c": b.color, width: 64, height: 64, borderRadius: 16 }}><Icon name={b.icon} /></span><h1>{b.name}</h1></div>
      <dl className="facts">
        <div><dt>{t("Membre", "Member")}</dt><dd><Link className="link" to={`/u/${a.username}`}>@{a.username}</Link></dd></div>
        <div><dt>{t("Obtenu le", "Earned on")}</dt><dd>{fmtDate(a.awarded_at)}</dd></div>
        <div><dt>{t("Origine", "Origin")}</dt><dd>{SOURCE[a.source] ?? a.source}</dd></div>
        <div><dt>{t("Référence", "Reference")}</dt><dd className="mono">{id}</dd></div>
      </dl>
      <Link className="btn" to={`/badges/${a.badge.key}`} style={{ width: "fit-content" }}>{t("À propos de ce badge", "About this badge")}</Link>
    </div>
  );
}
