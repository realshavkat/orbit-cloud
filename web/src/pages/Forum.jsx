import { Fragment, useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { t, LANG } from "../lib/i18n.js";
import { get, post, patch, del } from "../lib/api.js";
import { useMe, session } from "../lib/session.js";
import { ago, fmtDate, fmtShort } from "../lib/format.js";
import { Icon, Link, Avatar, Empty } from "../components/ui.jsx";
import { act, useBusy, confirmDialog, openModal, toast } from "../components/overlay.jsx";
import { useClickAway } from "../components/Shell.jsx";
import { reportDialog } from "./Profile.jsx";

const CAT_FR = {
  announcements: ["Annonces", "Les nouvelles de l'équipe Orbit."], general: ["Général", "Tout ce qui touche à Orbit et au web."],
  help: ["Aide", "Questions, problèmes, astuces."], mods: ["Mods et thèmes", "Partage, demande et peaufine des mods."],
  showcase: ["Vitrine", "Montre ton installation."], suggestions: ["Suggestions", "Des idées pour Orbit. Vote et débats."], "off-topic": ["Hors-sujet", "Tout le reste."],
};
const catName = c => (LANG == "fr" && CAT_FR[c.slug ?? c.category]?.[0]) || c.name || c.category_name;
const catDesc = c => (LANG == "fr" && CAT_FR[c.slug]?.[1]) || c.description;

export const STATUS = () => ({
  open: ["circle-dot", t("Ouverte", "Open"), "#a3a2b3"],
  planned: ["calendar-check", t("Prévue", "Planned"), "#7fd1ff"],
  in_progress: ["hammer", t("En cours", "In progress"), "#f5b841"],
  done: ["circle-check", t("Livrée", "Shipped"), "#3dd68c"],
  declined: ["circle-x", t("Refusée", "Declined"), "#ff8d97"],
});

const canModerate = me => me?.permissions?.includes("forum.moderate");

function useLogin() {
  const navigate = useNavigate();
  return () => {
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { viewTransition: true });
    return false;
  };
}

export function StatusPill({ status }) {
  if (!status) return null;
  const [ic, label, c] = STATUS()[status];
  return <span className="f-status" style={{ "--c": c }}><Icon name={ic} />{label}</span>;
}

function CatChip({ c }) {
  return <Link className="f-cat" to={c.kind == "suggestions" || c.category == "suggestions" ? "/forum/suggestions" : `/forum/c/${c.slug ?? c.category}`} style={{ "--c": c.color ?? c.category_color }}>{catName(c)}</Link>;
}

