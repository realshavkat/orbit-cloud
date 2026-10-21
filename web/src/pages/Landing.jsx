import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n.js";
import { get } from "../lib/api.js";
import { useMe, session } from "../lib/session.js";
import { fmtMoney } from "../lib/format.js";
import { Icon, Link } from "../components/ui.jsx";
import { SLOGAN } from "../components/Shell.jsx";
import { LatestThreads, STATUS } from "./Forum.jsx";

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
  ["downloads", "download", "Orbit Turbo", t("Les gros fichiers arrivent plus vite", "Big files arrive faster"),
    t("Quand un téléchargement est lent, Orbit Turbo le découpe en plusieurs connexions. Une page complète pour retrouver, trier et chercher tout ce que tu as téléchargé.",
      "When a download is slow, Orbit Turbo splits it over several connections. A full page to find, sort and search everything you downloaded.")],
  ["privacy", "shield-check", t("Vie privée", "Privacy"), t("Les traqueurs restent dehors", "Trackers stay outside"),
    t("Bloqueur intégré, DNS chiffré, protection contre l'empreinte. Ton historique ne quitte jamais ton ordinateur, et la navigation privée ne laisse aucune trace.",
      "Built-in blocker, encrypted DNS, fingerprinting protection. Your history never leaves your computer, and private browsing leaves no trace.")],
  ["community", "users", t("Communauté", "Community"), t("Un profil, des badges, des mods", "A profile, badges, mods"),
    t("Un profil à ton image, des badges vérifiables, des mods vérifiés par l'équipe. Tu choisis ce que les autres voient.",
      "A profile that looks like you, verified badges, mods checked by the team. You choose what others see.")],
];

const MORE = () => [
  ["palette", "Mods", t("Change tout le style d'Orbit en un clic.", "Restyle Orbit in one click."), "/mods"],
  ["bot", t("IA sur plusieurs onglets", "AI across tabs"), t("Résume, compare ou interroge les pages choisies.", "Summarize, compare or ask about the pages you pick.")],
  ["history", t("Sessions", "Sessions"), t("Enregistre tes onglets sous un nom, retrouve-les plus tard.", "Save your tabs under a name, bring them back later.")],
  ["eye", t("Mode concentration", "Focus mode"), t("Ctrl+Maj+F : la page, rien d'autre.", "Ctrl+Shift+F: the page, nothing else.")],
  ["picture-in-picture-2", "Picture-in-Picture", t("Une vidéo qui flotte au-dessus de tout.", "A video floating above everything.")],
  ["book-open", t("Notes d'onglet", "Tab notes"), t("Une note attachée à une page, retrouvée à chaque visite.", "A note on a page, back on every visit.")],
  ["refresh-cw", t("Synchronisation", "Sync"), t("Tes espaces et réglages sur tous tes PC.", "Your spaces and settings on every PC.")],
  ["moon", t("Mise en veille", "Tab sleeping"), t("Les onglets inutilisés libèrent la mémoire tout seuls.", "Idle tabs free memory on their own.")],
  ["languages", t("8 langues", "8 languages"), t("Français, anglais, espagnol, allemand, portugais, italien, russe, ukrainien.", "English, French, Spanish, German, Portuguese, Italian, Russian, Ukrainian.")],
  ["app-window", t("Onglets en haut", "Tabs on top"), t("Préfères les onglets classiques ? Un réglage.", "Prefer classic tabs? One setting.")],
  ["upload", t("Import en un clic", "One-click import"), t("Favoris, mots de passe et historique de Chrome, Edge, Brave.", "Bookmarks, passwords and history from Chrome, Edge, Brave.")],
  ["sparkles", t("Pipette, loupe, PDF", "Picker, loupe, PDF"), t("Les petits outils du quotidien, déjà là.", "The everyday little tools, already there.")],
];

