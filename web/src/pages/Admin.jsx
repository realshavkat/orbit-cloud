import { useEffect, useState } from "react";
import { redirect, useLoaderData, useNavigate, useParams, useRevalidator, useSearchParams } from "react-router";
import { t, LANG } from "../lib/i18n.js";
import { get, post, patch, put } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { fmtDate, fmtDateTime, fmtMoney, RARITY, localBadge } from "../lib/format.js";
import { Icon, Link, Logo, Avatar, Empty, Field, SwitchRow } from "../components/ui.jsx";
import { LangSwitch } from "../components/Shell.jsx";
import { act, openDrawer, openModal, promptDialog, toast, useBusy } from "../components/overlay.jsx";

const TABS = () => [
  ["", "layout-dashboard", t("Vue d'ensemble", "Overview"), "stats.read"],
  ["users", "users", t("Membres", "Users"), "users.read"],
  ["badges", "award", "Badges", "badges.award"],
  ["mods", "palette", "Mods", "mods.review"],
  ["reports", "flag", t("Signalements", "Reports"), "reports.read"],
  ["payments", "heart", t("Paiements", "Payments"), "donations.read"],
  ["beta", "download", t("Bêta", "Beta"), "beta.grant"],
  ["audit", "scroll-text", t("Journal d'audit", "Audit log"), "audit.read"],
];

const SECTIONS = {};

export async function loader({ params, request }) {
  let me;
  try {
    me = await get("/admin/me");
  } catch {
    return { denied: true };
  }
  const perms = new Set(me.permissions);
  const tabs = TABS().filter(([, , , p]) => perms.has(p));
  const tab = params.tab ?? (perms.has("stats.read") ? "" : tabs[0]?.[0]);
  if (params.tab == null && tab) throw redirect(`/admin/${tab}`);
  const counts = {};
  await Promise.all([
    perms.has("mods.review") && get("/admin/mods").then(r => (counts.mods = r.pending)).catch(() => {}),
    perms.has("stats.read") && get("/admin/stats").then(r => (counts.reports = r.reports_open)).catch(() => {}),
  ]);
  const section = SECTIONS[params.id ? `${tab}/:id` : tab];
  const allowed = tabs.some(([k]) => k == tab);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  return { perms: [...perms], tabs, tab, counts, allowed, data: allowed && section?.load ? await section.load({ params, query, perms }) : null, query };
}

export default function Admin() {
  const { denied, tabs, tab, counts, allowed, data, perms, query } = useLoaderData();
  const { id } = useParams();
  const me = useMe();
  if (denied) {
    return <div className="admin"><div className="admin-main"><Empty icon="lock" action={<Link className="btn small" to="/">{t("Retour au site", "Back to site")}</Link>}>{t("Accès réservé à l'équipe.", "Team only.")}</Empty></div></div>;
  }
  const Section = SECTIONS[id ? `${tab}/:id` : tab]?.View;
  return (
    <div className="admin">
      <aside className="admin-side">
        <Link className="brand" to="/admin"><Logo size={26} />Orbit<small>Admin</small></Link>
        <nav className="admin-nav" aria-label={t("Administration", "Admin")}>
          {tabs.map(([k, ic, label]) => (
            <Link key={k} to={k ? `/admin/${k}` : "/admin"} aria-current={k == tab ? "page" : undefined}><Icon name={ic} />{label}{counts[k] > 0 && <span className="n">{counts[k]}</span>}</Link>
          ))}
        </nav>
        <div className="admin-foot">
          <Link className="row muted small" to="/" style={{ padding: "0 12px" }}><Icon name="arrow-left" />{t("Retour au site", "Back to site")}</Link>
          <div className="me"><Avatar user={me} className="avatar sm" /><span><b style={{ fontWeight: 500 }}>{me.username}</b><span className="faint">{me.roles?.find(r => r != "user") ?? ""}</span></span></div>
          <div style={{ padding: "0 10px" }}><LangSwitch /></div>
        </div>
      </aside>
      <div className="admin-main">
        {allowed && Section ? <Section data={data} perms={new Set(perms)} query={query} id={id} /> : <Empty icon="lock">{t("Pas d'accès à cette section.", "No access to this section.")}</Empty>}
      </div>
    </div>
  );
}

const Head = ({ title, sub, children }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <p style={{ fontSize: 15, marginTop: 6 }}>{sub}</p>}</div>{children && <div className="row wrap">{children}</div>}</div>
);
const STATUS_COLOR = { active: "var(--ok)", succeeded: "var(--ok)", processed: "var(--ok)", resolved: "var(--ok)", approved: "var(--ok)", suspended: "var(--danger)", failed: "var(--danger)",
  disputed: "var(--danger)", rejected: "var(--danger)", open: "var(--warn)", pending: "var(--warn)", reviewing: "var(--warn)", refunded: "var(--warn)", partially_refunded: "var(--warn)" };
const Status = ({ s }) => <span className="dot" style={{ "--c": STATUS_COLOR[s] ?? "var(--faint)" }}>{s}</span>;
const Table = ({ cols, children }) => (
  <div style={{ overflowX: "auto" }}><table><thead><tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);
const Stat = ({ label, value, sub }) => <div className="stat"><span>{label}</span><b>{value}</b>{sub && <span className="faint">{sub}</span>}</div>;

function useReload() {
  const { revalidate } = useRevalidator();
  return revalidate;
}

const reasoned = (title, run, reload) => async () => {
  const reason = await promptDialog({ title, label: t("Motif (obligatoire, visible dans le journal)", "Reason (required, logged)"), action: t("Confirmer", "Confirm") });
  if (reason && (await act(() => run(reason), { ok: t("Fait", "Done") }))) reload();
};

function SignupChart({ days }) {
  const [tip, setTip] = useState(null);
  const W = 640, H = 220, L = 34, B = 26;
  const step = Math.ceil(Math.max(4, ...days.map(d => d.n)) / 4);
  const top = step * 4;
  const y = v => H - B - (v / top) * (H - B - 10);
  const bw = (W - L) / days.length;
  const label = d => new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric" }).format(new Date(d));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Nouveaux membres par jour, 30 derniers jours", "New members per day, last 30 days")}>
        {[0, 1, 2, 3, 4].map(k => (
          <g key={k}><line x1={L} x2={W} y1={y(step * k)} y2={y(step * k)} stroke={`rgba(255,255,255,${k ? 0.05 : 0.12})`} />
            <text x={L - 8} y={y(step * k) + 4} textAnchor="end" fill="#7A7A8C" fontSize="12">{step * k}</text></g>
        ))}
        {days.map((d, i) => {
          const x = L + i * bw + 1, w = bw - 2, h = Math.max(H - B - y(d.n) - 4, 0);
          return (
            <g key={d.day}>
              {d.n > 0 && <path d={`M${x} ${H - B}v${-h}q0 -4 4 -4h${w - 8}q4 0 4 4v${h}z`} fill={tip?.i == i ? "#C4B5FF" : "rgba(196,181,255,.6)"} />}
              <rect className="bar-hit" x={L + i * bw} y={0} width={bw} height={H - B} onPointerEnter={() => setTip({ i, d })} onPointerLeave={() => setTip(null)} />
            </g>
          );
        })}
        {[0, Math.floor(days.length / 2), days.length - 1].map(i => (
          <text key={i} x={Math.min(L + i * bw + bw / 2, W)} y={H - 6} textAnchor={i == days.length - 1 ? "end" : "middle"} fill="#7A7A8C" fontSize="12">{label(days[i].day)}</text>
        ))}
      </svg>
      {tip && <div className="tip" style={{ left: `${((L + tip.i * bw + bw / 2) / W) * 100}%` }}><b>{tip.d.n}</b> {t("nouveaux", "new")} · {label(tip.d.day)}</div>}
    </div>
  );
}