function Rich({ text }) {
  const parts = useMemo(() => String(text ?? "").split(/\n{2,}/), [text]);
  const linkify = line => line.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g).map((s, i) => i % 2
    ? <a key={i} href={s} target="_blank" rel="noopener nofollow ugc">{s.replace(/^https?:\/\//, "")}</a> : s);
  return <div className="prose f-body">{parts.map((p, i) => <p key={i}>{p.split("\n").map((l, j) => <Fragment key={j}>{j > 0 && <br />}{linkify(l)}</Fragment>)}</p>)}</div>;
}

export function Votes({ type, id, score, mine, row = false, disabled = false }) {
  const me = useMe();
  const login = useLogin();
  const [state, setState] = useState({ score, mine: mine ?? null });
  const [dir, setDir] = useState(0);
  const vote = async v => {
    if (!me) return login();
    const next = state.mine == v ? 0 : v;
    const prev = state;
    setDir(next - (state.mine ?? 0) > 0 ? 1 : -1);
    setState({ score: state.score + next - (state.mine ?? 0), mine: next || null });
    const r = await act(() => post("/forum/vote", { target_type: type, target_id: id, value: next }));
    if (r) setState({ score: r.score, mine: r.my_vote });
    else setState(prev);
  };
  return (
    <div className={`f-votes${row ? " row" : ""}`} data-mine={state.mine ?? 0}>
      <button type="button" className="up" aria-label={t("Voter pour", "Upvote")} aria-pressed={state.mine == 1} disabled={disabled} onClick={() => vote(1)}><Icon name="arrow-big-up" /></button>
      <b key={state.score} className={dir > 0 ? "go-up" : dir < 0 ? "go-down" : ""} aria-live="polite">{fmtShort(state.score)}</b>
      <button type="button" className="down" aria-label={t("Voter contre", "Downvote")} aria-pressed={state.mine == -1} disabled={disabled} onClick={() => vote(-1)}><Icon name="arrow-big-down" /></button>
    </div>
  );
}

function ThreadRow({ th, i, showCat = true }) {
  return (
    <article className={`f-row${th.pinned ? " pinned" : ""}${th.hidden ? " hidden" : ""}`} style={{ "--i": Math.min(i, 12) }}>
      <Votes type="thread" id={th.id} score={th.score} mine={th.my_vote} />
      <div className="f-row-main">
        <div className="f-meta">
          {showCat && <CatChip c={th} />}
          {th.pinned && <span className="f-flag"><Icon name="pin" />{t("Épinglé", "Pinned")}</span>}
          {th.locked && <span className="f-flag"><Icon name="lock" />{t("Verrouillé", "Locked")}</span>}
          {th.hidden && <span className="f-flag warn"><Icon name="eye-off" />{t("Masqué", "Hidden")}</span>}
          <StatusPill status={th.status} />
        </div>
        <Link className="f-title" to={`/forum/t/${th.id}`}>{th.title}</Link>
        {th.excerpt && <p className="f-excerpt">{th.excerpt}</p>}
        <div className="f-by">
          {th.author ? <Link className="f-author" to={`/u/${th.author.username}`}><Avatar user={th.author} className="avatar xs" />@{th.author.username}</Link> : <span className="f-author">{t("compte supprimé", "deleted account")}</span>}
          {th.author?.staff && <span className="f-staff">{t("Équipe", "Team")}</span>}
          <span>·</span><time dateTime={th.created_at}>{ago(th.created_at)}</time>
          <Link className="f-replies" to={`/forum/t/${th.id}#replies`}><Icon name="message-square" />{th.comment_count}</Link>
        </div>
      </div>
    </article>
  );
}

function Rail({ categories, active }) {
  const me = useMe();
  return (
    <nav className="f-rail" aria-label="Forum">
      <Link className="btn primary block" to={active && active != "all" && active != "suggestions" ? `/forum/new?category=${active}` : active == "suggestions" ? "/forum/new?category=suggestions" : "/forum/new"}>
        <Icon name="square-pen" />{active == "suggestions" ? t("Proposer une idée", "Suggest an idea") : t("Nouvelle discussion", "New thread")}
      </Link>
      <div className="f-rail-group">
        <span className="label">{t("Fil", "Feeds")}</span>
        <Link to="/forum" aria-current={active == "all" ? "page" : undefined}><Icon name="activity" />{t("Tout le forum", "All discussions")}</Link>
        <Link to="/forum/suggestions" aria-current={active == "suggestions" ? "page" : undefined}><Icon name="lightbulb" />Suggestions</Link>
        {me && <Link to="/forum/mine" aria-current={active == "mine" ? "page" : undefined}><Icon name="user" />{t("Mes discussions", "My threads")}</Link>}
      </div>
      <div className="f-rail-group">
        <span className="label">{t("Catégories", "Categories")}</span>
        {categories.filter(c => c.kind != "suggestions").map(c => (
          <Link key={c.slug} to={`/forum/c/${c.slug}`} aria-current={active == c.slug ? "page" : undefined} style={{ "--c": c.color }}>
            <span className="f-dot" />{catName(c)}<span className="n">{c.threads}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function SortTabs({ sort, base, extra = "" }) {
  const items = [["hot", "flame", t("Populaires", "Hot")], ["new", "clock", t("Récents", "New")], ["top", "trending-up", t("Meilleurs", "Top")], ["active", "message-square", t("Actifs", "Active")]];
  return (
    <div className="tabs" role="tablist" aria-label={t("Trier", "Sort")}>
      {items.map(([k, ic, label]) => <Link key={k} to={`${base}?sort=${k}${extra}`} role="tab" aria-selected={String(sort == k)} preventScrollReset><Icon name={ic} />{label}</Link>)}
    </div>
  );
}

function OrbitWelcome() {
  const [params, setParams] = useSearchParams();
  if (params.get("from") != "orbit") return null;
  return (
    <div className="f-welcome" role="note">
      <Icon name="info" />
      <span>{t("Orbit ouvre le forum au démarrage. Tu peux le désactiver dans Paramètres › Navigation › Forum au démarrage.", "Orbit opens the forum at launch. You can turn this off in Settings › Browsing › Forum at launch.")}</span>
      <button className="icon-btn" aria-label={t("Fermer", "Close")} onClick={() => setParams(p => (p.delete("from"), p), { replace: true })}><Icon name="x" /></button>
    </div>
  );
}

function Pager({ page, total, base }) {
  const pages = Math.ceil(total / 25);
  if (pages <= 1) return null;
  return (
    <div className="f-pager">
      {page > 0 ? <Link className="btn small" to={`${base}page=${page - 1}`}><Icon name="arrow-left" />{t("Précédent", "Previous")}</Link> : <span />}
      <span className="mono faint">{page + 1} / {pages}</span>
      {page + 1 < pages ? <Link className="btn small" to={`${base}page=${page + 1}`}>{t("Suivant", "Next")}<Icon name="arrow-right" /></Link> : <span />}
    </div>
  );
}

export async function homeLoader({ params, request }) {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") ?? "hot";
  const page = Number(url.searchParams.get("page") ?? 0) || 0;
  const q = new URLSearchParams({ sort, page });
  if (params.slug) q.set("category", params.slug);
  const [c, th, s] = await Promise.all([get("/forum/categories"), get(`/forum/threads?${q}`), get("/forum/suggestions/summary")]);
  const cat = params.slug ? c.categories.find(x => x.slug == params.slug) : null;
  if (params.slug && !cat) throw new Response("", { status: 404 });
  return { categories: c.categories, cat, ...th, summary: s, sort, page };
}

export function Home() {
  const d = useLoaderData();
  const me = useMe();
  const base = d.cat ? `/forum/c/${d.cat.slug}` : "/forum";
  const total = d.categories.reduce((n, c) => n + c.threads, 0);
  return (
    <div className="forum">
      <Rail categories={d.categories} active={d.cat?.slug ?? "all"} />
      <section className="f-main">
        <OrbitWelcome />
        <header className="f-head" style={d.cat ? { "--c": d.cat.color } : undefined}>
          {d.cat ? <span className="f-head-ic"><Icon name={d.cat.icon} /></span> : <span className="eyebrow">{t("Forum Orbit", "Orbit forum")}</span>}
          <div>
            <h1>{d.cat ? catName(d.cat) : t("Discussions", "Discussions")}</h1>
            <p>{d.cat ? catDesc(d.cat) : t("Pose tes questions, partage tes réglages, débats des idées pour Orbit.", "Ask questions, share your setup, debate ideas for Orbit.")}</p>
          </div>
        </header>
        <div className="f-toolbar"><SortTabs sort={d.sort} base={base} /><span className="mono faint">{fmtShort(d.cat ? d.cat.threads : total)} {t("discussions", "threads")}</span></div>
        {d.threads.length ? (
          <div className="f-list">{d.threads.map((th, i) => <ThreadRow key={th.id} th={th} i={i} showCat={!d.cat} />)}</div>
        ) : (
          <Empty icon="message-square" action={<Link className="btn primary" to={d.cat ? `/forum/new?category=${d.cat.slug}` : "/forum/new"}>{t("Lancer la première discussion", "Start the first thread")}</Link>}>
            {t("Rien ici pour l'instant.", "Nothing here yet.")}
          </Empty>
        )}
        <Pager page={d.page} total={d.total} base={`${base}?sort=${d.sort}&`} />
      </section>
      <aside className="f-side">
        <SuggestBox summary={d.summary} />
        <section className="f-card">
          <h2>{t("Règles", "House rules")}</h2>
          <ol className="f-rules">
            <li>{t("Reste aimable : on critique les idées, pas les gens.", "Be kind: criticise ideas, not people.")}</li>
            <li>{t("Cherche avant de poster, vote plutôt que de répéter.", "Search before posting, vote instead of repeating.")}</li>
            <li>{t("Pas de pub, pas de liens douteux.", "No ads, no shady links.")}</li>
            <li>{t("Signale ce qui n'a rien à faire ici.", "Report what doesn't belong here.")}</li>
          </ol>
        </section>
        {!me && <section className="f-card"><h2>{t("Rejoins la discussion", "Join the conversation")}</h2><p className="muted small">{t("Un compte Orbit pour voter, répondre et proposer des idées.", "An Orbit account to vote, reply and suggest ideas.")}</p>
          <div className="row"><Link className="btn primary small" to="/register">{t("Créer un compte", "Sign up")}</Link><Link className="btn small" to="/login">{t("Se connecter", "Sign in")}</Link></div></section>}
      </aside>
    </div>
  );
}

function SuggestBox({ summary }) {
  const S = STATUS();
  return (
    <section className="f-card">
      <header className="row between"><h2>Suggestions</h2><Link className="link small" to="/forum/suggestions">{t("Tableau", "Board")}</Link></header>
      <div className="f-sum">
        {Object.keys(S).map(k => (
          <Link key={k} to={`/forum/suggestions?status=${k}`} style={{ "--c": S[k][2] }}><Icon name={S[k][0]} /><span>{S[k][1]}</span><b>{summary[k] ?? 0}</b></Link>
        ))}
      </div>
    </section>
  );
}

export async function suggestionsLoader({ request }) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const sort = url.searchParams.get("sort") ?? "top";
  const page = Number(url.searchParams.get("page") ?? 0) || 0;
  const q = new URLSearchParams({ category: "suggestions", sort, page });
  if (status) q.set("status", status);
  const [c, th, s] = await Promise.all([get("/forum/categories"), get(`/forum/threads?${q}`), get("/forum/suggestions/summary")]);
  return { categories: c.categories, ...th, summary: s, status, sort, page };
}

export function Suggestions() {
  const d = useLoaderData();
  const S = STATUS();
  const all = Object.values(d.summary).reduce((a, b) => a + b, 0);
  const extra = d.status ? `&status=${d.status}` : "";
  return (
    <div className="forum">
      <Rail categories={d.categories} active="suggestions" />
      <section className="f-main">
        <header className="f-head" style={{ "--c": "#f5b841" }}>
          <span className="f-head-ic"><Icon name="lightbulb" /></span>
          <div>
            <h1>Suggestions</h1>
            <p>{t("Propose une idée, vote pour celles que tu veux voir, débats en commentaires. L'équipe indique ce qui est prévu, en cours ou livré.",
              "Suggest an idea, vote for the ones you want, debate in the comments. The team marks what is planned, in progress or shipped.")}</p>
          </div>
        </header>
        <div className="f-board" role="tablist" aria-label={t("Statut", "Status")}>
          <Link to={`/forum/suggestions?sort=${d.sort}`} role="tab" aria-selected={String(!d.status)}><span>{t("Toutes", "All")}</span><b>{all}</b></Link>
          {Object.entries(S).map(([k, [ic, label, c]]) => (
            <Link key={k} to={`/forum/suggestions?status=${k}&sort=${d.sort}`} role="tab" aria-selected={String(d.status == k)} style={{ "--c": c }}>
              <span><Icon name={ic} />{label}</span><b>{d.summary[k] ?? 0}</b>
            </Link>
          ))}
        </div>
        <div className="f-toolbar">
          <div className="tabs" role="tablist" aria-label={t("Trier", "Sort")}>
            {[["top", "trending-up", t("Plus votées", "Most voted")], ["hot", "flame", t("Tendance", "Trending")], ["new", "clock", t("Récentes", "Newest")]].map(([k, ic, label]) => (
              <Link key={k} to={`/forum/suggestions?sort=${k}${extra}`} role="tab" aria-selected={String(d.sort == k)} preventScrollReset><Icon name={ic} />{label}</Link>
            ))}
          </div>
          <Link className="btn primary small" to="/forum/new?category=suggestions"><Icon name="plus" />{t("Proposer", "Suggest")}</Link>
        </div>
        {d.threads.length ? (
          <div className="f-list sugg">{d.threads.map((th, i) => <ThreadRow key={th.id} th={th} i={i} showCat={false} />)}</div>
        ) : <Empty icon="lightbulb">{d.status ? t("Aucune suggestion avec ce statut.", "No suggestion with this status.") : t("Aucune suggestion pour l'instant. Lance la première !", "No suggestions yet. Start the first one!")}</Empty>}
        <Pager page={d.page} total={d.total} base={`/forum/suggestions?sort=${d.sort}${extra}&`} />
      </section>
      <aside className="f-side">
        <section className="f-card">
          <h2>{t("Comment ça marche", "How it works")}</h2>
          <ol className="f-steps">
            <li><b>{t("Propose", "Suggest")}</b><span>{t("Une idée par discussion, avec le problème qu'elle résout.", "One idea per thread, with the problem it solves.")}</span></li>
            <li><b>{t("Vote et débats", "Vote and debate")}</b><span>{t("Les votes font remonter les idées, les réponses les affinent.", "Votes lift ideas up, replies sharpen them.")}</span></li>
            <li><b>{t("L'équipe tranche", "The team decides")}</b><span>{t("Prévue, en cours, livrée ou refusée : l'auteur est notifié.", "Planned, in progress, shipped or declined: the author is notified.")}</span></li>
          </ol>
        </section>
      </aside>
    </div>
  );
}

export const threadLoader = ({ params }) => Promise.all([get(`/forum/threads/${params.id}`), get("/forum/categories")])
  .then(([d, c]) => ({ ...d, categories: c.categories }));

function buildTree(posts) {
  const by = new Map(posts.map(p => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const p of by.values()) (p.parent_id && by.has(p.parent_id) ? by.get(p.parent_id).children : roots).push(p);
  return roots;
}

function Composer({ onSend, placeholder, autoFocus, onCancel, initial = "", action }) {
  const [text, setText] = useState(initial);
  const [busy, run] = useBusy();
  const [open, setOpen] = useState(!!autoFocus || !!initial);
  const submit = async e => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(() => onSend(text.trim()))) {
      setText("");
      setOpen(false);
      onCancel?.();
    }
  };
  return (
    <form className={`f-compose${open ? " open" : ""}`} onSubmit={submit}>
      <textarea className="input" rows={open ? 4 : 1} maxLength={10000} placeholder={placeholder} value={text} autoFocus={autoFocus}
        onFocus={() => setOpen(true)} onChange={e => setText(e.target.value)}
        onKeyDown={e => (e.ctrlKey || e.metaKey) && e.key == "Enter" && submit(e)} />
      {open && (
        <div className="row between">
          <span className="faint small"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span>
          <div className="row">
            <button type="button" className="btn quiet small" onClick={() => (setOpen(false), setText(initial), onCancel?.())}>{t("Annuler", "Cancel")}</button>
            <button type="submit" className="btn primary small" disabled={!text.trim()} aria-busy={busy}>{action ?? t("Répondre", "Reply")}</button>
          </div>
        </div>
      )}
    </form>
  );
}

function Comment({ p, depth, ctx }) {
  const me = useMe();
  const login = useLogin();
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState(null);
  const gone = p.body == null;
  const count = n => n.children.reduce((a, c) => a + 1 + count(c), 0);
  return (
    <div className={`f-c${collapsed ? " collapsed" : ""}`} id={`p-${p.id}`} style={{ "--depth": depth }}>
      <button className="f-c-line" aria-label={collapsed ? t("Déplier", "Expand") : t("Replier", "Collapse")} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} />
      <div className="f-c-head">
        {p.author ? <Link className="f-author" to={`/u/${p.author.username}`}><Avatar user={p.author} className="avatar xs" /><b>{p.author.display_name || p.author.username}</b></Link>
          : <span className="f-author faint">{p.deleted ? t("[supprimé]", "[deleted]") : t("[masqué]", "[hidden]")}</span>}
        {p.author && p.author.username == ctx.op && <span className="f-op">OP</span>}
        {p.author?.staff && <span className="f-staff">{t("Équipe", "Team")}</span>}
        <time className="faint" dateTime={p.created_at} title={fmtDate(p.created_at)}>{ago(p.created_at)}</time>
        {p.edited_at && <span className="faint">· {t("modifié", "edited")}</span>}
        {p.hidden && !p.deleted && <span className="f-flag warn"><Icon name="eye-off" />{t("Masqué", "Hidden")}</span>}
        {collapsed && <span className="faint">· {count(p) + 1} {t("messages", "messages")}</span>}
      </div>
      {!collapsed && (
        <>
          {mode == "edit" ? (
            <Composer initial={p.body} autoFocus action={t("Enregistrer", "Save")} onCancel={() => setMode(null)}
              onSend={async body => (await patch(`/forum/posts/${p.id}`, { body }), ctx.reload(), true)} />
          ) : gone ? <p className="f-gone">{p.deleted ? t("Ce message a été supprimé.", "This message was deleted.") : t("Ce message a été masqué par la modération.", "This message was hidden by moderation.")}</p>
            : <Rich text={p.body} />}
          {!gone && (
            <div className="f-c-actions">
              <Votes type="post" id={p.id} score={p.score} mine={p.my_vote} row />
              {!ctx.locked && <button className="f-act" onClick={() => (me ? setMode(mode == "reply" ? null : "reply") : login())}><Icon name="reply" />{t("Répondre", "Reply")}</button>}
              {p.mine && !ctx.locked && <button className="f-act" onClick={() => setMode("edit")}><Icon name="pencil" />{t("Modifier", "Edit")}</button>}
              {p.mine && <button className="f-act" onClick={async () => {
                if (await confirmDialog({ title: t("Supprimer ce message ?", "Delete this message?"), text: t("Les réponses restent visibles.", "Replies stay visible."), action: t("Supprimer", "Delete"), danger: true })
                  && await act(() => del(`/forum/posts/${p.id}`))) ctx.reload();
              }}><Icon name="trash-2" />{t("Supprimer", "Delete")}</button>}
              {me && !p.mine && <button className="f-act" onClick={() => reportDialog("post", p.id)}><Icon name="flag" />{t("Signaler", "Report")}</button>}
              {ctx.mod && <button className="f-act" onClick={async () => (await act(() => post(`/forum/posts/${p.id}/moderate`, { action: p.hidden ? "unhide" : "hide" }))) && ctx.reload()}>
                <Icon name={p.hidden ? "eye" : "eye-off"} />{p.hidden ? t("Réafficher", "Unhide") : t("Masquer", "Hide")}</button>}
            </div>
          )}
          {mode == "reply" && <Composer autoFocus placeholder={t(`Répondre à ${p.author?.username ?? ""}`, `Reply to ${p.author?.username ?? ""}`)} onCancel={() => setMode(null)}
            onSend={async body => (await post(`/forum/threads/${ctx.id}/posts`, { body, parent_id: p.id }), ctx.reload(), true)} />}
          {p.children.length > 0 && <div className="f-children">{p.children.map(c => <Comment key={c.id} p={c} depth={Math.min(depth + 1, 6)} ctx={ctx} />)}</div>}
        </>
      )}
    </div>
  );
}

function ModMenu({ th, categories, reload }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, setOpen);
  const run = async (action, value) => {
    setOpen(false);
    if (await act(() => post(`/forum/threads/${th.id}/moderate`, { action, ...(value ? { value } : {}) }), { ok: t("C'est fait", "Done") })) reload();
  };
  const move = () => openModal(close => (
    <>
      <h2>{t("Déplacer vers…", "Move to…")}</h2>
      <div className="pick-list">{categories.filter(c => c.slug != th.category).map(c => (
        <button key={c.slug} onClick={() => (close(), run("move", c.slug))} style={{ "--c": c.color }}><span className="f-dot" />{catName(c)}</button>
      ))}</div>
    </>
  ));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn small" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="shield" />{t("Modérer", "Moderate")}<Icon name="chevron-down" /></button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => run(th.pinned ? "unpin" : "pin")}><Icon name="pin" />{th.pinned ? t("Désépingler", "Unpin") : t("Épingler", "Pin")}</button>
          <button role="menuitem" onClick={() => run(th.locked ? "unlock" : "lock")}><Icon name={th.locked ? "lock-open" : "lock"} />{th.locked ? t("Déverrouiller", "Unlock") : t("Verrouiller", "Lock")}</button>
          <button role="menuitem" onClick={() => run(th.hidden ? "unhide" : "hide")}><Icon name={th.hidden ? "eye" : "eye-off"} />{th.hidden ? t("Réafficher", "Unhide") : t("Masquer", "Hide")}</button>
          <button role="menuitem" onClick={() => (setOpen(false), move())}><Icon name="arrow-right-left" />{t("Déplacer", "Move")}</button>
          {th.kind == "suggestions" && <>
            <hr />
            {Object.entries(STATUS()).map(([k, [ic, label]]) => <button key={k} role="menuitem" aria-current={th.status == k ? "true" : undefined} onClick={() => run("status", k)}><Icon name={ic} />{label}{th.status == k && <Icon name="check" />}</button>)}
          </>}
        </div>
      )}
    </div>
  );
}

