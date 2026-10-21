// Administration: a dashboard with a vertical sidebar. The menu shows what the
// account's permissions allow; the server checks the same permissions on every call.
import { h, icon, t, get, post, patch, put, api, act, field, empty, fmtDate, fmtDateTime, fmtMoney, RARITY, promptDialog, confirmDialog, toast, badgeCard, avatar, errorBox,
  state, logo, drawer, localBadge, LANG, setLang } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);

// [path, icon, label, permission]
const TABS = [
  ["", "layout-dashboard", t("Vue d'ensemble", "Overview"), "stats.read"],
  ["users", "users", t("Membres", "Users"), "users.read"],
  ["badges", "award", t("Badges", "Badges"), "badges.award"],
  ["mods", "palette", "Mods", "mods.review"],
  ["reports", "flag", t("Signalements", "Reports"), "reports.read"],
  ["donations", "heart", t("Dons", "Donations"), "donations.read"],
  ["audit", "scroll-text", t("Journal d'audit", "Audit log"), "audit.read"],
];

function shell(tabs, tab, counts, content) {
  const lang = h("div", { class: "lang", role: "group", "aria-label": "Language" },
    ...[["en", "EN"], ["fr", "FR"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(LANG == k), onclick: () => LANG != k && setLang(k) }, l)));
  return h("div", { class: "admin" },
    h("aside", { class: "admin-side" },
      h("a", { class: "brand", href: "/admin" }, logo(26), "Orbit", h("small", {}, "Admin")),
      h("nav", { class: "admin-nav", "aria-label": t("Administration", "Admin") },
        ...tabs.map(([k, ic, label]) => h("a", { href: k ? `/admin/${k}` : "/admin", "aria-current": k == tab ? "page" : null }, icon(ic), label,
          counts[k] ? h("span", { class: "n" }, String(counts[k])) : null))),
      h("div", { class: "admin-foot" },
        h("a", { class: "row muted small", href: "/", style: { padding: "0 12px" } }, icon("arrow-left"), t("Retour au site", "Back to site")),
        h("div", { class: "me" }, avatar({ ...state.me, avatar_url: state.me.avatar_media_id ? `/api/v1/users/media/${state.me.avatar_media_id}` : null }, "avatar sm"),
          h("span", {}, h("b", { style: { fontWeight: 500 } }, state.me.username), h("span", { class: "faint" }, state.me.roles?.find(r => r != "user") ?? ""))),
        h("div", { style: { padding: "0 10px" } }, lang))),
    h("div", { class: "admin-main" }, content));
}

export async function page({ params, query }) {
  let me;
  try {
    me = await get("/admin/me");
  } catch {
    return h("div", { class: "admin" }, h("div", { class: "admin-main" }, empty("lock", t("Accès réservé à l'équipe.", "Team only."), h("a", { class: "btn small", href: "/" }, t("Retour au site", "Back to site")))));
  }
  const perms = new Set(me.permissions);
  const tabs = TABS.filter(([, , , p]) => perms.has(p));
  const tab = params.tab ?? (perms.has("stats.read") ? "" : tabs[0]?.[0]);
  const counts = {};
  if (perms.has("mods.review")) counts.mods = (await get("/admin/mods").catch(() => ({}))).pending ?? 0;
  if (perms.has("stats.read")) counts.reports = (await get("/admin/stats").catch(() => ({}))).reports_open ?? 0;
  const fn = { "": dashboard, users: params.id ? userDetail : users, badges: params.id ? badgeDetail : badges, mods, reports, donations, audit }[tab];
  if (!fn || !tabs.some(([k]) => k == tab)) return shell(tabs, tab, counts, empty("lock", t("Pas d'accès à cette section.", "No access to this section.")));
  return shell(tabs, tab, counts, await fn({ perms, id: params.id, query }));
}

const head = (title, sub, ...actions) => h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub ? h("p", { style: { fontSize: "15px", marginTop: "6px" } }, sub) : null),
  h("div", { class: "row wrap" }, ...actions));
const stat = (value, label, sub = null) => h("div", { class: "stat" }, h("span", {}, label), h("b", {}, value), sub ? h("span", { class: "faint" }, sub) : null);
const table = (cols, rows) => h("div", { style: { overflowX: "auto" } }, h("table", {}, h("thead", {}, h("tr", {}, cols.map(c => h("th", {}, c)))), h("tbody", {}, rows)));
const STATUS_COLOR = { active: "var(--ok)", succeeded: "var(--ok)", processed: "var(--ok)", resolved: "var(--ok)", approved: "var(--ok)", suspended: "var(--danger)", failed: "var(--danger)",
  disputed: "var(--danger)", rejected: "var(--danger)", open: "var(--warn)", pending: "var(--warn)", reviewing: "var(--warn)", refunded: "var(--warn)", partially_refunded: "var(--warn)" };
const STATUS_TAG = s => h("span", { class: "dot", style: { "--c": STATUS_COLOR[s] ?? "var(--faint)" } }, s);

