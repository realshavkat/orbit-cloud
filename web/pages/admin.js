// Administration. The menu shows what the account's permissions allow; the
// server checks the same permissions on every call.
import { h, icon, t, get, post, patch, put, api, act, field, empty, fmtDate, fmtDateTime, fmtMoney, RARITY, promptDialog, confirmDialog, toast, badgeCard, avatar, errorBox } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);

const TABS = [
  ["", "gauge", t("Tableau de bord", "Dashboard"), "stats.read"],
  ["users", "users", t("Utilisateurs", "Users"), "users.read"],
  ["badges", "award", t("Badges", "Badges"), "badges.award"],
  ["reports", "flag", t("Signalements", "Reports"), "reports.read"],
  ["donations", "receipt", t("Dons", "Donations"), "donations.read"],
  ["audit", "scroll-text", t("Journal d'audit", "Audit log"), "audit.read"],
];

export async function page({ params, query }) {
  let me;
  try {
    me = await get("/admin/me");
  } catch {
    return h("div", { class: "card" }, empty("lock", t("Accès réservé à l'équipe.", "Team only.")));
  }
  const perms = new Set(me.permissions);
  const tabs = TABS.filter(([, , , p]) => perms.has(p));
  const tab = params.tab ?? (perms.has("stats.read") ? "" : tabs[0]?.[0]);
  const nav = h("nav", { class: "sidenav", "aria-label": t("Administration", "Administration") }, h("div", { class: "label" }, me.roles[0] ?? ""),
    ...tabs.map(([k, ic, label]) => h("a", { href: k ? `/admin/${k}` : "/admin", "aria-current": k == tab ? "page" : null }, icon(ic), label)));
  const fn = { "": dashboard, users: params.id ? userDetail : users, badges: params.id ? badgeDetail : badges, reports, donations, audit }[tab];
  if (!fn || !tabs.some(([k]) => k == tab)) return h("div", { class: "split" }, nav, h("div", { class: "card" }, empty("lock", t("Pas d'accès à cette section.", "No access to this section."))));
  return h("div", { class: "split" }, nav, h("div", { class: "stack" }, await fn({ perms, id: params.id, query })));
}

const head = (title, sub, ...actions) => h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null), h("div", { class: "row wrap" }, ...actions));
const stat = (value, label, c) => h("div", { class: "stat", style: c ? { "--c": c } : null }, h("b", {}, value), h("span", {}, label));
const table = (cols, rows) => h("div", { class: "card flat", style: { overflowX: "auto" } }, h("table", {}, h("thead", {}, h("tr", {}, cols.map(c => h("th", {}, c)))), h("tbody", {}, rows)));
const STATUS_TAG = s => h("span", { class: `tag ${{ active: "ok", succeeded: "ok", processed: "ok", resolved: "ok", suspended: "err", failed: "err", disputed: "err", open: "warn", pending: "warn", reviewing: "warn", refunded: "warn", partially_refunded: "warn" }[s] ?? ""}` }, s);

