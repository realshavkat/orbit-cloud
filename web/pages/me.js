// /me/*: the member's own profile editor, privacy, security, sites, donations, data.
import { h, icon, t, get, post, patch, put, del, api, state, loadMe, act, field, switchRow, avatar, badgeCard, empty, fmtDate, fmtDateTime, fmtMoney,
  THEME, confirmDialog, toast, errorBox, errorText, spinner } from "../lib.js";

const go = (url, o) => window.orbitNavigate(url, o);

const TABS = [
  ["", "user", t("Profil", "Profile")],
  ["badges", "award", t("Badges", "Badges")],
  ["sites", "globe", t("Sites et collections", "Sites and collections")],
  ["privacy", "eye", t("Confidentialité", "Privacy")],
  ["notifications", "bell", t("Notifications", "Notifications")],
  ["security", "lock", t("Sécurité", "Security")],
  ["donations", "heart", t("Mes dons", "My donations")],
  ["data", "download", t("Mes données", "My data")],
];

export async function page({ params }) {
  const tab = params.tab ?? "";
  await loadMe();
  const me = state.me;
  const nav = h("nav", { class: "sidenav", "aria-label": t("Compte", "Account") },
    ...TABS.map(([k, ic, label]) => h("a", { href: k ? `/me/${k}` : "/me", "aria-current": k == tab ? "page" : null }, icon(ic), label)));
  const body = await (PAGES[tab] ?? PAGES[""])(me);
  const banner = !me.verified ? h("div", { class: "alert warn", style: { marginBottom: "16px" } }, icon("mail"),
    h("span", { style: { flex: 1 } }, t("Confirme ton adresse e-mail pour ajouter des amis, partager des sites et faire un don.", "Confirm your e-mail to add friends, share sites and donate.")),
    h("button", { class: "btn small", onclick: e => act(e.target, () => post("/auth/resend-verification"), { ok: t("Lien envoyé", "Link sent") }) }, t("Renvoyer le lien", "Resend link"))) : null;
  return h("div", {}, banner, h("div", { class: "split" }, nav, h("div", { class: "stack" }, body)));
}

const head = (title, sub, ...actions) => h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null), h("div", { class: "row" }, ...actions));