// New members per day: one series, bars from the baseline, a tooltip on hover.
function signupChart(days) {
  const W = 640, H = 220, L = 34, B = 26, max = Math.max(4, ...days.map(d => d.n));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const y = v => H - B - (v / top) * (H - B - 10);
  const bw = (W - L) / days.length;
  const tip = h("div", { class: "tip", hidden: true });
  const svg = h("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("Nouveaux membres par jour, 30 derniers jours", "New members per day, last 30 days") });
  for (let k = 0; k <= 4; k++) {
    const v = step * k;
    svg.append(h("line", { x1: L, x2: W, y1: y(v), y2: y(v), stroke: `rgba(255,255,255,${k ? .05 : .12})` }),
      h("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", fill: "#7A7A8C", "font-size": 12 }, String(Math.round(v))));
  }
  days.forEach((d, i) => {
    const x = L + i * bw + 1, w = bw - 2, hgt = H - B - y(d.n);
    if (d.n) svg.append(h("path", { d: `M${x} ${H - B}v${-Math.max(hgt - 4, 0)}q0 -4 4 -4h${w - 8}q4 0 4 4v${Math.max(hgt - 4, 0)}z`, fill: "rgba(196,181,255,.6)" }));
    const hit = h("rect", { class: "bar-hit", x: L + i * bw, y: 0, width: bw, height: H - B });
    const label = new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric" }).format(new Date(d.day));
    hit.addEventListener("pointerenter", () => {
      tip.hidden = false;
      tip.style.left = `${((L + i * bw + bw / 2) / W) * 100}%`;
      tip.replaceChildren(h("b", {}, String(d.n)), ` ${t("nouveaux", "new")} · ${label}`);
    });
    hit.addEventListener("pointerleave", () => (tip.hidden = true));
    svg.append(hit);
  });
  for (const i of [0, Math.floor(days.length / 2), days.length - 1]) {
    svg.append(h("text", { x: Math.min(L + i * bw + bw / 2, W), y: H - 6, "text-anchor": i == days.length - 1 ? "end" : "middle", fill: "#7A7A8C", "font-size": 12 },
      new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric" }).format(new Date(days[i].day))));
  }
  return h("div", { class: "chart" }, svg, tip);
}

async function dashboard({ perms }) {
  const s = await get("/admin/stats");
  const [reportsList, auditList] = await Promise.all([
    perms.has("reports.read") ? get("/admin/reports?status=open").then(r => r.reports).catch(() => []) : [],
    perms.has("audit.read") ? get("/admin/audit").then(r => r.entries).catch(() => []) : [],
  ]);
  const top = s.badges.filter(b => b.n).slice(0, 5);
  const maxBadge = Math.max(1, ...top.map(b => b.n));
  const today = new Intl.DateTimeFormat(LANG, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return [head(t("Vue d'ensemble", "Overview"), today[0].toUpperCase() + today.slice(1),
    perms.has("badges.award") ? h("button", { class: "btn primary", onclick: () => awardDrawer({ perms }) }, icon("award"), t("Attribuer un badge", "Award badge")) : null),
  h("section", { class: "kpis", "aria-label": t("Chiffres clés", "Key numbers") },
    stat(s.users.total.toLocaleString(), t("Membres", "Members"), `+${s.users.new_7d} ${t("cette semaine", "this week")}`),
    stat(s.users.active_30d.toLocaleString(), t("Actifs (30 j)", "Active (30 d)")),
    s.donations ? stat(fmtMoney(s.donations.net_cents), t("Dons nets", "Net donations"), `${s.donations.confirmed} ${t("dons", "donations")}`) : null,
    stat(s.reports_open, t("Signalements ouverts", "Open reports"), s.mods_pending ? `${s.mods_pending} ${t("mods à vérifier", "mods to review")}` : null)),
  h("div", { class: "panels" },
    h("section", { class: "panel wide" }, h("header", {}, h("h2", {}, t("Nouveaux membres", "New members")), h("span", { class: "faint" }, t("par jour, 30 jours", "per day, 30 days"))),
      signupChart(s.signups)),
    h("section", { class: "panel" }, h("header", {}, h("h2", {}, t("À traiter", "To review")), h("a", { class: "link", href: "/admin/reports" }, t("Tout voir", "See all"))),
      reportsList.length ? h("div", {}, reportsList.slice(0, 4).map(r => h("a", { class: "site-row", href: "/admin/reports" },
        h("span", { style: { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 } }, h("b", { style: { fontWeight: 500 } }, r.target_label ?? "?"), h("span", { class: "muted small" }, r.reason)),
        h("span", { class: "faint small" }, fmtDate(r.created_at)))))
        : empty("circle-check", t("Rien en attente.", "Nothing waiting.")))),
  h("div", { class: "panels" },
    h("section", { class: "panel" }, h("header", {}, h("h2", {}, t("Badges les plus portés", "Most held badges")), h("a", { class: "link", href: "/admin/badges" }, t("Gérer", "Manage"))),
      top.length ? h("div", {}, top.map(b => h("div", { class: "site-row" }, h("span", { class: "badge-mini", style: { "--c": b.color } }, icon(b.icon ?? "award")),
        h("span", { style: { flex: 1 } }, localBadge(b).name), h("span", { class: "bar", style: { width: "120px" } }, h("i", { style: { width: `${(b.n / maxBadge) * 100}%` } })),
        h("span", { class: "muted small", style: { width: "48px", textAlign: "right" } }, b.n.toLocaleString()))))
        : empty("award", t("Aucun badge attribué.", "No badge awarded."))),
    h("section", { class: "panel" }, h("header", {}, h("h2", {}, t("Activité récente", "Recent activity")), perms.has("audit.read") ? h("a", { class: "link", href: "/admin/audit" }, t("Journal", "Audit log")) : null),
      auditList.length ? h("div", {}, auditList.slice(0, 5).map(a => h("div", { class: "site-row" },
        h("span", { style: { flex: 1, minWidth: 0 } }, h("b", { style: { fontWeight: 500 } }, a.actor ?? "Orbit"), " ", h("span", { class: "mono muted" }, a.action), a.reason ? h("span", { class: "muted" }, ` · ${a.reason}`) : null),
        h("span", { class: "faint small" }, fmtDateTime(a.created_at)))))
        : h("div", {}, ...[["database", t("Base de données", "Database")], ["mail", t("E-mails (SMTP)", "E-mail (SMTP)")], ["donations", t("Paiements (Stripe)", "Payments (Stripe)")]].map(([k, l]) =>
          h("div", { class: "site-row" }, h("span", { style: { flex: 1 } }, l), h("span", { class: `tag ${s.services[k] ? "ok" : "warn"}` }, s.services[k] ? t("opérationnel", "running") : t("non configuré", "not configured")))))))];
}

// Award one badge to several members at once (each award is checked and logged).
async function awardDrawer({ perms, badge = null, member = null }) {
  const { badges: all } = await get("/admin/badges");
  const usable = all.filter(b => b.manual_award && !b.protected && b.status == "active" && (!b.official || perms.has("badges.official")));
  if (!usable.length) return toast(t("Aucun badge attribuable à la main.", "No badge can be awarded by hand."));
  const sel = h("select", { class: "input" }, usable.map(b => h("option", { value: b.key, selected: b.key == badge }, localBadge(b).name)));
  const picked = new Map(member ? [[member.id, member]] : []);
  const chips = h("div", { class: "chips" });
  const drawChips = () => chips.replaceChildren(...[...picked.values()].map(u => h("span", { class: "chip" }, u.username,
    h("button", { type: "button", "aria-label": `${t("Retirer", "Remove")} ${u.username}`, onclick: () => (picked.delete(u.id), drawChips(), drawGo()) }, icon("x")))));
  const results = h("div");
  const q = h("input", { class: "input", placeholder: t("Pseudo ou e-mail", "Username or e-mail"), "aria-label": t("Chercher un membre", "Search a member") });
  let timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (q.value.trim().length < 2) return results.replaceChildren();
      const { users: found } = await get(`/admin/users?q=${encodeURIComponent(q.value.trim())}`).catch(() => ({ users: [] }));
      results.replaceChildren(found.length ? h("div", { class: "pick-list" }, found.slice(0, 6).map(u => h("button", { type: "button", onclick: () => {
        picked.set(u.id, u);
        q.value = "";
        results.replaceChildren();
        drawChips();
        drawGo();
      } }, avatar(u, "avatar sm"), h("span", { style: { flex: 1 } }, u.username), h("span", { class: "faint small" }, u.email ?? "")))) : h("p", { class: "faint small" }, t("Aucun membre.", "No member.")));
    }, 250);
  });
  const reason = h("textarea", { class: "input", rows: 3, placeholder: t("Pourquoi ce badge ?", "Why this badge?") });
  const goBtn = h("button", { class: "btn primary" });
  const drawGo = () => {
    goBtn.textContent = picked.size > 1 ? t(`Attribuer à ${picked.size} membres`, `Award to ${picked.size} members`) : t("Attribuer", "Award");
    goBtn.disabled = !picked.size;
  };
  drawChips();
  drawGo();
  const d = drawer(t("Attribuer un badge", "Award badge"), [
    field("Badge", sel),
    h("div", { class: "field" }, h("label", {}, t("Membres", "Members")), q, results, chips),
    field(t("Motif", "Reason"), reason, h("span", { class: "hint" }, t("Gardé dans le journal d'audit. Les membres ne le voient pas.", "Kept in the audit log. Members don't see it."))),
  ], [h("button", { class: "btn", onclick: () => d.close() }, t("Annuler", "Cancel")), goBtn]);
  goBtn.addEventListener("click", async () => {
    if (reason.value.trim().length < 3) return reason.setAttribute("aria-invalid", "true");
    goBtn.disabled = true;
    let ok = 0;
    const failed = [];
    for (const u of picked.values()) {
      try {
        await post(`/admin/users/${u.id}/badges`, { badge: sel.value, action: "award", reason: reason.value.trim() });
        ok++;
      } catch (e) {
        failed.push(`${u.username}: ${e.code}`);
      }
    }
    toast(failed.length ? `${ok} ✓ · ${failed.join(", ")}` : t(`Badge attribué (${ok})`, `Badge awarded (${ok})`), failed.length ? "" : "ok");
    d.close();
    go(location.pathname + location.search, { replace: true });
  });
}