SECTIONS[""] = {
  load: ({ perms }) => Promise.all([
    get("/admin/stats"),
    perms.has("reports.read") ? get("/admin/reports?status=open").then(r => r.reports).catch(() => []) : [],
    perms.has("audit.read") ? get("/admin/audit").then(r => r.entries).catch(() => []) : [],
  ]).then(([stats, reports, audit]) => ({ stats, reports, audit })),
  View({ data, perms }) {
    const { stats: s, reports, audit } = data;
    const top = s.badges.filter(b => b.n).slice(0, 5);
    const max = Math.max(1, ...top.map(b => b.n));
    const today = new Intl.DateTimeFormat(LANG, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
    return (
      <>
        <Head title={t("Vue d'ensemble", "Overview")} sub={today[0].toUpperCase() + today.slice(1)}>
          {perms.has("badges.award") && <button className="btn primary" onClick={() => awardDrawer({ perms })}><Icon name="award" />{t("Attribuer un badge", "Award badge")}</button>}
        </Head>
        <section className="kpis" aria-label={t("Chiffres clés", "Key numbers")}>
          <Stat label={t("Membres", "Members")} value={s.users.total.toLocaleString()} sub={`+${s.users.new_7d} ${t("cette semaine", "this week")}`} />
          <Stat label={t("Actifs (30 j)", "Active (30 d)")} value={s.users.active_30d.toLocaleString()} />
          {s.donations && <Stat label={t("Paiements nets", "Net payments")} value={fmtMoney(s.donations.net_cents)} sub={`${s.donations.confirmed} ${t("paiements", "payments")}`} />}
          <Stat label={t("À traiter", "To handle")} value={s.reports_open + s.mods_pending} sub={`${s.reports_open} ${t("signalements", "reports")} · ${s.mods_pending} mods`} />
        </section>
        <div className="panels">
          <section className="panel wide"><header><h2>{t("Nouveaux membres", "New members")}</h2><span className="faint">{t("par jour, 30 jours", "per day, 30 days")}</span></header><SignupChart days={s.signups} /></section>
          <section className="panel"><header><h2>{t("Signalements", "Reports")}</h2><Link className="link" to="/admin/reports">{t("Tout voir", "See all")}</Link></header>
            {reports.length ? <div>{reports.slice(0, 4).map(r => (
              <Link key={r.id} className="site-row" to="/admin/reports"><span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><b style={{ fontWeight: 500 }}>{r.target_label ?? "?"}</b><span className="muted small">{r.reason}</span></span><span className="faint small">{fmtDate(r.created_at)}</span></Link>
            ))}</div> : <Empty icon="circle-check">{t("Rien en attente.", "Nothing waiting.")}</Empty>}
          </section>
        </div>
        <div className="panels">
          <section className="panel"><header><h2>{t("Badges les plus portés", "Most held badges")}</h2><Link className="link" to="/admin/badges">{t("Gérer", "Manage")}</Link></header>
            {top.length ? <div>{top.map(b => (
              <div key={b.key} className="site-row"><span className="badge-mini" style={{ "--c": b.color }}><Icon name={b.icon ?? "award"} /></span><span style={{ flex: 1 }}>{localBadge(b).name}</span>
                <span className="bar" style={{ width: 120 }}><i style={{ width: `${(b.n / max) * 100}%` }} /></span><span className="muted small" style={{ width: 48, textAlign: "right" }}>{b.n.toLocaleString()}</span></div>
            ))}</div> : <Empty icon="award">{t("Aucun badge attribué.", "No badge awarded.")}</Empty>}
          </section>
          <section className="panel"><header><h2>{t("Activité récente", "Recent activity")}</h2>{perms.has("audit.read") && <Link className="link" to="/admin/audit">{t("Journal", "Audit log")}</Link>}</header>
            {audit.length ? <div>{audit.slice(0, 5).map(a => (
              <div key={a.id} className="site-row"><span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{a.actor ?? "Orbit"}</b> <span className="mono muted">{a.action}</span>{a.reason && <span className="muted"> · {a.reason}</span>}</span><span className="faint small">{fmtDateTime(a.created_at)}</span></div>
            ))}</div> : <div>{[["database", t("Base de données", "Database")], ["mail", "E-mail (SMTP)"], ["donations", t("Paiements (Stripe)", "Payments (Stripe)")]].map(([k, l]) => (
              <div key={k} className="site-row"><span style={{ flex: 1 }}>{l}</span><span className={`tag ${s.services[k] ? "ok" : "warn"}`}>{s.services[k] ? t("opérationnel", "running") : t("non configuré", "not configured")}</span></div>
            ))}</div>}
          </section>
        </div>
      </>
    );
  },
};

SECTIONS.users = {
  load: ({ query }) => get(`/admin/users?q=${encodeURIComponent(query.q ?? "")}`),
  View({ data, query }) {
    const navigate = useNavigate();
    const [q, setQ] = useState(query.q ?? "");
    return (
      <>
        <Head title={t("Membres", "Users")}>
          <form className="top-search" style={{ display: "flex", width: 300 }} role="search" onSubmit={e => (e.preventDefault(), navigate(`/admin/users?q=${encodeURIComponent(q.trim())}`, { viewTransition: true }))}>
            <Icon name="search" /><input type="search" placeholder={t("Pseudo, identifiant ou e-mail", "Username, id or e-mail")} aria-label={t("Chercher", "Search")} value={q} onChange={e => setQ(e.target.value)} />
          </form>
        </Head>
        {data.users.length ? (
          <Table cols={[t("Membre", "Member"), t("Rôle", "Role"), t("Statut", "Status"), t("Inscrit", "Joined"), t("Actif", "Active")]}>
            {data.users.map(u => (
              <tr key={u.id}>
                <td><Link className="row" to={`/admin/users/${u.id}`}><Avatar user={u} className="avatar sm" /><span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 500 }}>{u.username}</b>{u.email && <span className="faint small">{u.email}</span>}</span></Link></td>
                <td className="muted">{u.roles.filter(r => r != "user").join(", ") || t("Membre", "Member")}</td>
                <td><Status s={u.status} />{!u.verified && <span className="tag warn" style={{ marginLeft: 6 }}>{t("non vérifié", "unverified")}</span>}</td>
                <td className="muted">{fmtDate(u.created_at)}</td><td className="muted">{fmtDate(u.last_active_at)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty icon="users">{t("Aucun résultat.", "No result.")}</Empty>}
      </>
    );
  },
};

SECTIONS["users/:id"] = {
  load: ({ params, perms }) => Promise.all([
    get(`/admin/users/${params.id}`),
    perms.has("badges.award") ? get("/admin/badges").then(r => r.badges) : [],
    get(`/admin/beta/users/${params.id}`).catch(() => null),
  ]).then(([d, badges, beta]) => ({ ...d, allBadges: badges, beta })),
  View({ data: d, perms, id }) {
    const reload = useReload();
    const u = d.user;
    const [note, setNote] = useState("");
    const awardable = d.allBadges.filter(b => b.manual_award && !b.protected && b.status == "active" && (!b.official || perms.has("badges.official")));
    const [badge, setBadge] = useState(awardable[0]?.key ?? "");
    const roleKeys = d.roles.map(r => r.key);
    const suspend = () => openModal(close => <Suspend id={id} close={close} onDone={reload} />);
    return (
      <>
        <Head title={u.username} sub={`${t("Inscrit le", "Joined")} ${fmtDate(u.created_at)}${u.email ? ` · ${u.email}` : ""}`}>
          <Link className="btn" to={`/u/${u.username}`}><Icon name="eye" />{t("Profil public", "Public profile")}</Link>
        </Head>
        <section className="panel stack">
          <div className="row wrap">
            <Status s={u.status} />{u.profile_hidden && <span className="tag err">{t("profil masqué", "profile hidden")}</span>}
            {u.social_suspended_until && new Date(u.social_suspended_until) > new Date() && <span className="tag warn">{t("social suspendu jusqu'au", "social suspended until")} {fmtDate(u.social_suspended_until)}</span>}
            <span className="tag">{d.sessions} session(s)</span>
            <span className={`tag ${u.email_verified_at ? "ok" : "warn"}`}>{u.email_verified_at ? t("e-mail vérifié", "verified e-mail") : t("e-mail non vérifié", "unverified e-mail")}</span>
            {d.beta && <span className={`tag ${d.beta.paid || d.beta.granted ? "ok" : ""}`}>{d.beta.paid ? t("bêta achetée", "beta purchased") : d.beta.granted ? t("bêta offerte", "beta given") : t("pas de bêta", "no beta")}{d.beta.key && ` · ${t("clé", "key")} …${d.beta.key.last4} · ${d.beta.key.devices}/${d.beta.key.max_devices}`}</span>}
          </div>
          <div className="row wrap">
            {perms.has("users.rename") && <button className="btn" onClick={() => openModal(close => <Rename id={id} current={u.username} close={close} onDone={reload} />)}><Icon name="pencil" />{t("Changer le pseudo", "Change username")}</button>}
            {perms.has("users.suspend") && (u.status == "suspended"
              ? <button className="btn" onClick={reasoned(t("Réactiver le compte", "Reactivate the account"), r => post(`/admin/users/${id}/unsuspend`, { reason: r }), reload)}>{t("Réactiver", "Reactivate")}</button>
              : <button className="btn danger" onClick={suspend}><Icon name="ban" />{t("Suspendre", "Suspend")}</button>)}
            {perms.has("users.sessions") && <>
              <button className="btn" onClick={reasoned(t("Déconnecter toutes ses sessions", "Sign out all sessions"), r => post(`/admin/users/${id}/revoke-sessions`, { reason: r }), reload)}>{t("Révoquer les sessions", "Revoke sessions")}</button>
              <button className="btn" onClick={reasoned(t("Réinitialiser la validation en deux étapes (identité vérifiée)", "Reset two-step verification (identity checked)"), r => post(`/admin/users/${id}/reset-mfa`, { reason: r }), reload)}>{t("Réinitialiser la 2FA", "Reset 2FA")}</button>
            </>}
            {perms.has("moderation.act") && <>
              <button className="btn" onClick={reasoned(u.profile_hidden ? t("Rendre le profil visible", "Unhide profile") : t("Masquer le profil", "Hide profile"), r => post("/admin/moderation", { user_id: id, action: u.profile_hidden ? "unhide_profile" : "hide_profile", reason: r }), reload)}>{u.profile_hidden ? t("Rendre visible", "Unhide") : t("Masquer le profil", "Hide profile")}</button>
              <button className="btn" onClick={reasoned(t("Avertir", "Warn"), r => post("/admin/moderation", { user_id: id, action: "warn", reason: r }), reload)}>{t("Avertir", "Warn")}</button>
              <button className="btn" onClick={reasoned(t("Suspendre les fonctions communautaires 7 jours", "Suspend community features for 7 days"), r => post("/admin/moderation", { user_id: id, action: "suspend_social", reason: r, until: new Date(Date.now() + 7 * 864e5).toISOString() }), reload)}>{t("Suspendre le social (7 j)", "Suspend social (7 d)")}</button>
            </>}
            {perms.has("beta.grant") && d.beta && !d.beta.paid && (d.beta.granted
              ? <button className="btn" onClick={reasoned(t("Retirer l'accès bêta", "Remove beta access"), r => post(`/admin/beta/users/${id}`, { action: "revoke", reason: r }), reload)}>{t("Retirer la bêta", "Remove beta")}</button>
              : <button className="btn" onClick={reasoned(t("Offrir l'accès bêta", "Give beta access"), r => post(`/admin/beta/users/${id}`, { action: "grant", reason: r }), reload)}><Icon name="download" />{t("Offrir la bêta", "Give beta")}</button>)}
          </div>
        </section>
        <section className="panel stack"><h2>{t("Rôles", "Roles")}</h2>
          <div className="chips">{d.roles.map(r => <span key={r.key} className="chip">{r.key}</span>)}</div>
          <div className="row wrap">{[["moderator", "roles.moderators", t("Modérateur", "Moderator")], ["administrator", "roles.administrators", t("Administrateur", "Administrator")]].filter(([, p]) => perms.has(p)).map(([role, , label]) => {
            const has = roleKeys.includes(role);
            return <button key={role} className={`btn small ${has ? "danger" : ""}`} onClick={reasoned(`${has ? t("Retirer", "Remove") : t("Donner", "Grant")} : ${label}`, r => post(`/admin/users/${id}/roles`, { role, action: has ? "revoke" : "grant", reason: r }), reload)}>{has ? `− ${label}` : `+ ${label}`}</button>;
          })}</div>
        </section>
        <section className="panel stack"><h2>Badges</h2>
          {d.badges.length ? <Table cols={["Badge", "Source", "Date", t("État", "State"), ""]}>{d.badges.map((b, i) => (
            <tr key={i}><td>{localBadge(b).name}</td><td className="muted">{b.source}</td><td className="muted">{fmtDate(b.awarded_at)}</td>
              <td>{b.revoked_at ? <span className="tag">{t("retiré", "removed")} : {b.revoke_reason ?? ""}</span> : <span className="tag ok">{t("actif", "active")}</span>}</td>
              <td style={{ textAlign: "right" }}>{!b.revoked_at && perms.has("badges.award") && b.source == "manual" && <button className="btn small quiet danger" onClick={reasoned(`${t("Retirer", "Remove")} ${b.name}`, r => post(`/admin/users/${id}/badges`, { badge: b.key, action: "revoke", reason: r }), reload)}>{t("Retirer", "Remove")}</button>}</td></tr>
          ))}</Table> : <p className="muted">{t("Aucun badge.", "No badge.")}</p>}
          {perms.has("badges.award") && awardable.length > 0 && (
            <div className="row">
              <select className="input" style={{ maxWidth: 260 }} aria-label="Badge" value={badge} onChange={e => setBadge(e.target.value)}>{awardable.map(b => <option key={b.key} value={b.key}>{localBadge(b).name}</option>)}</select>
              <button className="btn primary" onClick={reasoned(t("Attribuer le badge", "Award the badge"), r => post(`/admin/users/${id}/badges`, { badge, action: "award", reason: r }), reload)}><Icon name="award" />{t("Attribuer", "Award")}</button>
            </div>
          )}
        </section>
        {d.reports.length > 0 && <section className="stack"><h2>{t("Signalements le concernant", "Reports about this user")}</h2>
          <Table cols={[t("Motif", "Reason"), t("Détails", "Details"), t("Statut", "Status"), "Date"]}>{d.reports.map(r => <tr key={r.id}><td>{r.reason}</td><td className="muted">{r.details ?? ""}</td><td><Status s={r.status} /></td><td className="muted">{fmtDate(r.created_at)}</td></tr>)}</Table></section>}
        {d.moderation.length > 0 && <section className="stack"><h2>{t("Modération", "Moderation")}</h2>
          <Table cols={["Action", t("Motif", "Reason"), t("Contestation", "Appeal"), "Date"]}>{d.moderation.map(m => <tr key={m.id}><td>{m.action}</td><td>{m.reason}</td><td className="muted">{m.appeal_status ?? ""}</td><td className="muted">{fmtDate(m.created_at)}</td></tr>)}</Table></section>}
        {d.notes && <section className="panel stack"><h2>{t("Notes internes", "Internal notes")}</h2>
          {d.notes.map(n => <div key={n.id} className="alert" style={{ flexDirection: "column", alignItems: "flex-start" }}><div>{n.body}</div><div className="faint small">{n.author ?? "?"} · {fmtDateTime(n.created_at)}</div></div>)}
          <textarea className="input" maxLength={2000} placeholder={t("Note interne (visible par l'équipe uniquement)", "Internal note (team only)")} value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn" style={{ width: "fit-content" }} disabled={!note.trim()} onClick={async () => (await act(() => post(`/admin/users/${id}/notes`, { body: note }))) && (setNote(""), reload())}>{t("Ajouter la note", "Add note")}</button>
        </section>}
        {d.history && <section className="stack"><h2>{t("Historique administratif", "Admin history")}</h2>
          <Table cols={["Action", t("Par", "By"), t("Motif", "Reason"), "Date"]}>{d.history.map((a, i) => <tr key={i}><td className="mono">{a.action}</td><td>{a.actor ?? ""}</td><td className="muted">{a.reason ?? ""}</td><td className="muted">{fmtDateTime(a.created_at)}</td></tr>)}</Table></section>}
      </>
    );
  },
};

function Rename({ id, current, close, onDone }) {
  const [username, setUsername] = useState(current);
  const [reason, setReason] = useState("");
  const [busy, run] = useBusy();
  return (
    <>
      <h2>{t("Changer le pseudo", "Change username")}</h2>
      <p>{t(`Le membre garde son compte ; seul son @ change. Il est prévenu.`, `The member keeps their account; only their @ changes. They get notified.`)}</p>
      <Field label={t("Nouveau pseudo", "New username")} hint={t("3 à 24 caractères : lettres, chiffres, _ . -", "3 to 24 characters: letters, digits, _ . -")}>
        <input className="input" maxLength={24} spellCheck="false" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
      </Field>
      <Field label={t("Motif", "Reason")}><input className="input" maxLength={500} placeholder={t("Visible dans le journal", "Kept in the audit log")} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn primary" disabled={busy || username == current || reason.trim().length < 3} onClick={async () => {
          if (await run(() => post(`/admin/users/${id}/username`, { username, reason }), { ok: t("Pseudo changé", "Username changed") })) {
            close();
            onDone();
          }
        }}>{t("Changer", "Change")}</button>
      </div>
    </>
  );
}

function Suspend({ id, close, onDone }) {
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, run] = useBusy();
  return (
    <>
      <h2>{t("Suspendre le compte", "Suspend the account")}</h2>
      <Field label={t("Jusqu'au (vide = indéfiniment)", "Until (empty = indefinitely)")}><input className="input" type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} /></Field>
      <Field label={t("Motif", "Reason")}><textarea className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn danger solid" disabled={busy || reason.trim().length < 3} onClick={async () => {
          if (await run(() => post(`/admin/users/${id}/suspend`, { reason, until: until ? new Date(until).toISOString() : null }), { ok: t("Compte suspendu", "Account suspended") })) {
            close();
            onDone();
          }
        }}>{t("Suspendre", "Suspend")}</button>
      </div>
    </>
  );
}

