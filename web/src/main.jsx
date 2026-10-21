import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "./styles/app.css";
import "./styles/landing.css";
import { loadMe, loadConfig } from "./lib/session.js";
import { router } from "./App.jsx";

await Promise.all([loadMe(), loadConfig()]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