function Mock({ active }) {
  const rows = [["languages", t("Traduire la page", "Translate page")], ["layers", t("Fermer les onglets en double", "Close duplicate tabs")], ["pipette", t("Pipette à couleurs", "Color picker")], ["lock", t("Verrouiller Orbit", "Lock Orbit")]];
  const dl = [["film", "trailer-4k.mp4", 8], ["download", "orbit-setup.exe", 4], ["image", "photos.zip", 6]];
  return (
    <div className="mock" data-active={active}>
      <div className="m-top"><div className="m-dots"><i /><i /><i /></div><div className="m-url"><Icon name="lock" /><span>orbit://{active}</span></div></div>
      <div className="m-body">
        <div className="m-side">
          <div className="m-spaces"><i className="s1" /><i className="s2" /><i className="s3" /></div>
          <div className="m-space-name" />
          {Array.from({ length: 6 }, (_, i) => <div key={i} className={`m-tab${i == 1 ? " sel" : ""}`}><div className="m-fav" /><div className="m-line" /></div>)}
        </div>
        <div className="m-page">
          <div className="m-hero" />{Array.from({ length: 4 }, (_, i) => <div key={i} className="m-text" />)}
          <div className="scene" data-scene="spaces"><div className="m-space-cards">
            <div className="m-sc a"><Icon name="layers" /><b>{t("Travail", "Work")}</b></div>
            <div className="m-sc b"><Icon name="heart" /><b>{t("Perso", "Personal")}</b></div>
            <div className="m-sc c"><Icon name="rocket" /><b>{t("Projets", "Projects")}</b></div>
          </div></div>
          <div className="scene" data-scene="palette"><div className="m-palette">
            <div className="m-pal-input"><Icon name="search" /><span className="m-typed">{t("traduire", "translate")}</span><span className="m-caret" /></div>
            {rows.map(([ic, label], i) => <div key={i} className={`m-pal-row r${i}`}><Icon name={ic} /><span>{label}</span>{i == 0 && <kbd>↵</kbd>}</div>)}
          </div></div>
          <div className="scene" data-scene="split"><div className="m-split"><div className="m-pane p1" /><div className="m-pane p2" /><div className="m-pane p3" /><div className="m-pane p4" /></div></div>
          <div className="scene" data-scene="pipette"><div className="m-swatches"><div className="sw a" /><div className="sw b" /><div className="sw c" /><div className="sw d" /></div><div className="m-loupe"><div className="m-loupe-ring" /><span className="m-hex" /></div></div>
          <div className="scene" data-scene="lock"><div className="m-lock"><div className="m-lock-icon"><Icon name="lock" /></div><b>{t("Orbit est verrouillé", "Orbit is locked")}</b><div className="m-pin"><i /><i /><i /><i /></div></div></div>
          <div className="scene" data-scene="downloads"><div className="m-dl">
            {dl.map(([ic, name, n], i) => (
              <div key={i} className={`m-dl-row d${i}`}><div className="m-dl-ic"><Icon name={ic} /></div>
                <div className="m-dl-main"><b>{name}</b><div className="m-dl-bar">{Array.from({ length: n }, (_, j) => <i key={j} style={{ "--j": j }} />)}</div></div>
                <span className="m-turbo">Turbo ×{n}</span></div>
            ))}
          </div></div>
          <div className="scene" data-scene="privacy"><div className="m-shield"><div className="m-shield-icon"><Icon name="shield-check" /></div><b className="m-count" /><span>{t("traqueurs bloqués", "trackers blocked")}</span>
            <div className="m-blocked">{["ads.doubleclick.net", "pixel.facebook.com", "analytics.tiktok.com", "bat.bing.com"].map((d, i) => <span key={d} style={{ "--i": i }}><Icon name="ban" />{d}</span>)}</div>
          </div></div>
          <div className="scene" data-scene="community"><div className="m-profile"><div className="m-pbanner" /><div className="m-pavatar">S</div><b>shavkat</b>
            <div className="m-pbadges">{[["rocket", "#f5c518"], ["shield-check", "#ff8d97"], ["heart", "#ff8da5"], ["bug", "#3dd68c"]].map(([ic, c], i) => <span key={ic} style={{ "--c": c, "--i": i }}><Icon name={ic} /></span>)}</div>
          </div></div>
        </div>
      </div>
    </div>
  );
}

function useCounts(root) {
  useEffect(() => {
    const counts = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        counts.unobserve(e.target);
        const end = Number(e.target.dataset.count);
        const t0 = performance.now();
        const tick = now => {
          const p = Math.min(1, (now - t0) / 1400);
          e.target.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString();
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.6 });
    root.current.querySelectorAll("[data-count]").forEach(el => counts.observe(el));
    return () => counts.disconnect();
  }, []);
}

function useScrollTilt(ref) {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return ref.current?.style.setProperty("--p", 1);
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, 1 - (r.top - innerHeight * 0.25) / (innerHeight * 0.55)));
        el.style.setProperty("--p", p.toFixed(3));
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
    };
  }, []);
}

const Words = ({ text }) => text.split(" ").map((w, i) => <span key={i} className="hw" style={{ "--w": i }}>{w}{" "}</span>);

