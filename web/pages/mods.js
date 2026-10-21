// Orbit Mods: browse, install (from inside Orbit), submit a .zip, follow reviews.
import { h, icon, t, get, post, state, act, empty, errorBox, errorText, field, fmtDate, toast } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);
const DOWNLOAD = "https://github.com/realshavkat/orbit/releases/latest";
const CATS = () => [["", t("Tous", "All")], ["tabs", t("Onglets", "Tabs")], ["sidebar", t("Barre latérale", "Sidebar")], ["colors", t("Couleurs", "Colors")],
  ["layout", t("Disposition", "Layout")], ["other", t("Autres", "Other")]];
const catName = k => CATS().find(([c]) => c == k)?.[1] ?? k;
const fmtN = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// Without a picture: a small Orbit window in colors derived from the mod's name.
function preview(m) {
  if (m.preview_url) return h("div", { class: "mod-prev", style: { backgroundImage: `url("${m.preview_url}")` } });
  let n = 0;
  for (const c of m.slug) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const hue = n % 360;
  return h("div", { class: "mod-prev fake", "aria-hidden": "true", style: { "--b": `hsl(${hue} 30% 7%)`, "--s": `hsl(${hue} 22% 14%)`, "--a": `hsl(${(hue + 40) % 360} 70% 72%)` } },
    h("div", { class: "side" }, h("i"), h("i"), h("i"), h("i"), h("i")), h("div", { class: "page" }, h("i"), h("i")));
}

// Big picture and thumbnails; a click on a thumbnail shows it.
function gallery(m) {
  if (!m.images?.length) return preview(m);
  const big = h("div", { class: "mod-prev", role: "img", "aria-label": m.name, style: { backgroundImage: `url("${m.images[0]}")` } });
  if (m.images.length == 1) return big;
  const thumbs = h("div", { class: "thumbs" }, m.images.map((src, i) => h("button", { type: "button", "aria-label": `${t("Image", "Picture")} ${i + 1}`, "aria-pressed": String(i == 0),
    style: { backgroundImage: `url("${src}")` }, onclick: e => {
      big.style.backgroundImage = `url("${src}")`;
      thumbs.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b == e.currentTarget)));
    } })));
  return h("div", { class: "gallery" }, big, thumbs);
}

// Screenshots for a submission: 1 to 6 pictures, the first is the cover.
function shotsPicker(onChange) {
  const shots = [];
  const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true });
  const grid = h("div", { class: "shots" });
  const draw = () => {
    grid.replaceChildren(...shots.map((s, i) => h("div", { class: "shot-item", style: { backgroundImage: `url("${s.url}")` } },
      i == 0 ? h("span", { class: "cover" }, t("Couverture", "Cover")) : null,
      h("button", { class: "icon-btn", type: "button", "aria-label": t("Retirer l'image", "Remove picture"), onclick: () => {
        URL.revokeObjectURL(s.url);
        shots.splice(i, 1);
        draw();
      } }, icon("x")))),
    shots.length < 6 ? h("label", { class: "shot-add" }, icon("image-plus"), t("Ajouter", "Add"), input) : null);
    onChange(shots.map(s => s.b64));
  };
  input.addEventListener("change", async () => {
    for (const file of [...input.files].slice(0, 6 - shots.length)) {
      if (file.size > 3 * 1024 * 1024) {
        toast(errorText("file_too_large"));
        continue;
      }
      shots.push({ url: URL.createObjectURL(file), b64: await readBase64(file) });
    }
    input.value = "";
    draw();
  });
  draw();
  return grid;
}

// The install button: Orbit wires buttons marked data-orbit-mod (see OrbitStore).
function installButton(m) {
  return [
    h("button", { class: "btn primary big only-orbit", type: "button", "data-orbit-mod": m.slug }, icon("download"), t("Ajouter à Orbit", "Add to Orbit")),
    h("a", { class: "btn big not-orbit", href: DOWNLOAD, target: "_blank", rel: "noopener" }, icon("download"), t("Installer Orbit pour l'ajouter", "Get Orbit to install it")),
  ];
}

