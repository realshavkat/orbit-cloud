export const MOD_FILES = ["theme.json", "chrome.css", "preferences.json", "readme.md"];
const LIMITS = { "theme.json": 16 * 1024, "chrome.css": 1024 * 1024, "preferences.json": 64 * 1024, "readme.md": 64 * 1024 };
export const CATEGORIES = ["tabs", "sidebar", "colors", "layout", "other"];

const ZEN_SELECTORS = [
  ["#zen-sidebar-top-buttons", "#orbit-sidebar-header"],
  ["#zen-sidebar-bottom-buttons", "#orbit-sidebar-footer"],
  ["#zen-sidebar-icons-wrapper", "#orbit-sidebar-footer"],
  ["#zen-essentials-container", "#pinned-tabs-container"],
  ["#zen-essentials", "#pinned-tabs-container"],
  ["#zen-tabs-wrapper", "#vertical-tabs"],
  [".zen-workspace-tabs-section", "#vertical-tabs"],
  ["#zen-workspaces-button", "#orbit-space-switcher"],
  ["#zen-current-workspace-indicator", "#orbit-space-indicator"],
  ["#zen-appcontent-wrapper", "#tabbrowser-tabbox"],
  ["#zen-tabbox-wrapper", "#tabbrowser-tabbox"],
  ["#zen-main-app-wrapper", "#browser"],
];
const ZEN_VARIABLES = [
  ["--zen-primary-color", "--orbit-accent"],
  ["--zen-colors-primary", "--orbit-accent"],
  ["--zen-colors-secondary", "--orbit-hover"],
  ["--zen-colors-tertiary", "--orbit-panel"],
  ["--zen-colors-border", "--orbit-border"],
  ["--zen-border-radius", "--orbit-radius"],
  ["--zen-element-separation", "--orbit-gap"],
  ["--zen-toolbox-padding", "--orbit-gap"],
  ["--zen-themed-toolbar-bg", "--orbit-base"],
  ["--zen-main-browser-background", "--orbit-base"],
  ["--zen-dialog-background", "--orbit-panel"],
  ["--zen-urlbar-background", "--orbit-field"],
  ["--zen-sidebar-width", "--orbit-sidebar-width"],
  ["--zen-toolbar-height", "--orbit-toolbox-height"],
];
const ZEN_PREFS = [["zen.view.compact", "orbit.view.compact"]];

const PREF_RE = /^[A-Za-z0-9_.-]{3,80}$/;
const PREF_PREFIXES = ["orbit.mod.", "theme.", "mod.", "uc."];
const PREF_TYPES = new Set(["checkbox", "dropdown", "string"]);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dashed = p => p.replace(/\./g, "-");

export function isZenMod(files, meta) {
  const css = files["chrome.css"] ?? "";
  return /zen-browser|theme-store/.test(JSON.stringify(meta ?? {})) || /--zen-|#zen-|\.zen-|\[zen-|zen\.[a-z]/.test(css + (files["preferences.json"] ?? ""));
}

