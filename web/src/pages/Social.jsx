import { useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { t, errorText } from "../lib/i18n.js";
import { get, post, patch, del } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { ago, localBadge } from "../lib/format.js";
import { Icon, Link, PersonCard, Empty, PageHead } from "../components/ui.jsx";
import { act } from "../components/overlay.jsx";

export const discoverLoader = () => get("/users/discover");

export function Discover() {
  const d = useLoaderData();
  const blocks = [
    [t("Centres d'intérêt en commun", "Shared interests"), null, d.shared_interests],
    [t("Membres actifs", "Active members"), t("Actifs cette semaine.", "Active this week."), d.active],
    [t("Populaires", "Popular"), t("Les membres qui ont le plus d'amis.", "Members with the most friends."), d.popular],
    [t("Nouveaux membres", "New members"), null, d.recent],
  ].filter(([, , list]) => list.length);
  return (
    <>
      <PageHead title={t("Découvrir", "Discover")} sub={t("Seuls les membres qui ont choisi d'apparaître ici sont affichés.", "Only members who chose to appear here are shown.")} />
      {blocks.length || d.collections.length ? (
        <div className="stack" style={{ gap: 40 }}>
          {blocks.map(([title, sub, list]) => (
            <section key={title} className="stack">
              <div><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>
              <div className="grid cols-3">{list.map(u => <PersonCard key={u.id ?? u.username} user={u} />)}</div>
            </section>
          ))}
          {d.collections.length > 0 && (
            <section className="stack">
              <h2>Collections</h2>
              <div className="list">{d.collections.map(c => (
                <Link key={c.id} className="site-row" to={`/u/${c.username}`}>
                  <Icon name="layers" />
                  <span style={{ flex: 1, display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 500 }}>{c.title}</b>{c.description && <span className="muted small">{c.description}</span>}</span>
                  <span className="faint small">@{c.username} · {c.items} {t("liens", "links")}</span>
                </Link>
              ))}</div>
            </section>
          )}
        </div>
      ) : (
        <Empty icon="compass">{t("Personne ici pour l'instant. Active « Apparaître dans les suggestions » dans ta confidentialité pour être le premier.", "Nobody here yet. Turn on \"Appear in suggestions\" in your privacy settings to be the first.")}</Empty>
      )}
    </>
  );
}

export async function searchLoader({ request }) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return { q, users: null };
  try {
    return { q, users: (await get(`/users/search?q=${encodeURIComponent(q)}`)).users };
  } catch (e) {
    return { q, error: e };
  }
}

export function Search() {
  const { q, users, error } = useLoaderData();
  const navigate = useNavigate();
  const [value, setValue] = useState(q);
  return (
    <div className="stack" style={{ gap: 28 }}>
      <PageHead title={t("Rechercher", "Search")} style={{ marginBottom: 0 }} />
      <form className="row" onSubmit={e => (e.preventDefault(), navigate(`/search?q=${encodeURIComponent(value.trim())}`, { viewTransition: true }))}>
        <input className="input" placeholder={t("Pseudo", "Username")} autoFocus value={value} onChange={e => setValue(e.target.value)} />
        <button className="btn primary" type="submit"><Icon name="search" />{t("Rechercher", "Search")}</button>
      </form>
      {error ? <Empty icon="search">{errorText(error.code)}</Empty>
        : users && (users.length ? <div className="grid cols-3">{users.map(u => <PersonCard key={u.id} user={u} />)}</div> : <Empty icon="search">{t("Aucun membre trouvé.", "No member found.")}</Empty>)}
    </div>
  );
}

export const friendsLoader = () => get("/friends");