async function users({ query }) {
  const q = query.q ?? "";
  const { users: list } = await get(`/admin/users?q=${encodeURIComponent(q)}`);
  const input = h("input", { class: "input", value: q, placeholder: t("Pseudo, identifiant ou e-mail", "Username, id or e-mail") });
  return [head(t("Utilisateurs", "Users"), null),
    h("form", { class: "row", onsubmit: e => (e.preventDefault(), go(`/admin/users?q=${encodeURIComponent(input.value.trim())}`)) }, input, h("button", { class: "btn primary", type: "submit" }, icon("search"))),
    list.length ? table([t("Pseudo", "Username"), t("Rôles", "Roles"), t("Statut", "Status"), t("Inscrit", "Joined"), t("Actif", "Active")],
      list.map(u => h("tr", {}, h("td", {}, h("a", { class: "link", href: `/admin/users/${u.id}` }, u.username), u.email ? h("div", { class: "faint small" }, u.email) : null),
        h("td", {}, u.roles.filter(r => r != "user").join(", ")), h("td", {}, STATUS_TAG(u.status), u.verified ? null : h("span", { class: "tag", style: { marginLeft: "4px" } }, t("non vérifié", "unverified"))),
        h("td", {}, fmtDate(u.created_at)), h("td", {}, fmtDate(u.last_active_at))))) : h("div", { class: "card" }, empty("users", t("Aucun résultat.", "No result.")))];
}