export function Thread() {
  const d = useLoaderData();
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const th = d.thread;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(th.title);
  const [body, setBody] = useState(th.body);
  const [busy, run] = useBusy();
  const [order, setOrder] = useState("best");
  const tree = useMemo(() => {
    const roots = buildTree(d.posts);
    const score = p => (order == "new" ? -new Date(p.created_at) : order == "old" ? +new Date(p.created_at) : -p.score);
    const sortAll = list => list.sort((a, b) => score(a) - score(b)).forEach(p => sortAll(p.children));
    sortAll(roots);
    return roots;
  }, [d.posts, order]);
  const ctx = { id: th.id, locked: th.locked, mod: d.can_moderate, op: th.author?.username, reload: revalidate };
  const people = [...new Map([th.author, ...d.posts.map(p => p.author)].filter(Boolean).map(a => [a.username, a])).values()];
  const cat = d.categories.find(c => c.slug == th.category);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href.split("#")[0]);
      toast(t("Lien copié", "Link copied"), "ok");
    } catch {
      toast(location.href);
    }
  };
  return (
    <div className="forum thread">
      <Rail categories={d.categories} active={th.kind == "suggestions" ? "suggestions" : th.category} />
      <section className="f-main">
        <Link className="f-back" to={th.kind == "suggestions" ? "/forum/suggestions" : `/forum/c/${th.category}`}><Icon name="arrow-left" />{catName(th)}</Link>
        <article className="f-op-post">
          <Votes type="thread" id={th.id} score={th.score} mine={th.my_vote} disabled={th.hidden} />
          <div className="f-op-main">
            <div className="f-meta">
              <CatChip c={th} />
              {th.pinned && <span className="f-flag"><Icon name="pin" />{t("Épinglé", "Pinned")}</span>}
              {th.locked && <span className="f-flag"><Icon name="lock" />{t("Verrouillé", "Locked")}</span>}
              {th.hidden && <span className="f-flag warn"><Icon name="eye-off" />{t("Masqué", "Hidden")}</span>}
              <StatusPill status={th.status} />
            </div>
            {editing ? (
              <form className="stack" style={{ gap: 10 }} onSubmit={async e => {
                e.preventDefault();
                if (await run(() => patch(`/forum/threads/${th.id}`, { title, body }), { ok: t("Enregistré", "Saved") })) {
                  setEditing(false);
                  revalidate();
                }
              }}>
                <input className="input f-title-input" value={title} maxLength={140} onChange={e => setTitle(e.target.value)} aria-label={t("Titre", "Title")} />
                <textarea className="input" rows={8} value={body} maxLength={20000} onChange={e => setBody(e.target.value)} aria-label={t("Message", "Message")} />
                <div className="row"><button className="btn primary small" aria-busy={busy}>{t("Enregistrer", "Save")}</button><button type="button" className="btn quiet small" onClick={() => setEditing(false)}>{t("Annuler", "Cancel")}</button></div>
              </form>
            ) : (
              <>
                <h1 className="f-h1">{th.title}</h1>
                <div className="f-by">
                  {th.author ? <Link className="f-author" to={`/u/${th.author.username}`}><Avatar user={th.author} className="avatar xs" /><b>{th.author.display_name || th.author.username}</b><span className="faint">@{th.author.username}</span></Link> : <span className="f-author">{t("compte supprimé", "deleted account")}</span>}
                  {th.author?.staff && <span className="f-staff">{t("Équipe", "Team")}</span>}
                  <span>·</span><time dateTime={th.created_at} title={fmtDate(th.created_at)}>{ago(th.created_at)}</time>
                  {th.edited_at && <span>· {t("modifié", "edited")}</span>}
                </div>
                <Rich text={th.body} />
              </>
            )}
            <div className="f-c-actions big">
              <a className="f-act" href="#replies"><Icon name="message-square" />{th.comment_count} {t("réponses", "replies")}</a>
              <button className="f-act" onClick={share}><Icon name="share-2" />{t("Partager", "Share")}</button>
              {th.mine && !th.locked && !editing && <button className="f-act" onClick={() => setEditing(true)}><Icon name="pencil" />{t("Modifier", "Edit")}</button>}
              {th.mine && <button className="f-act" onClick={async () => {
                if (await confirmDialog({ title: t("Supprimer la discussion ?", "Delete this thread?"), text: t("Elle disparaît du forum avec ses réponses.", "It disappears from the forum with its replies."), action: t("Supprimer", "Delete"), danger: true })
                  && await act(() => del(`/forum/threads/${th.id}`), { ok: t("Discussion supprimée", "Thread deleted") })) navigate(`/forum/c/${th.category}`, { viewTransition: true });
              }}><Icon name="trash-2" />{t("Supprimer", "Delete")}</button>}
              {me && !th.mine && <button className="f-act" onClick={() => reportDialog("thread", th.id)}><Icon name="flag" />{t("Signaler", "Report")}</button>}
              <span className="grow" />
              {d.can_moderate && <ModMenu th={th} categories={d.categories} reload={revalidate} />}
            </div>
          </div>
        </article>

        <section className="f-replies-sec" id="replies">
          <div className="f-toolbar">
            <h2>{th.comment_count} {t("réponses", "replies")}</h2>
            <div className="seg" role="group" aria-label={t("Trier", "Sort")}>
              {[["best", t("Meilleures", "Best")], ["new", t("Récentes", "Newest")], ["old", t("Anciennes", "Oldest")]].map(([k, l]) => <button key={k} aria-pressed={order == k} onClick={() => setOrder(k)}>{l}</button>)}
            </div>
          </div>
          {th.locked ? <div className="alert"><Icon name="lock" />{t("Discussion verrouillée : plus de nouvelles réponses.", "Thread locked: no new replies.")}</div>
            : me ? <Composer placeholder={t("Ajoute ta réponse…", "Add your reply…")} onSend={async text => (await post(`/forum/threads/${th.id}/posts`, { body: text }), revalidate(), true)} />
              : <button className="f-compose-login" onClick={login}><Icon name="message-square" />{t("Connecte-toi pour répondre", "Sign in to reply")}</button>}
          {tree.length ? <div className="f-tree">{tree.map(p => <Comment key={p.id} p={p} depth={0} ctx={ctx} />)}</div>
            : <p className="faint" style={{ padding: "24px 0" }}>{t("Pas encore de réponse. Lance le débat.", "No replies yet. Start the debate.")}</p>}
        </section>
      </section>
      <aside className="f-side">
        {cat && (
          <section className="f-card" style={{ "--c": cat.color }}>
            <header className="row"><span className="f-head-ic sm"><Icon name={cat.icon} /></span><h2>{catName(cat)}</h2></header>
            <p className="muted small">{catDesc(cat)}</p>
            <Link className="btn small block" to={`/forum/new?category=${cat.slug}`}><Icon name="square-pen" />{cat.kind == "suggestions" ? t("Proposer une idée", "Suggest an idea") : t("Nouvelle discussion", "New thread")}</Link>
          </section>
        )}
        <section className="f-card">
          <dl className="facts">
            <div><dt>{t("Score", "Score")}</dt><dd>{th.score}</dd></div>
            <div><dt>{t("Réponses", "Replies")}</dt><dd>{th.comment_count}</dd></div>
            <div><dt>{t("Créée", "Created")}</dt><dd>{fmtDate(th.created_at)}</dd></div>
            <div><dt>{t("Activité", "Activity")}</dt><dd>{ago(th.last_activity_at)}</dd></div>
          </dl>
          {people.length > 0 && <>
            <span className="label">{t("Participants", "Participants")}</span>
            <div className="f-people">{people.slice(0, 12).map(a => <Link key={a.username} to={`/u/${a.username}`} title={`@${a.username}`}><Avatar user={a} className="avatar sm" /></Link>)}</div>
          </>}
        </section>
      </aside>
    </div>
  );
}

