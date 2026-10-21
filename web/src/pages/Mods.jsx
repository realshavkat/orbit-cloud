import { useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { t, errorText } from "../lib/i18n.js";
import { get, post, fileToBase64 } from "../lib/api.js";
import { useMe } from "../lib/session.js";
import { fmtDate, fmtShort } from "../lib/format.js";
import { Icon, Link, Empty, ErrorBox, Field, Spinner, PageHero } from "../components/ui.jsx";
import { act, openModal, toast, useBusy } from "../components/overlay.jsx";

const DOWNLOAD = "/beta";
const CATS = () => [["", t("Tous", "All")], ["tabs", t("Onglets", "Tabs")], ["sidebar", t("Barre latérale", "Sidebar")], ["colors", t("Couleurs", "Colors")], ["layout", t("Disposition", "Layout")], ["other", t("Autres", "Other")]];
const catName = k => CATS().find(([c]) => c == k)?.[1] ?? k;

function Preview({ m, src }) {
  const url = src ?? m.preview_url;
  if (url) return <div className="mod-prev" role="img" aria-label={m.name} style={{ backgroundImage: `url("${url}")` }} />;
  let n = 0;
  for (const c of m.slug) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const hue = n % 360;
  return (
    <div className="mod-prev fake" aria-hidden="true" style={{ "--b": `hsl(${hue} 30% 7%)`, "--s": `hsl(${hue} 22% 14%)`, "--a": `hsl(${(hue + 40) % 360} 70% 72%)` }}>
      <div className="side"><i /><i /><i /><i /><i /></div><div className="page"><i /><i /></div>
    </div>
  );
}

export async function storeLoader({ request }) {
  const p = new URL(request.url).searchParams;
  const q = { category: p.get("category") ?? "", q: p.get("q") ?? "", sort: p.get("sort") ?? "popular" };
  return { ...q, ...(await get(`/mods?${new URLSearchParams(q)}`)) };
}

export function Store() {
  const { mods, category, q, sort } = useLoaderData();
  const me = useMe();
  const navigate = useNavigate();
  const [search, setSearch] = useState(q);
  const url = (o = {}) => {
    const p = new URLSearchParams(Object.entries({ category, q, sort, ...o }).filter(([, v]) => v && v != "popular"));
    return `/mods${p.size ? `?${p}` : ""}`;
  };
  return (
    <div className="stack" style={{ gap: 32 }}>
      <PageHero style={{ marginBottom: 0 }} eyebrow="Orbit Mods" title={t("Fais d'Orbit le tien.", "Make Orbit yours.")}
        sub={t("Change l'apparence d'Orbit en un clic. Chaque mod est vérifié par l'équipe Orbit avant d'être publié.", "Change how Orbit looks and feels, one click to install. Every mod is checked by the Orbit team before it is listed.")}>
        <Link className="btn" to={me ? "/mods/submit" : "/login?next=/mods/submit"}><Icon name="upload" />{t("Proposer un mod", "Submit a mod")}</Link>
      </PageHero>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="tabs" role="tablist">{CATS().map(([k, l]) => <Link key={k} to={url({ category: k })} role="tab" aria-selected={String(k == category)}>{l}</Link>)}</div>
        <div className="row" style={{ marginLeft: "auto" }}>
          <form className="top-search" style={{ display: "flex", width: 240 }} role="search" onSubmit={e => (e.preventDefault(), navigate(url({ q: search.trim() }), { viewTransition: true }))}>
            <Icon name="search" /><input type="search" placeholder={t("Rechercher un mod", "Search mods")} aria-label={t("Rechercher un mod", "Search mods")} value={search} onChange={e => setSearch(e.target.value)} />
          </form>
          <select className="input" style={{ width: "auto" }} aria-label={t("Trier", "Sort")} value={sort} onChange={e => navigate(url({ sort: e.target.value }), { viewTransition: true })}>
            <option value="popular">{t("Populaires", "Popular")}</option><option value="new">{t("Nouveaux", "New")}</option><option value="updated">{t("Mis à jour", "Updated")}</option>
          </select>
        </div>
      </div>
      {mods.length ? (
        <div className="mod-grid">{mods.map(m => (
          <Link key={m.slug} className="mod-card" to={`/mods/${m.slug}`}>
            <Preview m={m} />
            <div className="meta"><b>{m.name}</b>{m.summary && <p>{m.summary}</p>}
              <div className="foot"><span>@{m.author}</span><span>· {catName(m.category)}</span><span className="n"><Icon name="download" />{fmtShort(m.installs)}</span></div></div>
          </Link>
        ))}</div>
      ) : <Empty icon="palette">{q || category ? t("Aucun mod ne correspond.", "No mod matches.") : t("Aucun mod publié pour l'instant. Propose le premier !", "No mod listed yet. Submit the first one!")}</Empty>}
    </div>
  );
}

function Markdown({ text }) {
  const out = [];
  let list = null;
  const inline = line => line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((m, i) =>
    m.startsWith("`") ? <code key={i}>{m.slice(1, -1)}</code> : m.startsWith("**") ? <b key={i}>{m.slice(2, -2)}</b> : m);
  String(text).split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trimEnd();
    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) out.push((list = { key: n, items: [] }));
      list.items.push(inline(item[1]));
      return;
    }
    list = null;
    if (head) {
      const H = `h${head[1].length + 1}`;
      out.push(<H key={n}>{inline(head[2])}</H>);
    } else if (line.trim() && !/^!\[|^<\w/.test(line.trim())) out.push(<p key={n}>{inline(line)}</p>);
  });
  return <div className="prose">{out.map(o => (o.items ? <ul key={o.key}>{o.items.map((x, i) => <li key={i}>{x}</li>)}</ul> : o))}</div>;
}

