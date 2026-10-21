// Landing page: hero, then every Orbit feature told while scrolling, beside a
// browser mock-up that changes scene with the step in view.
import { h, icon, t, state, liquid } from "../lib.js";

const DOWNLOAD = "https://github.com/realshavkat/orbit/releases/latest";

// [id, icon, kicker, title, text, scene]
const STEPS = () => [
  ["spaces", "layers", t("Espaces", "Spaces"), t("Un espace pour chaque partie de ta vie", "A space for each part of your life"),
    t("Travail, perso, projets : chaque espace garde ses onglets, sa couleur, ses favoris. Alt+1…9 pour passer de l'un à l'autre, et les onglets épinglés restent là où tu les as laissés.",
      "Work, personal, projects: each space keeps its tabs, color and essentials. Alt+1…9 to switch, and pinned tabs stay where you left them.")],
  ["palette", "search", t("Palette de commandes", "Command palette"), t("Ctrl+K, et tout est là", "Ctrl+K, and everything is there"),
    t("Toutes les actions, les onglets de tous les espaces, l'historique, les favoris et les onglets fermés, dans une seule liste au clavier. Et chaque action peut avoir ton propre raccourci.",
      "Every action, the tabs of every space, history, bookmarks and closed tabs, in one keyboard list. And every action can have your own shortcut.")],
  ["split", "columns-2", t("Vue partagée", "Split view"), t("Jusqu'à quatre pages côte à côte", "Up to four pages side by side"),
    t("Deux, trois ou quatre onglets dans la même fenêtre, en grille ou en colonnes. Idéal pour comparer, traduire ou garder un œil sur une discussion.",
      "Two, three or four tabs in one window, as a grid or columns. Perfect to compare, translate or keep an eye on a chat.")],
  ["pipette", "pipette", t("Pipette", "Color picker"), t("Le code de n'importe quelle couleur", "The code of any color"),
    t("Une loupe suit ta souris, un clic copie le HEX. RGB, HSL et OKLCH sont à côté, avec l'historique de tes dernières couleurs.",
      "A loupe follows your mouse, one click copies the HEX. RGB, HSL and OKLCH are right there, with your recent colors.")],
  ["lock", "lock", t("Verrouillage", "Lock"), t("Ton navigateur, à toi seul", "Your browser, yours only"),
    t("Ctrl+Alt+L cache toutes les fenêtres. Windows Hello ou un code PIN Orbit pour revenir, verrouillage automatique après une absence.",
      "Ctrl+Alt+L hides every window. Windows Hello or an Orbit PIN to come back, automatic lock when you're away.")],
  ["downloads", "download", t("Orbit Turbo", "Orbit Turbo"), t("Les gros fichiers arrivent plus vite", "Big files arrive faster"),
    t("Quand un téléchargement est lent, Orbit Turbo le découpe en plusieurs connexions. Une page complète pour retrouver, trier et chercher tout ce que tu as téléchargé.",
      "When a download is slow, Orbit Turbo splits it over several connections. A full page to find, sort and search everything you downloaded.")],
  ["privacy", "shield-check", t("Vie privée", "Privacy"), t("Les traqueurs restent dehors", "Trackers stay outside"),
    t("Bloqueur intégré, DNS chiffré, protection contre l'empreinte. Ton historique ne quitte jamais ton ordinateur, et la navigation privée ne laisse aucune trace.",
      "Built-in blocker, encrypted DNS, fingerprinting protection. Your history never leaves your computer, and private browsing leaves no trace.")],
  ["community", "users", t("Communauté", "Community"), t("Un profil, des badges, des amis", "A profile, badges, friends"),
    t("Facultatif et gratuit : un profil à ton image, des badges vérifiables, des collections de sites à partager. Tu choisis ce que les autres voient.",
      "Optional and free: a profile that looks like you, verifiable badges, collections of sites to share. You choose what others see.")],
];