function AwardForm({ perms, badge, member, close, onDone }) {
  const [all, setAll] = useState(null);
  const [key, setKey] = useState(badge ?? "");
  const [picked, setPicked] = useState(member ? [member] : []);
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get("/admin/badges").then(r => {
      const usable = r.badges.filter(b => b.manual_award && !b.protected && b.status == "active" && (!b.official || perms.has("badges.official")));
      setAll(usable);
      setKey(k => k || usable[0]?.key || "");
    });
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) return setFound(null);
    const id = setTimeout(() => get(`/admin/users?q=${encodeURIComponent(q.trim())}`).then(r => setFound(r.users)).catch(() => setFound([])), 250);
    return () => clearTimeout(id);
  }, [q]);
  const go = async () => {
    if (reason.trim().length < 3) return toast(t("Indique un motif.", "Add a reason."));
    setBusy(true);
    let ok = 0;
    const failed = [];
    for (const u of picked) {
      try {
        await post(`/admin/users/${u.id}/badges`, { badge: key, action: "award", reason: reason.trim() });
        ok++;
      } catch (e) {
        failed.push(`${u.username}: ${e.code}`);
      }
    }
    setBusy(false);
    toast(failed.length ? `${ok} ✓ · ${failed.join(", ")}` : t(`Badge attribué (${ok})`, `Badge awarded (${ok})`), failed.length ? "" : "ok");
    close();
    onDone?.();
  };
  if (!all) return <div className="spinner" />;
  return (
    <>
      <Field label="Badge"><select className="input" value={key} onChange={e => setKey(e.target.value)}>{all.map(b => <option key={b.key} value={b.key}>{localBadge(b).name}</option>)}</select></Field>
      <div className="field"><label>{t("Membres", "Members")}</label>
        <input className="input" placeholder={t("Pseudo ou e-mail", "Username or e-mail")} aria-label={t("Chercher un membre", "Search a member")} value={q} onChange={e => setQ(e.target.value)} />
        {found && (found.length ? <div className="pick-list">{found.slice(0, 6).map(u => (
          <button key={u.id} type="button" onClick={() => (setPicked(p => (p.some(x => x.id == u.id) ? p : [...p, u])), setQ(""))}><Avatar user={u} className="avatar sm" /><span style={{ flex: 1 }}>{u.username}</span><span className="faint small">{u.email ?? ""}</span></button>
        ))}</div> : <p className="faint small">{t("Aucun membre.", "No member.")}</p>)}
        <div className="chips">{picked.map(u => <span key={u.id} className="chip">{u.username}<button type="button" aria-label={`${t("Retirer", "Remove")} ${u.username}`} onClick={() => setPicked(picked.filter(x => x.id != u.id))}><Icon name="x" /></button></span>)}</div>
      </div>
      <Field label={t("Motif", "Reason")} hint={t("Gardé dans le journal d'audit. Les membres ne le voient pas.", "Kept in the audit log. Members don't see it.")}><textarea className="input" rows={3} placeholder={t("Pourquoi ce badge ?", "Why this badge?")} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="row" style={{ justifyContent: "flex-end", paddingTop: 8 }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn primary" disabled={!picked.length || busy} onClick={go}>{picked.length > 1 ? t(`Attribuer à ${picked.length} membres`, `Award to ${picked.length} members`) : t("Attribuer", "Award")}</button>
      </div>
    </>
  );
}