export function convertZen(files, slug) {
  let css = files["chrome.css"] ?? "";
  const report = { selectors: 0, variables: 0, prefs: [], unsupported: [] };
  const count = (re, to) => {
    let n = 0;
    css = css.replace(re, () => (n++, to));
    return n;
  };
  for (const [from, to] of ZEN_SELECTORS) report.selectors += count(new RegExp(`${escapeRe(from)}(?![\\w-])`, "g"), to);
  for (const [from, to] of ZEN_VARIABLES) report.variables += count(new RegExp(`${escapeRe(from)}(?![\\w-])`, "g"), to);

  let prefs = null;
  if (files["preferences.json"]) {
    try {
      prefs = JSON.parse(files["preferences.json"]);
    } catch {}
  }
  const renames = [...ZEN_PREFS];
  for (const p of Array.isArray(prefs) ? prefs : []) {
    const name = p?.property;
    if (typeof name != "string" || !PREF_RE.test(name) || ZEN_PREFS.some(([f]) => f == name)) continue;
    if (name.startsWith("zen.") || !PREF_PREFIXES.some(x => name.startsWith(x))) {
      renames.push([name, `orbit.mod.${slug}.${name.replace(/^zen\./, "")}`]);
    }
  }
  for (const [from, to] of renames) {
    const n = count(new RegExp(`(["'])${escapeRe(from)}\\1`, "g"), `"${to}"`)
      + count(new RegExp(`--${escapeRe(dashed(from))}(?![\\w-])`, "g"), `--${dashed(to)}`)
      + count(new RegExp(`\\[${escapeRe(dashed(from))}(?=[\\]=~|^$*])`, "g"), `[${dashed(to)}`);
    const declared = Array.isArray(prefs) && prefs.some(p => p?.property == from);
    if (declared) for (const p of prefs) if (p.property == from) p.property = to;
    if (n || declared) report.prefs.push({ from, to });
  }
  report.unsupported = [...new Set(css.match(/(?:#zen-|\.zen-|\[zen-|--zen-)[\w-]+/g) ?? [])].slice(0, 30);
  const out = { ...files, "chrome.css": `/* Converted from a Zen mod by Orbit */\n${css}` };
  if (prefs) out["preferences.json"] = JSON.stringify(prefs, null, 2);
  return { files: out, report };
}

function badUrl(raw) {
  const u = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (/^data:image\/(png|jpeg|gif|webp);/i.test(u)) return null;
  if (/^data:image\/svg\+xml/i.test(u)) {
    let body = u;
    try {
      body = decodeURIComponent(u);
    } catch {}
    if (/;base64,/i.test(u)) {
      try {
        body = Buffer.from(u.split(",")[1] ?? "", "base64").toString("utf8");
      } catch {}
    }
    return /<script|\bon\w+\s*=|javascript:|<foreignObject|href\s*=\s*["']?(?:https?:|\/\/)/i.test(body) ? "svg_script" : null;
  }
  if (/^(chrome|moz-icon|resource):\/\//i.test(u)) return null;
  if (/^[a-z][\w+.-]*:/i.test(u) || u.startsWith("//")) return "remote_content";
  return null;
}

export function checkMod(files) {
  const errors = [], warnings = [];
  for (const name of Object.keys(files)) {
    if (!MOD_FILES.includes(name)) errors.push({ code: "file_not_allowed", file: name });
    else if (typeof files[name] != "string") errors.push({ code: "file_invalid", file: name });
    else if (Buffer.byteLength(files[name]) > LIMITS[name]) errors.push({ code: "file_too_big", file: name });
  }
  if (!files["chrome.css"]?.trim()) errors.push({ code: "css_missing", file: "chrome.css" });
  const css = (files["chrome.css"] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(css)) errors.push({ code: "remote_content", file: "chrome.css", detail: "@import" });
  if (/-moz-binding|javascript:|expression\s*\(|behavior\s*:/i.test(css)) errors.push({ code: "code_in_css", file: "chrome.css" });
  for (const m of css.matchAll(/url\(\s*([^)]*)\)/gi)) {
    const why = badUrl(m[1]);
    if (why) errors.push({ code: why, file: "chrome.css", detail: m[1].trim().slice(0, 80) });
  }
  if (/@font-face/i.test(css)) warnings.push({ code: "font_face", file: "chrome.css" });

  let meta = {};
  if (files["theme.json"]) {
    try {
      meta = JSON.parse(files["theme.json"]);
      if (typeof meta != "object" || Array.isArray(meta) || !meta) throw 0;
    } catch {
      errors.push({ code: "json_invalid", file: "theme.json" });
      meta = {};
    }
  }
  let prefs = [];
  if (files["preferences.json"]) {
    try {
      prefs = JSON.parse(files["preferences.json"]);
      if (!Array.isArray(prefs)) throw 0;
    } catch {
      errors.push({ code: "json_invalid", file: "preferences.json" });
      prefs = [];
    }
  }
  if (prefs.length > 40) errors.push({ code: "too_many_prefs", file: "preferences.json" });
  for (const p of prefs) {
    if (!p || typeof p.property != "string" || !PREF_RE.test(p.property) || !PREF_TYPES.has(p.type)) {
      errors.push({ code: "pref_invalid", file: "preferences.json", detail: String(p?.property ?? "").slice(0, 80) });
    } else if (!PREF_PREFIXES.some(x => p.property.startsWith(x)) && !ZEN_PREFS.some(([, to]) => to == p.property)) {
      errors.push({ code: "pref_not_allowed", file: "preferences.json", detail: p.property });
    }
  }
  return { errors, warnings, meta, prefs };
}

export function prepareMod(files, slug) {
  const original = files;
  const meta0 = (() => {
    try {
      return JSON.parse(files["theme.json"] ?? "{}");
    } catch {
      return {};
    }
  })();
  const zen = isZenMod(files, meta0);
  let conversion = null;
  if (zen) ({ files, report: conversion } = convertZen(files, slug));
  const check = checkMod(files);
  for (const u of conversion?.unsupported ?? []) check.warnings.push({ code: "zen_unsupported", file: "chrome.css", detail: u });
  for (const r of conversion?.prefs ?? []) check.warnings.push({ code: "pref_renamed", file: "preferences.json", detail: `${r.from} → ${r.to}` });
  return { zen, files, original, conversion, ...check };
}

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

export function filesFromZip(entries) {
  const names = Object.keys(entries).filter(n => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(n));
  const top = names.length && names.every(n => n.includes("/")) && new Set(names.map(n => n.split("/")[0])).size == 1
    ? `${names[0].split("/")[0]}/` : "";
  const files = {}, images = {};
  const shots = [];
  for (const full of names) {
    const name = full.slice(top.length);
    const ext = name.split(".").pop().toLowerCase();
    if (MOD_FILES.includes(name)) files[name] = entries[full].toString("utf8");
    else if (/^preview\.(png|jpe?g|webp)$/i.test(name)) shots.unshift(entries[full]);
    else if (/^screenshots\/[^/]+\.(png|jpe?g|webp)$/i.test(name)) shots.push(entries[full]);
    else if (IMAGE_TYPES[ext]) images[name] = `data:${IMAGE_TYPES[ext]};base64,${entries[full].toString("base64")}`;
    else files[name] = "";
  }
  if (files["chrome.css"]) {
    const used = new Set();
    files["chrome.css"] = files["chrome.css"].replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, ref) => {
      const key = ref.trim().replace(/^\.\//, "");
      if (!images[key]) return m;
      used.add(key);
      return `url("${images[key]}")`;
    });
    for (const k of Object.keys(images)) if (!used.has(k)) delete images[k];
  }
  return { files, shots, inlined: Object.keys(images).length };
}

export function slugify(name) {
  return String(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mod";
}