function Gallery({ m }) {
  const [current, setCurrent] = useState(0);
  if (!m.images?.length) return <Preview m={m} />;
  return (
    <div className="gallery">
      <Preview m={m} src={m.images[current]} />
      {m.images.length > 1 && (
        <div className="thumbs">{m.images.map((src, i) => (
          <button key={src} type="button" aria-label={`${t("Image", "Picture")} ${i + 1}`} aria-pressed={String(i == current)} style={{ backgroundImage: `url("${src}")` }} onClick={() => setCurrent(i)} />
        ))}</div>
      )}
    </div>
  );
}

export async function detailLoader({ params }) {
  try {
    return { mod: await get(`/mods/${encodeURIComponent(params.slug)}`) };
  } catch (e) {
    return { error: e };
  }
}

export function Detail() {
  const { mod: m, error } = useLoaderData();
  if (error) return <Empty icon="palette">{error.code == "not_found" ? t("Ce mod n'existe pas ou n'est pas encore publié.", "This mod doesn't exist or isn't listed yet.") : errorText(error.code)}</Empty>;
  const prefs = (m.preferences ?? []).filter(p => p.label);
  const status = { pending: t("En attente de vérification : seuls toi et l'équipe le voyez.", "Waiting for review: only you and the team can see it."),
    rejected: t("Refusé. Corrige-le et envoie une nouvelle version.", "Rejected. Fix it and send a new version."), removed: t("Retiré par l'équipe.", "Removed by the team.") }[m.status];
  const facts = [[t("Version", "Version"), m.version ?? "—"], [t("Mis à jour", "Updated"), fmtDate(m.updated_at)], [t("Installations", "Installs"), (m.installs ?? 0).toLocaleString()],
    [t("Catégorie", "Category"), catName(m.category)], ...(m.zen ? [[t("Origine", "Origin"), t("Converti depuis Zen", "Converted from Zen")]] : [])];
  return (
    <div className="stack" style={{ gap: 36 }}>
      <Link className="row muted" to="/mods" style={{ width: "fit-content" }}><Icon name="arrow-left" />{t("Tous les mods", "All mods")}</Link>
      {status && <div className="alert warn"><Icon name="clock" />{status}</div>}
      <div className="mod-detail">
        <div className="shot"><Gallery m={m} /></div>
        <aside>
          <div className="stack" style={{ gap: 10 }}>
            <h1>{m.name}</h1>
            <Link className="link" to={m.author_url}>@{m.author}</Link>
            {m.summary && <p className="muted" style={{ fontSize: 17 }}>{m.summary}</p>}
          </div>
          {m.status == "listed" && (
            <div className="row wrap">
              <button className="btn primary big only-orbit" type="button" data-orbit-mod={m.slug}><Icon name="download" />{t("Ajouter à Orbit", "Add to Orbit")}</button>
              <Link className="btn big not-orbit" to={DOWNLOAD}><Icon name="download" />{t("Installer Orbit pour l'ajouter", "Get Orbit to install it")}</Link>
            </div>
          )}
          <div className="verified"><Icon name="shield-check" />{t("Vérifié par l'équipe Orbit · CSS uniquement, aucun fichier distant", "Checked by the Orbit team · CSS only, no remote files")}</div>
          <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {m.homepage && <a className="link" href={m.homepage} target="_blank" rel="noopener noreferrer nofollow">{t("Site du mod", "Mod homepage")}</a>}
        </aside>
      </div>
      <div className="row wrap" style={{ alignItems: "flex-start", gap: 56 }}>
        <section className="stack" style={{ flex: "3 1 520px", minWidth: 0 }}><h2>{t("À propos", "About")}</h2>
          {m.readme?.trim() ? <Markdown text={m.readme} /> : <p className="muted">{t("Pas de description.", "No description.")}</p>}</section>
        {prefs.length > 0 && (
          <section style={{ flex: "2 1 300px" }}>
            <h2 style={{ marginBottom: 6 }}>{t("Réglages", "Settings")}</h2>
            <p className="muted small" style={{ marginBottom: 10 }}>{t("À ajuster après l'installation dans Paramètres › Mods.", "Adjust them after install in Settings › Mods.")}</p>
            <div className="list">{prefs.map(p => (
              <div key={p.property} className="switch-row"><b>{p.label}</b>
                <span className="tag">{{ checkbox: t("Interrupteur", "Switch"), dropdown: t("Choix", "Choice"), string: t("Valeur", "Value") }[p.type] ?? p.type}</span></div>
            ))}</div>
          </section>
        )}
      </div>
    </div>
  );
}