export async function store({ query }) {
  const cat = query.category ?? "";
  const q = query.q ?? "";
  const sort = query.sort ?? "popular";
  const url = (o = {}) => {
    const p = new URLSearchParams(Object.entries({ category: cat, q, sort, ...o }).filter(([, v]) => v && v != "popular"));
    return `/mods${p.size ? `?${p}` : ""}`;
  };
  const { mods } = await get(`/mods?${new URLSearchParams({ category: cat, q, sort })}`);
  const search = h("input", { type: "search", value: q, placeholder: t("Rechercher un mod", "Search mods"), "aria-label": t("Rechercher un mod", "Search mods") });
  const sortSel = h("select", { class: "input", style: { width: "auto" }, "aria-label": t("Trier", "Sort"), onchange: e => go(url({ sort: e.target.value })) },
    ...[["popular", t("Populaires", "Popular")], ["new", t("Nouveaux", "New")], ["updated", t("Mis à jour", "Updated")]].map(([v, l]) => h("option", { value: v, selected: v == sort }, l)));
  return h("div", { class: "stack", style: { gap: "32px" } },
    h("div", { class: "page-head", style: { marginBottom: 0 } },
      h("div", {}, h("h1", { style: { fontSize: "48px" } }, "Mods"),
        h("p", {}, t("Change l'apparence d'Orbit en un clic. Chaque mod est vérifié par l'équipe Orbit avant d'être publié.",
          "Change how Orbit looks and feels, one click to install. Every mod is checked by the Orbit team before it is listed."))),
      h("a", { class: "btn", href: state.me ? "/mods/submit" : "/login?next=/mods/submit" }, icon("upload"), t("Proposer un mod", "Submit a mod"))),
    h("div", { class: "row wrap", style: { gap: "12px" } },
      h("div", { class: "tabs", role: "tablist" }, CATS().map(([k, l]) => h("a", { href: url({ category: k }), role: "tab", "aria-selected": String(k == cat) }, l))),
      h("div", { class: "row", style: { marginLeft: "auto" } },
        h("form", { class: "top-search", style: { display: "flex", width: "240px" }, role: "search", onsubmit: e => (e.preventDefault(), go(url({ q: search.value.trim() }))) }, icon("search"), search),
        sortSel)),
    mods.length ? h("div", { class: "mod-grid" }, mods.map(m => h("a", { class: "mod-card", href: `/mods/${m.slug}` }, preview(m),
      h("div", { class: "meta" }, h("b", {}, m.name), m.summary ? h("p", {}, m.summary) : null,
        h("div", { class: "foot" }, h("span", {}, `@${m.author}`), h("span", {}, `· ${catName(m.category)}`), h("span", { class: "n" }, icon("download"), fmtN(m.installs)))))))
      : empty("palette", q || cat ? t("Aucun mod ne correspond.", "No mod matches.") : t("Aucun mod publié pour l'instant. Propose le premier !", "No mod listed yet. Submit the first one!")));
}

// Readme: a small, safe subset of Markdown (headings, lists, code, bold).
function markdown(text) {
  const out = [];
  let list = null;
  const inline = line => {
    const parts = [];
    for (const m of line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
      if (!m) continue;
      if (m.startsWith("`")) parts.push(h("code", {}, m.slice(1, -1)));
      else if (m.startsWith("**")) parts.push(h("b", {}, m.slice(2, -2)));
      else parts.push(m);
    }
    return parts;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) out.push((list = h("ul")));
      list.append(h("li", {}, inline(item[1])));
      continue;
    }
    list = null;
    if (head) out.push(h(`h${head[1].length + 1}`, {}, inline(head[2])));
    else if (line.trim() && !/^!\[|^<\w/.test(line.trim())) out.push(h("p", {}, inline(line)));
  }
  return h("div", { class: "prose" }, out);
}

