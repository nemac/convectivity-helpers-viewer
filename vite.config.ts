import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// The methodology notes live in docs/ in this repo, outside Vite's public/
// folder, so it will not serve them by default. Rather than keep a duplicate
// copy under public/, this plugin answers /docs/<name>.md straight from docs/.
// One file on disk, read by the browser as committed.
function serveRepoDocs() {
  const docsDir = path.resolve(__dirname, "docs");
  return {
    name: "serve-repo-docs",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const m = /^\/docs\/([A-Za-z0-9._-]+\.md)$/.exec((req.url || "").split("?")[0]);
        if (!m) return next();
        const file = path.join(docsDir, m[1]);
        // path.join already collapses "..", and the pattern above rejects
        // slashes, but check anyway so no request can climb out of docs/.
        if (!file.startsWith(docsDir) || !fs.existsSync(file)) return next();
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.end(fs.readFileSync(file));
      });
    },
    // For `vite build`, copy them into the bundle instead.
    closeBundle() {
      const out = path.resolve(__dirname, "dist", "docs");
      if (!fs.existsSync(docsDir)) return;
      fs.mkdirSync(out, { recursive: true });
      for (const f of fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"))) {
        fs.copyFileSync(path.join(docsDir, f), path.join(out, f));
      }
    },
  };
}

// base "./" so a built copy works from any folder, including a subpath host
export default defineConfig({
  plugins: [react(), serveRepoDocs()],
  base: "./",
  server: {
    // 5173 and 5180 are already taken by other work on this machine.
    port: 5190,
    strictPort: true,
    // A production build writes dist/ inside the project; without this the
    // dev server saw dist/index.html change and reloaded the open page.
    watch: { ignored: ["**/dist/**"] },
  },
});