export function Friends() {
  const d = useLoaderData();
  const { revalidate } = useRevalidator();
  const answer = (r, verb) => async e => {
    e.preventDefault();
    if (await act(() => post(`/friends/requests/${r.id}/${verb}`))) revalidate();
  };
  return (
    <div className="stack" style={{ gap: 40 }}>
      <PageHead title={t("Amis", "Friends")} style={{ marginBottom: 0 }}><Link className="btn" to="/discover"><Icon name="user-plus" />{t("Trouver des membres", "Find members")}</Link></PageHead>
      {d.incoming.length > 0 && (
        <section className="stack"><h2>{t("Demandes reçues", "Requests received")}</h2>
          <div className="grid cols-2">{d.incoming.map(r => <PersonCard key={r.id} user={r.user} extra={
            <span className="row">
              <button className="btn small primary" onClick={answer(r, "accept")}>{t("Accepter", "Accept")}</button>
              <button className="btn small" onClick={answer(r, "decline")}>{t("Refuser", "Decline")}</button>
            </span>} />)}</div>
        </section>
      )}
      <section className="stack"><h2>{t("Mes amis", "My friends")} <span className="faint">· {d.friends.length}</span></h2>
        {d.friends.length ? <div className="grid cols-3">{d.friends.map(u => <PersonCard key={u.id} user={u} />)}</div> : <Empty icon="users">{t("Pas encore d'amis.", "No friends yet.")}</Empty>}
      </section>
      {d.outgoing.length > 0 && (
        <section className="stack"><h2>{t("Demandes envoyées", "Requests sent")}</h2>
          <div className="grid cols-2">{d.outgoing.map(r => <PersonCard key={r.id} user={r.user} extra={<button className="btn small" onClick={answer(r, "cancel")}>{t("Annuler", "Cancel")}</button>} />)}</div>
        </section>
      )}
      {d.blocked.length > 0 && (
        <section className="stack"><h2>{t("Membres bloqués", "Blocked members")}</h2>
          <div className="list">{d.blocked.map(u => (
            <div key={u.id} className="site-row"><span style={{ flex: 1 }}>{u.username}</span>
              <button className="btn small" onClick={async () => (await act(() => del(`/friends/blocks/${u.id}`))) && revalidate()}>{t("Débloquer", "Unblock")}</button></div>
          ))}</div>
        </section>
      )}
    </div>
  );
}

const securityText = what => ({ email_changed: t("Ton adresse e-mail a été changée.", "Your e-mail address was changed."),
  mfa_reset: t("Ta validation en deux étapes a été réinitialisée par l'équipe.", "Your two-step verification was reset by the team.") }[what] ?? what);

const NOTIF = {
  friend_request: n => ["user-plus", t(`@${n.data.username} veut être ton ami.`, `@${n.data.username} wants to be your friend.`), "/friends"],
  friend_accepted: n => ["user-check", t(`@${n.data.username} a accepté ta demande.`, `@${n.data.username} accepted your request.`), `/u/${n.data.username}`],
  badge: n => ["award", t(`Nouveau badge : ${localBadge({ key: n.data.badge, name: n.data.name }).name}`, `New badge: ${n.data.name}`), "/me/badges"],
  support_badge: n => ["heart", t(`Merci ! Badge de soutien : ${localBadge({ key: n.data.badge, name: n.data.name }).name}`, `Thank you! Support badge: ${n.data.name}`), "/me/badges"],
  contribution: () => ["git-branch", t("Ta contribution a été reconnue.", "Your contribution was recognised."), "/me/badges"],
  security: n => ["shield-alert", securityText(n.data.what), "/me/security"],
  report_update: n => ["flag", n.data.status == "resolved" ? t("Ton signalement a été traité. Merci.", "Your report was handled. Thank you.") : t("Ton signalement a été examiné.", "Your report was reviewed."), null],
  moderation: n => ["shield", n.data.appeal ? (n.data.appeal == "accepted" ? t("Ta contestation a été acceptée.", "Your appeal was accepted.") : t("Ta contestation a été refusée.", "Your appeal was rejected."))
    : t(`Décision de modération : ${n.data.reason ?? ""}`, `Moderation decision: ${n.data.reason ?? ""}`), "/me/data"],
  mod_review: n => ["palette", n.data.removed ? t(`Ton mod ${n.data.name} a été retiré : ${n.data.note}`, `Your mod ${n.data.name} was removed: ${n.data.note}`)
    : n.data.approved ? t(`Ton mod ${n.data.name} ${n.data.version} est publié.`, `Your mod ${n.data.name} ${n.data.version} is listed.`)
      : t(`Ton mod ${n.data.name} ${n.data.version} a été refusé : ${n.data.note}`, `Your mod ${n.data.name} ${n.data.version} was rejected: ${n.data.note}`), `/mods/${n.data.mod}`],
  beta_key: () => ["download", t("Ta clé bêta d'Orbit est prête. Entre-la dans l'application.", "Your Orbit beta key is ready. Enter it in the app."), "/me/payments"],
  news: n => ["info", n.data.title ?? t("Actualité d'Orbit", "Orbit news"), null],
};

export async function notificationsLoader() {
  const d = await get("/notifications");
  if (d.notifications.some(n => !n.read_at)) post("/notifications/read", { all: true }).catch(() => {});
  return d;
}