async function userDetail({ perms, id }) {
  const d = await get(`/admin/users/${id}`);
  const u = d.user;
  const reload = () => go(location.pathname, { replace: true });
  const reasoned = (title, run) => async e => {
    const reason = await promptDialog({ title, label: t("Motif (obligatoire, visible dans le journal)", "Reason (required, logged)"), action: t("Confirmer", "Confirm") });
    if (reason && (await act(e.target, () => run(reason), { ok: t("Fait", "Done") })) !== undefined) reload();
  };
  const actions = [];
  if (perms.has("users.suspend")) {
    actions.push(u.status == "suspended"
      ? h("button", { class: "btn", onclick: reasoned(t("Réactiver le compte", "Reactivate the account"), r => post(`/admin/users/${id}/unsuspend`, { reason: r })) }, t("Réactiver", "Reactivate"))
      : h("button", { class: "btn danger", onclick: async e => {
        const until = h("input", { class: "input", type: "datetime-local" });
        const reason = h("textarea", { class: "input", placeholder: t("Motif", "Reason") });
        const ok = await new Promise(res => {
          const bg = h("div", { class: "modal-bg" }, h("div", { class: "modal" }, h("h2", {}, t("Suspendre le compte", "Suspend the account")),
            field(t("Jusqu'au (vide = indéfiniment)", "Until (empty = indefinitely)"), until), field(t("Motif", "Reason"), reason),
            h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", onclick: () => (bg.remove(), res(false)) }, t("Annuler", "Cancel")),
              h("button", { class: "btn danger solid", onclick: () => (bg.remove(), res(true)) }, t("Suspendre", "Suspend")))));
          document.body.append(bg);
        });
        if (ok && (await act(e.target, () => post(`/admin/users/${id}/suspend`, { reason: reason.value, until: until.value ? new Date(until.value).toISOString() : null }), { ok: t("Compte suspendu", "Account suspended") })) !== undefined) reload();
      } }, icon("ban"), t("Suspendre", "Suspend")));
  }
  if (perms.has("users.sessions")) {
    actions.push(h("button", { class: "btn", onclick: reasoned(t("Déconnecter toutes ses sessions", "Sign out all sessions"), r => post(`/admin/users/${id}/revoke-sessions`, { reason: r })) }, t("Révoquer les sessions", "Revoke sessions")),
      h("button", { class: "btn", onclick: reasoned(t("Réinitialiser la validation en deux étapes (identité vérifiée)", "Reset two-step verification (identity checked)"), r => post(`/admin/users/${id}/reset-mfa`, { reason: r })) }, t("Réinitialiser la 2FA", "Reset 2FA")));
  }
  if (perms.has("moderation.act")) {
    actions.push(h("button", { class: "btn", onclick: reasoned(u.profile_hidden ? t("Rendre le profil visible", "Unhide profile") : t("Masquer le profil", "Hide profile"),
      r => post("/admin/moderation", { user_id: id, action: u.profile_hidden ? "unhide_profile" : "hide_profile", reason: r })) }, u.profile_hidden ? t("Rendre visible", "Unhide") : t("Masquer le profil", "Hide profile")),
    h("button", { class: "btn", onclick: reasoned(t("Avertir", "Warn"), r => post("/admin/moderation", { user_id: id, action: "warn", reason: r })) }, t("Avertir", "Warn")),
    h("button", { class: "btn", onclick: reasoned(t("Suspendre les fonctions communautaires 7 jours", "Suspend community features for 7 days"),
      r => post("/admin/moderation", { user_id: id, action: "suspend_social", reason: r, until: new Date(Date.now() + 7 * 864e5).toISOString() })) }, t("Suspendre le social (7 j)", "Suspend social (7 d)")));
  }
  const roleKeys = d.roles.map(r => r.key);
  const roleBtns = [["moderator", "roles.moderators", t("Modérateur", "Moderator")], ["administrator", "roles.administrators", t("Administrateur", "Administrator")]]
    .filter(([, p]) => perms.has(p)).map(([role, , label]) => {
      const has = roleKeys.includes(role);
      return h("button", { class: `btn small ${has ? "danger" : ""}`, onclick: reasoned(`${has ? t("Retirer", "Remove") : t("Donner", "Grant")} : ${label}`,
        r => post(`/admin/users/${id}/roles`, { role, action: has ? "revoke" : "grant", reason: r })) }, has ? `− ${label}` : `+ ${label}`);
    });
  const badgeSelect = h("select", { class: "input", style: { maxWidth: "240px" } });
  if (perms.has("badges.award")) {
    const { badges: all } = await get("/admin/badges");
    badgeSelect.append(...all.filter(b => b.manual_award && !b.protected && b.status == "active" && (!b.official || perms.has("badges.official"))).map(b => h("option", { value: b.key }, b.name)));
  }
  const note = h("textarea", { class: "input", placeholder: t("Note interne (visible par l'équipe uniquement)", "Internal note (team only)"), maxlength: 2000 });
  return [head(u.username, `${t("Inscrit le", "Joined")} ${fmtDate(u.created_at)} · ${u.email ?? ""}`, h("a", { class: "btn", href: `/u/${u.username}` }, icon("eye"), t("Profil public", "Public profile"))),
    h("section", { class: "panel stack" }, h("div", { class: "row wrap" }, STATUS_TAG(u.status), u.profile_hidden ? h("span", { class: "tag err" }, t("profil masqué", "profile hidden")) : null,
      u.social_suspended_until && new Date(u.social_suspended_until) > new Date() ? h("span", { class: "tag warn" }, `${t("social suspendu jusqu'au", "social suspended until")} ${fmtDate(u.social_suspended_until)}`) : null,
      h("span", { class: "tag" }, `${d.sessions} session(s)`), u.email_verified_at ? h("span", { class: "tag ok" }, t("e-mail vérifié", "verified e-mail")) : h("span", { class: "tag warn" }, t("e-mail non vérifié", "unverified e-mail"))),
    h("div", { class: "row wrap" }, ...actions)),
    h("section", { class: "panel stack" }, h("h2", {}, t("Rôles", "Roles")), h("div", { class: "chips" }, d.roles.map(r => h("span", { class: "chip" }, r.key))), roleBtns.length ? h("div", { class: "row wrap" }, ...roleBtns) : null),
    h("section", { class: "panel stack" }, h("h2", {}, t("Badges", "Badges")),
      d.badges.length ? table([t("Badge", "Badge"), t("Source", "Source"), t("Date", "Date"), t("État", "State"), ""], d.badges.map(b => h("tr", {},
        h("td", {}, b.name), h("td", {}, b.source), h("td", {}, fmtDate(b.awarded_at)), h("td", {}, b.revoked_at ? h("span", { class: "tag" }, `${t("retiré", "removed")} : ${b.revoke_reason ?? ""}`) : h("span", { class: "tag ok" }, t("actif", "active"))),
        h("td", {}, !b.revoked_at && perms.has("badges.award") && b.source == "manual" ? h("button", { class: "btn small danger", onclick: reasoned(`${t("Retirer", "Remove")} ${b.name}`,
          r => post(`/admin/users/${id}/badges`, { badge: b.key, action: "revoke", reason: r })) }, t("Retirer", "Remove")) : null)))) : h("p", { class: "muted", style: { margin: 0 } }, t("Aucun badge.", "No badge.")),
      perms.has("badges.award") ? h("div", { class: "row" }, badgeSelect, h("button", { class: "btn primary", onclick: reasoned(t("Attribuer le badge", "Award the badge"),
        r => post(`/admin/users/${id}/badges`, { badge: badgeSelect.value, action: "award", reason: r })) }, icon("award"), t("Attribuer", "Award"))) : null),
    d.reports.length ? h("section", { class: "stack" }, h("h2", {}, t("Signalements le concernant", "Reports about this user")),
      table([t("Motif", "Reason"), t("Détails", "Details"), t("Statut", "Status"), t("Date", "Date")], d.reports.map(r => h("tr", {}, h("td", {}, r.reason), h("td", {}, r.details ?? ""), h("td", {}, STATUS_TAG(r.status)), h("td", {}, fmtDate(r.created_at)))))) : null,
    d.moderation.length ? h("section", { class: "stack" }, h("h2", {}, t("Modération", "Moderation")),
      table([t("Action", "Action"), t("Motif", "Reason"), t("Contestation", "Appeal"), t("Date", "Date")], d.moderation.map(m => h("tr", {}, h("td", {}, m.action), h("td", {}, m.reason), h("td", {}, m.appeal_status ?? ""), h("td", {}, fmtDate(m.created_at)))))) : null,
    d.notes ? h("section", { class: "panel stack" }, h("h2", {}, t("Notes internes", "Internal notes")),
      ...d.notes.map(n => h("div", { class: "alert" }, h("div", {}, h("div", {}, n.body), h("div", { class: "faint small" }, `${n.author ?? "?"} · ${fmtDateTime(n.created_at)}`)))),
      note, h("button", { class: "btn", style: { width: "fit-content" }, onclick: async e => (await act(e.target, () => post(`/admin/users/${id}/notes`, { body: note.value }))) !== undefined && reload() }, t("Ajouter la note", "Add note"))) : null,
    d.history ? h("section", { class: "stack" }, h("h2", {}, t("Historique administratif", "Admin history")),
      table([t("Action", "Action"), t("Par", "By"), t("Motif", "Reason"), t("Date", "Date")], d.history.map(a => h("tr", {}, h("td", { class: "mono" }, a.action), h("td", {}, a.actor ?? ""), h("td", {}, a.reason ?? ""), h("td", {}, fmtDateTime(a.created_at)))))) : null];
}

const ICON_CHOICES = ["award", "star", "heart", "rocket", "shield-check", "code", "sparkles", "flask-conical", "bug", "gem", "crown", "flame", "globe", "users", "zap", "palette",
  "git-branch", "infinity", "calendar-heart", "compass", "book-open", "circle-check", "languages", "bot"];
const COLOR_CHOICES = ["#c4b5ff", "#7fd1ff", "#3dd68c", "#f5c518", "#f5b841", "#ff8da5", "#ff7a85", "#c9ccd8"];
const CATEGORIES = ["official", "support", "community", "seniority", "event", "contribution", "creator", "beta", "trust", "special"];