async function dashboard({ perms }) {
  const s = await get("/admin/stats");
  const maxBadge = Math.max(1, ...s.badges.map(b => b.n));
  return [head(t("Tableau de bord", "Dashboard"), t("« Actifs » = connectés au moins une fois ces 30 derniers jours.", "\"Active\" = signed in at least once in the last 30 days.")),
    h("div", { class: "grid cols-4" },
      stat(s.users.total, t("comptes", "accounts")), stat(s.users.new_7d, t("nouveaux (7 j)", "new (7 d)")), stat(s.users.new_30d, t("nouveaux (30 j)", "new (30 d)")),
      stat(s.users.active_30d, t("actifs (30 j)", "active (30 d)")), stat(s.users.verified, t("e-mails vérifiés", "verified e-mails")), stat(s.users.suspended, t("suspendus", "suspended")),
      stat(s.reports_open, t("signalements ouverts", "open reports")), stat(s.appeals_pending, t("contestations", "appeals"))),
    s.donations ? h("section", { class: "stack" }, h("h2", {}, t("Dons", "Donations")), h("div", { class: "grid cols-4" },
      stat(s.donations.confirmed, t("dons confirmés", "confirmed donations")), stat(fmtMoney(s.donations.gross_cents), t("total brut", "gross total")),
      stat(fmtMoney(s.donations.net_cents), t("total net (remboursements déduits)", "net total (refunds deducted)")),
      stat(`${s.donations.failed} / ${s.donations.disputed}`, t("échoués / contestés", "failed / disputed")))) : null,
    h("div", { class: "grid cols-2" },
      h("section", { class: "card stack" }, h("h2", {}, t("Badges attribués", "Badges awarded")),
        ...s.badges.filter(b => b.n).slice(0, 12).map(b => h("div", { class: "stack", style: { gap: "4px" } }, h("div", { class: "row between small" }, h("span", {}, b.name), h("b", {}, b.n)),
          h("div", { class: "bar", style: { "--c": b.color } }, h("i", { style: { width: `${(b.n / maxBadge) * 100}%` } })))),
        s.badges.every(b => !b.n) ? empty("award", t("Aucun badge attribué.", "No badge awarded.")) : null),
      h("section", { class: "card stack" }, h("h2", {}, t("Services", "Services")),
        ...[["database", t("Base de données", "Database")], ["mail", t("E-mails (SMTP)", "E-mail (SMTP)")], ["donations", t("Paiements (Stripe)", "Payments (Stripe)")]].map(([k, l]) =>
          h("div", { class: "row between" }, h("span", {}, l), h("span", { class: `tag ${s.services[k] ? "ok" : "warn"}` }, s.services[k] ? t("opérationnel", "running") : t("non configuré", "not configured")))),
        h("div", { class: "row between" }, h("span", {}, t("Webhooks en échec", "Failed webhooks")), h("span", { class: `tag ${s.webhooks.failed ? "err" : "ok"}` }, String(s.webhooks.failed))),
        h("div", { class: "row between" }, h("span", {}, t("Webhooks en attente", "Pending webhooks")), h("span", { class: "tag" }, String(s.webhooks.pending)))))];
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
    h("section", { class: "card stack" }, h("div", { class: "row wrap" }, STATUS_TAG(u.status), u.profile_hidden ? h("span", { class: "tag err" }, t("profil masqué", "profile hidden")) : null,
      u.social_suspended_until && new Date(u.social_suspended_until) > new Date() ? h("span", { class: "tag warn" }, `${t("social suspendu jusqu'au", "social suspended until")} ${fmtDate(u.social_suspended_until)}`) : null,
      h("span", { class: "tag" }, `${d.sessions} session(s)`), u.email_verified_at ? h("span", { class: "tag ok" }, t("e-mail vérifié", "verified e-mail")) : h("span", { class: "tag warn" }, t("e-mail non vérifié", "unverified e-mail"))),
    h("div", { class: "row wrap" }, ...actions)),
    h("section", { class: "card stack" }, h("h2", {}, t("Rôles", "Roles")), h("div", { class: "chips" }, d.roles.map(r => h("span", { class: "chip" }, r.key))), roleBtns.length ? h("div", { class: "row wrap" }, ...roleBtns) : null),
    h("section", { class: "card stack" }, h("h2", {}, t("Badges", "Badges")),
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
    d.notes ? h("section", { class: "card stack" }, h("h2", {}, t("Notes internes", "Internal notes")),
      ...d.notes.map(n => h("div", { class: "alert" }, h("div", {}, h("div", {}, n.body), h("div", { class: "faint small" }, `${n.author ?? "?"} · ${fmtDateTime(n.created_at)}`)))),
      note, h("button", { class: "btn", style: { width: "fit-content" }, onclick: async e => (await act(e.target, () => post(`/admin/users/${id}/notes`, { body: note.value }))) !== undefined && reload() }, t("Ajouter la note", "Add note"))) : null,
    d.history ? h("section", { class: "stack" }, h("h2", {}, t("Historique administratif", "Admin history")),
      table([t("Action", "Action"), t("Par", "By"), t("Motif", "Reason"), t("Date", "Date")], d.history.map(a => h("tr", {}, h("td", { class: "mono" }, a.action), h("td", {}, a.actor ?? ""), h("td", {}, a.reason ?? ""), h("td", {}, fmtDateTime(a.created_at)))))) : null];
}

const ICON_CHOICES = ["award", "star", "heart", "rocket", "shield", "shield-check", "code", "sparkles", "flask-conical", "bug", "git-branch", "gem", "globe", "users", "circle-check", "infinity", "calendar-heart"];

