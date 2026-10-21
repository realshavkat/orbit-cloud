import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "./styles/app.css";
import "./styles/landing.css";
import { loadMe, loadConfig } from "./lib/session.js";
import "./styles/forum.css";
import { router } from "./App.jsx";
import { startReveal } from "./lib/reveal.js";

await Promise.all([loadMe(), loadConfig()]);

startReveal();
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