export async function detail({ params }) {
  let m;
  try {
    m = await get(`/mods/${encodeURIComponent(params.slug)}`);
  } catch (e) {
    return empty("palette", e.code == "not_found" ? t("Ce mod n'existe pas ou n'est pas encore publié.", "This mod doesn't exist or isn't listed yet.") : errorText(e.code));
  }
  const status = m.status != "listed" ? h("div", { class: "alert warn" }, icon("clock"),
    m.status == "pending" ? t("En attente de vérification : seul toi et l'équipe le voyez.", "Waiting for review: only you and the team can see it.")
      : m.status == "rejected" ? t("Refusé. Corrige-le et envoie une nouvelle version.", "Rejected. Fix it and send a new version.")
        : t("Retiré par l'équipe.", "Removed by the team.")) : null;
  const prefs = (m.preferences ?? []).filter(p => p.label);
  return h("div", { class: "stack", style: { gap: "36px" } },
    h("a", { class: "row muted", href: "/mods", style: { width: "fit-content" } }, icon("arrow-left"), t("Tous les mods", "All mods")),
    status,
    h("div", { class: "mod-detail" },
      h("div", { class: "shot" }, gallery(m)),
      h("aside", {},
        h("div", { class: "stack", style: { gap: "10px" } },
          h("h1", {}, m.name),
          h("a", { class: "link", href: m.author_url }, `@${m.author}`),
          m.summary ? h("p", { class: "muted", style: { fontSize: "17px" } }, m.summary) : null),
        m.status == "listed" ? h("div", { class: "row wrap" }, installButton(m)) : null,
        h("div", { class: "verified" }, icon("shield-check"), t("Vérifié par l'équipe Orbit · CSS uniquement, aucun fichier distant", "Checked by the Orbit team · CSS only, no remote files")),
        h("dl", { class: "facts" },
          ...[[t("Version", "Version"), m.version ?? "—"], [t("Mis à jour", "Updated"), fmtDate(m.updated_at)], [t("Installations", "Installs"), (m.installs ?? 0).toLocaleString()],
            [t("Catégorie", "Category"), catName(m.category)], ...(m.zen ? [[t("Origine", "Origin"), t("Converti depuis Zen", "Converted from Zen")]] : [])]
            .map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
        m.homepage ? h("a", { class: "link", href: m.homepage, target: "_blank", rel: "noopener noreferrer nofollow" }, t("Site du mod", "Mod homepage")) : null)),
    h("div", { class: "row wrap", style: { alignItems: "flex-start", gap: "56px" } },
      h("section", { class: "stack", style: { flex: "3 1 520px", minWidth: 0 } }, h("h2", {}, t("À propos", "About")),
        m.readme?.trim() ? markdown(m.readme) : h("p", { class: "muted" }, t("Pas de description.", "No description."))),
      prefs.length ? h("section", { style: { flex: "2 1 300px" } }, h("h2", { style: { marginBottom: "6px" } }, t("Réglages", "Settings")),
        h("p", { class: "muted small", style: { marginBottom: "10px" } }, t("À ajuster après l'installation dans Paramètres › Mods.", "Adjust them after install in Settings › Mods.")),
        h("div", { class: "list" }, prefs.map(p => h("div", { class: "switch-row" }, h("b", {}, p.label),
          h("span", { class: "tag" }, { checkbox: t("Interrupteur", "Switch"), dropdown: t("Choix", "Choice"), string: t("Valeur", "Value") }[p.type] ?? p.type))))) : null));
}

// ---- submitting
const readBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("read"));
  r.readAsDataURL(file);
});

