import { useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigate, useParams, useRevalidator } from "react-router";
import { t } from "../lib/i18n.js";
import { api, get, post, patch, put, del } from "../lib/api.js";
import { loadMe, session, setMe } from "../lib/session.js";
import { fmtDate, fmtDateTime, fmtMoney, THEME } from "../lib/format.js";
import { Icon, Link, Avatar, BadgeCard, Empty, Field, SwitchRow, ErrorBox } from "../components/ui.jsx";
import { act, confirmDialog, openModal, toast, useBusy } from "../components/overlay.jsx";
import { BetaKey } from "../components/BetaKey.jsx";

const TABS = () => [
  ["", t("Profil", "Profile")], ["badges", "Badges"], ["sites", t("Sites et collections", "Sites and collections")], ["privacy", t("Confidentialité", "Privacy")],
  ["notifications", "Notifications"], ["security", t("Sécurité", "Security")], ["payments", t("Achats et dons", "Purchases and donations")], ["data", t("Mes données", "My data")],
];

export async function loader({ params }) {
  const me = await loadMe();
  const tab = params.tab ?? "";
  const extra = {
    badges: () => get("/me/badges"),
    sites: () => get("/sites/mine"),
    security: () => get("/me/sessions"),
    payments: () => Promise.all([get("/me/donations"), get("/beta")]).then(([d, beta]) => ({ ...d, beta })),
  }[tab];
  return { me, data: extra ? await extra() : null };
}

const Head = ({ title, sub, children }) => (
  <div className="acc-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children && <div className="row wrap">{children}</div>}</div>
);
const Group = ({ title, children, danger }) => (
  <section className={`acc-group${danger ? " danger" : ""}`}>{title && <h2>{title}</h2>}{children}</section>
);

export default function Account() {
  const { tab = "" } = useParams();
  const { me, data } = useLoaderData();
  const [resent, setResent] = useState(false);
  const Page = PAGES[tab] ?? PAGES[""];
  return (
    <div className="split">
      <nav className="sidenav" aria-label={t("Compte", "Account")}>
        <span className="label">{t("Mon compte", "My account")}</span>
        {TABS().map(([k, label]) => <Link key={k} to={k ? `/me/${k}` : "/me"} aria-current={k == tab ? "page" : undefined}>{label}</Link>)}
      </nav>
      <div className="stack acc" style={{ gap: 40 }}>
        {!me.verified && (
          <div className="alert warn"><Icon name="mail" /><span style={{ flex: 1 }}>{t("Confirme ton adresse e-mail pour ajouter des amis, partager des sites et acheter la bêta.", "Confirm your e-mail to add friends, share sites and buy the beta.")}</span>
            <button className="btn small" disabled={resent} onClick={async () => (await act(() => post("/auth/resend-verification"), { ok: t("Lien envoyé", "Link sent") })) && setResent(true)}>{t("Renvoyer le lien", "Resend link")}</button></div>
        )}
        <Page key={tab} me={me} data={data} />
      </div>
    </div>
  );
}