const CHECK_TEXT = () => ({
  file_not_allowed: t("Fichier non autorisé", "File not allowed"), file_invalid: t("Fichier illisible", "Unreadable file"), file_too_big: t("Fichier trop lourd", "File too large"),
  css_missing: t("chrome.css manquant", "chrome.css is missing"), remote_content: t("Contenu chargé depuis Internet", "Content loaded from the internet"),
  code_in_css: t("Code exécutable dans le CSS", "Executable code in the CSS"), svg_script: t("Image SVG avec script", "SVG image with a script"),
  json_invalid: t("JSON invalide", "Invalid JSON"), too_many_prefs: t("Trop de réglages", "Too many settings"), pref_invalid: t("Réglage invalide", "Invalid setting"),
  pref_not_allowed: t("Ce réglage touche le navigateur", "This setting touches the browser"), font_face: t("Police embarquée : vérifiée par l'équipe", "Embedded font: checked by the team"),
  zen_unsupported: t("Partie de Zen absente d'Orbit (ignorée)", "Zen part Orbit doesn't have (ignored)"), pref_renamed: t("Réglage renommé", "Setting renamed"),
});

function Checks({ r }) {
  const text = CHECK_TEXT();
  const Row = ({ icon, color, title, body }) => <div className="check-row" style={{ "--c": color }}><Icon name={icon} /><div><b>{title}</b>{body && <span>{body}</span>}</div></div>;
  const groups = {};
  for (const w of r.warnings) (groups[w.code] ??= []).push(w.detail);
  return (
    <div>
      {r.zen && r.conversion && <Row icon="refresh-cw" color="var(--lav)" title={t("Converti pour Orbit", "Converted to Orbit")}
        body={t(`Fait pour Zen : ${r.conversion.selectors} sélecteurs et ${r.conversion.variables} variables pointent maintenant vers Orbit.`, `Made for Zen: ${r.conversion.selectors} selectors and ${r.conversion.variables} variables now point to Orbit.`)} />}
      {!r.errors.length && <Row icon="circle-check" color="var(--ok)" title={t("Contrôles réussis", "Checks passed")} body={t("Pas de script, rien de chargé depuis Internet.", "No scripts, nothing loaded from the internet.")} />}
      {r.errors.map((e, i) => <Row key={i} icon="circle-alert" color="var(--danger)" title={text[e.code] ?? e.code} body={[e.file, e.detail].filter(Boolean).join(" · ")} />)}
      {Object.entries(groups).map(([code, d]) => <Row key={code} icon="circle-alert" color="var(--warn)" title={text[code] ?? code} body={d.filter(Boolean).slice(0, 6).join(", ")} />)}
    </div>
  );
}

