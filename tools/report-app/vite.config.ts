import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/**
 * The app builds into `dist/`, which `scripts/report-server.mjs` serves. In dev, Vite owns the page and
 * proxies `/api` to the report server, so a change to a component reloads without restarting anything.
 * `npm run dev` starts both and passes the server's URL in `REPORT_URL`, so `--port 9000` is followed.
 */
export default defineConfig(() => {
  const reportUrl = process.env.REPORT_URL ?? "http://127.0.0.1:8787";
  return {
    plugins: [tailwindcss(), solid()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: reportUrl, changeOrigin: false },
        "/history.jsonl": { target: reportUrl, changeOrigin: false },
      },
    },
    build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  };
});