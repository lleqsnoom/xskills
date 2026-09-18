import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

/**
 * The panel build: one file, with no external reference left in it.
 *
 * A plugin panel is a document with `default-src 'none'` and `script-src 'unsafe-inline'`, so a `<script src>`
 * or a `<link href>` is not merely slower there, it is blocked — a build that keeps one shows a blank pane.
 * Vite emits those tags whatever the asset settings, so this inlines them and drops what it inlined.
 */
function singleFilePanel(): Plugin {
  return {
    name: "report-panel-single-file",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find(
        (file) => file.type === "asset" && file.fileName.endsWith(".html")
      );
      if (!page || page.type !== "asset" || typeof page.source !== "string") return;

      const take = (href: string): string => {
        const key = href.replace(/^\//, "");
        const file = bundle[key];
        if (!file) return "";
        const source = file.type === "asset" ? String(file.source) : file.code;
        delete bundle[key];
        return source;
      };

      page.source = page.source
        .replace(
          /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
          (_, href) => `<style>${take(href)}</style>`
        )
        .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "")
        .replace(
          /<script[^>]*src="([^"]+)"[^>]*><\/script>/g,
          (_, src) => `<script type="module">${take(src)}</script>`
        );
    },
  };
}

/**
 * The app builds into `dist/`, which `scripts/report-server.mjs` serves. In dev, Vite owns the page and
 * proxies `/api` to the report server, so a change to a component reloads without restarting anything.
 * `npm run dev` starts both and passes the server's URL in `REPORT_URL`, so `--port 9000` is followed.
 *
 * `--mode panel` builds the second target instead: `dist-panel/`, one file, which
 * `scripts/report-panel.mjs` bakes a snapshot into for the Orca plugin's panel.
 */
export default defineConfig(({ mode }) => {
  const panel = mode === "panel";
  const reportUrl = process.env.REPORT_URL ?? "http://127.0.0.1:8787";
  return {
    plugins: [tailwindcss(), solid(), ...(panel ? [singleFilePanel()] : [])],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: reportUrl, changeOrigin: false },
        "/history.jsonl": { target: reportUrl, changeOrigin: false },
      },
    },
    build: panel
      ? {
          outDir: "dist-panel",
          emptyOutDir: true,
          target: "es2022",
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          cssCodeSplit: false,
          modulePreload: { polyfill: false },
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : { outDir: "dist", emptyOutDir: true, target: "es2022" },
  };
});