const awardDrawer = ({ perms, badge, member, onDone }) => openDrawer(t("Attribuer un badge", "Award badge"), close => <AwardForm {...{ perms, badge, member, close, onDone }} />);

const ICONS = ["award", "star", "heart", "rocket", "shield-check", "code", "sparkles", "flask-conical", "bug", "gem", "crown", "flame", "globe", "users", "zap", "palette", "git-branch", "infinity", "calendar-heart", "compass", "book-open", "circle-check", "languages", "bot"];
const COLORS = ["#c4b5ff", "#7fd1ff", "#3dd68c", "#f5c518", "#f5b841", "#ff8da5", "#ff7a85", "#c9ccd8"];
const CATEGORIES = ["official", "support", "community", "seniority", "event", "contribution", "creator", "beta", "trust", "special"];

function BadgeForm({ b, close, onDone }) {
  const isNew = !b;
  const [v, setV] = useState({ key: "", name: "", description: "", icon: "award", category_key: "community", rarity: "common", color: "#c4b5ff", public: true, manual_award: true, permanent: true, duration_days: null, condition: "", status: "active", ...(b ?? {}) });
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [busy, run] = useBusy();
  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));
  const setName = name => setV(prev => ({ ...prev, name, ...(keyTouched ? {} : { key: name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) }) }));
  const save = async () => {
    const body = { name: v.name, description: v.description, icon: v.icon, category_key: v.category_key, rarity: v.rarity, color: v.color, public: v.public,
      manual_award: v.manual_award, permanent: v.permanent, duration_days: v.permanent ? null : Number(v.duration_days) || null, condition: v.condition };
    if (await run(() => (isNew ? post("/admin/badges", { key: v.key, ...body }) : patch(`/admin/badges/${b.key}`, { ...body, status: v.status })), { ok: isNew ? t("Badge créé", "Badge created") : t("Badge enregistré", "Badge saved") })) {
      close();
      onDone();
    }
  };
  return (
    <>
      <div className="file-row">
        <span className="medal xl" style={{ "--c": v.color, width: 48, height: 48, borderRadius: 12 }}><Icon name={v.icon} style={{ width: 24, height: 24 }} /></span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b>{v.name || t("Nom du badge", "Badge name")}</b><span className="muted small">{v.description || RARITY[v.rarity]}</span></span>
        <span className="faint small">{t("Aperçu", "Preview")}</span>
      </div>
      <Field label={t("Nom", "Name")}><input className="input" maxLength={40} value={v.name} onChange={e => setName(e.target.value)} /></Field>
      <Field label={t("Identifiant", "Key")} hint={t("Minuscules, chiffres et _. Ne change plus ensuite.", "Lowercase letters, digits and _. Cannot change later.")}>
        <input className="input mono" pattern="[a-z0-9_]{2,40}" disabled={!isNew} value={v.key} onChange={e => (setKeyTouched(true), set("key", e.target.value))} />
      </Field>
      <Field label="Description"><textarea className="input" rows={2} maxLength={200} value={v.description} onChange={e => set("description", e.target.value)} /></Field>
      <div className="field"><label>{t("Icône", "Icon")}</label>
        <div className="icon-grid" role="group" aria-label={t("Icône", "Icon")}>{ICONS.map(i => <button key={i} type="button" aria-label={i} aria-pressed={String(i == v.icon)} onClick={() => set("icon", i)}><Icon name={i} /></button>)}</div></div>
      <div className="field"><label>{t("Couleur", "Color")}</label>
        <div className="swatches" role="group" aria-label={t("Couleur", "Color")}>
          {COLORS.map(c => <button key={c} type="button" aria-label={c} aria-pressed={String(c == v.color)} style={{ "--c": c }} onClick={() => set("color", c)} />)}
          <input type="color" aria-label={t("Autre couleur", "Other color")} value={v.color} onChange={e => set("color", e.target.value)} style={{ width: 30, height: 30, padding: 0, border: 0, background: "none" }} />
        </div></div>
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}><Field label={t("Catégorie", "Category")}><select className="input" value={v.category_key} onChange={e => set("category_key", e.target.value)}>{CATEGORIES.map(k => <option key={k} value={k}>{k}</option>)}</select></Field></div>
        <div style={{ flex: 1 }}><Field label={t("Rareté", "Rarity")}><select className="input" value={v.rarity} onChange={e => set("rarity", e.target.value)}>{Object.entries(RARITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
      </div>
      <Field label={t("Comment l'obtenir", "How to earn it")}><textarea className="input" rows={2} maxLength={300} placeholder={t("Affichée sur la page du badge", "Shown on the badge page")} value={v.condition} onChange={e => set("condition", e.target.value)} /></Field>
      <div className="list">
        <SwitchRow title={t("Public", "Public")} desc={t("Visible sur les profils et dans la liste", "Shown on profiles and in the badge list")} checked={v.public} onChange={on => set("public", on)} />
        <SwitchRow title={t("Attribuable à la main", "Awarded by hand")} desc={t("Sinon, seulement par une règle automatique", "Otherwise only by an automatic rule")} checked={v.manual_award} onChange={on => set("manual_award", on)} />
        <SwitchRow title={t("Permanent", "Permanent")} desc={t("Désactivé : expire après un nombre de jours", "Off: expires after a number of days")} checked={v.permanent} onChange={on => set("permanent", on)} />
      </div>
      {!v.permanent && <Field label={t("Durée (jours)", "Duration (days)")}><input className="input" type="number" min={1} max={3650} value={v.duration_days ?? ""} onChange={e => set("duration_days", e.target.value)} /></Field>}
      {!isNew && <Field label={t("État", "State")}><select className="input" value={v.status} onChange={e => set("status", e.target.value)}>{["active", "disabled", "retired"].map(s => <option key={s} value={s}>{s}</option>)}</select></Field>}
      <div className="row" style={{ justifyContent: "flex-end", paddingTop: 8 }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn primary" disabled={busy || !v.name.trim() || !v.key} onClick={save}>{isNew ? t("Créer le badge", "Create badge") : t("Enregistrer", "Save")}</button>
      </div>
    </>
  );
}

const badgeDrawer = (b, onDone) => openDrawer(b ? `${t("Modifier", "Edit")} · ${b.name}` : t("Nouveau badge", "New badge"), close => <BadgeForm b={b} close={close} onDone={onDone} />);

SECTIONS.badges = {
  load: () => get("/admin/badges"),
  View({ data, perms, query }) {
    const reload = useReload();
    const f = query.f ?? "";
    const shown = data.badges.filter(b => !f || (f == "official" ? b.official : f == "inactive" ? b.status != "active" : b.category_key == f));
    const awarded = data.badges.reduce((n, b) => n + (b.holders ?? 0), 0);
    const canAward = b => perms.has("badges.award") && b.manual_award && !b.protected && b.status == "active" && (!b.official || perms.has("badges.official"));
    return (
      <>
        <Head title="Badges" sub={`${data.badges.length} badges · ${awarded.toLocaleString()} ${t("attribués", "awarded")}`}>
          {perms.has("badges.award") && <button className="btn" onClick={() => awardDrawer({ perms, onDone: reload })}><Icon name="award" />{t("Attribuer", "Award badge")}</button>}
          {perms.has("badges.manage") && <button className="btn primary" onClick={() => badgeDrawer(null, reload)}><Icon name="plus" />{t("Nouveau badge", "New badge")}</button>}
        </Head>
        <div className="tabs">{[["", t("Tous", "All")], ["official", t("Officiels", "Official")], ["support", t("Soutien", "Supporter")], ["community", t("Communauté", "Community")], ["inactive", t("Inactifs", "Inactive")]]
          .map(([k, l]) => <Link key={k} to={k ? `/admin/badges?f=${k}` : "/admin/badges"} aria-current={k == f ? "page" : undefined}>{l}</Link>)}</div>
        <Table cols={["Badge", t("Rareté", "Rarity"), t("Attribution", "Awarded by"), t("Détenteurs", "Holders"), t("État", "State"), ""]}>
          {shown.map(b => (
            <tr key={b.key}>
              <td><Link className="row" to={`/admin/badges/${b.key}`}><span className="badge-mini" style={{ "--c": b.color, width: 34, height: 34, borderRadius: 9 }}><Icon name={b.icon} /></span>
                <span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 500 }}>{localBadge(b).name}</b><span className="faint small mono">{b.key}</span></span></Link></td>
              <td className="muted">{RARITY[b.rarity]}</td>
              <td className="muted">{b.rules?.length ? t("Règle", "Rule") : b.manual_award ? t("À la main", "By hand") : t("Rôle / événement", "Role / event")}</td>
              <td>{(b.holders ?? 0).toLocaleString()}</td>
              <td>{b.official ? <span className="dot" style={{ "--c": "#f5c518" }}>{t("officiel", "official")}</span> : <Status s={b.status} />}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {canAward(b) && <button className="btn small quiet" style={{ color: "var(--lav)" }} onClick={() => awardDrawer({ perms, badge: b.key, onDone: reload })}>{t("Attribuer", "Award")}</button>}
                {perms.has("badges.manage") && !b.protected && <button className="btn small quiet" onClick={() => badgeDrawer(b, reload)}>{t("Modifier", "Edit")}</button>}
              </td>
            </tr>
          ))}
        </Table>
      </>
    );
  },
};