// Create or edit a badge, in a drawer with a live preview.
function badgeDrawer(b, perms) {
  const isNew = !b;
  const v = { key: "", name: "", description: "", icon: "award", category_key: "community", rarity: "common", color: "#c4b5ff", public: true, manual_award: true, permanent: true,
    duration_days: null, condition: "", status: "active", ...(b ?? {}) };
  const name = h("input", { class: "input", value: v.name, maxlength: 40 });
  const key = h("input", { class: "input mono", value: v.key, pattern: "[a-z0-9_]{2,40}", disabled: !isNew });
  let keyTouched = !isNew;
  key.addEventListener("input", () => (keyTouched = true));
  name.addEventListener("input", () => {
    if (!keyTouched) key.value = name.value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    draw();
  });
  const desc = h("textarea", { class: "input", rows: 2, maxlength: 200 });
  desc.value = v.description;
  const cond = h("textarea", { class: "input", rows: 2, maxlength: 300, placeholder: t("Affichée sur la page du badge", "Shown on the badge page") });
  cond.value = v.condition;
  let iconV = v.icon, colorV = v.color;
  const icons = h("div", { class: "icon-grid", role: "group", "aria-label": t("Icône", "Icon") });
  const drawIcons = () => icons.replaceChildren(...ICON_CHOICES.map(i => h("button", { type: "button", "aria-label": i, "aria-pressed": String(i == iconV), onclick: () => ((iconV = i), drawIcons(), draw()) }, icon(i))));
  const custom = h("input", { type: "color", value: colorV, "aria-label": t("Autre couleur", "Other color"), style: { width: "30px", height: "30px", padding: 0, border: 0, background: "none" } });
  const swatches = h("div", { class: "swatches", role: "group", "aria-label": t("Couleur", "Color") });
  const drawSwatches = () => swatches.replaceChildren(...COLOR_CHOICES.map(c => h("button", { type: "button", "aria-label": c, "aria-pressed": String(c == colorV), style: { "--c": c },
    onclick: () => ((colorV = c), drawSwatches(), draw()) })), custom);
  custom.addEventListener("input", () => ((colorV = custom.value), drawSwatches(), draw()));
  const cat = h("select", { class: "input" }, CATEGORIES.map(k => h("option", { value: k, selected: k == v.category_key }, k)));
  const rarity = h("select", { class: "input", onchange: () => draw() }, Object.entries(RARITY).map(([k, l]) => h("option", { value: k, selected: k == v.rarity }, l)));
  const sw = (label, hint, on) => {
    const input = h("input", { type: "checkbox", class: "switch", role: "switch", "aria-label": label });
    input.checked = on;
    return [input, h("label", { class: "switch-row" }, h("span", {}, h("b", {}, label), hint ? h("div", { class: "hint" }, hint) : null), input)];
  };
  const [pub, pubRow] = sw(t("Public", "Public"), t("Visible sur les profils et dans la liste", "Shown on profiles and in the badge list"), v.public);
  const [manual, manualRow] = sw(t("Attribuable à la main", "Awarded by hand"), t("Sinon, seulement par une règle automatique", "Otherwise only by an automatic rule"), v.manual_award);
  const [permanent, permRow] = sw(t("Permanent", "Permanent"), t("Désactivé : expire après un nombre de jours", "Off: expires after a number of days"), v.permanent);
  const days = h("input", { class: "input", type: "number", min: 1, max: 3650, value: v.duration_days ?? "", placeholder: t("Jours", "Days") });
  const daysField = field(t("Durée (jours)", "Duration (days)"), days);
  const syncDays = () => (daysField.hidden = permanent.checked);
  permanent.addEventListener("change", syncDays);
  syncDays();
  const status = h("select", { class: "input" }, ["active", "disabled", "retired"].map(s => h("option", { value: s, selected: s == v.status }, s)));
  const preview = h("div");
  const draw = () => preview.replaceChildren(h("div", { class: "file-row" },
    h("span", { class: "medal", style: { "--c": colorV, display: "grid", placeItems: "center", width: "48px", height: "48px", borderRadius: "12px", color: colorV, background: `color-mix(in srgb, ${colorV} 13%, transparent)` } }, icon(iconV)),
    h("span", { style: { display: "flex", flexDirection: "column", flex: 1 } }, h("b", {}, name.value || t("Nom du badge", "Badge name")), h("span", { class: "muted small" }, desc.value || RARITY[rarity.value])),
    h("span", { class: "faint small" }, t("Aperçu", "Preview"))));
  desc.addEventListener("input", draw);
  drawIcons();
  drawSwatches();
  draw();
  const save = h("button", { class: "btn primary" }, isNew ? t("Créer le badge", "Create badge") : t("Enregistrer", "Save"));
  const d = drawer(isNew ? t("Nouveau badge", "New badge") : `${t("Modifier", "Edit")} · ${b.name}`, [
    preview, field(t("Nom", "Name"), name),
    field(t("Identifiant", "Key"), key, h("span", { class: "hint" }, t("Minuscules, chiffres et _. Ne change plus ensuite.", "Lowercase letters, digits and _. Cannot change later."))),
    field("Description", desc),
    h("div", { class: "field" }, h("label", {}, t("Icône", "Icon")), icons),
    h("div", { class: "field" }, h("label", {}, t("Couleur", "Color")), swatches),
    h("div", { class: "row", style: { gap: "12px", alignItems: "flex-start" } }, h("div", { style: { flex: 1 } }, field(t("Catégorie", "Category"), cat)), h("div", { style: { flex: 1 } }, field(t("Rareté", "Rarity"), rarity))),
    field(t("Comment l'obtenir", "How to earn it"), cond),
    h("div", { class: "list" }, pubRow, manualRow, permRow), daysField,
    isNew ? null : field(t("État", "State"), status),
  ], [h("button", { class: "btn", onclick: () => d.close() }, t("Annuler", "Cancel")), save]);
  save.addEventListener("click", async () => {
    const body = { name: name.value, description: desc.value, icon: iconV, category_key: cat.value, rarity: rarity.value, color: colorV, public: pub.checked,
      manual_award: manual.checked, permanent: permanent.checked, duration_days: permanent.checked ? null : Number(days.value) || null, condition: cond.value };
    const r = await act(save, () => (isNew ? post("/admin/badges", { key: key.value, ...body }) : patch(`/admin/badges/${b.key}`, { ...body, status: status.value })),
      { ok: isNew ? t("Badge créé", "Badge created") : t("Badge enregistré", "Badge saved") });
    if (r !== undefined) {
      d.close();
      go(location.pathname, { replace: true });
    }
  });
}

