import { useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { t, errorText } from "../lib/i18n.js";
import { get, post, patch, del } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { fmtDate, ago, THEME, localBadge } from "../lib/format.js";
import { Icon, Link, Avatar, BadgeCard, Empty } from "../components/ui.jsx";
import { act, confirmDialog, openModal } from "../components/overlay.jsx";
import { useClickAway } from "../components/Shell.jsx";

export async function loader({ params }) {
  try {
    return { profile: await get(`/users/${encodeURIComponent(params.name)}`) };
  } catch (e) {
    return { error: e };
  }
}

export function reportDialog(targetType, targetId) {
  return openModal(close => <Report {...{ targetType, targetId, close }} />);
}

function Report({ targetType, targetId, close }) {
  const reasons = [["spam", "Spam"], ["harassment", t("Harcèlement", "Harassment")], ["impersonation", t("Usurpation d'identité", "Impersonation")],
    ["inappropriate", t("Contenu inapproprié", "Inappropriate content")], ["illegal", t("Contenu illégal", "Illegal content")], ["other", t("Autre", "Other")]];
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  return (
    <>
      <h2>{t("Signaler", "Report")}</h2>
      <p>{t("L'équipe de modération examinera ton signalement. La personne signalée ne saura pas que c'est toi.", "The moderation team will review your report. The reported person won't know it was you.")}</p>
      <select className="input" value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <textarea className="input" maxLength={1000} placeholder={t("Détails (facultatif)", "Details (optional)")} value={details} onChange={e => setDetails(e.target.value)} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn primary" onClick={async () => {
          if (await act(() => post("/reports", { target_type: targetType, target_id: targetId, reason, details: details || null }), { ok: t("Signalement envoyé. Merci.", "Report sent. Thank you.") })) close();
        }}>{t("Envoyer", "Send")}</button>
      </div>
    </>
  );
}

function MoreMenu({ p }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, setOpen);
  const navigate = useNavigate();
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn" style={{ width: 40, padding: 0 }} aria-label={t("Plus d'actions", "More actions")} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="ellipsis" /></button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <button role="menuitem" onClick={() => reportDialog("user", p.id)}><Icon name="flag" />{t("Signaler", "Report")}</button>
          <button role="menuitem" onClick={async () => {
            if (!(await confirmDialog({ title: t(`Bloquer @${p.username} ?`, `Block @${p.username}?`), action: t("Bloquer", "Block"), danger: true,
              text: t("Vous ne pourrez plus vous voir ni interagir. L'amitié et les demandes en cours sont supprimées.", "You won't see or reach each other anymore. Friendship and pending requests are removed.") }))) return;
            if (await act(() => post("/friends/blocks", { user_id: p.id }), { ok: t("Membre bloqué", "Member blocked") })) navigate("/friends", { viewTransition: true });
          }}><Icon name="ban" />{t("Bloquer", "Block")}</button>
        </div>
      )}
    </div>
  );
}

function Relation({ p }) {
  const me = useMe();
  const { revalidate } = useRevalidator();
  if (!me || p.self) return null;
  let main = null;
  if (p.relation == "friend") {
    main = <button className="btn" onClick={async () => {
      if (await confirmDialog({ title: t("Retirer cet ami ?", "Remove this friend?"), action: t("Retirer", "Remove"), danger: true }) && await act(() => del(`/friends/${p.id}`))) revalidate();
    }}><Icon name="user-check" />{t("Ami", "Friend")}</button>;
  } else if (p.relation == "request_received") {
    main = <Link className="btn primary" to="/friends"><Icon name="user-plus" />{t("Répondre à sa demande", "Answer the request")}</Link>;
  } else if (p.relation == "request_sent") {
    main = <button className="btn" disabled><Icon name="clock" />{t("Demande envoyée", "Request sent")}</button>;
  } else if (p.can_request) {
    main = <button className="btn primary" onClick={async () => {
      if (await act(() => post("/friends/requests", { user_id: p.id }), { ok: t("Demande envoyée", "Request sent") })) revalidate();
    }}><Icon name="user-plus" />{t("Ajouter en ami", "Add friend")}</button>;
  }
  return <>{main}<MoreMenu p={p} /></>;
}

function Bio({ p }) {
  const { revalidate } = useRevalidator();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(p.bio ?? "");
  const [busy, setBusy] = useState(false);
  if (!p.self) return p.bio ? <p className="bio">{p.bio}</p> : null;
  if (editing) {
    return (
      <form className="bio-edit" onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const ok = await act(() => patch("/me/profile", { bio: value.trim() || null }), { ok: t("Bio enregistrée", "Bio saved") });
        setBusy(false);
        if (ok) {
          setEditing(false);
          revalidate();
        }
      }}>
        <textarea className="input" rows={3} maxLength={400} aria-label="Bio" placeholder={t("Quelques mots sur toi", "A few words about you")} value={value} onChange={e => setValue(e.target.value)} autoFocus />
        <div className="row">
          <span className="hint">{value.length} / 400</span>
          <div style={{ flex: 1 }} />
          <button className="btn quiet small" type="button" onClick={() => (setEditing(false), setValue(p.bio ?? ""))}>{t("Annuler", "Cancel")}</button>
          <button className="btn primary small" type="submit" disabled={busy}>{t("Enregistrer", "Save")}</button>
        </div>
      </form>
    );
  }
  return (
    <div>
      {p.bio && <p className="bio">{p.bio}</p>}
      <button className="bio-add" type="button" style={p.bio ? { marginTop: 8 } : undefined} onClick={() => setEditing(true)}>
        <Icon name={p.bio ? "pencil" : "plus"} />{p.bio ? t("Modifier la bio", "Edit bio") : t("Ajouter une bio", "Add a bio")}
      </button>
    </div>
  );
}

