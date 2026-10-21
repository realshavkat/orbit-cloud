import { createBrowserRouter, redirect, Outlet, ScrollRestoration, useRouteError, useNavigation } from "react-router";
import { session } from "./lib/session.js";
import { t } from "./lib/i18n.js";
import { Topbar, Footer, SLOGAN, LangSwitch } from "./components/Shell.jsx";
import { Overlays } from "./components/overlay.jsx";
import { ErrorBox, Spinner, NotFound, Logo, Link, Icon } from "./components/ui.jsx";
import Cosmos from "./components/Cosmos.jsx";
import Landing from "./pages/Landing.jsx";
import * as Auth from "./pages/Auth.jsx";
import * as Profile from "./pages/Profile.jsx";
import * as Account from "./pages/Account.jsx";
import * as Social from "./pages/Social.jsx";
import * as Badges from "./pages/Badges.jsx";
import * as Support from "./pages/Support.jsx";
import * as Beta from "./pages/Beta.jsx";
import * as Legal from "./pages/Legal.jsx";
import * as Mods from "./pages/Mods.jsx";
import * as Forum from "./pages/Forum.jsx";

export function requireMe({ request }) {
  const url = new URL(request.url);
  if (!session.me) throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  if (session.me.mfa_pending && url.pathname != "/mfa") throw redirect("/mfa");
  return session.me;
}

const guard = loader => args => {
  requireMe(args);
  return loader ? loader(args) : null;
};

function Layout({ variant }) {
  const nav = useNavigation();
  return (
    <>
      <Cosmos />
      {nav.state == "loading" && <div className="progress" />}
      <Topbar />
      <main className={variant} aria-busy={nav.state == "loading"}><Outlet /></main>
      <Footer />
      <Overlays />
      <ScrollRestoration />
    </>
  );
}

function AuthLayout() {
  return (
    <div className="auth">
      <Cosmos />
      <aside className="auth-side">
        <Link className="brand" to="/"><Logo size={28} /><span>Orbit</span></Link>
        <div className="auth-pitch"><span className="eyebrow">{t("Compte Orbit", "Orbit account")}</span><h2>{SLOGAN()}</h2>
          <p>{t("Un seul compte pour le forum, ton profil, tes badges, tes mods et ta clé bêta.", "One account for the forum, your profile, badges, mods and beta key.")}</p>
          <ul className="auth-points">
            {[["message-square", t("Discute et vote dans le forum", "Discuss and vote in the forum")], ["palette", t("Publie et installe des mods vérifiés", "Publish and install reviewed mods")],
              ["refresh-cw", t("Lié à Firefox Sync dans Orbit", "Linked to Firefox Sync in Orbit")]].map(([ic, text]) => <li key={ic}><Icon name={ic} />{text}</li>)}
          </ul></div>
        <LangSwitch />
      </aside>
      <main className="auth-main"><div className="auth-form"><Outlet /></div></main>
      <Overlays />
      <ScrollRestoration />
    </div>
  );
}

function AdminLayout() {
  return (
    <>
      <Cosmos quiet />
      <Outlet />
      <Overlays />
      <ScrollRestoration />
    </>
  );
}

function RouteError() {
  const error = useRouteError();
  return error?.status == 404 ? <NotFound /> : <ErrorBox error={error} />;
}

const page = (path, mod, extra = {}) => ({ path, element: <mod.default />, loader: mod.loader, errorElement: <RouteError />, ...extra });

export const router = createBrowserRouter([
  {
    element: <Layout variant="full" />,
    hydrateFallbackElement: <Spinner />,
    children: [{ path: "/", element: <Landing />, errorElement: <RouteError /> }],
  },
  {
    element: <AuthLayout />,
    children: [
      { path: "/login", element: <Auth.Login />, errorElement: <RouteError /> },
      { path: "/register", element: <Auth.Register />, errorElement: <RouteError /> },
      { path: "/connect", element: <Auth.Connect />, errorElement: <RouteError /> },
      { path: "/verify", element: <Auth.Verify />, loader: Auth.verifyLoader, errorElement: <RouteError /> },
      { path: "/confirm-email", element: <Auth.Verify />, loader: Auth.verifyLoader, errorElement: <RouteError /> },
      { path: "/forgot", element: <Auth.Forgot />, errorElement: <RouteError /> },
      { path: "/reset", element: <Auth.Reset />, errorElement: <RouteError /> },
      { path: "/mfa", element: <Auth.Mfa />, errorElement: <RouteError /> },
    ],
  },
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      page("/u/:name", Profile),
      { path: "/discover", element: <Social.Discover />, loader: Social.discoverLoader },
      { path: "/search", element: <Social.Search />, loader: Social.searchLoader },
      { path: "/friends", element: <Social.Friends />, loader: guard(Social.friendsLoader) },
      { path: "/notifications", element: <Social.Notifications />, loader: guard(Social.notificationsLoader) },
      { path: "/sites/:domain", element: <Social.Site />, loader: Social.siteLoader },
      { path: "/share", element: <Social.Share />, loader: guard() },
      { path: "/forum", element: <Forum.Home />, loader: Forum.homeLoader },
      { path: "/forum/c/:slug", element: <Forum.Home />, loader: Forum.homeLoader },
      { path: "/forum/suggestions", element: <Forum.Suggestions />, loader: Forum.suggestionsLoader },
      { path: "/forum/t/:id", element: <Forum.Thread />, loader: Forum.threadLoader },
      { path: "/forum/new", element: <Forum.Compose />, loader: guard(Forum.composeLoader) },
      { path: "/forum/mine", element: <Forum.Mine />, loader: guard(Forum.mineLoader) },
      { path: "/mods", element: <Mods.Store />, loader: Mods.storeLoader },
      { path: "/mods/submit", element: <Mods.Submit />, loader: guard() },
      { path: "/mods/mine", element: <Mods.Mine />, loader: guard(Mods.mineLoader) },
      { path: "/mods/:slug", element: <Mods.Detail />, loader: Mods.detailLoader },
      { path: "/badges", element: <Badges.Catalog />, loader: Badges.catalogLoader },
      { path: "/badges/:key", element: <Badges.Detail />, loader: Badges.detailLoader },
      { path: "/award/:id", element: <Badges.Award />, loader: Badges.awardLoader },
      { path: "/support", element: <Support.default />, loader: Support.loader },
      { path: "/beta", element: <Beta.default />, loader: Beta.loader },
      { path: "/me/:tab?", element: <Account.default />, loader: guard(Account.loader) },
      { path: "/terms", element: <Legal.Terms /> },
      { path: "/privacy", element: <Legal.Privacy /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    element: <AdminLayout />,
    errorElement: <RouteError />,
    children: [{ path: "/admin/:tab?/:id?", lazy: () => import("./pages/Admin.jsx").then(m => ({ Component: m.default, loader: guard(m.loader) })) }],
  },
]);