async function badges({ perms, query }) {
  const { badges: all } = await get("/admin/badges");
  const filter = query.f ?? "";
  const shown = all.filter(b => !filter || (filter == "official" ? b.official : filter == "drafts" ? b.status != "active" : b.category_key == filter));
  const awarded = all.reduce((n, b) => n + (b.holders ?? 0), 0);
  return [head(t("Badges", "Badges"), `${all.length} badges · ${awarded.toLocaleString()} ${t("attribués", "awarded")}`,
    perms.has("badges.award") ? h("button", { class: "btn", onclick: () => awardDrawer({ perms }) }, icon("award"), t("Attribuer", "Award badge")) : null,
    perms.has("badges.manage") ? h("button", { class: "btn primary", onclick: () => badgeDrawer(null, perms) }, icon("plus"), t("Nouveau badge", "New badge")) : null),
  h("div", { class: "tabs" }, [["", t("Tous", "All")], ["official", t("Officiels", "Official")], ["support", t("Soutien", "Supporter")], ["community", t("Communauté", "Community")], ["drafts", t("Inactifs", "Inactive")]]
    .map(([k, l]) => h("a", { href: k ? `/admin/badges?f=${k}` : "/admin/badges", "aria-current": k == filter ? "page" : null }, l))),
  table([t("Badge", "Badge"), t("Rareté", "Rarity"), t("Attribution", "Awarded by"), t("Détenteurs", "Holders"), t("État", "State"), ""],
    shown.map(b => {
      const lb = localBadge(b);
      return h("tr", {}, h("td", {}, h("a", { class: "row", href: `/admin/badges/${b.key}` }, h("span", { class: "badge-mini", style: { "--c": b.color, width: "34px", height: "34px", borderRadius: "9px" } }, icon(b.icon)),
        h("span", { style: { display: "flex", flexDirection: "column" } }, h("b", { style: { fontWeight: 500 } }, lb.name), h("span", { class: "faint small mono" }, b.key)))),
      h("td", { class: "muted" }, RARITY[b.rarity]), h("td", { class: "muted" }, b.rules?.length ? t("Règle", "Rule") : b.manual_award ? t("À la main", "By hand") : t("Rôle / événement", "Role / event")),
      h("td", {}, (b.holders ?? 0).toLocaleString()), h("td", {}, b.official ? h("span", { class: "dot", style: { "--c": "#f5c518" } }, t("officiel", "official")) : STATUS_TAG(b.status)),
      h("td", { style: { textAlign: "right", whiteSpace: "nowrap" } },
        perms.has("badges.award") && b.manual_award && !b.protected && b.status == "active" && (!b.official || perms.has("badges.official"))
          ? h("button", { class: "btn small quiet", style: { color: "var(--lav)" }, onclick: () => awardDrawer({ perms, badge: b.key }) }, t("Attribuer", "Award")) : null,
        perms.has("badges.manage") && !b.protected ? h("button", { class: "btn small quiet", onclick: () => badgeDrawer(b, perms) }, t("Modifier", "Edit")) : null));
    }))];
}

async function badgeDetail({ perms, id }) {
  const { badges: all } = await get("/admin/badges");
  const b = all.find(x => x.key == id);
  if (!b) return empty("award", t("Badge introuvable.", "Badge not found."));
  const { holders, history } = await get(`/admin/badges/${id}/holders`);
  return [head(b.name, b.description, h("a", { class: "btn", href: `/badges/${b.key}` }, icon("eye"), t("Page publique", "Public page"))),
    perms.has("badges.manage") && !b.protected ? h("div", { class: "row" }, h("button", { class: "btn", onclick: () => badgeDrawer(b, perms) }, icon("pencil"), t("Modifier", "Edit")),
      perms.has("badges.award") ? h("button", { class: "btn primary", onclick: () => awardDrawer({ perms, badge: b.key }) }, icon("award"), t("Attribuer", "Award")) : null) : null,
    h("section", { class: "panel stack" }, h("h2", {}, t("Règles", "Rules")), b.rules?.length ? h("div", { class: "chips" }, b.rules.map(r => h("span", { class: "chip mono" }, `${r.type} ${JSON.stringify(r.params)}`))) : h("p", { class: "muted", style: { margin: 0 } }, t("Attribution manuelle ou par événement.", "Manual or event award."))),
    h("section", { class: "stack" }, h("h2", {}, `${t("Détenteurs", "Holders")} (${holders.length})`),
      holders.length ? table([t("Membre", "Member"), t("Source", "Source"), t("Date", "Date")], holders.map(x => h("tr", {}, h("td", {}, h("a", { class: "link", href: `/admin/users/${x.user_id}` }, x.username)), h("td", {}, x.source), h("td", {}, fmtDate(x.awarded_at))))) : h("p", { class: "muted" }, "—")),
    h("section", { class: "stack" }, h("h2", {}, t("Historique", "History")),
      history.length ? table([t("Action", "Action"), t("Membre", "Member"), t("Par", "By"), t("Motif", "Reason"), t("Date", "Date")], history.map(e => h("tr", {}, h("td", {}, e.action), h("td", {}, e.username ?? ""), h("td", {}, e.actor ?? e.source), h("td", {}, e.reason ?? ""), h("td", {}, fmtDateTime(e.created_at))))) : h("p", { class: "muted" }, "—"))];
}

async function reports({ perms, query }) {
  const status = query.status ?? "open";
  const { reports: list } = await get(`/admin/reports?status=${status}`);
  const appeals = perms.has("reports.handle") ? (await get("/admin/appeals")).appeals : [];
  const filter = h("div", { class: "tabs" }, ...["open", "reviewing", "resolved", "dismissed"].map(s => h("button", { "aria-selected": String(s == status), onclick: () => go(`/admin/reports?status=${s}`) }, s)));
  const handle = (r, st) => async e => {
    const resolution = st == "reviewing" ? null : await promptDialog({ title: t("Résolution", "Resolution"), label: t("Ce qui a été décidé", "What was decided"), action: t("Valider", "Confirm") });
    if (st != "reviewing" && !resolution) return;
    if ((await act(e.target, () => post(`/admin/reports/${r.id}`, { status: st, resolution }))) !== undefined) go(location.pathname + location.search, { replace: true });
  };
  return [head(t("Signalements", "Reports"), null, filter),
    list.length ? table([t("Cible", "Target"), t("Motif", "Reason"), t("Détails", "Details"), t("Par", "By"), t("Date", "Date"), ""], list.map(r => h("tr", {},
      h("td", {}, r.target_type == "user" ? h("a", { class: "link", href: perms.has("users.read") ? `/admin/users/${r.target_id}` : `/u/${r.target_label}` }, r.target_label ?? "?") : h("span", {}, `${t("Collection", "Collection")} : ${r.target_label ?? "?"}`)),
      h("td", {}, r.reason), h("td", { style: { maxWidth: "260px" } }, r.details ?? ""), h("td", {}, r.reporter ?? "—"), h("td", {}, fmtDate(r.created_at)),
      h("td", {}, perms.has("reports.handle") && ["open", "reviewing"].includes(r.status) ? h("div", { class: "row" },
        r.status == "open" ? h("button", { class: "btn small", onclick: handle(r, "reviewing") }, t("Examiner", "Review")) : null,
        h("button", { class: "btn small primary", onclick: handle(r, "resolved") }, t("Résolu", "Resolved")),
        h("button", { class: "btn small", onclick: handle(r, "dismissed") }, t("Rejeter", "Dismiss"))) : h("span", { class: "faint small" }, r.resolution ?? "")))))
      : h("div", { class: "card" }, empty("flag", t("Aucun signalement.", "No report."))),
    appeals.length ? h("section", { class: "stack" }, h("h2", {}, t("Contestations en attente", "Pending appeals")),
      table([t("Membre", "Member"), t("Décision", "Decision"), t("Contestation", "Appeal"), ""], appeals.map(a => h("tr", {}, h("td", {}, a.username), h("td", {}, `${a.action} : ${a.reason}`),
        h("td", {}, a.appeal_text), h("td", {}, h("div", { class: "row" },
          ...["accepted", "rejected"].map(dec => h("button", { class: `btn small ${dec == "accepted" ? "primary" : ""}`, onclick: async e => {
            const reason = await promptDialog({ title: dec == "accepted" ? t("Accepter la contestation", "Accept the appeal") : t("Refuser la contestation", "Reject the appeal"), label: t("Motif", "Reason"), action: t("Valider", "Confirm") });
            if (reason && (await act(e.target, () => post(`/admin/appeals/${a.id}`, { decision: dec, reason }))) !== undefined) go(location.pathname, { replace: true });
          } }, dec == "accepted" ? t("Accepter", "Accept") : t("Refuser", "Reject"))))))))) : null];
}