SECTIONS["badges/:id"] = {
  load: ({ params }) => Promise.all([get("/admin/badges"), get(`/admin/badges/${params.id}/holders`)]).then(([a, h]) => ({ badge: a.badges.find(x => x.key == params.id), ...h })),
  View({ data, perms }) {
    const reload = useReload();
    const b = data.badge;
    if (!b) return <Empty icon="award">{t("Badge introuvable.", "Badge not found.")}</Empty>;
    return (
      <>
        <Head title={localBadge(b).name} sub={localBadge(b).description}>
          <Link className="btn" to={`/badges/${b.key}`}><Icon name="eye" />{t("Page publique", "Public page")}</Link>
          {perms.has("badges.manage") && !b.protected && <button className="btn" onClick={() => badgeDrawer(b, reload)}><Icon name="pencil" />{t("Modifier", "Edit")}</button>}
          {perms.has("badges.award") && b.manual_award && !b.protected && <button className="btn primary" onClick={() => awardDrawer({ perms, badge: b.key, onDone: reload })}><Icon name="award" />{t("Attribuer", "Award")}</button>}
        </Head>
        <section className="panel stack"><h2>{t("Règles", "Rules")}</h2>
          {b.rules?.length ? <div className="chips">{b.rules.map((r, i) => <span key={i} className="chip mono">{r.type} {JSON.stringify(r.params)}</span>)}</div> : <p className="muted">{t("Attribution manuelle ou par événement.", "Manual or event award.")}</p>}</section>
        <section className="stack"><h2>{t("Détenteurs", "Holders")} <span className="faint">· {data.holders.length}</span></h2>
          {data.holders.length ? <Table cols={[t("Membre", "Member"), "Source", "Date"]}>{data.holders.map(x => <tr key={x.user_id}><td><Link className="link" to={`/admin/users/${x.user_id}`}>{x.username}</Link></td><td className="muted">{x.source}</td><td className="muted">{fmtDate(x.awarded_at)}</td></tr>)}</Table> : <p className="muted">—</p>}</section>
        <section className="stack"><h2>{t("Historique", "History")}</h2>
          {data.history.length ? <Table cols={["Action", t("Membre", "Member"), t("Par", "By"), t("Motif", "Reason"), "Date"]}>{data.history.map((e, i) => <tr key={i}><td>{e.action}</td><td>{e.username ?? ""}</td><td className="muted">{e.actor ?? e.source}</td><td className="muted">{e.reason ?? ""}</td><td className="muted">{fmtDateTime(e.created_at)}</td></tr>)}</Table> : <p className="muted">—</p>}</section>
      </>
    );
  },
};