function ForumPreview() {
  const [data, setData] = useState(null);
  useEffect(() => {
    Promise.all([get("/forum/threads?sort=hot"), get("/forum/suggestions/summary")])
      .then(([th, s]) => setData({ threads: th.threads.slice(0, 4), summary: s }))
      .catch(() => setData({ threads: [], summary: {} }));
  }, []);
  const S = STATUS();
  return (
    <section className="l-forum">
      <div className="l-forum-text" data-reveal="">
        <span className="eyebrow">Forum</span>
        <h2>{t("La communauté décide de la suite.", "The community shapes what comes next.")}</h2>
        <p>{t("Des discussions par sujet, des votes, et un tableau de suggestions où l'équipe répond. Orbit l'ouvre au démarrage, et un réglage suffit pour l'enlever.",
          "Threads by topic, votes, and a suggestions board where the team answers. Orbit opens it at launch, and one setting turns that off.")}</p>
        <ul className="l-status">
          {Object.entries(S).slice(1, 4).map(([k, [ic, label, c]]) => (
            <li key={k} style={{ "--c": c }}><Icon name={ic} /><span>{label}</span><b>{data ? data.summary[k] ?? 0 : "–"}</b></li>
          ))}
        </ul>
        <div className="row wrap">
          <Link className="btn primary big" to="/forum">{t("Ouvrir le forum", "Open the forum")}<Icon name="arrow-right" /></Link>
          <Link className="btn big quiet" to="/forum/suggestions"><Icon name="lightbulb" />Suggestions</Link>
        </div>
      </div>
      <div className="l-window" data-reveal="" style={{ "--d": "120ms" }}>
        <div className="l-window-bar"><i /><i /><i /><span>orbit://forum</span></div>
        <div className="l-window-body">
          {!data ? Array.from({ length: 4 }, (_, i) => <div key={i} className="l-skel"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>)
            : data.threads.length ? <LatestThreads threads={data.threads} />
              : <div className="empty"><Icon name="message-square" /><div>{t("Le forum vient d'ouvrir. Lance la première discussion.", "The forum just opened. Start the first thread.")}</div>
                <Link className="btn small" to="/forum/new">{t("Nouvelle discussion", "New thread")}</Link></div>}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const me = useMe();
  const root = useRef(null);
  const shot = useRef(null);
  const steps = STEPS();
  const [scene, setScene] = useState(steps[0][0]);
  const [hero, setHero] = useState(0);
  const stepRefs = useRef([]);
  useCounts(root);
  useScrollTilt(shot);
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setScene(e.target.dataset.step);
    }, { rootMargin: "-45% 0px -45% 0px" });
    stepRefs.current.forEach(s => s && io.observe(s));
    const id = setInterval(() => setHero(k => (k + 1) % steps.length), 3400);
    return () => {
      io.disconnect();
      clearInterval(id);
    };
  }, []);
  const price = session.config?.beta?.paywall ? fmtMoney(session.config.beta.price_cents ?? 200) : null;
  const get_ = price
    ? <Link className="btn primary big" to="/beta"><Icon name="download" />{t(`Obtenir la bêta · ${price}`, `Get the beta · ${price}`)}</Link>
    : <Link className="btn primary big" to="/beta"><Icon name="download" />{t("Télécharger pour Windows", "Download for Windows")}</Link>;
  return (
    <div className="landing" ref={root}>
      <section className="hero">
        <Link className="release" to="/forum"><span>{t("Nouveau", "New")}</span>{t("Le forum Orbit est ouvert", "The Orbit forum is open")}<Icon name="arrow-right" /></Link>
        <h1 className="hero-title"><Words text={SLOGAN()} /></h1>
        <p className="lead">
          {t("Espaces, palette de commandes, vue partagée, verrouillage, mods vérifiés. Ton historique reste sur ton ordinateur. Basé sur Firefox.",
            "Spaces, command palette, split view, lock, reviewed mods. Your history stays on your computer. Built on Firefox.")}
        </p>
        <div className="hero-cta">{get_}<Link className="btn big" to="/forum"><Icon name="message-square" />{t("Voir le forum", "Visit the forum")}</Link></div>
        <p className="hero-meta">{price ? t(`Bêta à ${price}, une seule fois · gratuit à la 1.0`, `Beta ${price} once · free at 1.0`) : t("Gratuit", "Free")}<i />Windows 10 · 11<i />Firefox 158</p>
        <div className="hero-shot" ref={shot}><Mock active={steps[hero][0]} /></div>
      </section>

      <section className="numbers">
        {[[0, t("octet d'historique envoyé à qui que ce soit", "bytes of history sent to anyone")], [4, t("pages côte à côte en vue partagée", "pages side by side in split view")],
          [8, t("langues, dont le français", "languages, English and French included")], [price ? 2 : 100, price ? t("€ une seule fois pour toute la bêta", "€ once for the whole beta") : t("% gratuit", "% free")]]
          .map(([n, label], i) => <div key={i} className="num" data-reveal="" style={{ "--d": `${i * 90}ms` }}><b data-count={n}>0</b><span>{label}</span></div>)}
      </section>

      <section className="story" id="features">
        <header className="section-head" data-reveal="">
          <span className="eyebrow">{t("Fonctionnalités", "Features")}</span>
          <h2>{t("Pensé pour aller vite, sans bruit.", "Built for speed, without the noise.")}</h2>
          <p>{t("Chaque fonction s'allume dans la fenêtre pendant que tu fais défiler.", "Each feature lights up in the window as you scroll.")}</p>
        </header>
        <div className="story-grid">
          <div className="steps">
            {steps.map(([id, ic, kicker, title, text], i) => (
              <article key={id} ref={el => (stepRefs.current[i] = el)} className={`step${scene == id ? " on" : ""}`} data-step={id}>
                <span className="kicker"><b>{String(i + 1).padStart(2, "0")}</b><Icon name={ic} />{kicker}</span>
                <h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
          <div className="stage">
            <Mock active={scene} />
            <div className="rail">{steps.map(([id], i) => <button key={id} type="button" aria-label={steps[i][2]} className={scene == id ? "on" : ""} onClick={() => stepRefs.current[i]?.scrollIntoView({ block: "center", behavior: "smooth" })} />)}</div>
          </div>
        </div>
      </section>

      <section className="more">
        <header className="section-head left" data-reveal="">
          <span className="eyebrow">{t("Détails", "Details")}</span>
          <h2>{t("Et tous les détails qui comptent.", "And every detail that matters.")}</h2>
        </header>
        <div className="more-grid">
          {MORE().map(([ic, name, text, to], i) => {
            const body = <><span className="d-ic"><Icon name={ic} /></span><span><h3>{name}</h3><p>{text}</p></span></>;
            return to
              ? <Link key={i} className="detail" to={to} data-reveal="" style={{ "--d": `${(i % 3) * 70}ms` }}>{body}</Link>
              : <div key={i} className="detail" data-reveal="" style={{ "--d": `${(i % 3) * 70}ms` }}>{body}</div>;
          })}
        </div>
      </section>

      <ForumPreview />

      <section className="community">
        <div className="badge-orbit" data-reveal="">
          {[["rocket", "#f5c518"], ["shield-check", "#ff8d97"], ["heart", "#ff8da5"], ["bug", "#3dd68c"], ["flask-conical", "#f5b841"], ["code", "#7fd1ff"], ["gem", "#c9ccd8"], ["sparkles", "#c4b5ff"]]
            .map(([ic, c], i) => <span key={ic} className="orb" style={{ "--c": c, "--i": i }}><Icon name={ic} /></span>)}
          <div className="orb-core">{(me?.username ?? "O")[0].toUpperCase()}</div>
        </div>
        <div className="community-text" data-reveal="" style={{ "--d": "100ms" }}>
          <span className="eyebrow">{t("Profil", "Profile")}</span>
          <h2>{t("Un profil qui te ressemble.", "A profile that feels like you.")}</h2>
          <p>{t("Badges vérifiables, amis, collections de sites et mods. Tu choisis qui voit chaque partie. Connecte-toi à Firefox Sync dans Orbit et ton compte suit.",
            "Verified badges, friends, site collections and mods. You choose who sees each part. Sign in to Firefox Sync in Orbit and your account follows.")}</p>
          <div className="row wrap">
            {me ? <Link className="btn big" to={`/u/${me.username}`}>{t("Mon profil", "My profile")}</Link> : <Link className="btn big" to="/register">{t("Créer mon profil", "Create my profile")}</Link>}
            <Link className="btn big quiet" to="/badges">{t("Voir les badges", "See badges")}<Icon name="arrow-right" /></Link>
          </div>
        </div>
      </section>

      <section className="final" data-reveal="">
        <div>
          <h2>{t("Prêt à décoller ?", "Ready for takeoff?")}</h2>
          <p>{price ? t(`La bêta coûte ${price}, une seule fois. Tes favoris et mots de passe suivent.`, `The beta costs ${price}, once. Your bookmarks and passwords come along.`)
            : t("Une minute pour l'installer. Tes favoris et mots de passe suivent.", "One minute to install. Your bookmarks and passwords come along.")}</p>
        </div>
        <div className="row wrap">{get_}<Link className="btn big" to="/support">{t("Soutenir le projet", "Support the project")}</Link></div>
      </section>
    </div>
  );
}