export function Notifications() {
  const d = useLoaderData();
  const [gone, setGone] = useState(new Set());
  const list = d.notifications.filter(n => !gone.has(n.id));
  return (
    <div className="stack" style={{ gap: 28, maxWidth: 760 }}>
      <PageHead title="Notifications" style={{ marginBottom: 0 }}><Link className="btn small" to="/me/notifications"><Icon name="settings" />{t("Préférences", "Preferences")}</Link></PageHead>
      {list.length ? (
        <div className="list">{list.map(n => {
          const [ic, text, to] = (NOTIF[n.type] ?? (() => ["bell", n.type, null]))(n);
          const body = (
            <>
              <span className="row" style={{ flex: 1, opacity: n.read_at ? 0.7 : 1 }}><Icon name={ic} /><span>{text}<div className="faint small">{ago(n.created_at)}</div></span></span>
              <button className="icon-btn" aria-label={t("Supprimer", "Delete")} onClick={async e => {
                e.preventDefault();
                if (await act(() => del(`/notifications/${n.id}`))) setGone(new Set([...gone, n.id]));
              }}><Icon name="x" /></button>
            </>
          );
          return to ? <Link key={n.id} className="site-row" to={to}>{body}</Link> : <div key={n.id} className="site-row">{body}</div>;
        })}</div>
      ) : <Empty icon="bell">{t("Aucune notification.", "No notifications.")}</Empty>}
    </div>
  );
}

export const siteLoader = ({ params }) => get(`/sites/domain/${encodeURIComponent(params.domain)}`);

export function Site() {
  const d = useLoaderData();
  const me = useMe();
  const { revalidate } = useRevalidator();
  if (d.sensitive) return <Empty icon="lock">{t("Ce site est protégé : on n'affiche pas qui le visite.", "This site is protected: we don't show who visits it.")}</Empty>;
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="row" style={{ gap: 16 }}>
          <span className="favicon" style={{ width: 48, height: 48, fontSize: 18 }}>{d.domain[0].toUpperCase()}</span>
          <div><h1>{d.domain}</h1><p>{d.count ? t(`${d.count} membres l'ont partagé`, `${d.count} members shared it`) : t("Pas encore assez de membres pour l'afficher.", "Not enough members yet to show it.")}</p></div>
        </div>
        {me && (d.shared_by_me
          ? <button className="btn" onClick={async () => (await act(() => del(`/sites/shared/${d.domain}`), { ok: t("Retiré de ton profil", "Removed from your profile") })) && revalidate()}><Icon name="check" />{t("Partagé sur mon profil", "Shared on my profile")}</button>
          : <Link className="btn primary" to={`/share?domain=${encodeURIComponent(d.domain)}`}><Icon name="plus" />{t("Partager sur mon profil", "Share on my profile")}</Link>)}
      </div>
      {d.members.length ? <div className="grid cols-3">{d.members.map(u => <PersonCard key={u.id} user={u} />)}</div>
        : <Empty icon="users">{t("Pour protéger chacun, la liste n'apparaît qu'à partir de 3 membres.", "To protect everyone, the list only shows from 3 members.")}</Empty>}
    </div>
  );
}

export function Share() {
  const me = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const domain = (params.get("domain") ?? "").toLowerCase();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = me?.privacy?.share_sites_enabled;
  return (
    <div className="stack" style={{ maxWidth: 480, margin: "24px auto", gap: 20 }}>
      <h1>{t("Partager ce site ?", "Share this site?")}</h1>
      <div className="row"><span className="favicon">{(domain[0] ?? "?").toUpperCase()}</span><b>{domain || "—"}</b></div>
      <p className="muted">{t("Seul le nom du site sera ajouté à ton profil : pas la page, pas ton historique. Tu peux le retirer à tout moment.", "Only the site's name is added to your profile: not the page, not your history. You can remove it any time.")}</p>
      {!enabled && <div className="alert warn"><Icon name="info" />{t("Le partage de sites est désactivé. Le confirmer l'active.", "Site sharing is off. Confirming turns it on.")}</div>}
      <input className="input" maxLength={140} placeholder={t("Pourquoi tu l'aimes (facultatif)", "Why you like it (optional)")} value={note} onChange={e => setNote(e.target.value)} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Link className="btn" to="/">{t("Annuler", "Cancel")}</Link>
        <button className="btn primary" disabled={!domain || busy} onClick={async () => {
          setBusy(true);
          const r = await act(async () => {
            if (!enabled) await patch("/me/privacy", { share_sites_enabled: true });
            return post("/sites/shared", { domain, note: note || null });
          }, { ok: t("Site partagé", "Site shared") });
          setBusy(false);
          if (r) navigate(`/sites/${r.domain ?? domain}`, { viewTransition: true });
        }}>{t("Partager", "Share")}</button>
      </div>
    </div>
  );
}
