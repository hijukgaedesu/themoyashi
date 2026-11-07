// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      proxy: {
        // Dev-only proxy so the browser app can talk to Notion without CORS.
        // In production on Cloudflare Pages, functions/api/notion-api/[[path]].js handles this.
        "/api/notion-api": {
          target: "https://api.notion.com",
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api\/notion-api/, ""),
        },
      },
    },
  },
});