async function donations({ perms, query }) {
  const status = query.status ?? "";
  const [{ donations: list, refunds }, { events }, settings] = await Promise.all([get(`/admin/donations${status ? `?status=${status}` : ""}`), get("/admin/webhooks"), get("/admin/donations/settings")]);
  const filter = h("div", { class: "tabs" }, ...[["", t("Tous", "All")], ["succeeded", "succeeded"], ["refunded", "refunded"], ["failed", "failed"], ["disputed", "disputed"]]
    .map(([s, l]) => h("button", { "aria-selected": String(s == status), onclick: () => go(`/admin/donations${s ? `?status=${s}` : ""}`) }, l)));
  const amounts = h("input", { class: "input", value: settings.donation_amounts.map(c => c / 100).join(", ") });
  const tierInputs = settings.tiers.map(tr => [tr.key, h("input", { class: "input", type: "number", min: 1, value: tr.threshold_cents / 100 })]);
  const early = h("input", { class: "input", type: "date", value: settings.early_supporter_until ? settings.early_supporter_until.slice(0, 10) : "" });
  return [head(t("Dons", "Donations"), t("Les remboursements se font dans Stripe ; ils arrivent ici par webhook.", "Refunds are made in Stripe; they arrive here by webhook."), filter),
    list.length ? table([t("Date", "Date"), t("Membre", "Member"), t("Montant", "Amount"), t("Type", "Type"), t("Statut", "Status"), t("Référence Stripe", "Stripe reference")],
      list.map(d => h("tr", {}, h("td", {}, fmtDateTime(d.created_at)), h("td", {}, d.username ?? "—"),
        h("td", {}, fmtMoney(d.amount_cents, d.currency), d.refunded_cents ? h("span", { class: "faint" }, ` −${fmtMoney(d.refunded_cents, d.currency)}`) : null),
        h("td", {}, d.recurring ? t("mensuel", "monthly") : t("ponctuel", "one-time")), h("td", {}, STATUS_TAG(d.status)), h("td", { class: "mono" }, d.payment_ref ?? d.invoice_ref ?? d.checkout_ref ?? ""))))
      : h("div", { class: "card" }, empty("receipt", t("Aucun don.", "No donation."))),
    refunds.length ? h("section", { class: "stack" }, h("h2", {}, t("Remboursements", "Refunds")),
      table([t("Date", "Date"), t("Montant", "Amount"), t("Statut", "Status"), t("Référence", "Reference")], refunds.map(r => h("tr", {}, h("td", {}, fmtDateTime(r.created_at)), h("td", {}, fmtMoney(r.amount_cents)), h("td", {}, r.status), h("td", { class: "mono" }, r.provider_refund_id))))) : null,
    h("section", { class: "stack" }, h("h2", {}, t("Événements Stripe", "Stripe events")),
      events.length ? table([t("Reçu", "Received"), t("Type", "Type"), t("Statut", "Status"), t("Essais", "Attempts"), t("Erreur", "Error"), ""], events.map(ev => h("tr", {},
        h("td", {}, fmtDateTime(ev.received_at)), h("td", { class: "mono" }, ev.type), h("td", {}, STATUS_TAG(ev.status)), h("td", {}, ev.attempts), h("td", { class: "small" }, ev.error ?? ""),
        h("td", {}, ev.status == "failed" && perms.has("donations.settings") ? h("button", { class: "btn small", onclick: async e => (await act(e.target, () => post(`/admin/webhooks/${ev.id}/retry`), { ok: t("Traité", "Processed") })) !== undefined && go(location.pathname, { replace: true }) }, icon("refresh-cw"), t("Réessayer", "Retry")) : null))))
        : h("div", { class: "card" }, empty("webhook", t("Aucun événement reçu.", "No event received.")))),
    perms.has("donations.settings") ? h("form", { class: "card stack", onsubmit: async e => {
      e.preventDefault();
      const body = {
        donation_amounts: amounts.value.split(",").map(x => Math.round(Number(x.trim()) * 100)).filter(Boolean),
        tiers: Object.fromEntries(tierInputs.map(([k, i]) => [k, Math.round(Number(i.value) * 100)])),
        early_supporter_until: early.value ? new Date(`${early.value}T23:59:59Z`).toISOString() : null,
      };
      await act(e.submitter, () => put("/admin/donations/settings", body), { ok: t("Réglages enregistrés", "Settings saved") });
    } }, h("h2", {}, t("Réglages", "Settings")),
    field(t("Montants suggérés (€, séparés par des virgules)", "Suggested amounts (€, comma-separated)"), amounts),
    h("div", { class: "grid cols-4" }, tierInputs.map(([k, i]) => field(`${k} (€ ${t("nets cumulés", "net total")})`, i))),
    field(t("Early Supporter : dons confirmés avant le (vide = période close)", "Early Supporter: confirmed donations before (empty = closed)"), early),
    h("button", { class: "btn primary", type: "submit", style: { width: "fit-content" } }, t("Enregistrer", "Save"))) : null];
}