function SourcePicker({ onSource }) {
  const [file, setFile] = useState(null);
  const [zen, setZen] = useState(null);
  const [over, setOver] = useState(false);
  const take = async f => {
    if (!f) return;
    if (f.size > 1024 * 1024) return toast(errorText("file_too_big"));
    setFile(f);
    onSource({ zip: await fileToBase64(f) });
  };
  const reset = () => {
    setFile(null);
    setZen(null);
    onSource(null);
  };
  if (file) {
    return (
      <div className="file-row"><Icon name="layers" />
        <span style={{ flex: 1, display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 500 }}>{file.name}</b><span className="hint">{Math.ceil(file.size / 1024)} KB</span></span>
        <button className="icon-btn" type="button" aria-label={t("Retirer", "Remove")} onClick={reset}><Icon name="x" /></button>
      </div>
    );
  }
  if (zen != null) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <Field label={t("Lien du mod Zen", "Zen mod link")}><input className="input" placeholder="https://zen-browser.app/mods/…" value={zen} onChange={e => setZen(e.target.value)} /></Field>
        <div className="row">
          <button className="btn small" type="button" onClick={() => zen.trim() && onSource({ zen: zen.trim() })}>{t("Importer", "Import")}</button>
          <button className="btn small quiet" type="button" onClick={reset}>{t("Envoyer un .zip à la place", "Upload a .zip instead")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className={`drop${over ? " over" : ""}`} onDragOver={e => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)}
        onDrop={e => (e.preventDefault(), setOver(false), take(e.dataTransfer.files[0]))}>
        <Icon name="upload" /><b>{t("Dépose le .zip de ton mod", "Drop your mod's .zip")}</b>
        <span className="hint">{t("chrome.css, theme.json, preferences.json, readme.md, images · 1 Mo max", "chrome.css, theme.json, preferences.json, readme.md, images · 1 MB max")}</span>
        <span className="btn small" style={{ marginTop: 6 }}>{t("Choisir un fichier", "Choose a file")}</span>
        <input type="file" accept=".zip,application/zip" hidden onChange={e => take(e.target.files[0])} />
      </label>
      <button className="bio-add" type="button" onClick={() => setZen("")}><Icon name="link" />{t("Ou importer un mod du store de Zen avec son lien", "Or import a mod from Zen's store with its link")}</button>
    </div>
  );
}

function ShotsPicker({ onChange }) {
  const [shots, setShots] = useState([]);
  useEffect(() => onChange(shots.map(s => s.b64)), [shots]);
  useEffect(() => () => shots.forEach(s => URL.revokeObjectURL(s.url)), []);
  const add = async files => {
    const next = [...shots];
    for (const f of [...files].slice(0, 6 - shots.length)) {
      if (f.size > 3 * 1024 * 1024) {
        toast(errorText("file_too_large"));
        continue;
      }
      next.push({ url: URL.createObjectURL(f), b64: await fileToBase64(f) });
    }
    setShots(next);
  };
  return (
    <div className="shots">
      {shots.map((s, i) => (
        <div key={s.url} className="shot-item" style={{ backgroundImage: `url("${s.url}")` }}>
          {i == 0 && <span className="cover">{t("Couverture", "Cover")}</span>}
          <button className="icon-btn" type="button" aria-label={t("Retirer l'image", "Remove picture")} onClick={() => (URL.revokeObjectURL(s.url), setShots(shots.filter(x => x != s)))}><Icon name="x" /></button>
        </div>
      ))}
      {shots.length < 6 && (
        <label className="shot-add"><Icon name="image-plus" />{t("Ajouter", "Add")}
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => (add(e.target.files), (e.target.value = ""))} /></label>
      )}
    </div>
  );
}