const PAGES = {
  // ---- profile editor
  async ""(me) {
    const display = h("input", { class: "input", maxlength: 40, value: me.display_name ?? "" });
    const bio = h("textarea", { class: "input", maxlength: 400 });
    bio.value = me.bio ?? "";
    const counter = h("span", { class: "hint" }, `${bio.value.length}/400`);
    bio.addEventListener("input", () => (counter.textContent = `${bio.value.length}/400`));
    let color = me.theme_color;
    const colors = h("div", { class: "row wrap" }, ...Object.entries(THEME).map(([k, c]) => {
      const b = h("button", { type: "button", class: "icon-btn", "aria-label": k, "aria-pressed": String(k == color), style: { background: c, width: "30px", height: "30px", borderRadius: "50%",
        boxShadow: k == color ? "0 0 0 2px var(--bg), 0 0 0 4px var(--fg)" : "none" } });
      b.addEventListener("click", () => {
        color = k;
        for (const x of colors.children) x.style.boxShadow = "none";
        b.style.boxShadow = "0 0 0 2px var(--bg), 0 0 0 4px var(--fg)";
      });
      return b;
    }));
    // Links
    const links = [...(me.links ?? [])];
    const linksBox = h("div", { class: "stack" });
    const drawLinks = () => linksBox.replaceChildren(...links.map((l, i) => h("div", { class: "row" },
      h("input", { class: "input", placeholder: t("Libellé", "Label"), value: l.label ?? "", maxlength: 30, style: { maxWidth: "160px" }, oninput: e => (links[i].label = e.target.value) }),
      h("input", { class: "input", placeholder: "https://…", value: l.url, oninput: e => (links[i].url = e.target.value) }),
      h("button", { type: "button", class: "icon-btn", "aria-label": t("Retirer", "Remove"), onclick: () => (links.splice(i, 1), drawLinks()) }, icon("x")))),
    links.length < 6 ? h("button", { type: "button", class: "btn small", onclick: () => (links.push({ label: "", url: "" }), drawLinks()) }, icon("plus"), t("Ajouter un lien", "Add a link")) : null);
    drawLinks();
    // Interests
    const interests = [...me.interests];
    const intInput = h("input", { class: "input", placeholder: t("ex. musique, jeux-video, code", "e.g. music, video-games, code"), maxlength: 30 });
    const intBox = h("div", { class: "chips" });
    const drawInts = () => intBox.replaceChildren(...interests.map((x, i) => h("span", { class: "chip" }, `#${x}`,
      h("button", { type: "button", "aria-label": t("Retirer", "Remove"), onclick: () => (interests.splice(i, 1), drawInts()) }, icon("x", "i")))));
    drawInts();
    intInput.addEventListener("keydown", e => {
      if (e.key != "Enter" && e.key != ",") return;
      e.preventDefault();
      const v = intInput.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (v.length >= 2 && !interests.includes(v) && interests.length < 12) interests.push(v);
      intInput.value = "";
      drawInts();
    });
    // Section order
    const order = [...me.section_order];
    const names = { badges: t("Badges", "Badges"), sites: t("Sites partagés", "Shared sites"), collections: t("Collections", "Collections"), interests: t("Centres d'intérêt", "Interests"), links: t("Liens", "Links") };
    const orderBox = h("div", { class: "stack", style: { gap: "6px" } });
    const drawOrder = () => orderBox.replaceChildren(...order.map((k, i) => h("div", { class: "row card", style: { padding: "8px 12px" } },
      icon("grip-vertical"), h("span", { style: { flex: 1 } }, names[k]),
      h("button", { type: "button", class: "btn small", disabled: i == 0, "aria-label": t("Monter", "Move up"), onclick: () => ([order[i - 1], order[i]] = [order[i], order[i - 1]], drawOrder()) }, "↑"),
      h("button", { type: "button", class: "btn small", disabled: i == order.length - 1, "aria-label": t("Descendre", "Move down"), onclick: () => ([order[i + 1], order[i]] = [order[i], order[i + 1]], drawOrder()) }, "↓"))));
    drawOrder();
    const err = h("div");
    const save = h("button", { class: "btn primary", type: "submit" }, t("Enregistrer", "Save"));
    const upload = (kind, label) => {
      const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append("file", file);
        if (await act(null, () => api("POST", `/me/media/${kind}`, fd), { ok: t("Image mise à jour", "Image updated") })) go(location.pathname, { replace: true });
      });
      const has = kind == "avatar" ? me.avatar_media_id : me.banner_media_id;
      return h("div", { class: "row" }, input,
        h("button", { type: "button", class: "btn small", onclick: () => input.click() }, icon("image-plus"), label),
        has ? h("button", { type: "button", class: "btn small danger", onclick: async e => (await act(e.target, () => del(`/me/media/${kind}`))) !== undefined && go(location.pathname, { replace: true }) },
          t("Retirer", "Remove")) : null);
    };
    const me2 = { ...me, avatar_url: me.avatar_media_id ? `/api/v1/users/media/${me.avatar_media_id}` : null };
    return [head(t("Mon profil", "My profile"), t("Ce que les autres voient sur ta page.", "What others see on your page."),
      h("a", { class: "btn", href: `/u/${me.username}` }, icon("eye"), t("Aperçu", "Preview"))),
    h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      err.replaceChildren();
      save.disabled = true;
      try {
        await patch("/me/profile", { display_name: display.value || null, bio: bio.value || null, theme_color: color,
          links: links.filter(l => l.url.trim()), interests, section_order: order });
        toast(t("Profil enregistré", "Profile saved"), "ok");
      } catch (x) {
        err.replaceChildren(errorBox(x));
      } finally {
        save.disabled = false;
      }
    } },
    h("section", { class: "card stack" }, h("h2", {}, t("Images", "Images")),
      h("div", { class: "row" }, avatar(me2, "avatar"), h("div", { class: "stack", style: { gap: "4px" } },
        upload("avatar", t("Changer l'avatar", "Change avatar")), h("span", { class: "hint" }, t("PNG, JPEG, WebP ou GIF, 2 Mo max.", "PNG, JPEG, WebP or GIF, 2 MB max."))) ),
      h("div", { class: "stack", style: { gap: "4px" } }, upload("banner", t("Changer la bannière", "Change banner")), h("span", { class: "hint" }, t("4 Mo max, idéalement 1500 × 400.", "4 MB max, ideally 1500 × 400.")))),
    h("section", { class: "card stack" }, h("h2", {}, t("Identité", "Identity")),
      field(t("Nom affiché (facultatif)", "Display name (optional)"), display),
      field(t("Biographie", "Bio"), bio, counter),
      h("div", { class: "field" }, h("label", {}, t("Couleur du profil", "Profile color")), colors)),
    h("section", { class: "card stack" }, h("h2", {}, t("Centres d'intérêt", "Interests")), intInput,
      h("span", { class: "hint" }, t("Entrée pour ajouter, 12 maximum.", "Enter to add, 12 at most.")), intBox),
    h("section", { class: "card stack" }, h("h2", {}, t("Liens", "Links")), linksBox),
    h("section", { class: "card stack" }, h("h2", {}, t("Ordre des sections", "Section order")), orderBox),
    err, h("div", { class: "row" }, save))];
  },

  // ---- badges
  async badges() {
    const data = await get("/me/badges");
    const featured = new Set(data.current.filter(b => b.featured).map(b => b.key));
    const list = h("div", { class: "grid cols-2" });
    const draw = () => list.replaceChildren(...data.current.map(b => {
      const on = featured.has(b.key);
      const star = h("button", { class: "icon-btn", "aria-pressed": String(on), "aria-label": t("Mettre en avant", "Feature"), title: t("Mettre en avant (3 max)", "Feature (3 max)"),
        style: { color: on ? "var(--warn)" : null }, onclick: async e => {
          e.preventDefault();
          if (on) featured.delete(b.key);
          else if (featured.size < 3) featured.add(b.key);
          else return toast(t("3 badges maximum en avant.", "3 featured badges at most."));
          await act(null, () => put("/me/featured-badges", { keys: [...featured] }));
          draw();
        } }, icon("star"));
      return h("div", { class: "row" }, h("div", { style: { flex: 1, minWidth: 0 } }, badgeCard(b, { href: `/award/${b.award_id}`, extra: h("span", { class: "faint small" }, fmtDate(b.awarded_at)) })), star);
    }));
    draw();
    const ACTION = { award: t("obtenu", "earned"), revoke: t("retiré", "removed"), expire: t("expiré", "expired") };
    return [head(t("Mes badges", "My badges"), t("L'étoile met un badge en avant sur ton profil.", "The star features a badge on your profile."),
      h("a", { class: "btn", href: "/badges" }, icon("award"), t("Tous les badges", "All badges"))),
    data.current.length ? list : h("div", { class: "card" }, empty("award", t("Pas encore de badge.", "No badge yet."), h("a", { class: "btn small", href: "/badges" }, t("Voir comment en obtenir", "See how to earn some")))),
    data.history.length ? h("section", { class: "card flat" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, t("Badge", "Badge")), h("th", {}, t("Événement", "Event")), h("th", {}, t("Date", "Date")))),
      h("tbody", {}, data.history.map(e => h("tr", {}, h("td", {}, e.name), h("td", {}, ACTION[e.action] ?? e.action), h("td", {}, fmtDateTime(e.created_at))))))) : null];
  },

  // ---- shared sites and collections
  async sites(me) {
    const data = await get("/sites/mine");
    const domain = h("input", { class: "input", placeholder: "exemple.com" });
    const note = h("input", { class: "input", placeholder: t("Note (facultatif)", "Note (optional)"), maxlength: 140 });
    const siteList = h("div", {}, data.sites.length ? data.sites.map(s => h("div", { class: "site-row" },
      h("span", { class: "favicon" }, s.domain[0].toUpperCase()),
      h("a", { href: `/sites/${s.domain}`, style: { flex: 1 } }, h("b", {}, s.domain), s.note ? h("div", { class: "muted small" }, s.note) : null),
      h("button", { class: "btn small danger", onclick: async e => (await act(e.target, () => del(`/sites/shared/${s.domain}`))) !== undefined && go(location.pathname, { replace: true }) }, t("Retirer", "Remove"))))
      : empty("globe", t("Aucun site partagé.", "No shared site.")));
    const collections = h("div", { class: "stack" }, ...data.collections.map(c => collectionEditor(c)), collectionEditor(null));
    return [head(t("Sites et collections", "Sites and collections"), t("Seulement ce que tu choisis de partager. Orbit n'envoie jamais ton historique.", "Only what you choose to share. Orbit never sends your history.")),
      !data.sharing_enabled ? h("div", { class: "alert warn" }, icon("info"), h("span", { style: { flex: 1 } }, t("Le partage de sites est désactivé.", "Site sharing is off.")),
        h("a", { class: "btn small", href: "/me/privacy" }, t("L'activer", "Turn it on"))) : null,
      h("section", { class: "card stack" }, h("h2", {}, t("Sites partagés", "Shared sites")),
        h("form", { class: "row", onsubmit: async e => {
          e.preventDefault();
          if ((await act(e.submitter, () => post("/sites/shared", { domain: domain.value, note: note.value || null }), { ok: t("Site partagé", "Site shared") })) !== undefined) go(location.pathname, { replace: true });
        } }, domain, note, h("button", { class: "btn primary", type: "submit", disabled: !data.sharing_enabled }, t("Partager", "Share"))),
        h("span", { class: "hint" }, t("Juste le domaine (ex. github.com) : jamais une page précise. Les sites sensibles (santé, banque, rencontres…) sont refusés.",
          "Just the domain (e.g. github.com), never a specific page. Sensitive sites (health, banking, dating…) are refused.")),
        siteList),
      h("section", { class: "stack" }, h("h2", {}, t("Collections", "Collections")), collections)];
  },

  // ---- privacy
  async privacy(me) {
    const p = me.privacy;
    const row = (key, title, desc) => switchRow(title, desc, p[key], async (on, input) => {
      if ((await act(null, () => patch("/me/privacy", { [key]: on }))) === undefined) input.checked = !on;
      else p[key] = on;
    });
    return [head(t("Confidentialité", "Privacy"), t("Chaque réglage est appliqué par le serveur : ce qui est masqué n'est jamais envoyé.", "Each setting is enforced by the server: what is hidden is never sent.")),
      h("section", { class: "card flat" },
        row("profile_public", t("Profil public", "Public profile"), t("Désactivé : seuls tes amis voient ton profil.", "Off: only your friends see your profile.")),
        row("show_badges", t("Afficher mes badges", "Show my badges")),
        row("show_activity", t("Afficher ma dernière activité", "Show my last activity")),
        row("show_collections", t("Afficher mes collections", "Show my collections")),
        row("show_interests", t("Afficher mes centres d'intérêt", "Show my interests")),
        row("show_sites", t("Afficher mes sites partagés", "Show my shared sites")),
        row("show_friend_count", t("Afficher mon nombre d'amis", "Show my friend count"))),
      h("section", { class: "card flat" },
        row("allow_friend_requests", t("Accepter les demandes d'amis", "Accept friend requests")),
        row("discoverable", t("Apparaître dans les suggestions", "Appear in suggestions"), t("Découverte, membres actifs, centres d'intérêt communs.", "Discovery, active members, shared interests.")),
        row("share_sites_enabled", t("Partage de sites", "Site sharing"), t("Permet de partager un site depuis Orbit. Désactivé : plus aucun envoi, et tes sites ne sont plus visibles.",
          "Lets you share a site from Orbit. Off: nothing more is sent, and your sites are no longer visible.")),
        row("show_stats", t("Statistiques de navigation", "Browsing statistics"), t("Désactivé par défaut. Orbit ne collecte aucune statistique de navigation.", "Off by default. Orbit collects no browsing statistics.")),
        row("social_disabled", t("Désactiver toutes les fonctions sociales", "Turn off all social features"), t("Ton profil devient invisible, plus de demandes ni de suggestions.", "Your profile becomes invisible, no more requests or suggestions."))),
      h("p", { class: "muted small" }, t("Orbit n'envoie jamais ton historique, tes onglets ni tes favoris. Rien n'est envoyé depuis la navigation privée.",
        "Orbit never sends your history, tabs or bookmarks. Nothing is sent from private browsing."))];
  },

  // ---- notification preferences
  async notifications(me) {
    const prefs = me.preferences;
    const n = prefs.notify ?? {};
    const types = [["friend_request", t("Demandes d'amis", "Friend requests")], ["friend_accepted", t("Demandes acceptées", "Accepted requests")],
      ["badge", t("Nouveaux badges", "New badges")], ["support_badge", t("Badges de soutien", "Support badges")], ["report_update", t("Suivi de mes signalements", "Updates on my reports")],
      ["news", t("Actualités d'Orbit", "Orbit news")]];
    const save = async (body, input, on) => {
      if ((await act(null, () => patch("/me/preferences", body))) === undefined) input.checked = !on;
    };
    return [head(t("Notifications", "Notifications"), t("Les notifications de sécurité restent toujours actives.", "Security notifications always stay on.")),
      h("section", { class: "card flat" }, ...types.map(([k, label]) => switchRow(label, null, n[k] !== false && (k != "news" || n[k] === true), (on, input) => {
        n[k] = on;
        save({ notify: n }, input, on);
      }))),
      h("section", { class: "card flat" },
        switchRow(t("E-mails de sécurité", "Security e-mails"), t("Mot de passe changé, nouvelle connexion avec un code de secours…", "Password changed, sign-in with a recovery code…"), prefs.email_security, (on, i) => save({ email_security: on }, i, on)),
        switchRow(t("E-mails d'actualités", "News e-mails"), t("Seulement si tu le demandes. Désinscription à tout moment.", "Only if you ask. Unsubscribe any time."), prefs.email_news, (on, i) => save({ email_news: on }, i, on)))];
  },

  // ---- security
  async security(me) {
    const { sessions } = await get("/me/sessions");
    const cur = h("input", { class: "input", type: "password", autocomplete: "current-password" });
    const npw = h("input", { class: "input", type: "password", autocomplete: "new-password", minlength: 10 });
    const email = h("input", { class: "input", type: "email", placeholder: me.email });
    const uname = h("input", { class: "input", value: me.username, maxlength: 24 });
    const mfaBox = h("div", { class: "stack" });
    const drawMfa = () => {
      if (me.mfa_enabled) {
        mfaBox.replaceChildren(h("div", { class: "alert ok" }, icon("shield-check"), t("Activée.", "On.")),
          h("div", { class: "row" },
            h("button", { class: "btn", onclick: async e => {
              const r = await act(e.target, () => post("/me/mfa/recovery-codes"));
              if (r) mfaBox.append(codesBox(r.recovery_codes));
            } }, t("Nouveaux codes de récupération", "New recovery codes")),
            h("button", { class: "btn danger", onclick: async e => {
              if (!(await confirmDialog({ title: t("Désactiver la validation en deux étapes ?", "Turn off two-step verification?"), action: t("Désactiver", "Turn off"), danger: true }))) return;
              if ((await act(e.target, () => del("/me/mfa"))) !== undefined) {
                me.mfa_enabled = false;
                drawMfa();
              }
            } }, t("Désactiver", "Turn off"))));
        return;
      }
      mfaBox.replaceChildren(h("p", { class: "muted", style: { margin: 0 } }, t("Un code à 6 chiffres d'une application (Aegis, 2FAS, Google Authenticator…) en plus de ton mot de passe.",
        "A 6-digit code from an app (Aegis, 2FAS, Google Authenticator…) on top of your password.")),
      h("button", { class: "btn primary", style: { width: "fit-content" }, onclick: async e => {
        const s = await act(e.target, () => post("/me/mfa/setup"));
        if (!s) return;
        const code = h("input", { class: "input", inputmode: "numeric", maxlength: 6, placeholder: "123456", style: { maxWidth: "160px" } });
        mfaBox.replaceChildren(
          h("p", { style: { margin: 0 } }, t("1. Dans ton application, ajoute un compte avec cette clé :", "1. In your app, add an account with this key:")),
          h("div", { class: "secret" }, s.secret.match(/.{1,4}/g).join(" ")),
          h("a", { class: "link small", href: s.otpauth }, t("Ou ouvre directement l'application", "Or open the app directly")),
          h("p", { style: { margin: 0 } }, t("2. Entre le code affiché :", "2. Enter the code it shows:")),
          h("form", { class: "row", onsubmit: async ev => {
            ev.preventDefault();
            const r = await act(ev.submitter, () => post("/me/mfa/confirm", { code: code.value }));
            if (!r) return;
            me.mfa_enabled = true;
            drawMfa();
            mfaBox.append(codesBox(r.recovery_codes));
          } }, code, h("button", { class: "btn primary", type: "submit" }, t("Activer", "Turn on"))));
      } }, icon("smartphone"), t("Activer", "Turn on")));
    };
    drawMfa();
    const sessionsBox = h("div", { class: "card flat" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, t("Appareil", "Device")), h("th", {}, t("Adresse", "Address")), h("th", {}, t("Dernière activité", "Last active")), h("th"))),
      h("tbody", {}, sessions.map(s => h("tr", {},
        h("td", {}, describeAgent(s.user_agent), s.current ? h("span", { class: "tag ok", style: { marginLeft: "8px" } }, t("Cette session", "This session")) : null),
        h("td", { class: "mono" }, s.ip ?? ""), h("td", {}, fmtDateTime(s.last_seen_at)),
        h("td", {}, s.current ? null : h("button", { class: "btn small danger", onclick: async e => {
          if ((await act(e.target, () => del(`/me/sessions/${s.id}`))) !== undefined) e.target.closest("tr").remove();
        } }, t("Déconnecter", "Sign out"))))))));
    const signIn = h("section", { class: "card stack" }, h("h2", {}, t("Connexion", "Sign-in")),
      h("div", { class: "switch-row", style: { padding: "4px 0" } }, h("span", {}, h("b", {}, t("Compte Mozilla (Firefox Sync)", "Mozilla account (Firefox Sync)")),
        h("div", { class: "hint" }, me.mozilla_linked
          ? t("Lié : te connecter à Firefox Sync dans Orbit te connecte ici aussi.", "Linked: signing in to Firefox Sync in Orbit signs you in here too.")
          : t("Connecte-toi à Firefox Sync dans Orbit pour le lier à ce compte.", "Sign in to Firefox Sync in Orbit to link it to this account."))),
        h("span", { class: `tag ${me.mozilla_linked ? "ok" : ""}` }, me.mozilla_linked ? t("Lié", "Linked") : t("Non lié", "Not linked"))));
    if (!me.has_password) {
      return [head(t("Sécurité", "Security"), null), signIn,
        h("section", { class: "card stack" }, h("h2", {}, t("Mot de passe", "Password")),
          h("p", { class: "muted" }, t("Ton compte n'a pas de mot de passe : tu te connectes avec Firefox Sync. Pour en ajouter un, utilise le lien de réinitialisation envoyé par e-mail.",
            "Your account has no password: you sign in with Firefox Sync. To add one, use the reset link sent by e-mail.")),
          h("button", { class: "btn", style: { width: "fit-content" }, onclick: e => act(e.target, () => post("/auth/forgot", { email: me.email }), { ok: t("Lien envoyé", "Link sent") }) },
            icon("mail"), t("Recevoir le lien", "Send me the link"))),
        h("section", { class: "card stack" }, h("h2", {}, t("Sessions", "Sessions")), sessionsBox)];
    }
    return [head(t("Sécurité", "Security"), null), signIn,
      h("section", { class: "card stack" }, h("h2", {}, t("Mot de passe", "Password")),
        h("form", { class: "stack", onsubmit: async e => {
          e.preventDefault();
          if ((await act(e.submitter, () => post("/me/password", { current: cur.value, password: npw.value }),
            { ok: t("Mot de passe changé. Tes autres appareils sont déconnectés.", "Password changed. Your other devices were signed out.") })) !== undefined) {
            cur.value = "";
            npw.value = "";
          }
        } }, field(t("Mot de passe actuel", "Current password"), cur), field(t("Nouveau mot de passe", "New password"), npw),
        h("button", { class: "btn primary", type: "submit", style: { width: "fit-content" } }, t("Changer", "Change")))),
      h("section", { class: "card stack" }, h("h2", {}, t("Validation en deux étapes", "Two-step verification")), mfaBox),
      h("section", { class: "card stack" }, h("h2", {}, t("Adresse e-mail", "E-mail address")),
        h("p", { class: "muted", style: { margin: 0 } }, t(`Actuelle : ${me.email}. La nouvelle adresse doit être confirmée par un lien.`, `Current: ${me.email}. The new address must be confirmed by a link.`)),
        h("form", { class: "row", onsubmit: async e => {
          e.preventDefault();
          await act(e.submitter, () => post("/me/email", { email: email.value }), { ok: t("Si l'adresse est libre, un lien de confirmation y a été envoyé.", "If the address is free, a confirmation link was sent to it.") });
        } }, email, h("button", { class: "btn", type: "submit" }, t("Changer", "Change")))),
      h("section", { class: "card stack" }, h("h2", {}, t("Pseudo", "Username")),
        h("form", { class: "row", onsubmit: async e => {
          e.preventDefault();
          if ((await act(e.submitter, () => post("/me/username", { username: uname.value }), { ok: t("Pseudo changé", "Username changed") })) !== undefined) await loadMe();
        } }, uname, h("button", { class: "btn", type: "submit" }, t("Changer", "Change")))),
      h("section", { class: "stack" }, h("div", { class: "row between" }, h("h2", {}, t("Sessions actives", "Active sessions")),
        h("button", { class: "btn small danger", onclick: async e => {
          if (!(await confirmDialog({ title: t("Se déconnecter partout ?", "Sign out everywhere?"), text: t("Y compris sur cet appareil.", "Including this device."), action: t("Tout déconnecter", "Sign out all"), danger: true }))) return;
          if ((await act(e.target, () => post("/auth/logout-all"))) !== undefined) {
            state.me = null;
            go("/login");
          }
        } }, t("Tout déconnecter", "Sign out everywhere"))), sessionsBox)];
  },

  // ---- donations
  async donations() {
    const { donations, subscriptions } = await get("/me/donations");
    const STATUS = { succeeded: [t("Confirmé", "Confirmed"), "ok"], failed: [t("Échoué", "Failed"), "err"], canceled: [t("Annulé", "Canceled"), ""],
      refunded: [t("Remboursé", "Refunded"), "warn"], partially_refunded: [t("Remboursé en partie", "Partly refunded"), "warn"], disputed: [t("Contesté", "Disputed"), "err"] };
    const active = subscriptions.find(s => ["active", "trialing", "past_due"].includes(s.status));
    return [head(t("Mes dons", "My donations"), t("Merci de soutenir Orbit.", "Thank you for supporting Orbit."), h("a", { class: "btn primary", href: "/support" }, icon("heart"), t("Faire un don", "Donate"))),
      active ? h("section", { class: "card row between" }, h("div", {}, h("b", {}, t("Soutien mensuel actif", "Active monthly support")),
        h("div", { class: "muted small" }, active.amount_cents ? fmtMoney(active.amount_cents, active.currency) : "", active.current_period_end ? ` · ${t("prochain paiement", "next payment")} ${fmtDate(active.current_period_end)}` : "")),
      h("button", { class: "btn", onclick: async e => {
        const r = await act(e.target, () => post("/donations/portal"));
        if (r?.url) location.href = r.url;
      } }, t("Gérer ou arrêter", "Manage or stop"))) : null,
      donations.length ? h("section", { class: "card flat" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, t("Date", "Date")), h("th", {}, t("Montant", "Amount")), h("th", {}, t("Type", "Type")), h("th", {}, t("Statut", "Status")))),
        h("tbody", {}, donations.map(d => h("tr", {}, h("td", {}, fmtDate(d.created_at)),
          h("td", {}, fmtMoney(d.amount_cents, d.currency), d.refunded_cents ? h("span", { class: "faint" }, ` (−${fmtMoney(d.refunded_cents, d.currency)})`) : null),
          h("td", {}, d.recurring ? t("Mensuel", "Monthly") : t("Ponctuel", "One-time")),
          h("td", {}, h("span", { class: `tag ${STATUS[d.status]?.[1] ?? ""}` }, STATUS[d.status]?.[0] ?? d.status))))))) :
        h("div", { class: "card" }, empty("heart", t("Aucun don pour l'instant.", "No donation yet.")))];
  },

  // ---- data export and deletion
  async data(me) {
    return [head(t("Mes données", "My data"), t("Tes droits : accès, export, suppression.", "Your rights: access, export, deletion.")),
      h("section", { class: "card stack" }, h("h2", {}, t("Exporter", "Export")),
        h("p", { class: "muted", style: { margin: 0 } }, t("Un fichier JSON avec ton compte, ton profil, tes badges, amis, sites, collections, notifications, sessions et dons.",
          "A JSON file with your account, profile, badges, friends, sites, collections, notifications, sessions and donations.")),
        h("a", { class: "btn", href: "/api/v1/me/export", download: "orbit-account.json", style: { width: "fit-content" } }, icon("download"), t("Télécharger mes données", "Download my data"))),
      h("section", { class: "card stack", style: { boxShadow: "0 0 0 1px color-mix(in srgb, var(--danger) 40%, transparent)" } },
        h("h2", {}, t("Supprimer mon compte", "Delete my account")),
        h("p", { class: "muted", style: { margin: 0 } }, t("Ton profil, tes amis, badges, sites, collections et notifications sont supprimés tout de suite. Les dons restent enregistrés (obligation comptable), sans lien avec un profil visible. Irréversible.",
          "Your profile, friends, badges, sites, collections and notifications are deleted right away. Donations stay recorded (accounting duty), not linked to a visible profile. Cannot be undone.")),
        h("button", { class: "btn danger solid", style: { width: "fit-content" }, onclick: () => deleteDialog(me) }, icon("trash-2"), t("Supprimer mon compte", "Delete my account")))];
  },
};