async function audit({ query }) {
  const { entries } = await get(`/admin/audit${query.action ? `?action=${encodeURIComponent(query.action)}` : ""}`);
  return [head(t("Journal d'audit", "Audit log"), t("Lecture seule : la base refuse toute modification ou suppression.", "Read only: the database refuses any change or deletion.")),
    entries.length ? table([t("Date", "Date"), t("Acteur", "Actor"), t("Action", "Action"), t("Cible", "Target"), t("Motif", "Reason"), "IP"], entries.map(a => h("tr", {},
      h("td", {}, fmtDateTime(a.created_at)), h("td", {}, a.actor ?? "—"), h("td", { class: "mono" }, a.action), h("td", { class: "mono small" }, a.target_type ? `${a.target_type}:${(a.target_id ?? "").slice(0, 12)}` : ""),
      h("td", {}, a.reason ?? ""), h("td", { class: "mono small" }, a.ip ?? ""))))
      : h("div", { class: "card" }, empty("scroll-text", t("Journal vide.", "Empty log.")))];
}

// ---- mods: the review queue
async function reviewDrawer(id) {
  const v = await get(`/admin/mods/versions/${id}`);
  const files = v.files ?? {};
  const checks = v.checks ?? {};
  const row = (ic, c, title, text) => h("div", { class: "check-row", style: { "--c": c } }, icon(ic), h("div", {}, h("b", {}, title), text ? h("span", {}, text) : null));
  const warnings = checks.warnings ?? [];
  const codeBox = h("pre", { class: "code" }, files["chrome.css"] ?? "");
  const showing = { v: "orbit" };
  const toggle = v.original_css ? h("div", { class: "seg", style: { width: "fit-content" } },
    ...[["orbit", t("Version Orbit", "Orbit version")], ["original", t("Original (Zen)", "Original (Zen)")]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(k == showing.v), onclick: e => {
      showing.v = k;
      codeBox.textContent = k == "orbit" ? files["chrome.css"] : v.original_css;
      e.target.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b == e.target)));
    } }, l))) : null;
  const note = h("textarea", { class: "input", rows: 2, maxlength: 1000, placeholder: t("Obligatoire pour refuser", "Required when rejecting") });
  const decide = action => async e => {
    const r = await act(e.target, () => post(`/admin/mods/versions/${id}/review`, { action, note: note.value.trim() || undefined }),
      { ok: action == "approve" ? t("Mod publié", "Mod listed") : t("Mod refusé", "Mod rejected") });
    if (r !== undefined) {
      d.close();
      go(location.pathname + location.search, { replace: true });
    }
  };
  const pending = v.status == "pending";
  const d = drawer(t("Vérifier le mod", "Review mod"), [
    h("div", { class: "stack", style: { gap: "4px" } }, h("b", { style: { fontSize: "20px", fontWeight: 600 } }, v.name),
      h("span", { class: "muted small" }, `@${v.username} · ${v.source == "zen" ? t("import Zen", "Zen import") : t("envoi", "upload")} · version ${v.version}`),
      v.summary ? h("p", { class: "muted small" }, v.summary) : null),
    h("section", {}, h("h3", { class: "section-title" }, t("Contrôles", "Checks")),
      row("circle-check", "var(--ok)", t("Fichiers", "Files"), Object.keys(files).join(", ")),
      row("circle-check", "var(--ok)", t("Aucun contenu distant", "No remote content"), t("Pas de url() vers Internet, pas de @import", "No url() to the internet, no @import")),
      checks.zen && checks.conversion ? row("refresh-cw", "var(--lav)", t("Converti depuis Zen", "Converted from Zen"),
        `${checks.conversion.selectors} ${t("sélecteurs", "selectors")}, ${checks.conversion.variables} variables`) : null,
      ...warnings.slice(0, 12).map(w => row("circle-alert", "var(--warn)", w.code, [w.file, w.detail].filter(Boolean).join(" · ")))),
    v.images?.length ? h("section", { class: "stack", style: { gap: "8px" } }, h("h3", { class: "section-title" }, t("Captures", "Screenshots")),
      h("div", { class: "shots" }, v.images.map(src => h("a", { class: "shot-item", href: src, target: "_blank", style: { backgroundImage: `url("${src}")` }, "aria-label": t("Ouvrir l'image", "Open picture") })))) : null,
    h("section", { class: "stack", style: { gap: "8px" } }, h("h3", { class: "section-title" }, "chrome.css"), toggle, codeBox),
    files["preferences.json"] ? h("section", { class: "stack", style: { gap: "8px" } }, h("h3", { class: "section-title" }, "preferences.json"), h("pre", { class: "code" }, files["preferences.json"])) : null,
    files["readme.md"] ? h("section", { class: "stack", style: { gap: "8px" } }, h("h3", { class: "section-title" }, "readme.md"), h("pre", { class: "code" }, files["readme.md"])) : null,
    pending ? field(t("Note à l'auteur", "Note to the author"), note) : h("p", { class: "muted small" }, `${v.status}${v.review_note ? ` · ${v.review_note}` : ""}`),
  ], pending ? [h("button", { class: "btn danger", onclick: decide("reject") }, t("Refuser", "Reject")), h("button", { class: "btn primary", onclick: decide("approve") }, t("Approuver et publier", "Approve and list"))] : []);
}

async function mods({ query }) {
  const status = query.status ?? "pending";
  const { versions, pending } = await get(`/admin/mods?status=${status}`);
  return [head("Mods", `${pending} ${t("en attente de vérification", "waiting for review")}`, h("a", { class: "btn", href: "/mods", target: "_blank" }, icon("external-link"), t("Voir la boutique", "Open the store"))),
    h("div", { class: "tabs" }, [["pending", `${t("À vérifier", "To review")} · ${pending}`], ["approved", t("Publiés", "Listed")], ["rejected", t("Refusés", "Rejected")]]
      .map(([k, l]) => h("a", { href: `/admin/mods?status=${k}`, "aria-current": k == status ? "page" : null }, l))),
    versions.length ? table(["Mod", t("Source", "Source"), t("Contrôles", "Checks"), status == "pending" ? t("En attente depuis", "Waiting since") : t("Date", "Date"), ""],
      versions.map(v => h("tr", {}, h("td", {}, h("span", { style: { display: "flex", flexDirection: "column" } }, h("b", { style: { fontWeight: 500 } }, `${v.name} ${v.version}`), h("span", { class: "faint small" }, `@${v.username}`))),
        h("td", { class: "muted" }, v.zen ? t("Import Zen", "Zen import") : t("Envoi", "Upload")),
        h("td", {}, v.warnings ? h("span", { class: "dot", style: { "--c": "var(--warn)" } }, `${v.warnings} ${t("à regarder", "to look at")}`) : h("span", { class: "dot", style: { "--c": "var(--ok)" } }, t("Tout est bon", "All checks passed"))),
        h("td", { class: "muted" }, fmtDate(v.created_at)),
        h("td", { style: { textAlign: "right" } }, h("button", { class: "btn small", onclick: () => reviewDrawer(v.id) }, status == "pending" ? t("Vérifier", "Review") : t("Ouvrir", "Open"))))))
      : empty("circle-check", status == "pending" ? t("Aucun mod en attente.", "No mod waiting.") : t("Rien ici.", "Nothing here."))];
}