const CHECK_TEXT = {
  file_not_allowed: t("Fichier non autorisé", "File not allowed"), file_invalid: t("Fichier illisible", "Unreadable file"), file_too_big: t("Fichier trop lourd", "File too large"),
  css_missing: t("chrome.css manquant", "chrome.css is missing"), remote_content: t("Contenu chargé depuis Internet", "Content loaded from the internet"),
  code_in_css: t("Code exécutable dans le CSS", "Executable code in the CSS"), svg_script: t("Image SVG avec script", "SVG image with a script"),
  json_invalid: t("JSON invalide", "Invalid JSON"), too_many_prefs: t("Trop de réglages", "Too many settings"), pref_invalid: t("Réglage invalide", "Invalid setting"),
  pref_not_allowed: t("Ce réglage touche le navigateur", "This setting touches the browser"), font_face: t("Police embarquée : vérifiée par l'équipe", "Embedded font: checked by the team"),
  zen_unsupported: t("Partie de Zen absente d'Orbit (ignorée)", "Zen part Orbit doesn't have (ignored)"), pref_renamed: t("Réglage renommé", "Setting renamed"),
};

function checksView(r) {
  const row = (ic, c, title, text) => h("div", { class: "check-row", style: { "--c": c } }, icon(ic), h("div", {}, h("b", {}, title), text ? h("span", {}, text) : null));
  const rows = [];
  if (r.zen && r.conversion) {
    rows.push(row("refresh-cw", "var(--lav)", t("Converti pour Orbit", "Converted to Orbit"),
      t(`Fait pour Zen : ${r.conversion.selectors} sélecteurs et ${r.conversion.variables} variables pointent maintenant vers Orbit.`,
        `Made for Zen: ${r.conversion.selectors} selectors and ${r.conversion.variables} variables now point to Orbit.`)));
  }
  if (!r.errors.length) rows.push(row("circle-check", "var(--ok)", t("Contrôles réussis", "Checks passed"), t("Pas de script, rien de chargé depuis Internet.", "No scripts, nothing loaded from the internet.")));
  for (const e of r.errors) rows.push(row("circle-alert", "var(--danger)", CHECK_TEXT[e.code] ?? e.code, [e.file, e.detail].filter(Boolean).join(" · ")));
  const groups = {};
  for (const w of r.warnings) (groups[w.code] ??= []).push(w.detail);
  for (const [code, details] of Object.entries(groups)) rows.push(row("circle-alert", "var(--warn)", CHECK_TEXT[code] ?? code, details.filter(Boolean).slice(0, 6).join(", ")));
  return h("div", {}, rows);
}

function sourcePicker(onSource) {
  const input = h("input", { type: "file", accept: ".zip,application/zip", hidden: true });
  const box = h("div", { class: "stack" });
  const zenInput = h("input", { class: "input", placeholder: "https://zen-browser.app/mods/…" });
  const drop = h("label", { class: "drop" }, icon("upload"), h("b", {}, t("Dépose le .zip de ton mod", "Drop your mod's .zip")),
    h("span", { class: "hint" }, t("chrome.css, theme.json, preferences.json, readme.md, images, preview.png · 1 Mo max", "chrome.css, theme.json, preferences.json, readme.md, images, preview.png · 1 MB max")),
    h("span", { class: "btn small", style: { marginTop: "6px" } }, t("Choisir un fichier", "Choose a file")), input);
  const take = async file => {
    if (!file) return;
    if (file.size > 1024 * 1024) return toast(errorText("file_too_big"));
    const zip = await readBase64(file);
    box.replaceChildren(h("div", { class: "file-row" }, icon("layers"), h("span", { style: { flex: 1, display: "flex", flexDirection: "column" } }, h("b", { style: { fontWeight: 500 } }, file.name),
      h("span", { class: "hint" }, `${Math.ceil(file.size / 1024)} KB`)), h("button", { class: "icon-btn", type: "button", "aria-label": t("Retirer", "Remove"), onclick: reset }, icon("x"))));
    onSource({ zip });
  };
  const reset = () => {
    box.replaceChildren(drop, zenToggle);
    onSource(null);
  };
  input.addEventListener("change", () => take(input.files[0]));
  drop.addEventListener("dragover", e => (e.preventDefault(), drop.classList.add("over")));
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => (e.preventDefault(), drop.classList.remove("over"), take(e.dataTransfer.files[0])));
  const zenToggle = h("button", { class: "bio-add", type: "button", onclick: () => box.replaceChildren(
    field(t("Lien du mod Zen", "Zen mod link"), zenInput),
    h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => zenInput.value.trim() && onSource({ zen: zenInput.value.trim() }) }, t("Importer", "Import")),
      h("button", { class: "btn small quiet", type: "button", onclick: reset }, t("Envoyer un .zip à la place", "Upload a .zip instead")))) },
  icon("link"), t("Ou importer un mod du store de Zen avec son lien", "Or import a mod from Zen's store with its link"));
  box.append(drop, zenToggle);
  return box;
}