function Review({ id, close, onDone }) {
  const [v, setV] = useState(null);
  const [showing, setShowing] = useState("orbit");
  const [note, setNote] = useState("");
  const [busy, run] = useBusy();
  useEffect(() => void get(`/admin/mods/versions/${id}`).then(setV), [id]);
  if (!v) return <div className="spinner" />;
  const files = v.files ?? {};
  const checks = v.checks ?? {};
  const Row = ({ icon, color, title, body }) => <div className="check-row" style={{ "--c": color }}><Icon name={icon} /><div><b>{title}</b>{body && <span>{body}</span>}</div></div>;
  const decide = action => async () => {
    if (await run(() => post(`/admin/mods/versions/${id}/review`, { action, note: note.trim() || undefined }), { ok: action == "approve" ? t("Mod publié", "Mod listed") : t("Mod refusé", "Mod rejected") })) {
      close();
      onDone();
    }
  };
  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <b style={{ fontSize: 20, fontWeight: 600 }}>{v.name}</b>
        <span className="muted small">@{v.username} · {v.source == "zen" ? t("import Zen", "Zen import") : t("envoi", "upload")} · version {v.version}</span>
        {v.summary && <p className="muted small">{v.summary}</p>}
      </div>
      {v.images?.length > 0 && <section className="stack" style={{ gap: 8 }}><h3 className="section-title">{t("Captures", "Screenshots")}</h3>
        <div className="shots">{v.images.map(src => <a key={src} className="shot-item" href={src} target="_blank" rel="noopener" style={{ backgroundImage: `url("${src}")` }} aria-label={t("Ouvrir l'image", "Open picture")} />)}</div></section>}
      <section><h3 className="section-title">{t("Contrôles", "Checks")}</h3>
        <Row icon="circle-check" color="var(--ok)" title={t("Fichiers", "Files")} body={Object.keys(files).join(", ")} />
        <Row icon="circle-check" color="var(--ok)" title={t("Aucun contenu distant", "No remote content")} body={t("Pas de url() vers Internet, pas de @import", "No url() to the internet, no @import")} />
        {checks.zen && checks.conversion && <Row icon="refresh-cw" color="var(--lav)" title={t("Converti depuis Zen", "Converted from Zen")} body={`${checks.conversion.selectors} ${t("sélecteurs", "selectors")}, ${checks.conversion.variables} variables`} />}
        {(checks.warnings ?? []).slice(0, 12).map((w, i) => <Row key={i} icon="circle-alert" color="var(--warn)" title={w.code} body={[w.file, w.detail].filter(Boolean).join(" · ")} />)}
      </section>
      <section className="stack" style={{ gap: 8 }}><h3 className="section-title">chrome.css</h3>
        {v.original_css && <div className="seg" style={{ width: "fit-content" }}>
          <button type="button" aria-pressed={String(showing == "orbit")} onClick={() => setShowing("orbit")}>{t("Version Orbit", "Orbit version")}</button>
          <button type="button" aria-pressed={String(showing == "original")} onClick={() => setShowing("original")}>{t("Original (Zen)", "Original (Zen)")}</button>
        </div>}
        <pre className="code">{showing == "orbit" ? files["chrome.css"] : v.original_css}</pre></section>
      {files["preferences.json"] && <section className="stack" style={{ gap: 8 }}><h3 className="section-title">preferences.json</h3><pre className="code">{files["preferences.json"]}</pre></section>}
      {files["readme.md"] && <section className="stack" style={{ gap: 8 }}><h3 className="section-title">readme.md</h3><pre className="code">{files["readme.md"]}</pre></section>}
      {v.status == "pending" ? (
        <>
          <Field label={t("Note à l'auteur", "Note to the author")}><textarea className="input" rows={2} maxLength={1000} placeholder={t("Obligatoire pour refuser", "Required when rejecting")} value={note} onChange={e => setNote(e.target.value)} /></Field>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn danger" disabled={busy} onClick={decide("reject")}>{t("Refuser", "Reject")}</button>
            <button className="btn primary" disabled={busy} onClick={decide("approve")}>{t("Approuver et publier", "Approve and list")}</button>
          </div>
        </>
      ) : <p className="muted small">{v.status}{v.review_note && ` · ${v.review_note}`}</p>}
    </>
  );
}

SECTIONS.mods = {
  load: ({ query }) => get(`/admin/mods?status=${query.status ?? "pending"}`).then(r => ({ ...r, status: query.status ?? "pending" })),
  View({ data }) {
    const reload = useReload();
    const { versions, pending, status } = data;
    return (
      <>
        <Head title="Mods" sub={`${pending} ${t("en attente de vérification", "waiting for review")}`}><Link className="btn" to="/mods"><Icon name="external-link" />{t("Voir la boutique", "Open the store")}</Link></Head>
        <div className="tabs">{[["pending", `${t("À vérifier", "To review")} · ${pending}`], ["approved", t("Publiés", "Listed")], ["rejected", t("Refusés", "Rejected")]]
          .map(([k, l]) => <Link key={k} to={`/admin/mods?status=${k}`} aria-current={k == status ? "page" : undefined}>{l}</Link>)}</div>
        {versions.length ? (
          <Table cols={["Mod", "Source", t("Contrôles", "Checks"), status == "pending" ? t("Envoyé", "Sent") : "Date", ""]}>
            {versions.map(v => (
              <tr key={v.id}>
                <td><span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 500 }}>{v.name} {v.version}</b><span className="faint small">@{v.username}</span></span></td>
                <td className="muted">{v.zen ? t("Import Zen", "Zen import") : t("Envoi", "Upload")}</td>
                <td>{v.warnings ? <span className="dot" style={{ "--c": "var(--warn)" }}>{v.warnings} {t("à regarder", "to look at")}</span> : <span className="dot" style={{ "--c": "var(--ok)" }}>{t("Tout est bon", "All checks passed")}</span>}</td>
                <td className="muted">{fmtDate(v.created_at)}</td>
                <td style={{ textAlign: "right" }}><button className="btn small" onClick={() => openDrawer(t("Vérifier le mod", "Review mod"), close => <Review id={v.id} close={close} onDone={reload} />)}>{status == "pending" ? t("Vérifier", "Review") : t("Ouvrir", "Open")}</button></td>
              </tr>
            ))}
          </Table>
        ) : <Empty icon="circle-check">{status == "pending" ? t("Aucun mod en attente.", "No mod waiting.") : t("Rien ici.", "Nothing here.")}</Empty>}
      </>
    );
  },
};