const MORE = () => [
  ["sparkles", t("Mods", "Mods"), t("Change tout le style d'Orbit en un clic.", "Restyle Orbit in one click.")],
  ["bot", t("IA sur plusieurs onglets", "AI across tabs"), t("Résume, compare ou interroge les pages choisies.", "Summarize, compare or ask about the pages you pick.")],
  ["history", t("Sessions", "Sessions"), t("Enregistre tes onglets sous un nom, retrouve-les plus tard.", "Save your tabs under a name, bring them back later.")],
  ["eye", t("Mode concentration", "Focus mode"), t("Ctrl+Maj+F : la page, rien d'autre.", "Ctrl+Shift+F: the page, nothing else.")],
  ["picture-in-picture-2", t("Picture-in-Picture", "Picture-in-Picture"), t("Une vidéo qui flotte au-dessus de tout.", "A video floating above everything.")],
  ["palette", t("Couleurs rapides", "Quick colors"), t("La couleur de l'espace en un geste, avec du grain.", "The space's color in one gesture, with grain.")],
  ["book-open", t("Notes d'onglet", "Tab notes"), t("Une note attachée à une page, retrouvée à chaque visite.", "A note on a page, back on every visit.")],
  ["refresh-cw", t("Synchronisation", "Sync"), t("Tes espaces et réglages sur tous tes PC.", "Your spaces and settings on every PC.")],
  ["moon", t("Mise en veille", "Tab sleeping"), t("Les onglets inutilisés libèrent la mémoire tout seuls.", "Idle tabs free memory on their own.")],
  ["languages", t("8 langues", "8 languages"), t("Français, anglais, espagnol, allemand, portugais, italien, russe, ukrainien.", "French, English, Spanish, German, Portuguese, Italian, Russian, Ukrainian.")],
  ["app-window", t("Onglets en haut", "Tabs on top"), t("Préfères les onglets classiques ? Un réglage.", "Prefer classic tabs? One setting.")],
  ["upload", t("Import en un clic", "One-click import"), t("Favoris, mots de passe et historique de Chrome, Edge, Brave.", "Bookmarks, passwords and history from Chrome, Edge, Brave.")],
];

const div = (cls, ...c) => h("div", { class: cls }, ...c);

// The browser mock-up and its eight scenes (pure CSS animations).
function mock() {
  const tabs = n => Array.from({ length: n }, (_, i) => div(`m-tab${i == 1 ? " sel" : ""}`, div("m-fav"), div("m-line")));
  const lines = n => Array.from({ length: n }, () => div("m-text"));
  const scene = (id, ...c) => h("div", { class: "scene", "data-scene": id }, ...c);
  return div("mock",
    div("m-top", div("m-dots", h("i"), h("i"), h("i")), div("m-url", icon("lock"), h("span", { class: "m-url-text" }, "orbit://home"))),
    div("m-body",
      div("m-side",
        div("m-spaces", h("i", { class: "s1" }), h("i", { class: "s2" }), h("i", { class: "s3" })),
        div("m-space-name"),
        ...tabs(6)),
      div("m-page",
        div("m-hero"), ...lines(4),
        scene("spaces", div("m-space-cards", div("m-sc a", icon("layers"), h("b", {}, t("Travail", "Work"))), div("m-sc b", icon("heart"), h("b", {}, t("Perso", "Personal"))), div("m-sc c", icon("rocket"), h("b", {}, t("Projets", "Projects"))))),
        scene("palette", div("m-palette",
          div("m-pal-input", icon("search"), h("span", { class: "m-typed" }, t("traduire", "translate")), h("span", { class: "m-caret" })),
          ...[["languages", t("Traduire la page", "Translate page")], ["layers", t("Fermer les onglets en double", "Close duplicate tabs")], ["pipette", t("Pipette à couleurs", "Color picker")], ["lock", t("Verrouiller Orbit", "Lock Orbit")]]
            .map(([ic, label], i) => div(`m-pal-row r${i}`, icon(ic), h("span", {}, label), i == 0 ? h("kbd", {}, "↵") : null)))),
        scene("split", div("m-split", div("m-pane p1"), div("m-pane p2"), div("m-pane p3"), div("m-pane p4"))),
        scene("pipette", div("m-swatches", div("sw a"), div("sw b"), div("sw c"), div("sw d")), div("m-loupe", div("m-loupe-ring"), h("span", { class: "m-hex" }))),
        scene("lock", div("m-lock", div("m-lock-icon", icon("lock")), h("b", {}, t("Orbit est verrouillé", "Orbit is locked")), div("m-pin", h("i"), h("i"), h("i"), h("i")))),
        scene("downloads", div("m-dl", ...[["film", "trailer-4k.mp4", "8"], ["download", "orbit-setup.exe", "4"], ["image", "photos.zip", "6"]].map(([ic, name, n], i) =>
          div(`m-dl-row d${i}`, div("m-dl-ic", icon(ic)), div("m-dl-main", h("b", {}, name), div("m-dl-bar", ...Array.from({ length: Number(n) }, (_, j) => h("i", { style: { "--j": j } })))), h("span", { class: "m-turbo" }, `Turbo ×${n}`))))),
        scene("privacy", div("m-shield", div("m-shield-icon", icon("shield-check")), h("b", { class: "m-count" }), h("span", {}, t("traqueurs bloqués", "trackers blocked")),
          div("m-blocked", ...["ads.doubleclick.net", "pixel.facebook.com", "analytics.tiktok.com", "bat.bing.com"].map((d, i) => h("span", { style: { "--i": i } }, icon("ban"), d))))),
        scene("community", div("m-profile", div("m-pbanner"), div("m-pavatar", "S"), h("b", {}, "shavkat"),
          div("m-pbadges", ...[["rocket", "#f5c518"], ["shield-check", "#ff5d5d"], ["heart", "#ff6b8a"], ["bug", "#ff6bcb"]].map(([ic, c], i) => h("span", { style: { "--c": c, "--i": i } }, icon(ic)))))))));
}