export async function submit() {
  let source = null;
  let images = [];
  let found = 0;
  const sync = () => (send.disabled = !source || !ready || !(images.length || found));
  let ready = false;
  const checks = h("div", {}, h("p", { class: "muted small" }, t("Les contrôles s'affichent ici après l'envoi du fichier.", "Checks show up here once you add a file.")));
  const name = h("input", { class: "input", maxlength: 60, required: true });
  const summary = h("input", { class: "input", maxlength: 160 });
  const category = h("select", { class: "input" }, CATS().slice(1).map(([k, l]) => h("option", { value: k }, l)));
  const accept = h("input", { type: "checkbox", required: true });
  const err = h("div");
  const send = h("button", { class: "btn primary big", type: "submit", disabled: true }, t("Envoyer pour vérification", "Submit for review"));
  const shotsText = t("Obligatoire : au moins une image d'Orbit avec ton mod (PNG, JPEG ou WebP, 3 Mo max, 6 au plus). La première sert de couverture.",
    "Required: at least one picture of Orbit with your mod (PNG, JPEG or WebP, 3 MB each, 6 at most). The first one is the cover.");
  const shotsHint = h("span", { class: "hint" }, shotsText);
  const picker = sourcePicker(async src => {
    source = src;
    ready = false;
    found = 0;
    sync();
    err.replaceChildren();
    if (!src) return checks.replaceChildren(h("p", { class: "muted small" }, t("Les contrôles s'affichent ici après l'envoi du fichier.", "Checks show up here once you add a file.")));
    checks.replaceChildren(h("div", { class: "spinner", style: { margin: "20px 0" } }));
    try {
      const r = await post("/mods/check", src);
      checks.replaceChildren(checksView(r));
      if (r.name && !name.value) name.value = r.name;
      if (r.description && !summary.value) summary.value = r.description.slice(0, 160);
      ready = r.ok;
      found = r.images ?? 0;
      shotsHint.textContent = found ? t(`${found} image(s) trouvée(s) dans le mod. Tu peux en ajouter.`, `${found} picture(s) found in the mod. You can add more.`) : shotsText;
      sync();
    } catch (e) {
      checks.replaceChildren(errorBox(e));
    }
  });
  return h("div", { class: "row wrap", style: { alignItems: "flex-start", gap: "56px" } },
    h("form", { class: "stack", style: { flex: "3 1 520px", maxWidth: "680px", gap: "24px" }, onsubmit: async e => {
      e.preventDefault();
      if (!source) return;
      const r = await act(send, () => post("/mods", { ...source, images, name: name.value, summary: summary.value, category: category.value, accept: accept.checked }));
      if (r) {
        toast(t("Mod envoyé. Tu seras notifié après la vérification.", "Mod sent. You'll be notified after the review."), "ok");
        go("/mods/mine");
      }
    } },
    h("div", { class: "stack", style: { gap: "10px" } }, h("h1", {}, t("Proposer un mod", "Submit a mod")),
      h("p", { class: "muted", style: { fontSize: "17px" } }, t("Envoie ton mod en .zip. Les mods faits pour Zen ou Firefox sont convertis pour Orbit automatiquement.",
        "Upload your mod as a .zip. Mods made for Zen or Firefox are converted to Orbit automatically."))),
    picker,
    h("div", { class: "field" }, h("label", {}, t("Captures d'écran", "Screenshots")), shotsHint, shotsPicker(list => ((images = list), sync()))),
    h("div", { class: "row wrap", style: { gap: "12px", alignItems: "flex-start" } },
      h("div", { style: { flex: "2 1 260px" } }, field(t("Nom", "Name"), name)), h("div", { style: { flex: "1 1 160px" } }, field(t("Catégorie", "Category"), category))),
    field(t("Description courte", "Short description"), summary),
    h("label", { class: "check" }, accept, h("span", {}, t("J'ai créé ce mod, ou sa licence me permet de le partager ici.", "I made this mod, or its license lets me share it here."))),
    err, h("div", { class: "row" }, send)),
  h("aside", { class: "stack", style: { flex: "2 1 300px" } }, h("h2", { style: { fontSize: "17px" } }, t("Contrôles automatiques", "Automatic checks")), checks,
    h("div", { class: "alert" }, icon("clock"), h("span", { class: "small" }, t("L'équipe Orbit vérifie chaque mod avant sa publication, en général sous deux jours. Tu reçois une notification dans tous les cas.",
      "The Orbit team reviews every mod before it is listed, usually within two days. You get a notification either way.")))));
}