export function Submit() {
  const navigate = useNavigate();
  const [source, setSource] = useState(null);
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [images, setImages] = useState([]);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("tabs");
  const [accept, setAccept] = useState(false);
  const [busy, run] = useBusy();
  const seq = useRef(0);
  const pick = async src => {
    const n = ++seq.current;
    setSource(src);
    setReport(null);
    setCheckError(null);
    if (!src) return;
    setChecking(true);
    try {
      const r = await post("/mods/check", src);
      if (n != seq.current) return;
      setReport(r);
      if (r.name) setName(v => v || r.name);
      if (r.description) setSummary(v => v || r.description.slice(0, 160));
    } catch (e) {
      if (n == seq.current) setCheckError(e);
    } finally {
      if (n == seq.current) setChecking(false);
    }
  };
  const found = report?.images ?? 0;
  const ready = source && report?.ok && (images.length || found) && name.trim() && accept;
  const shotsHint = found
    ? t(`${found} image(s) trouvée(s) dans le mod. Tu peux en ajouter.`, `${found} picture(s) found in the mod. You can add more.`)
    : t("Obligatoire : au moins une image d'Orbit avec ton mod (PNG, JPEG ou WebP, 3 Mo max, 6 au plus). La première sert de couverture.",
      "Required: at least one picture of Orbit with your mod (PNG, JPEG or WebP, 3 MB each, 6 at most). The first one is the cover.");
  return (
    <div className="row wrap" style={{ alignItems: "flex-start", gap: 56 }}>
      <form className="stack" style={{ flex: "3 1 520px", maxWidth: 680, gap: 24 }} onSubmit={async e => {
        e.preventDefault();
        if (!ready) return;
        const r = await run(() => post("/mods", { ...source, images, name, summary, category, accept }));
        if (r) {
          toast(t("Mod envoyé. Tu seras notifié après la vérification.", "Mod sent. You'll be notified after the review."), "ok");
          navigate("/mods/mine", { viewTransition: true });
        }
      }}>
        <div className="stack" style={{ gap: 10 }}>
          <h1>{t("Proposer un mod", "Submit a mod")}</h1>
          <p className="muted" style={{ fontSize: 17 }}>{t("Envoie ton mod en .zip. Les mods faits pour Zen ou Firefox sont convertis pour Orbit automatiquement.", "Upload your mod as a .zip. Mods made for Zen or Firefox are converted to Orbit automatically.")}</p>
        </div>
        <SourcePicker onSource={pick} />
        <div className="field"><label>{t("Captures d'écran", "Screenshots")}</label><span className="hint">{shotsHint}</span><ShotsPicker onChange={setImages} /></div>
        <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: "2 1 260px" }}><Field label={t("Nom", "Name")}><input className="input" maxLength={60} required value={name} onChange={e => setName(e.target.value)} /></Field></div>
          <div style={{ flex: "1 1 160px" }}><Field label={t("Catégorie", "Category")}><select className="input" value={category} onChange={e => setCategory(e.target.value)}>{CATS().slice(1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
        </div>
        <Field label={t("Description courte", "Short description")}><input className="input" maxLength={160} value={summary} onChange={e => setSummary(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} /><span>{t("J'ai créé ce mod, ou sa licence me permet de le partager ici.", "I made this mod, or its license lets me share it here.")}</span></label>
        <div><button className="btn primary big" type="submit" disabled={!ready || busy}>{t("Envoyer pour vérification", "Submit for review")}</button></div>
      </form>
      <aside className="stack" style={{ flex: "2 1 300px" }}>
        <h2 style={{ fontSize: 17 }}>{t("Contrôles automatiques", "Automatic checks")}</h2>
        {checking ? <Spinner /> : checkError ? <ErrorBox error={checkError} /> : report ? <Checks r={report} />
          : <p className="muted small">{t("Les contrôles s'affichent ici après l'envoi du fichier.", "Checks show up here once you add a file.")}</p>}
        <div className="alert"><Icon name="clock" /><span className="small">{t("L'équipe Orbit vérifie chaque mod avant sa publication, en général sous deux jours. Tu reçois une notification dans tous les cas.",
          "The Orbit team reviews every mod before it is listed, usually within two days. You get a notification either way.")}</span></div>
      </aside>
    </div>
  );
}

export const mineLoader = () => get("/mods/mine");

function NewVersion({ m, close, onDone }) {
  const [src, setSrc] = useState(null);
  const [pics, setPics] = useState([]);
  const [version, setVersion] = useState("");
  const [busy, run] = useBusy();
  return (
    <>
      <h2>{m.name} · {t("nouvelle version", "new version")}</h2>
      <SourcePicker onSource={setSrc} />
      <Field label={t("Numéro de version (sinon celui de theme.json)", "Version number (else theme.json's)")}><input className="input" placeholder="1.1.0" maxLength={20} value={version} onChange={e => setVersion(e.target.value)} /></Field>
      <div className="field"><label>{t("Nouvelles captures (facultatif, remplacent les actuelles)", "New screenshots (optional, replace the current ones)")}</label><ShotsPicker onChange={setPics} /></div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => close()}>{t("Annuler", "Cancel")}</button>
        <button className="btn primary" disabled={!src || busy} onClick={async () => {
          if (await run(() => post(`/mods/${m.slug}/versions`, { ...src, images: pics.length ? pics : undefined, version: version.trim() || undefined }), { ok: t("Version envoyée pour vérification", "Version sent for review") })) {
            close();
            onDone();
          }
        }}>{t("Envoyer", "Send")}</button>
      </div>
    </>
  );
}