function reveal(root) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) {
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { threshold: .15 });
  root.querySelectorAll("[data-reveal]").forEach(el => io.observe(el));
}

// Numbers count up when they come into view.
function counters(root) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const end = Number(e.target.dataset.count);
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / 1400);
        e.target.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: .6 });
  root.querySelectorAll("[data-count]").forEach(el => io.observe(el));
}

export async function landing() {
  const steps = STEPS();
  const stage = mock();
  const dots = h("div", { class: "rail" }, ...steps.map(([id]) => h("i", { "data-dot": id })));
  const stepEls = steps.map(([id, ic, kicker, title, text], i) => h("article", { class: "step", "data-step": id },
    h("span", { class: "kicker" }, icon(ic), h("span", {}, `${String(i + 1).padStart(2, "0")} · ${kicker}`)),
    h("h3", {}, title), h("p", {}, text)));
  const ctaJoin = state.me ? h("a", { class: "btn big", href: `/u/${state.me.username}` }, t("Mon profil", "My profile"))
    : h("a", { class: "btn big", href: "/register" }, t("Rejoindre la communauté", "Join the community"));

  const page = h("div", { class: "landing" },
    // ---- hero
    h("section", { class: "hero" },
      liquid("liquid hero-liquid"),
      h("div", { class: "hero-text" },
        h("span", { class: "kicker-line", "data-reveal": "" }, t("Navigateur pour Windows · version 158", "Browser for Windows · version 158")),
        h("h1", { "data-reveal": "", style: { "--d": "80ms" } }, t("Le navigateur qui gravite autour de toi.", "The browser that orbits around you.")),
        h("p", { class: "lead", "data-reveal": "", style: { "--d": "160ms" } }, t("Espaces, palette de commandes, vue partagée, verrouillage. Ton historique reste sur ton ordinateur. Gratuit, sans compte, basé sur Firefox.",
          "Spaces, command palette, split view, lock. Your history stays on your computer. Free, no account needed, built on Firefox.")),
        h("div", { class: "hero-cta", "data-reveal": "", style: { "--d": "240ms" } },
          h("a", { class: "btn accent big", href: DOWNLOAD, target: "_blank", rel: "noopener" }, icon("download"), t("Télécharger pour Windows", "Download for Windows")), ctaJoin)),
      h("div", { class: "hero-mock", "data-reveal": "", style: { "--d": "200ms" } }, (() => {
        const m = mock();
        m.classList.add("tilt");
        m.dataset.active = "spaces";
        return m;
      })())),
    // ---- marquee
    h("div", { class: "marquee", "aria-hidden": "true" }, h("div", { class: "marquee-track" },
      ...[...MORE(), ...MORE()].map(([ic, name]) => h("span", {}, icon(ic), name)))),
    // ---- scrollytelling
    h("section", { class: "story" },
      h("header", { class: "section-head", "data-reveal": "" }, h("span", { class: "eyebrow" }, t("Fonctionnalités", "Features")),
        h("h2", {}, t("Fait pour aller vite.", "Built for speed.")),
        h("p", {}, t("Fais défiler : chaque fonction s'allume dans la fenêtre à droite.", "Scroll: each feature lights up in the window on the right."))),
      h("div", { class: "story-grid" }, h("div", { class: "steps" }, ...stepEls), h("div", { class: "stage" }, stage, dots))),
    // ---- more
    h("section", { class: "more" },
      h("header", { class: "section-head", "data-reveal": "" }, h("h2", {}, t("Et tous les détails qui comptent.", "And every detail that matters.")),
        h("p", {}, t("Chaque réglage s'explique, et chaque action a son raccourci.", "Every setting explains itself, and every action has a shortcut."))),
      h("div", { class: "more-grid" }, ...MORE().map(([ic, name, text], i) => h(i == 0 ? "a" : "div", { class: "detail", href: i == 0 ? "/mods" : null, "data-reveal": "", style: { "--d": `${(i % 4) * 60}ms` } },
        icon(ic), h("h3", {}, name), h("p", {}, text))))),
    // ---- numbers
    h("section", { class: "numbers" },
      ...[[0, t("octet d'historique envoyé à qui que ce soit", "bytes of history sent to anyone")], [4, t("pages côte à côte en vue partagée", "pages side by side in split view")],
        [8, t("langues, dont le français", "languages, English and French included")], [100, t("% gratuit, avec ou sans compte", "% free, with or without an account")]]
        .map(([n, label], i) => h("div", { class: "num", "data-reveal": "", style: { "--d": `${i * 90}ms` } }, h("b", { "data-count": n }, "0"), h("span", {}, label)))),
    // ---- community
    h("section", { class: "community" },
      h("div", { class: "community-text", "data-reveal": "" },
        h("span", { class: "eyebrow" }, t("Communauté", "Community")),
        h("h2", {}, t("Un profil qui te ressemble.", "A profile that feels like you.")),
        h("p", {}, t("Badges vérifiables, amis, collections de sites et mods. Tu choisis qui voit chaque partie. Connecte-toi à Firefox Sync dans Orbit et ton compte suit.",
          "Verified badges, friends, site collections and mods. You choose who sees each part. Sign in to Firefox Sync in Orbit and your account follows.")),
        h("div", { class: "row wrap" }, state.me ? ctaJoin.cloneNode(true) : h("a", { class: "btn primary big", href: "/register" }, t("Créer mon profil", "Create my profile")),
          h("a", { class: "btn big quiet", href: "/badges" }, t("Voir les badges →", "See badges →")))),
      h("div", { class: "badge-orbit", "data-reveal": "" },
        ...[["rocket", "#f5c518"], ["shield-check", "#ff5d5d"], ["heart", "#ff6b8a"], ["bug", "#ff6bcb"], ["flask-conical", "#ff9f43"], ["code", "#4f8cff"], ["gem", "#b8e4ff"], ["sparkles", "#a66bff"]]
          .map(([ic, c], i) => h("span", { class: "orb", style: { "--c": c, "--i": i } }, icon(ic))),
        div("orb-core", "S"))),
    // ---- final
    h("section", { class: "final", "data-reveal": "" },
      liquid("liquid"),
      h("h2", {}, t("Prêt à décoller ?", "Ready for takeoff?")),
      h("p", {}, t("Une minute pour l'installer. Tes favoris et mots de passe suivent.", "One minute to install. Your bookmarks and passwords come along.")),
      h("a", { class: "btn accent big", href: DOWNLOAD, target: "_blank", rel: "noopener" }, icon("download"), t("Télécharger Orbit", "Download Orbit"))));

  // Scene follows the step closest to the middle of the screen.
  const setScene = id => {
    stage.dataset.active = id;
    stage.querySelector(".m-url-text").textContent = `orbit://${id}`;
    stepEls.forEach(s => s.classList.toggle("on", s.dataset.step == id));
    dots.querySelectorAll("i").forEach(d => d.classList.toggle("on", d.dataset.dot == id));
  };
  setScene(steps[0][0]);
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) setScene(e.target.dataset.step);
  }, { rootMargin: "-45% 0px -45% 0px" });
  stepEls.forEach(s => io.observe(s));
  dots.querySelectorAll("i").forEach(d => d.addEventListener("click", () => stepEls.find(s => s.dataset.step == d.dataset.dot)?.scrollIntoView({ block: "center" })));

  // The hero mock-up tilts toward the pointer.
  const tilt = page.querySelector(".mock.tilt");
  page.querySelector(".hero").addEventListener("pointermove", e => {
    const x = e.clientX / innerWidth - .5;
    const y = e.clientY / innerHeight - .5;
    tilt.style.setProperty("--rx", `${(-y * 8).toFixed(2)}deg`);
    tilt.style.setProperty("--ry", `${(x * 10).toFixed(2)}deg`);
  });
  // The hero mock-up cycles through scenes on its own.
  let k = 0;
  const cycle = setInterval(() => {
    if (!tilt.isConnected) return clearInterval(cycle);
    tilt.dataset.active = steps[(k = (k + 1) % steps.length)][0];
  }, 3200);

  queueMicrotask(() => {
    reveal(page);
    counters(page);
  });
  return page;
}