SECTIONS.reports = {
  load: ({ query, perms }) => Promise.all([get(`/admin/reports?status=${query.status ?? "open"}`), perms.has("reports.handle") ? get("/admin/appeals").then(r => r.appeals) : []])
    .then(([r, appeals]) => ({ reports: r.reports, appeals, status: query.status ?? "open" })),
  View({ data, perms }) {
    const reload = useReload();
    const handle = (r, st) => async () => {
      const resolution = st == "reviewing" ? null : await promptDialog({ title: t("Résolution", "Resolution"), label: t("Ce qui a été décidé", "What was decided"), action: t("Valider", "Confirm") });
      if (st != "reviewing" && !resolution) return;
      if (await act(() => post(`/admin/reports/${r.id}`, { status: st, resolution }))) reload();
    };
    const appeal = (a, dec) => async () => {
      const reason = await promptDialog({ title: dec == "accepted" ? t("Accepter la contestation", "Accept the appeal") : t("Refuser la contestation", "Reject the appeal"), label: t("Motif", "Reason"), action: t("Valider", "Confirm") });
      if (reason && (await act(() => post(`/admin/appeals/${a.id}`, { decision: dec, reason })))) reload();
    };
    return (
      <>
        <Head title={t("Signalements", "Reports")} />
        <div className="tabs">{["open", "reviewing", "resolved", "dismissed"].map(s => <Link key={s} to={`/admin/reports?status=${s}`} aria-current={s == data.status ? "page" : undefined}>{s}</Link>)}</div>
        {data.reports.length ? (
          <Table cols={[t("Cible", "Target"), t("Motif", "Reason"), t("Détails", "Details"), t("Par", "By"), "Date", ""]}>
            {data.reports.map(r => (
              <tr key={r.id}>
                <td>{r.target_type == "user" ? <Link className="link" to={perms.has("users.read") ? `/admin/users/${r.target_id}` : `/u/${r.target_label}`}>{r.target_label ?? "?"}</Link>
                  : r.thread_id ? <span className="stack" style={{ gap: 2 }}><span className="label">{r.target_type == "post" ? t("Réponse du forum", "Forum reply") : t("Discussion", "Thread")}</span>
                    <Link className="link" to={`/forum/t/${r.thread_id}${r.target_type == "post" ? `#p-${r.target_id}` : ""}`}>{r.target_label ?? "?"}</Link></span>
                    : <span>Collection : {r.target_label ?? "?"}</span>}</td>
                <td>{r.reason}</td><td className="muted" style={{ maxWidth: 260 }}>{r.details ?? ""}</td><td className="muted">{r.reporter ?? "—"}</td><td className="muted">{fmtDate(r.created_at)}</td>
                <td style={{ textAlign: "right" }}>{perms.has("reports.handle") && ["open", "reviewing"].includes(r.status) ? (
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    {r.status == "open" && <button className="btn small" onClick={handle(r, "reviewing")}>{t("Examiner", "Review")}</button>}
                    <button className="btn small primary" onClick={handle(r, "resolved")}>{t("Résolu", "Resolved")}</button>
                    <button className="btn small" onClick={handle(r, "dismissed")}>{t("Rejeter", "Dismiss")}</button>
                  </div>) : <span className="faint small">{r.resolution ?? ""}</span>}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty icon="flag">{t("Aucun signalement.", "No report.")}</Empty>}
        {data.appeals.length > 0 && <section className="stack"><h2>{t("Contestations en attente", "Pending appeals")}</h2>
          <Table cols={[t("Membre", "Member"), t("Décision", "Decision"), t("Contestation", "Appeal"), ""]}>{data.appeals.map(a => (
            <tr key={a.id}><td>{a.username}</td><td>{a.action} : {a.reason}</td><td className="muted">{a.appeal_text}</td>
              <td><div className="row"><button className="btn small primary" onClick={appeal(a, "accepted")}>{t("Accepter", "Accept")}</button><button className="btn small" onClick={appeal(a, "rejected")}>{t("Refuser", "Reject")}</button></div></td></tr>
          ))}</Table></section>}
      </>
    );
  },
};

SECTIONS.payments = {
  load: ({ query, perms }) => Promise.all([get(`/admin/donations${query.status ? `?status=${query.status}` : ""}`), get("/admin/webhooks"), perms.has("donations.settings") ? get("/admin/donations/settings") : null])
    .then(([d, w, settings]) => ({ ...d, events: w.events, settings, status: query.status ?? "" })),
  View({ data, perms }) {
    const reload = useReload();
    const s = data.settings;
    const [amounts, setAmounts] = useState(s ? s.donation_amounts.map(c => c / 100).join(", ") : "");
    const [tiers, setTiers] = useState(s ? Object.fromEntries(s.tiers.map(x => [x.key, x.threshold_cents / 100])) : {});
    const [early, setEarly] = useState(s?.early_supporter_until?.slice(0, 10) ?? "");
    const [busy, run] = useBusy();
    return (
      <>
        <Head title={t("Paiements", "Payments")} sub={t("Dons et accès bêta. Les remboursements se font dans Stripe ; ils arrivent ici par webhook.", "Donations and beta access. Refunds are made in Stripe; they arrive here by webhook.")} />
        <div className="tabs">{[["", t("Tous", "All")], ["succeeded", "succeeded"], ["refunded", "refunded"], ["failed", "failed"], ["disputed", "disputed"]]
          .map(([k, l]) => <Link key={k} to={k ? `/admin/payments?status=${k}` : "/admin/payments"} aria-current={k == data.status ? "page" : undefined}>{l}</Link>)}</div>
        {data.donations.length ? (
          <Table cols={["Date", t("Membre", "Member"), t("Montant", "Amount"), "Type", t("Statut", "Status"), t("Référence", "Reference")]}>
            {data.donations.map(d => (
              <tr key={d.id}><td className="muted">{fmtDateTime(d.created_at)}</td><td>{d.username ?? "—"}</td>
                <td>{fmtMoney(d.amount_cents, d.currency)}{d.refunded_cents > 0 && <span className="faint"> −{fmtMoney(d.refunded_cents, d.currency)}</span>}</td>
                <td className="muted">{d.purpose == "beta" ? t("Bêta", "Beta") : d.recurring ? t("mensuel", "monthly") : t("don", "donation")}</td>
                <td><Status s={d.status} /></td><td className="mono">{d.payment_ref ?? d.invoice_ref ?? d.checkout_ref ?? ""}</td></tr>
            ))}
          </Table>
        ) : <Empty icon="receipt">{t("Aucun paiement.", "No payment.")}</Empty>}
        {data.refunds?.length > 0 && <section className="stack"><h2>{t("Remboursements", "Refunds")}</h2>
          <Table cols={["Date", t("Montant", "Amount"), t("Statut", "Status"), t("Référence", "Reference")]}>{data.refunds.map(r => <tr key={r.provider_refund_id}><td className="muted">{fmtDateTime(r.created_at)}</td><td>{fmtMoney(r.amount_cents)}</td><td>{r.status}</td><td className="mono">{r.provider_refund_id}</td></tr>)}</Table></section>}
        <section className="stack"><h2>{t("Événements Stripe", "Stripe events")}</h2>
          {data.events.length ? <Table cols={[t("Reçu", "Received"), "Type", t("Statut", "Status"), t("Essais", "Attempts"), t("Erreur", "Error"), ""]}>{data.events.map(ev => (
            <tr key={ev.id}><td className="muted">{fmtDateTime(ev.received_at)}</td><td className="mono">{ev.type}</td><td><Status s={ev.status} /></td><td>{ev.attempts}</td><td className="small muted">{ev.error ?? ""}</td>
              <td>{ev.status == "failed" && perms.has("donations.settings") && <button className="btn small" onClick={async () => (await act(() => post(`/admin/webhooks/${ev.id}/retry`), { ok: t("Traité", "Processed") })) && reload()}><Icon name="refresh-cw" />{t("Réessayer", "Retry")}</button>}</td></tr>
          ))}</Table> : <Empty icon="webhook">{t("Aucun événement reçu.", "No event received.")}</Empty>}</section>
        {s && (
          <form className="panel stack" onSubmit={async e => {
            e.preventDefault();
            await run(() => put("/admin/donations/settings", {
              donation_amounts: amounts.split(",").map(x => Math.round(Number(x.trim()) * 100)).filter(Boolean),
              tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, Math.round(Number(v) * 100)])),
              early_supporter_until: early ? new Date(`${early}T23:59:59Z`).toISOString() : null,
            }), { ok: t("Réglages enregistrés", "Settings saved") });
          }}>
            <h2>{t("Réglages des dons", "Donation settings")}</h2>
            <Field label={t("Montants suggérés (€, séparés par des virgules)", "Suggested amounts (€, comma-separated)")}><input className="input" value={amounts} onChange={e => setAmounts(e.target.value)} /></Field>
            <div className="grid cols-4">{Object.entries(tiers).map(([k, v]) => <Field key={k} label={`${k} (€)`}><input className="input" type="number" min={1} value={v} onChange={e => setTiers({ ...tiers, [k]: e.target.value })} /></Field>)}</div>
            <Field label={t("Early Supporter : dons confirmés avant le (vide = période close)", "Early Supporter: confirmed donations before (empty = closed)")}><input className="input" type="date" value={early} onChange={e => setEarly(e.target.value)} /></Field>
            <button className="btn primary" type="submit" style={{ width: "fit-content" }} disabled={busy}>{t("Enregistrer", "Save")}</button>
          </form>
        )}
      </>
    );
  },
};

SECTIONS.beta = {
  load: () => Promise.all([get("/admin/beta"), get("/admin/beta/keys")]).then(([s, k]) => ({ ...s, list: k.keys })),
  View({ data, perms }) {
    const reload = useReload();
    const [paywall, setPaywall] = useState(data.paywall);
    const [price, setPrice] = useState(data.price_cents / 100);
    const [busy, run] = useBusy();
    const canEdit = perms.has("settings.manage");
    return (
      <>
        <Head title={t("Bêta", "Beta")} sub={t("Accès au navigateur pendant la bêta. Le personnel a toujours accès.", "Access to the browser during the beta. Staff always have access.")} />
        <section className="kpis">
          <Stat label={t("Accès achetés", "Purchased")} value={data.paid} />
          <Stat label={t("Accès offerts", "Given by hand")} value={data.granted} />
          <Stat label={t("Appareils activés", "Activated devices")} value={data.devices} sub={`${data.keys} ${t("clés actives", "active keys")}`} />
          <Stat label={t("Prix", "Price")} value={fmtMoney(data.price_cents)} sub={data.paywall ? t("bêta payante", "paid beta") : t("gratuit pour tous", "free for everyone")} />
        </section>
        <form className="panel stack" onSubmit={async e => {
          e.preventDefault();
          if (await run(() => put("/admin/beta", { paywall, price_cents: Math.round(Number(price) * 100) }), { ok: t("Réglages enregistrés", "Settings saved") })) reload();
        }}>
          <h2>{t("Réglages", "Settings")}</h2>
          <div className="list">
            <SwitchRow title={t("Bêta payante", "Paid beta")} desc={t("Désactivé : Orbit est gratuit pour tout le monde, plus aucune vérification bloquante.", "Off: Orbit is free for everyone, no blocking check anymore.")} checked={paywall} onChange={setPaywall} disabled={!canEdit} />
          </div>
          <Field label={t("Prix (€)", "Price (€)")}><input className="input" type="number" min={1} max={100} step="0.5" style={{ maxWidth: 160 }} value={price} disabled={!canEdit} onChange={e => setPrice(e.target.value)} /></Field>
          {canEdit && <button className="btn primary" type="submit" style={{ width: "fit-content" }} disabled={busy}>{t("Enregistrer", "Save")}</button>}
          <p className="hint">{t("Pour offrir l'accès à un membre : Membres › son compte › Offrir la bêta. Il reçoit une clé dans son compte.", "To give access to a member: Users › their account › Give beta. They get a key in their account.")}</p>
        </form>
        <section className="stack">
          <div className="row between"><h2>{t("Clés", "Keys")} <span className="faint">· {data.keys}</span></h2>
            {perms.has("beta.grant") && <button className="btn" onClick={() => openModal(close => <MakeKeys close={close} onDone={reload} />)}><Icon name="plus" />{t("Créer des clés", "Create keys")}</button>}</div>
          {data.list.length ? (
            <Table cols={[t("Clé", "Key"), t("Pour", "For"), t("Appareils", "Devices"), t("Créée", "Created"), t("État", "State"), ""]}>
              {data.list.map(k => (
                <tr key={k.id}>
                  <td className="mono">{k.key ?? `…${k.last4}`}</td>
                  <td>{k.username ? <Link className="link" to={`/admin/users/${k.user_id}`}>{k.username}</Link> : <span className="muted">{k.note || t("à distribuer", "to hand out")}</span>}<div className="faint small">{{ payment: t("achat", "purchase"), grant: t("offerte", "given"), manual: t("créée à la main", "made by hand") }[k.source]}</div></td>
                  <td className="muted">{k.devices} / {k.max_devices}</td>
                  <td className="muted">{fmtDate(k.created_at)}</td>
                  <td>{k.revoked_at ? <span className="dot" style={{ "--c": "var(--danger)" }}>{t("révoquée", "revoked")}</span> : <span className="dot" style={{ "--c": "var(--ok)" }}>{t("active", "active")}</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{!k.revoked_at && <>
                    {k.devices > 0 && <button className="btn small quiet" onClick={async () => (await act(() => post(`/admin/beta/keys/${k.id}/reset-devices`), { ok: t("Appareils réinitialisés", "Devices reset") })) && reload()}>{t("Réinitialiser", "Reset devices")}</button>}
                    <button className="btn small quiet danger" onClick={reasoned(t("Révoquer la clé", "Revoke the key"), r => post(`/admin/beta/keys/${k.id}/revoke`, { reason: r }), reload)}>{t("Révoquer", "Revoke")}</button>
                  </>}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty icon="key-round">{t("Aucune clé pour l'instant.", "No key yet.")}</Empty>}
        </section>
      </>
    );
  },
};

function MakeKeys({ close, onDone }) {
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [devices, setDevices] = useState(3);
  const [made, setMade] = useState(null);
  const [busy, run] = useBusy();
  if (made) {
    return (
      <>
        <h2>{t("Clés créées", "Keys created")}</h2>
        <p>{t("Donne-les à qui tu veux. Elles restent visibles ici tant qu'elles ne sont pas révoquées.", "Hand them out as you like. They stay visible here until revoked.")}</p>
        <pre className="code">{made.join("\n")}</pre>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(made.join("\n"))}><Icon name="copy" />{t("Tout copier", "Copy all")}</button>
          <button className="btn primary" onClick={() => (close(), onDone())}>{t("Terminé", "Done")}</button>
        </div>
      </>
    );
  }
  return (
    <>
      <h2>{t("Créer des clés bêta", "Create beta keys")}</h2>
      <p>{t("Pour des testeurs sans compte, un concours, un partenaire…", "For testers without an account, a giveaway, a partner…")}</p>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}><Field label={t("Nombre", "How many")}><input className="input" type="number" min={1} max={50} value={count} onChange={e => setCount(e.target.value)} /></Field></div>
        <div style={{ flex: 1 }}><Field label={t("Appareils par clé", "Devices per key")}><input className="input" type="number" min={1} max={20} value={devices} onChange={e => setDevices(e.target.value)} /></Field></div>
      </div>
      <Field label={t("Note (facultatif)", "Note (optional)")}><input className="input" maxLength={200} placeholder={t("ex. Testeurs Discord", "e.g. Discord testers")} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn primary" disabled={busy} onClick={async () => {
          const r = await run(() => post("/admin/beta/keys", { count: Number(count) || 1, note: note || undefined, max_devices: Number(devices) || 3 }));
          if (r) setMade(r.keys);
        }}>{t("Créer", "Create")}</button>
      </div>
    </>
  );
}

SECTIONS.audit = {
  load: ({ query }) => get(`/admin/audit${query.action ? `?action=${encodeURIComponent(query.action)}` : ""}`),
  View({ data }) {
    return (
      <>
        <Head title={t("Journal d'audit", "Audit log")} sub={t("Lecture seule : la base refuse toute modification ou suppression.", "Read only: the database refuses any change or deletion.")} />
        {data.entries.length ? (
          <Table cols={["Date", t("Acteur", "Actor"), "Action", t("Cible", "Target"), t("Motif", "Reason"), "IP"]}>
            {data.entries.map(a => (
              <tr key={a.id}><td className="muted">{fmtDateTime(a.created_at)}</td><td>{a.actor ?? "—"}</td><td className="mono">{a.action}</td>
                <td className="mono small">{a.target_type ? `${a.target_type}:${(a.target_id ?? "").slice(0, 12)}` : ""}</td><td className="muted">{a.reason ?? ""}</td><td className="mono small">{a.ip ?? ""}</td></tr>
            ))}
          </Table>
        ) : <Empty icon="scroll-text">{t("Journal vide.", "Empty log.")}</Empty>}
      </>
    );
  },
};