export async function mine() {
  const { mods } = await get("/mods/mine");
  const STATUS = { pending: ["warn", t("En attente", "Waiting for review")], approved: ["ok", t("Publié", "Listed")], rejected: ["err", t("Refusé", "Rejected")],
    superseded: ["", t("Remplacé", "Replaced")] };
  const newVersion = m => async e => {
    let src = null;
    let pics = [];
    const version = h("input", { class: "input", placeholder: "1.1.0", maxlength: 20 });
    const box = h("div", { class: "modal-bg" });
    const send = h("button", { class: "btn primary", disabled: true, onclick: async ev => {
      const r = await act(ev.target, () => post(`/mods/${m.slug}/versions`, { ...src, images: pics.length ? pics : undefined, version: version.value.trim() || undefined }),
        { ok: t("Version envoyée pour vérification", "Version sent for review") });
      if (r) {
        box.remove();
        go("/mods/mine", { replace: true });
      }
    } }, t("Envoyer", "Send"));
    box.append(h("div", { class: "modal" }, h("h2", {}, `${m.name} · ${t("nouvelle version", "new version")}`),
      sourcePicker(s => ((src = s), (send.disabled = !s))), field(t("Numéro de version (sinon celui de theme.json)", "Version number (else theme.json's)"), version),
      h("div", { class: "field" }, h("label", {}, t("Nouvelles captures (facultatif, remplacent les actuelles)", "New screenshots (optional, replace the current ones)")), shotsPicker(l => (pics = l))),
      h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", onclick: () => box.remove() }, t("Annuler", "Cancel")), send)));
    document.body.append(box);
  };
  return h("div", { class: "stack", style: { gap: "28px" } },
    h("div", { class: "page-head", style: { marginBottom: 0 } }, h("h1", {}, t("Mes mods", "My mods")), h("a", { class: "btn", href: "/mods/submit" }, icon("plus"), t("Proposer un mod", "Submit a mod"))),
    mods.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Mod"), h("th", {}, t("Dernière version", "Latest version")), h("th", { class: "hide-sm" }, t("Installations", "Installs")), h("th", {}))),
      h("tbody", {}, mods.map(m => {
        const [cls, label] = STATUS[m.latest?.status] ?? ["", m.status];
        return h("tr", {}, h("td", {}, h("a", { class: "link", href: `/mods/${m.slug}` }, m.name)),
          h("td", {}, h("span", { class: `tag ${cls}` }, `${m.latest?.version ?? ""} · ${label}`), m.latest?.note ? h("div", { class: "faint small", style: { marginTop: "4px" } }, m.latest.note) : null),
          h("td", { class: "hide-sm" }, m.installs), h("td", { style: { textAlign: "right" } }, h("button", { class: "btn small", onclick: newVersion(m) }, t("Nouvelle version", "New version"))));
      })))
      : empty("palette", t("Tu n'as pas encore proposé de mod.", "You haven't submitted a mod yet."), h("a", { class: "btn small", href: "/mods/submit" }, t("Proposer un mod", "Submit a mod"))));
}