function badgeForm(b, perms, onSaved) {
  const isNew = !b;
  const v = { key: "", name: "", description: "", icon: "award", category_key: "community", rarity: "common", color: "#7c86ff", public: true, manual_award: true, permanent: true, duration_days: null, condition: "", status: "active", ...(b ?? {}) };
  const key = h("input", { class: "input", value: v.key, pattern: "[a-z0-9_]{2,40}", disabled: !isNew });
  const name = h("input", { class: "input", value: v.name, maxlength: 40 });
  const desc = h("input", { class: "input", value: v.description, maxlength: 200 });
  const cond = h("textarea", { class: "input", maxlength: 300 });
  cond.value = v.condition;
  const iconSel = h("select", { class: "input" }, ...ICON_CHOICES.map(i => h("option", { value: i, selected: i == v.icon }, i)));
  const cat = h("select", { class: "input" }, ...Object.keys({ official: 1, support: 1, community: 1, seniority: 1, event: 1, contribution: 1, creator: 1, beta: 1, trust: 1, special: 1 })
    .map(k => h("option", { value: k, selected: k == v.category_key }, k)));
  const rarity = h("select", { class: "input" }, ...Object.entries(RARITY).map(([k, l]) => h("option", { value: k, selected: k == v.rarity }, l)));
  const color = h("input", { class: "input", type: "color", value: v.color, style: { padding: "4px", width: "80px" } });
  const status = h("select", { class: "input" }, ...["active", "disabled", "retired"].map(s => h("option", { value: s, selected: s == v.status }, s)));
  const pub = h("input", { type: "checkbox", checked: v.public });
  const manual = h("input", { type: "checkbox", checked: v.manual_award });
  const permanent = h("input", { type: "checkbox", checked: v.permanent });
  const days = h("input", { class: "input", type: "number", min: 1, max: 3650, value: v.duration_days ?? "", placeholder: t("Jours", "Days") });
  const preview = h("div");
  const drawPreview = () => preview.replaceChildren(badgeCard({ key: key.value || "preview", name: name.value || t("Nom du badge", "Badge name"), icon: iconSel.value, color: color.value, rarity: rarity.value }, { href: "#" }));
  for (const el of [name, iconSel, color, rarity, key]) el.addEventListener("input", drawPreview);
  drawPreview();
  const err = h("div");
  return h("form", { class: "card stack", onsubmit: async e => {
    e.preventDefault();
    const body = { name: name.value, description: desc.value, icon: iconSel.value, category_key: cat.value, rarity: rarity.value, color: color.value, public: pub.checked,
      manual_award: manual.checked, permanent: permanent.checked, duration_days: permanent.checked ? null : Number(days.value) || null, condition: cond.value };
    const r = await act(e.submitter, () => (isNew ? post("/admin/badges", { key: key.value, ...body }) : patch(`/admin/badges/${b.key}`, { ...body, status: status.value })), { ok: t("Badge enregistré", "Badge saved") });
    if (r !== undefined) onSaved();
  } },
  h("h2", {}, isNew ? t("Nouveau badge", "New badge") : t("Modifier", "Edit")),
  h("div", { class: "grid cols-2" }, field(t("Identifiant (fixe)", "Key (fixed)"), key), field(t("Nom", "Name"), name)),
  field(t("Description", "Description"), desc), field(t("Condition d'obtention (affichée)", "How to earn it (shown)"), cond),
  h("div", { class: "grid cols-4" }, field(t("Icône", "Icon"), iconSel), field(t("Catégorie", "Category"), cat), field(t("Rareté", "Rarity"), rarity), field(t("Couleur", "Color"), color)),
  h("div", { class: "row wrap" }, h("label", { class: "check" }, pub, t("Public", "Public")), h("label", { class: "check" }, manual, t("Attribuable à la main", "Manual award")),
    h("label", { class: "check" }, permanent, t("Permanent", "Permanent")), days, !isNew ? field(t("État", "State"), status) : null),
  h("div", { class: "field" }, h("label", {}, t("Aperçu", "Preview")), preview), err,
  h("button", { class: "btn primary", type: "submit", style: { width: "fit-content" } }, t("Enregistrer", "Save")));
}

async function badges({ perms }) {
  const { badges: all } = await get("/admin/badges");
  const formBox = h("div");
  return [head(t("Badges", "Badges"), t("Les badges officiels et de soutien sont protégés : leurs règles ne changent qu'avec les droits adéquats.", "Official and support badges are protected: their rules only change with the right permissions."),
    perms.has("badges.manage") ? h("button", { class: "btn primary", onclick: () => formBox.replaceChildren(badgeForm(null, perms, () => go("/admin/badges", { replace: true }))) }, icon("plus"), t("Nouveau badge", "New badge")) : null),
  formBox,
  table([t("Badge", "Badge"), t("Catégorie", "Category"), t("Rareté", "Rarity"), t("Détenteurs", "Holders"), t("État", "State"), ""],
    all.map(b => h("tr", {}, h("td", {}, h("span", { class: "row" }, h("span", { class: "badge-mini", style: { "--c": b.color } }, icon(b.icon)), b.name,
      b.official ? h("span", { class: "tag" }, t("officiel", "official")) : null, b.protected ? h("span", { class: "tag err" }, t("protégé", "protected")) : null)),
    h("td", {}, b.category_key), h("td", {}, RARITY[b.rarity]), h("td", {}, b.holders), h("td", {}, STATUS_TAG(b.status)),
    h("td", {}, h("a", { class: "btn small", href: `/admin/badges/${b.key}` }, t("Ouvrir", "Open"))))))];
}

async function badgeDetail({ perms, id }) {
  const { badges: all } = await get("/admin/badges");
  const b = all.find(x => x.key == id);
  if (!b) return empty("award", t("Badge introuvable.", "Badge not found."));
  const { holders, history } = await get(`/admin/badges/${id}/holders`);
  return [head(b.name, b.description, h("a", { class: "btn", href: `/badges/${b.key}` }, icon("eye"), t("Page publique", "Public page"))),
    perms.has("badges.manage") && !b.protected ? badgeForm(b, perms, () => go(location.pathname, { replace: true })) : null,
    h("section", { class: "card stack" }, h("h2", {}, t("Règles", "Rules")), b.rules?.length ? h("div", { class: "chips" }, b.rules.map(r => h("span", { class: "chip mono" }, `${r.type} ${JSON.stringify(r.params)}`))) : h("p", { class: "muted", style: { margin: 0 } }, t("Attribution manuelle ou par événement.", "Manual or event award."))),
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

export { avatar, errorBox, toast, confirmDialog, api };