const TITLES = { badges: "Badges", sites: t("Sites partagés", "Shared sites"), collections: "Collections", interests: t("Centres d'intérêt", "Interests"), links: t("Liens", "Links") };
const ROLE_COLORS = { founder: "#f5c518", administrator: "#ff8d97", moderator: "#7fd1ff", developer: "#c4b5ff", verified: "#3dd68c" };

function Section({ k, p }) {
  const me = useMe();
  const wrap = (content, more) => <section className="p-section"><header><h2>{TITLES[k]}</h2>{more}</header>{content}</section>;
  if (k == "badges" && p.badges?.length) {
    return wrap(<div className="badges-row">{p.badges.map(b => <BadgeCard key={b.award_id} badge={b} to={`/award/${b.award_id}`} />)}</div>,
      <Link className="link small" to="/badges">{t("Tous les badges", "All badges")}</Link>);
  }
  if (k == "sites" && p.sites?.length) {
    return wrap(<div>{p.sites.map(s => (
      <Link key={s.domain} className="site-row" to={`/sites/${s.domain}`}>
        <span className="favicon">{s.domain[0].toUpperCase()}</span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}><b style={{ fontWeight: 500 }}>{s.domain}</b>{s.note && <span className="faint small">{s.note}</span>}</span>
        <Icon name="chevron-right" />
      </Link>
    ))}</div>);
  }
  if (k == "collections" && p.collections?.length) {
    return wrap(<div>{p.collections.map(c => (
      <div key={c.id} className="collection">
        <div className="row between"><h3>{c.title}</h3>{me && !p.self && <button className="icon-btn" aria-label={t("Signaler", "Report")} onClick={() => reportDialog("collection", c.id)}><Icon name="flag" /></button>}</div>
        {c.description && <p className="muted small" style={{ margin: "4px 0 6px" }}>{c.description}</p>}
        <div>{c.items.map(i => (
          <a key={i.url} className="site-row" href={i.url} target="_blank" rel="noopener noreferrer nofollow">
            <Icon name="link" /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title || i.url}</span><Icon name="external-link" />
          </a>
        ))}</div>
      </div>
    ))}</div>);
  }
  if (k == "interests" && p.interests?.length) return wrap(<div className="chips">{p.interests.map(i => <span key={i} className="chip">{i}</span>)}</div>);
  if (k == "links" && p.links?.length) {
    return wrap(<div className="stack" style={{ gap: 8 }}>{p.links.map(l => (
      <a key={l.url} className="link" href={l.url} target="_blank" rel="noopener noreferrer nofollow me">{l.label || new URL(l.url).hostname}</a>
    ))}</div>);
  }
  return null;
}

export default function Profile() {
  const { profile: p, error } = useLoaderData();
  const me = useMe();
  if (error) return <Empty icon="user-x">{error.code == "not_found" ? t("Ce profil n'existe pas ou n'est pas visible.", "This profile doesn't exist or isn't visible.") : errorText(error.code)}</Empty>;
  const color = THEME[p.theme_color] ?? THEME.violet;
  const official = (p.badges ?? []).filter(b => b.official).map(localBadge);
  const counts = [p.friend_count != null && [p.friend_count, t("amis", "friends")], [p.badges?.length ?? 0, "badges"], p.sites?.length && [p.sites.length, t("sites partagés", "shared sites")]].filter(Boolean);
  const order = p.section_order ?? ["badges", "sites", "collections", "interests", "links"];
  const side = ["interests", "links"];
  const mainKeys = order.filter(k => !side.includes(k));
  const sideKeys = order.filter(k => side.includes(k) && p[k]?.length);
  return (
    <div>
      <div className="profile-banner" style={p.banner_url ? { backgroundImage: `url("${p.banner_url}")` } : { "--c": color }} />
      <section className="profile-head" aria-label={t("Profil", "Profile")}>
        <Avatar user={p} className="avatar lg" />
        <div className="names">
          <h1>{p.display_name || p.username}{official.map(b => <span key={b.key} className="role-tag" style={{ "--c": ROLE_COLORS[b.key] ?? b.color }}>{b.name}</span>)}</h1>
          <span className="handle">@{p.username}{p.created_at && ` · ${t("Membre depuis", "Member since")} ${fmtDate(p.created_at)}`}{p.last_active_at && ` · ${t("actif", "active")} ${ago(p.last_active_at)}`}</span>
          {!p.private && <Bio key={p.bio ?? ""} p={p} />}
          {!p.private && <div className="counts">{counts.map(([n, l]) => <span key={l}><b>{n}</b> {l}</span>)}</div>}
        </div>
        <div className="actions">
          {p.self && <Link className="btn" to="/me"><Icon name="pencil" />{t("Modifier le profil", "Edit profile")}</Link>}
          <Relation p={p} />
        </div>
      </section>
      {p.private ? (
        <div style={{ marginTop: 32 }}><Empty icon="lock" action={!me && <Link className="btn small" to="/login">{t("Se connecter", "Sign in")}</Link>}>{t("Ce profil est privé.", "This profile is private.")}</Empty></div>
      ) : (
        <div className="profile-body">
          <div className="main">
            {mainKeys.some(k => p[k]?.length) ? mainKeys.map(k => <Section key={k} k={k} p={p} />) : <Empty icon="compass">{t("Rien à afficher pour l'instant.", "Nothing to show yet.")}</Empty>}
          </div>
          {sideKeys.length > 0 && <aside>{sideKeys.map(k => <Section key={k} k={k} p={p} />)}</aside>}
        </div>
      )}
    </div>
  );
}