export async function composeLoader({ request }) {
  const category = new URL(request.url).searchParams.get("category") ?? "general";
  const { categories } = await get("/forum/categories");
  return { categories, category };
}

export function Compose() {
  const d = useLoaderData();
  const me = useMe();
  const navigate = useNavigate();
  const mod = canModerate(me);
  const cats = d.categories.filter(c => mod || !c.staff_only);
  const [cat, setCat] = useState(cats.some(c => c.slug == d.category) ? d.category : "general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState(null);
  const [busy, run] = useBusy();
  const sugg = cat == "suggestions";
  const submit = async e => {
    e.preventDefault();
    if (title.trim().length < 4) return setErr("title");
    if (!body.trim()) return setErr("body");
    const r = await run(() => post("/forum/threads", { category: cat, title: title.trim(), body: body.trim() }), { ok: t("Discussion publiée", "Thread posted") });
    if (r) navigate(`/forum/t/${r.id}`, { viewTransition: true });
  };
  return (
    <div className="f-new">
      <Link className="f-back" to={sugg ? "/forum/suggestions" : "/forum"}><Icon name="arrow-left" />Forum</Link>
      <header className="f-new-head">
        <h1>{sugg ? t("Proposer une idée", "Suggest an idea") : t("Nouvelle discussion", "New thread")}</h1>
        <p className="muted">{sugg ? t("Décris le problème, puis ta solution. Une idée par suggestion.", "Describe the problem, then your solution. One idea per suggestion.")
          : t("Un titre clair aide les autres à te répondre.", "A clear title helps others answer you.")}</p>
      </header>
      <form className="f-new-form" onSubmit={submit}>
        <fieldset className="f-cats">
          <legend className="label">{t("Catégorie", "Category")}</legend>
          {cats.map(c => (
            <label key={c.slug} className="f-cat-opt" style={{ "--c": c.color }} data-on={cat == c.slug}>
              <input type="radio" name="cat" value={c.slug} checked={cat == c.slug} onChange={() => setCat(c.slug)} />
              <span className="f-head-ic sm"><Icon name={c.icon} /></span>
              <span><b>{catName(c)}</b><span>{catDesc(c)}</span></span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="f-title">{t("Titre", "Title")}</label>
          <input id="f-title" className="input f-title-input" maxLength={140} value={title} aria-invalid={err == "title" || undefined}
            placeholder={sugg ? t("Ex. : Grouper les onglets par site", "e.g. Group tabs by site") : t("De quoi veux-tu parler ?", "What do you want to talk about?")}
            onChange={e => (setTitle(e.target.value), setErr(null))} autoFocus />
          <span className={`hint${err == "title" ? " err" : ""}`}>{err == "title" ? t("4 caractères minimum.", "4 characters minimum.") : `${title.length} / 140`}</span>
        </div>
        <div className="field">
          <label htmlFor="f-body">{sugg ? t("Le problème et ton idée", "The problem and your idea") : t("Message", "Message")}</label>
          <textarea id="f-body" className="input" rows={10} maxLength={20000} value={body} aria-invalid={err == "body" || undefined}
            placeholder={sugg ? t("Aujourd'hui, quand je…\nCe serait mieux si…", "Today, when I…\nIt would be better if…") : ""}
            onChange={e => (setBody(e.target.value), setErr(null))} />
          <span className={`hint${err == "body" ? " err" : ""}`}>{err == "body" ? t("Écris quelque chose.", "Write something.") : t("Texte simple. Les liens deviennent cliquables.", "Plain text. Links become clickable.")}</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Link className="btn quiet" to={sugg ? "/forum/suggestions" : "/forum"}>{t("Annuler", "Cancel")}</Link>
          <button className="btn primary" type="submit" aria-busy={busy}><Icon name="arrow-up-right" />{t("Publier", "Post")}</button>
        </div>
      </form>
    </div>
  );
}

export async function mineLoader() {
  const [c, th] = await Promise.all([get("/forum/categories"), get(`/forum/threads?sort=new&author=${encodeURIComponent(session.me.username)}`)]);
  return { categories: c.categories, ...th };
}

export function Mine() {
  const d = useLoaderData();
  return (
    <div className="forum">
      <Rail categories={d.categories} active="mine" />
      <section className="f-main">
        <header className="f-head"><span className="eyebrow">Forum</span><div><h1>{t("Mes discussions", "My threads")}</h1><p>{t("Tout ce que tu as lancé, du plus récent au plus ancien.", "Everything you started, newest first.")}</p></div></header>
        {d.threads.length ? <div className="f-list">{d.threads.map((th, i) => <ThreadRow key={th.id} th={th} i={i} />)}</div>
          : <Empty icon="message-square" action={<Link className="btn primary" to="/forum/new">{t("Nouvelle discussion", "New thread")}</Link>}>{t("Tu n'as encore rien posté.", "You haven't posted anything yet.")}</Empty>}
      </section>
      <aside className="f-side" />
    </div>
  );
}

export function LatestThreads({ threads }) {
  return <div className="f-list compact">{threads.map((th, i) => <ThreadRow key={th.id} th={th} i={i} />)}</div>;
}