export function Mine() {
  const { mods } = useLoaderData();
  const { revalidate } = useRevalidator();
  const STATUS = { pending: ["warn", t("En attente", "Waiting for review")], approved: ["ok", t("Publié", "Listed")], rejected: ["err", t("Refusé", "Rejected")], superseded: ["", t("Remplacé", "Replaced")] };
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><h1>{t("Mes mods", "My mods")}</h1><Link className="btn" to="/mods/submit"><Icon name="plus" />{t("Proposer un mod", "Submit a mod")}</Link></div>
      {mods.length ? (
        <table><thead><tr><th>Mod</th><th>{t("Dernière version", "Latest version")}</th><th className="hide-sm">{t("Installations", "Installs")}</th><th /></tr></thead>
          <tbody>{mods.map(m => {
            const [cls, label] = STATUS[m.latest?.status] ?? ["", m.status];
            return (
              <tr key={m.slug}>
                <td><Link className="link" to={`/mods/${m.slug}`}>{m.name}</Link></td>
                <td><span className={`tag ${cls}`}>{m.latest?.version} · {label}</span>{m.latest?.note && <div className="faint small" style={{ marginTop: 4 }}>{m.latest.note}</div>}</td>
                <td className="hide-sm">{m.installs}</td>
                <td style={{ textAlign: "right" }}><button className="btn small" onClick={() => openModal(close => <NewVersion m={m} close={close} onDone={revalidate} />)}>{t("Nouvelle version", "New version")}</button></td>
              </tr>
            );
          })}</tbody></table>
      ) : <Empty icon="palette" action={<Link className="btn small" to="/mods/submit">{t("Proposer un mod", "Submit a mod")}</Link>}>{t("Tu n'as pas encore proposé de mod.", "You haven't submitted a mod yet.")}</Empty>}
    </div>
  );
}