function ProfileTab({ me }) {
  const { revalidate } = useRevalidator();
  const [display, setDisplay] = useState(me.display_name ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [color, setColor] = useState(me.theme_color);
  const [links, setLinks] = useState(me.links ?? []);
  const [interests, setInterests] = useState(me.interests);
  const [interest, setInterest] = useState("");
  const [order, setOrder] = useState(me.section_order);
  const [error, setError] = useState(null);
  const [busy, run] = useBusy();
  const names = { badges: "Badges", sites: t("Sites partagés", "Shared sites"), collections: "Collections", interests: t("Centres d'intérêt", "Interests"), links: t("Liens", "Links") };
  const move = (i, d) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  const addInterest = e => {
    if (e.key != "Enter" && e.key != ",") return;
    e.preventDefault();
    const v = interest.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (v.length >= 2 && !interests.includes(v) && interests.length < 12) setInterests([...interests, v]);
    setInterest("");
  };
  const save = async e => {
    e.preventDefault();
    setError(null);
    try {
      await patch("/me/profile", { display_name: display || null, bio: bio || null, theme_color: color, links: links.filter(l => l.url.trim()), interests, section_order: order });
      toast(t("Profil enregistré", "Profile saved"), "ok");
      revalidate();
    } catch (x) {
      setError(x);
    }
  };
  return (
    <>
      <Head title={t("Profil", "Profile")} sub={t("Ce que les autres voient sur ta page.", "What others see on your page.")}>
        <Link className="btn" to={`/u/${me.username}`}><Icon name="eye" />{t("Voir mon profil", "View my profile")}</Link>
      </Head>
      <Group title={t("Images", "Pictures")}>
        <div className="row" style={{ gap: 18, padding: "8px 0" }}>
          <Avatar user={me} className="avatar" />
          <Upload kind="avatar" has={me.avatar_media_id} label={t("Changer l'avatar", "Change avatar")} hint={t("PNG, JPEG, WebP ou GIF, 2 Mo max.", "PNG, JPEG, WebP or GIF, 2 MB max.")} onDone={revalidate} />
        </div>
        <div style={{ padding: "8px 0" }}><Upload kind="banner" has={me.banner_media_id} label={t("Changer la bannière", "Change banner")} hint={t("4 Mo max, idéalement 1500 × 400.", "4 MB max, ideally 1500 × 400.")} onDone={revalidate} /></div>
      </Group>
      <form className="stack" style={{ gap: 40 }} onSubmit={save}>
        <Group title={t("Identité", "Identity")}>
          <div className="stack" style={{ gap: 18, paddingTop: 8 }}>
            <Field label={t("Nom affiché (facultatif)", "Display name (optional)")}><input className="input" maxLength={40} value={display} onChange={e => setDisplay(e.target.value)} /></Field>
            <Field label="Bio" hint={`${bio.length} / 400`}><textarea className="input" maxLength={400} value={bio} onChange={e => setBio(e.target.value)} /></Field>
            <div className="field"><label>{t("Couleur du profil", "Profile color")}</label>
              <div className="swatches">{Object.entries(THEME).map(([k, c]) => <button key={k} type="button" aria-label={k} aria-pressed={String(k == color)} style={{ "--c": c }} onClick={() => setColor(k)} />)}</div></div>
          </div>
        </Group>
        <Group title={t("Centres d'intérêt", "Interests")}>
          <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
            <input className="input" maxLength={30} placeholder={t("ex. musique, jeux-video, code", "e.g. music, video-games, code")} aria-label={t("Ajouter un centre d'intérêt", "Add an interest")} value={interest} onChange={e => setInterest(e.target.value)} onKeyDown={addInterest} />
            <span className="hint">{t("Entrée pour ajouter, 12 au maximum.", "Enter to add, 12 at most.")}</span>
            <div className="chips">{interests.map(x => <span key={x} className="chip">{x}<button type="button" aria-label={`${t("Retirer", "Remove")} ${x}`} onClick={() => setInterests(interests.filter(i => i != x))}><Icon name="x" /></button></span>)}</div>
          </div>
        </Group>
        <Group title={t("Liens", "Links")}>
          <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
            {links.map((l, i) => (
              <div key={i} className="row">
                <input className="input" placeholder={t("Libellé", "Label")} maxLength={30} style={{ maxWidth: 160 }} value={l.label ?? ""} onChange={e => setLinks(links.map((x, j) => (j == i ? { ...x, label: e.target.value } : x)))} />
                <input className="input" placeholder="https://…" value={l.url} onChange={e => setLinks(links.map((x, j) => (j == i ? { ...x, url: e.target.value } : x)))} />
                <button type="button" className="icon-btn" aria-label={t("Retirer", "Remove")} onClick={() => setLinks(links.filter((_, j) => j != i))}><Icon name="x" /></button>
              </div>
            ))}
            {links.length < 6 && <button type="button" className="btn small" style={{ width: "fit-content" }} onClick={() => setLinks([...links, { label: "", url: "" }])}><Icon name="plus" />{t("Ajouter un lien", "Add a link")}</button>}
          </div>
        </Group>
        <Group title={t("Ordre des sections", "Section order")}>
          <div className="list">{order.map((k, i) => (
            <div key={k} className="site-row">
              <Icon name="grip-vertical" /><span style={{ flex: 1 }}>{names[k]}</span>
              <button type="button" className="btn small quiet" disabled={i == 0} aria-label={t("Monter", "Move up")} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn small quiet" disabled={i == order.length - 1} aria-label={t("Descendre", "Move down")} onClick={() => move(i, 1)}>↓</button>
            </div>
          ))}</div>
        </Group>
        {error && <ErrorBox error={error} />}
        <div><button className="btn primary" type="submit" disabled={busy}>{t("Enregistrer", "Save")}</button></div>
      </form>
    </>
  );
}

function Upload({ kind, has, label, hint, onDone }) {
  const input = useRef(null);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async e => {
          const file = e.target.files[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("file", file);
          if (await act(() => api("POST", `/me/media/${kind}`, fd), { ok: t("Image mise à jour", "Image updated") })) onDone();
        }} />
        <button type="button" className="btn small" onClick={() => input.current.click()}><Icon name="image-plus" />{label}</button>
        {has && <button type="button" className="btn small danger" onClick={async () => (await act(() => del(`/me/media/${kind}`))) && onDone()}>{t("Retirer", "Remove")}</button>}
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

function BadgesTab({ data }) {
  const [featured, setFeatured] = useState(new Set(data.current.filter(b => b.featured).map(b => b.key)));
  const ACTION = { award: t("obtenu", "earned"), revoke: t("retiré", "removed"), expire: t("expiré", "expired") };
  const toggle = async key => {
    const next = new Set(featured);
    if (next.has(key)) next.delete(key);
    else if (next.size < 3) next.add(key);
    else return toast(t("3 badges maximum en avant.", "3 featured badges at most."));
    if (await act(() => put("/me/featured-badges", { keys: [...next] }))) setFeatured(next);
  };
  return (
    <>
      <Head title="Badges" sub={t("L'étoile met un badge en avant sur ton profil (3 au plus).", "The star features a badge on your profile (3 at most).")}>
        <Link className="btn" to="/badges"><Icon name="award" />{t("Tous les badges", "All badges")}</Link>
      </Head>
      {data.current.length ? (
        <div className="list">{data.current.map(b => (
          <div key={b.key} className="site-row">
            <div style={{ flex: 1, minWidth: 0 }}><BadgeCard badge={b} to={`/award/${b.award_id}`} extra={fmtDate(b.awarded_at)} /></div>
            <button className="icon-btn" aria-pressed={featured.has(b.key)} aria-label={t("Mettre en avant", "Feature")} style={{ color: featured.has(b.key) ? "var(--warn)" : undefined }} onClick={() => toggle(b.key)}><Icon name="star" /></button>
          </div>
        ))}</div>
      ) : <Empty icon="award" action={<Link className="btn small" to="/badges">{t("Voir comment en obtenir", "See how to earn some")}</Link>}>{t("Pas encore de badge.", "No badge yet.")}</Empty>}
      {data.history.length > 0 && (
        <Group title={t("Historique", "History")}>
          <table><thead><tr><th>Badge</th><th>{t("Événement", "Event")}</th><th>Date</th></tr></thead>
            <tbody>{data.history.map((e, i) => <tr key={i}><td>{e.name}</td><td className="muted">{ACTION[e.action] ?? e.action}</td><td className="muted">{fmtDateTime(e.created_at)}</td></tr>)}</tbody></table>
        </Group>
      )}
    </>
  );
}

function SitesTab({ data }) {
  const { revalidate } = useRevalidator();
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const [busy, run] = useBusy();
  return (
    <>
      <Head title={t("Sites et collections", "Sites and collections")} sub={t("Seulement ce que tu choisis de partager. Orbit n'envoie jamais ton historique.", "Only what you choose to share. Orbit never sends your history.")} />
      {!data.sharing_enabled && (
        <div className="alert warn"><Icon name="info" /><span style={{ flex: 1 }}>{t("Le partage de sites est désactivé.", "Site sharing is off.")}</span><Link className="btn small" to="/me/privacy">{t("L'activer", "Turn it on")}</Link></div>
      )}
      <Group title={t("Sites partagés", "Shared sites")}>
        <form className="row wrap" style={{ padding: "8px 0 6px" }} onSubmit={async e => {
          e.preventDefault();
          if (await run(() => post("/sites/shared", { domain, note: note || null }), { ok: t("Site partagé", "Site shared") })) {
            setDomain("");
            setNote("");
            revalidate();
          }
        }}>
          <input className="input" placeholder="example.com" aria-label={t("Domaine", "Domain")} style={{ flex: "1 1 200px" }} value={domain} onChange={e => setDomain(e.target.value)} />
          <input className="input" placeholder={t("Note (facultatif)", "Note (optional)")} aria-label="Note" maxLength={140} style={{ flex: "2 1 240px" }} value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!data.sharing_enabled || busy || !domain}>{t("Partager", "Share")}</button>
        </form>
        <p className="hint" style={{ marginBottom: 8 }}>{t("Juste le domaine (ex. github.com), jamais une page précise. Les sites sensibles (santé, banque, rencontres…) sont refusés.", "Just the domain (e.g. github.com), never a specific page. Sensitive sites (health, banking, dating…) are refused.")}</p>
        {data.sites.length ? (
          <div className="list">{data.sites.map(s => (
            <div key={s.domain} className="site-row">
              <span className="favicon">{s.domain[0].toUpperCase()}</span>
              <Link to={`/sites/${s.domain}`} style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{s.domain}</b>{s.note && <div className="faint small">{s.note}</div>}</Link>
              <button className="btn small quiet danger" onClick={async () => (await act(() => del(`/sites/shared/${s.domain}`))) && revalidate()}>{t("Retirer", "Remove")}</button>
            </div>
          ))}</div>
        ) : <p className="muted small" style={{ padding: "12px 0" }}>{t("Aucun site partagé pour l'instant.", "No shared site yet.")}</p>}
      </Group>
      <Group title="Collections">
        <div className="stack" style={{ gap: 0 }}>
          {data.collections.map(c => <Collection key={c.id} c={c} onDone={revalidate} />)}
          <Collection key="new" onDone={revalidate} />
        </div>
      </Group>
    </>
  );
}

function Collection({ c, onDone }) {
  const isNew = !c;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(c?.title ?? "");
  const [desc, setDesc] = useState(c?.description ?? "");
  const [pub, setPub] = useState(c?.public ?? true);
  const [items, setItems] = useState((c?.items ?? []).map(i => ({ url: i.url, title: i.title ?? "" })));
  const [busy, run] = useBusy();
  if (!open) {
    return (
      <button type="button" className="site-row coll-toggle" onClick={() => setOpen(true)}>
        <Icon name={isNew ? "plus" : "layers"} />
        <span style={{ flex: 1, textAlign: "left" }}>{isNew ? t("Nouvelle collection", "New collection") : <><b style={{ fontWeight: 500 }}>{c.title}</b> <span className="faint small">· {c.items.length} {t("liens", "links")}{!c.public && ` · ${t("privée", "private")}`}</span></>}</span>
        {c?.hidden && <span className="tag err">{t("Masquée par la modération", "Hidden by moderation")}</span>}
        <Icon name="chevron-down" />
      </button>
    );
  }
  return (
    <form className="coll-edit" onSubmit={async e => {
      e.preventDefault();
      const body = { title, description: desc || null, public: pub, items: items.filter(i => i.url.trim()).map(i => ({ url: i.url.trim(), title: i.title || null })) };
      if (await run(() => (isNew ? post("/sites/collections", body) : patch(`/sites/collections/${c.id}`, body)), { ok: t("Collection enregistrée", "Collection saved") })) {
        setOpen(false);
        onDone();
      }
    }}>
      <input className="input" placeholder={t("Titre de la collection", "Collection title")} aria-label={t("Titre", "Title")} maxLength={60} required value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      <input className="input" placeholder={t("Description (facultatif)", "Description (optional)")} aria-label="Description" maxLength={280} value={desc} onChange={e => setDesc(e.target.value)} />
      {items.map((it, i) => (
        <div key={i} className="row">
          <input className="input" placeholder="https://…" aria-label="URL" value={it.url} onChange={e => setItems(items.map((x, j) => (j == i ? { ...x, url: e.target.value } : x)))} />
          <input className="input" placeholder={t("Titre", "Title")} aria-label={t("Titre du lien", "Link title")} maxLength={120} style={{ maxWidth: 200 }} value={it.title} onChange={e => setItems(items.map((x, j) => (j == i ? { ...x, title: e.target.value } : x)))} />
          <button type="button" className="icon-btn" aria-label={t("Retirer", "Remove")} onClick={() => setItems(items.filter((_, j) => j != i))}><Icon name="x" /></button>
        </div>
      ))}
      {items.length < 50 && <button type="button" className="btn small" style={{ width: "fit-content" }} onClick={() => setItems([...items, { url: "", title: "" }])}><Icon name="plus" />{t("Ajouter un lien", "Add a link")}</button>}
      <div className="row between">
        <label className="check"><input type="checkbox" checked={pub} onChange={e => setPub(e.target.checked)} /><span>{t("Publique", "Public")}</span></label>
        <div className="row">
          {!isNew && <button type="button" className="btn small quiet danger" onClick={async () => {
            if (await confirmDialog({ title: t("Supprimer cette collection ?", "Delete this collection?"), action: t("Supprimer", "Delete"), danger: true }) && await act(() => del(`/sites/collections/${c.id}`))) onDone();
          }}>{t("Supprimer", "Delete")}</button>}
          <button type="button" className="btn small" onClick={() => setOpen(false)}>{t("Annuler", "Cancel")}</button>
          <button className="btn small primary" type="submit" disabled={busy}>{isNew ? t("Créer", "Create") : t("Enregistrer", "Save")}</button>
        </div>
      </div>
    </form>
  );
}

function PrivacyTab({ me }) {
  const [p, setP] = useState(me.privacy);
  const set = key => async on => {
    setP({ ...p, [key]: on });
    if (!(await act(() => patch("/me/privacy", { [key]: on })))) setP(prev => ({ ...prev, [key]: !on }));
  };
  const row = (k, title, desc) => <SwitchRow key={k} title={title} desc={desc} checked={p[k]} onChange={set(k)} />;
  return (
    <>
      <Head title={t("Confidentialité", "Privacy")} sub={t("Ce que tu masques ici n'est jamais montré à personne.", "What you hide here is never shown to anyone else.")} />
      <Group title={t("Profil", "Profile")}>
        <div className="list">
          {row("profile_public", t("Profil public", "Public profile"), t("Désactivé : seuls tes amis voient ton profil.", "When off, only your friends can see your profile."))}
          {row("show_badges", t("Afficher mes badges", "Show my badges"))}
          {row("show_activity", t("Afficher ma dernière activité", "Show my last activity"))}
          {row("show_collections", t("Afficher mes collections", "Show my collections"))}
          {row("show_interests", t("Afficher mes centres d'intérêt", "Show my interests"))}
          {row("show_sites", t("Afficher mes sites partagés", "Show my shared sites"))}
          {row("show_friend_count", t("Afficher mon nombre d'amis", "Show my friend count"))}
        </div>
      </Group>
      <Group title={t("Partage et découverte", "Sharing and discovery")}>
        <div className="list">
          {row("allow_friend_requests", t("Accepter les demandes d'amis", "Accept friend requests"))}
          {row("discoverable", t("Apparaître dans les suggestions", "Appear in suggestions"), t("Découverte, membres actifs, centres d'intérêt communs.", "Discover, active members, shared interests."))}
          {row("share_sites_enabled", t("Partage de sites", "Site sharing"), t("Permet de partager un site depuis Orbit, uniquement son nom de domaine. Désactivé : plus aucun envoi.", "Lets you share a site from Orbit, only its domain name. When off, nothing is sent."))}
          {row("social_disabled", t("Désactiver toutes les fonctions sociales", "Turn off all social features"), t("Ton profil devient invisible, plus de demandes ni de suggestions.", "Your profile becomes invisible, no more requests or suggestions."))}
        </div>
      </Group>
      <p className="note-line"><Icon name="shield-check" />{t("Orbit n'envoie jamais ton historique, tes onglets ni tes favoris. Rien n'est envoyé depuis la navigation privée.", "Orbit never sends your history, tabs or bookmarks. Nothing is sent from private windows.")}</p>
    </>
  );
}

function NotificationsTab({ me }) {
  const [prefs, setPrefs] = useState(me.preferences);
  const n = prefs.notify ?? {};
  const save = async (body, undo) => {
    if (!(await act(() => patch("/me/preferences", body)))) setPrefs(undo);
  };
  const types = [["friend_request", t("Demandes d'amis", "Friend requests")], ["friend_accepted", t("Demandes acceptées", "Accepted requests")], ["badge", t("Nouveaux badges", "New badges")],
    ["support_badge", t("Badges de soutien", "Supporter badges")], ["mod_review", t("Vérification de mes mods", "Reviews of my mods")], ["report_update", t("Suivi de mes signalements", "Updates on my reports")],
    ["news", t("Actualités d'Orbit", "Orbit news")]];
  return (
    <>
      <Head title="Notifications" sub={t("Les notifications de sécurité restent toujours actives.", "Security notifications always stay on.")} />
      <Group title={t("Dans Orbit", "In Orbit")}>
        <div className="list">{types.map(([k, label]) => (
          <SwitchRow key={k} title={label} checked={k == "news" ? n[k] === true : n[k] !== false} onChange={on => {
            const prev = prefs;
            const notify = { ...n, [k]: on };
            setPrefs({ ...prefs, notify });
            save({ notify }, prev);
          }} />
        ))}</div>
      </Group>
      <Group title="E-mails">
        <div className="list">
          <SwitchRow title={t("E-mails de sécurité", "Security e-mails")} desc={t("Mot de passe changé, nouvelle connexion avec un code de secours…", "Password changed, sign-in with a recovery code…")} checked={prefs.email_security}
            onChange={on => (setPrefs({ ...prefs, email_security: on }), save({ email_security: on }, prefs))} />
          <SwitchRow title={t("E-mails d'actualités", "News e-mails")} desc={t("Seulement si tu le demandes. Désinscription à tout moment.", "Only if you ask. Unsubscribe any time.")} checked={prefs.email_news}
            onChange={on => (setPrefs({ ...prefs, email_news: on }), save({ email_news: on }, prefs))} />
        </div>
      </Group>
    </>
  );
}

function describeAgent(ua = "") {
  const browser = /Orbit/.test(ua) ? "Orbit" : /Edg\//.test(ua) ? "Edge" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : t("Navigateur", "Browser");
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` · ${os}` : ""}`;
}

function Codes({ codes }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert warn" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <b>{t("Codes de récupération : garde-les en lieu sûr. Chacun ne sert qu'une fois, ils ne seront plus affichés.", "Recovery codes: keep them somewhere safe. Each works once; they won't be shown again.")}</b>
      <div className="codes">{codes.map(c => <span key={c}>{c}</span>)}</div>
      <button className="btn small" style={{ width: "fit-content" }} onClick={() => (navigator.clipboard?.writeText(codes.join("\n")), setCopied(true))}><Icon name="copy" />{copied ? t("Copiés", "Copied") : t("Copier", "Copy")}</button>
    </div>
  );
}

function Mfa({ me }) {
  const [enabled, setEnabled] = useState(me.mfa_enabled);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  if (enabled) {
    return (
      <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
        <div className="row"><span className="tag ok"><Icon name="shield-check" />{t("Activée", "On")}</span></div>
        <div className="row wrap">
          <button className="btn" onClick={async () => { const r = await act(() => post("/me/mfa/recovery-codes")); if (r) setCodes(r.recovery_codes); }}>{t("Nouveaux codes de récupération", "New recovery codes")}</button>
          <button className="btn danger" onClick={async () => {
            if (await confirmDialog({ title: t("Désactiver la validation en deux étapes ?", "Turn off two-step verification?"), action: t("Désactiver", "Turn off"), danger: true }) && await act(() => del("/me/mfa"))) setEnabled(false);
          }}>{t("Désactiver", "Turn off")}</button>
        </div>
        {codes && <Codes codes={codes} />}
      </div>
    );
  }
  if (setup) {
    return (
      <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
        <p>{t("1. Dans ton application, ajoute un compte avec cette clé :", "1. In your app, add an account with this key:")}</p>
        <div className="secret">{setup.secret.match(/.{1,4}/g).join(" ")}</div>
        <a className="link small" href={setup.otpauth}>{t("Ou ouvre directement l'application", "Or open the app directly")}</a>
        <p>{t("2. Entre le code affiché :", "2. Enter the code it shows:")}</p>
        <form className="row" onSubmit={async e => {
          e.preventDefault();
          const r = await act(() => post("/me/mfa/confirm", { code }));
          if (r) {
            setEnabled(true);
            setCodes(r.recovery_codes);
            setSetup(null);
          }
        }}><input className="input" inputMode="numeric" maxLength={6} placeholder="123456" aria-label="Code" style={{ maxWidth: 160 }} value={code} onChange={e => setCode(e.target.value)} />
          <button className="btn primary" type="submit">{t("Activer", "Turn on")}</button></form>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
      <p className="muted">{t("Un code à 6 chiffres d'une application (Aegis, 2FAS, Google Authenticator…) en plus de ton mot de passe.", "A 6-digit code from an app (Aegis, 2FAS, Google Authenticator…) on top of your password.")}</p>
      <button className="btn" style={{ width: "fit-content" }} onClick={async () => { const s = await act(() => post("/me/mfa/setup")); if (s) setSetup(s); }}><Icon name="smartphone" />{t("Activer", "Turn on")}</button>
      {codes && <Codes codes={codes} />}
    </div>
  );
}

function SecurityTab({ me, data }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(data.sessions);
  const [cur, setCur] = useState("");
  const [npw, setNpw] = useState("");
  const [email, setEmail] = useState("");
  const [uname, setUname] = useState(me.username);
  const [busy, run] = useBusy();
  return (
    <>
      <Head title={t("Sécurité", "Security")} />
      <Group title={t("Connexion", "Sign-in")}>
        <div className="list">
          <div className="switch-row">
            <span><b>{t("Compte Mozilla (Firefox Sync)", "Mozilla account (Firefox Sync)")}</b>
              <div className="hint">{me.mozilla_linked ? t("Lié : te connecter à Firefox Sync dans Orbit te connecte ici aussi.", "Linked: signing in to Firefox Sync in Orbit signs you in here too.")
                : t("Connecte-toi à Firefox Sync dans Orbit pour le lier à ce compte.", "Sign in to Firefox Sync in Orbit to link it to this account.")}</div></span>
            <span className={`tag ${me.mozilla_linked ? "ok" : ""}`}>{me.mozilla_linked ? t("Lié", "Linked") : t("Non lié", "Not linked")}</span>
          </div>
        </div>
      </Group>
      <Group title={t("Mot de passe", "Password")}>
        {me.has_password ? (
          <form className="stack" style={{ gap: 14, paddingTop: 8, maxWidth: 420 }} onSubmit={async e => {
            e.preventDefault();
            if (await run(() => post("/me/password", { current: cur, password: npw }), { ok: t("Mot de passe changé. Tes autres appareils sont déconnectés.", "Password changed. Your other devices were signed out.") })) {
              setCur("");
              setNpw("");
            }
          }}>
            <Field label={t("Mot de passe actuel", "Current password")}><input className="input" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></Field>
            <Field label={t("Nouveau mot de passe", "New password")}><input className="input" type="password" autoComplete="new-password" minLength={10} value={npw} onChange={e => setNpw(e.target.value)} /></Field>
            <button className="btn" type="submit" style={{ width: "fit-content" }} disabled={busy}>{t("Changer", "Change")}</button>
          </form>
        ) : (
          <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
            <p className="muted">{t("Ton compte n'a pas de mot de passe : tu te connectes avec Firefox Sync. Pour en ajouter un, utilise le lien envoyé par e-mail.", "Your account has no password: you sign in with Firefox Sync. To add one, use the link sent by e-mail.")}</p>
            <button className="btn" style={{ width: "fit-content" }} onClick={() => act(() => post("/auth/forgot", { email: me.email }), { ok: t("Lien envoyé", "Link sent") })}><Icon name="mail" />{t("Recevoir le lien", "Send me the link")}</button>
          </div>
        )}
      </Group>
      {me.has_password && <Group title={t("Validation en deux étapes", "Two-step verification")}><Mfa me={me} /></Group>}
      <Group title={t("Adresse e-mail", "E-mail address")}>
        <p className="muted" style={{ paddingTop: 8 }}>{t(`Actuelle : ${me.email}. La nouvelle adresse doit être confirmée par un lien.`, `Current: ${me.email}. The new address must be confirmed by a link.`)}</p>
        <form className="row" style={{ paddingTop: 12, maxWidth: 520 }} onSubmit={e => (e.preventDefault(), run(() => post("/me/email", { email }), { ok: t("Si l'adresse est libre, un lien de confirmation y a été envoyé.", "If the address is free, a confirmation link was sent to it.") }))}>
          <input className="input" type="email" placeholder={me.email} aria-label={t("Nouvelle adresse", "New address")} value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn" type="submit" disabled={busy}>{t("Changer", "Change")}</button>
        </form>
      </Group>
      <Group title={t("Pseudo", "Username")}>
        <form className="row" style={{ paddingTop: 8, maxWidth: 520 }} onSubmit={async e => {
          e.preventDefault();
          if (await run(() => post("/me/username", { username: uname }), { ok: t("Pseudo changé", "Username changed") })) await loadMe();
        }}>
          <input className="input" maxLength={24} aria-label={t("Pseudo", "Username")} value={uname} onChange={e => setUname(e.target.value)} />
          <button className="btn" type="submit" disabled={busy}>{t("Changer", "Change")}</button>
        </form>
      </Group>
      <Group title={t("Sessions actives", "Active sessions")}>
        <table><thead><tr><th>{t("Appareil", "Device")}</th><th className="hide-sm">{t("Adresse", "Address")}</th><th>{t("Dernière activité", "Last active")}</th><th /></tr></thead>
          <tbody>{sessions.map(s => (
            <tr key={s.id}>
              <td>{describeAgent(s.user_agent)}{s.current && <span className="tag ok" style={{ marginLeft: 8 }}>{t("Cette session", "This session")}</span>}</td>
              <td className="mono hide-sm">{s.ip ?? ""}</td><td className="muted">{fmtDateTime(s.last_seen_at)}</td>
              <td style={{ textAlign: "right" }}>{!s.current && <button className="btn small quiet danger" onClick={async () => (await act(() => del(`/me/sessions/${s.id}`))) && setSessions(sessions.filter(x => x.id != s.id))}>{t("Déconnecter", "Sign out")}</button>}</td>
            </tr>
          ))}</tbody></table>
        <button className="btn small danger" style={{ marginTop: 14 }} onClick={async () => {
          if (!(await confirmDialog({ title: t("Se déconnecter partout ?", "Sign out everywhere?"), text: t("Y compris sur cet appareil.", "Including this device."), action: t("Tout déconnecter", "Sign out all"), danger: true }))) return;
          if (await act(() => post("/auth/logout-all"))) {
            setMe(null);
            navigate("/login", { viewTransition: true });
          }
        }}>{t("Se déconnecter partout", "Sign out everywhere")}</button>
      </Group>
    </>
  );
}

function PaymentsTab({ data }) {
  const { donations, subscriptions, beta } = data;
  const STATUS = { succeeded: [t("Confirmé", "Confirmed"), "ok"], failed: [t("Échoué", "Failed"), "err"], canceled: [t("Annulé", "Canceled"), ""],
    refunded: [t("Remboursé", "Refunded"), "warn"], partially_refunded: [t("Remboursé en partie", "Partly refunded"), "warn"], disputed: [t("Contesté", "Disputed"), "err"] };
  const active = subscriptions.find(s => ["active", "trialing", "past_due"].includes(s.status));
  return (
    <>
      <Head title={t("Achats et dons", "Purchases and donations")} />
      <Group title={t("Accès à la bêta", "Beta access")}>
        <div className="list"><div className="switch-row">
          <span><b>{beta.owned ? t("Tu as accès à la bêta d'Orbit", "You have access to the Orbit beta") : beta.paywall ? t("Pas encore d'accès", "No access yet") : t("La bêta est gratuite en ce moment", "The beta is free right now")}</b>
            <div className="hint">{beta.owned ? t("Entre ta clé dans Orbit quand il la demande, ou dans Paramètres › À propos.", "Enter your key in Orbit when it asks, or in Settings › About.") : t("Gratuit pour tous à la version 1.0.", "Free for everyone at version 1.0.")}</div></span>
          {beta.owned ? <span className="tag ok"><Icon name="check" />{t("Actif", "Active")}</span> : <Link className="btn small primary" to="/beta">{beta.paywall ? t(`Obtenir · ${fmtMoney(beta.price_cents, beta.currency)}`, `Get it · ${fmtMoney(beta.price_cents, beta.currency)}`) : t("Télécharger", "Download")}</Link>}
        </div></div>
        {beta.key && <BetaKey value={beta.key.key} devices={beta.key.devices} max={beta.key.max_devices} />}
      </Group>
      {active && (
        <Group title={t("Soutien mensuel", "Monthly support")}>
          <div className="list"><div className="switch-row">
            <span><b>{active.amount_cents ? fmtMoney(active.amount_cents, active.currency) : ""} {t("par mois", "a month")}</b>
              {active.current_period_end && <div className="hint">{t("Prochain paiement", "Next payment")} {fmtDate(active.current_period_end)}</div>}</span>
            <button className="btn small" onClick={async () => { const r = await act(() => post("/donations/portal")); if (r?.url) location.href = r.url; }}>{t("Gérer ou arrêter", "Manage or stop")}</button>
          </div></div>
        </Group>
      )}
      <Group title={t("Historique", "History")}>
        {donations.length ? (
          <table><thead><tr><th>Date</th><th>{t("Montant", "Amount")}</th><th>Type</th><th>{t("Statut", "Status")}</th></tr></thead>
            <tbody>{donations.map(d => (
              <tr key={d.id}><td className="muted">{fmtDate(d.created_at)}</td>
                <td>{fmtMoney(d.amount_cents, d.currency)}{d.refunded_cents > 0 && <span className="faint"> (−{fmtMoney(d.refunded_cents, d.currency)})</span>}</td>
                <td className="muted">{d.purpose == "beta" ? t("Accès bêta", "Beta access") : d.recurring ? t("Don mensuel", "Monthly donation") : t("Don", "Donation")}</td>
                <td><span className={`tag ${STATUS[d.status]?.[1] ?? ""}`}>{STATUS[d.status]?.[0] ?? d.status}</span></td></tr>
            ))}</tbody></table>
        ) : <p className="muted small" style={{ padding: "12px 0" }}>{t("Rien pour l'instant.", "Nothing yet.")}</p>}
        <Link className="btn small" style={{ marginTop: 14 }} to="/support"><Icon name="heart" />{t("Faire un don", "Donate")}</Link>
      </Group>
    </>
  );
}

function DataTab({ me }) {
  return (
    <>
      <Head title={t("Mes données", "My data")} sub={t("Tes droits : accès, export, suppression.", "Your rights: access, export, deletion.")} />
      <Group title={t("Exporter", "Export")}>
        <p className="muted" style={{ padding: "8px 0 14px" }}>{t("Un fichier JSON avec ton compte, ton profil, tes badges, amis, sites, collections, notifications, sessions et paiements.", "A JSON file with your account, profile, badges, friends, sites, collections, notifications, sessions and payments.")}</p>
        <a className="btn" href="/api/v1/me/export" download="orbit-account.json"><Icon name="download" />{t("Télécharger mes données", "Download my data")}</a>
      </Group>
      <Group title={t("Supprimer mon compte", "Delete my account")} danger>
        <p className="muted" style={{ padding: "8px 0 14px" }}>{t("Ton profil, tes amis, badges, sites, collections et notifications sont supprimés tout de suite. Les paiements restent enregistrés (obligation comptable), sans lien avec un profil visible. Irréversible.",
          "Your profile, friends, badges, sites, collections and notifications are deleted right away. Payments stay recorded (accounting duty), not linked to a visible profile. Cannot be undone.")}</p>
        <button className="btn danger solid" onClick={() => openModal(close => <DeleteAccount me={me} close={close} />)}><Icon name="trash-2" />{t("Supprimer mon compte", "Delete my account")}</button>
      </Group>
    </>
  );
}

function DeleteAccount({ me, close }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState(null);
  return (
    <form style={{ display: "contents" }} onSubmit={async e => {
      e.preventDefault();
      try {
        await post("/me/delete", { password: pw, confirm });
        setMe(null);
        close();
        navigate("/", { viewTransition: true });
        toast(t("Compte supprimé.", "Account deleted."));
      } catch (x) {
        setError(x);
      }
    }}>
      <h2>{t("Supprimer définitivement ?", "Delete for good?")}</h2>
      <p>{t(`Tape « ${me.username} » et ton mot de passe.`, `Type "${me.username}" and your password.`)}</p>
      <input className="input" placeholder={me.username} aria-label={t("Ton pseudo", "Your username")} value={confirm} onChange={e => setConfirm(e.target.value)} autoFocus />
      {me.has_password && <input className="input" type="password" placeholder={t("Mot de passe", "Password")} autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} />}
      {error && <ErrorBox error={error} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" type="button" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn danger solid" type="submit" disabled={confirm != me.username}>{t("Supprimer", "Delete")}</button>
      </div>
    </form>
  );
}

const PAGES = { "": ProfileTab, badges: BadgesTab, sites: SitesTab, privacy: PrivacyTab, notifications: NotificationsTab, security: SecurityTab, payments: PaymentsTab, data: DataTab };
