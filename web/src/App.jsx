import { createBrowserRouter, redirect, Outlet, ScrollRestoration, useRouteError, useNavigation } from "react-router";
import { session } from "./lib/session.js";
import { Topbar, Footer } from "./components/Shell.jsx";
import { Overlays } from "./components/overlay.jsx";
import { ErrorBox, Spinner } from "./components/ui.jsx";
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
      <Topbar />
      <main className={variant} aria-busy={nav.state == "loading"}><Outlet /></main>
      <Footer />
      <Overlays />
      <ScrollRestoration />
    </>
  );
}

function AdminLayout() {
  return (
    <>
      <Outlet />
      <Overlays />
      <ScrollRestoration />
    </>
  );
}

function RouteError() {
  const error = useRouteError();
  return <ErrorBox error={error?.status == 404 ? { code: "not_found" } : error} />;
}

const page = (path, mod, extra = {}) => ({ path, element: <mod.default />, loader: mod.loader, errorElement: <RouteError />, ...extra });

export const router = createBrowserRouter([
  {
    element: <Layout variant="full" />,
    hydrateFallbackElement: <Spinner />,
    children: [{ path: "/", element: <Landing />, errorElement: <RouteError /> }],
  },
  {
    element: <Layout variant="narrow" />,
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
      { path: "*", element: <ErrorBox error={{ code: "not_found" }} /> },
    ],
  },
  {
    element: <AdminLayout />,
    errorElement: <RouteError />,
    children: [{ path: "/admin/:tab?/:id?", lazy: () => import("./pages/Admin.jsx").then(m => ({ Component: m.default, loader: guard(m.loader) })) }],
  },
]);