function deleteDialog(me) {
  const pw = h("input", { class: "input", type: "password", placeholder: t("Mot de passe", "Password"), autocomplete: "current-password" });
  const confirm = h("input", { class: "input", placeholder: me.username, "aria-label": t("Ton pseudo", "Your username") });
  const err = h("div");
  const bg = h("div", { class: "modal-bg", onclick: e => e.target == bg && bg.remove() },
    h("form", { class: "modal", onsubmit: async e => {
      e.preventDefault();
      try {
        await post("/me/delete", { password: pw.value, confirm: confirm.value });
        state.me = null;
        bg.remove();
        go("/");
        toast(t("Compte supprimé.", "Account deleted."));
      } catch (x) {
        err.replaceChildren(errorBox(x));
      }
    } }, h("h2", {}, t("Supprimer définitivement ?", "Delete for good?")),
    h("p", { class: "muted", style: { margin: 0 } }, t(`Tape « ${me.username} » et ton mot de passe.`, `Type "${me.username}" and your password.`)), confirm, pw, err,
    h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", type: "button", onclick: () => bg.remove() }, t("Annuler", "Cancel")),
      h("button", { class: "btn danger solid", type: "submit" }, t("Supprimer", "Delete")))));
  document.body.append(bg);
  confirm.focus();
}

