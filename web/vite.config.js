import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets", sourcemap: false },
  server: { port: 5173, proxy: { "/api": "http://localhost:8790" } },
});