function codesBox(codes) {
  return h("div", { class: "alert warn stack", style: { flexDirection: "column" } },
    h("b", {}, t("Codes de récupération : garde-les en lieu sûr. Chacun ne sert qu'une fois, ils ne seront plus affichés.",
      "Recovery codes: keep them somewhere safe. Each works once; they won't be shown again.")),
    h("div", { class: "codes" }, codes.map(c => h("span", {}, c))),
    h("button", { class: "btn small", onclick: e => {
      navigator.clipboard?.writeText(codes.join("\n"));
      e.target.textContent = t("Copiés", "Copied");
    } }, icon("copy"), t("Copier", "Copy")));
}

function describeAgent(ua = "") {
  const browser = /Orbit/.test(ua) ? "Orbit" : /Edg\//.test(ua) ? "Edge" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : t("Navigateur", "Browser");
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` · ${os}` : ""}`;
}

function collectionEditor(c) {
  const isNew = !c;
  const title = h("input", { class: "input", placeholder: t("Titre de la collection", "Collection title"), maxlength: 60, value: c?.title ?? "" });
  const desc = h("input", { class: "input", placeholder: t("Description (facultatif)", "Description (optional)"), maxlength: 280, value: c?.description ?? "" });
  const pub = h("input", { type: "checkbox" });
  pub.checked = c?.public ?? true;
  const items = (c?.items ?? []).map(i => ({ url: i.url, title: i.title ?? "" }));
  const list = h("div", { class: "stack", style: { gap: "6px" } });
  const draw = () => list.replaceChildren(...items.map((it, i) => h("div", { class: "row" },
    h("input", { class: "input", placeholder: "https://…", value: it.url, oninput: e => (items[i].url = e.target.value) }),
    h("input", { class: "input", placeholder: t("Titre", "Title"), value: it.title, maxlength: 120, style: { maxWidth: "200px" }, oninput: e => (items[i].title = e.target.value) }),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("Retirer", "Remove"), onclick: () => (items.splice(i, 1), draw()) }, icon("x")))),
  items.length < 50 ? h("button", { type: "button", class: "btn small", style: { width: "fit-content" }, onclick: () => (items.push({ url: "", title: "" }), draw()) }, icon("plus"), t("Ajouter un lien", "Add a link")) : null);
  draw();
  return h("form", { class: "card stack", onsubmit: async e => {
    e.preventDefault();
    const body = { title: title.value, description: desc.value || null, public: pub.checked, items: items.filter(i => i.url.trim()).map(i => ({ url: i.url.trim(), title: i.title || null })) };
    const r = await act(e.submitter, () => (isNew ? post("/sites/collections", body) : patch(`/sites/collections/${c.id}`, body)), { ok: t("Collection enregistrée", "Collection saved") });
    if (r !== undefined) go(location.pathname, { replace: true });
  } },
  h("h3", {}, isNew ? t("Nouvelle collection", "New collection") : c.title, c?.hidden ? h("span", { class: "tag err", style: { marginLeft: "8px" } }, t("Masquée par la modération", "Hidden by moderation")) : null),
  title, desc, list,
  h("div", { class: "row between" }, h("label", { class: "check" }, pub, h("span", {}, t("Publique", "Public"))),
    h("div", { class: "row" },
      !isNew ? h("button", { type: "button", class: "btn small danger", onclick: async ev => {
        if (await confirmDialog({ title: t("Supprimer cette collection ?", "Delete this collection?"), action: t("Supprimer", "Delete"), danger: true })) {
          if ((await act(ev.target, () => del(`/sites/collections/${c.id}`))) !== undefined) go(location.pathname, { replace: true });
        }
      } }, t("Supprimer", "Delete")) : null,
      h("button", { class: "btn small primary", type: "submit" }, isNew ? t("Créer", "Create") : t("Enregistrer", "Save")))));
}
