import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_SERVER_BASE_URL || 'http://localhost:4000'
  // Production-readiness fix: VITE_* variables are inlined into the built
  // bundle at build time (Vite can't re-read them at runtime, unlike a
  // server env var) — src/pages/DataSourcesGithub.jsx uses
  // VITE_SERVER_BASE_URL to build the absolute URL for its GitHub OAuth
  // popup window. Leaving it unset used to silently ship a bundle that
  // popped open http://localhost:4000/... for every real user. `command
  // === 'build'` is exactly "someone ran `vite build`" (what `npm run
  // build` does) — dev (`vite`/`vite dev`) is unaffected, so local
  // development keeps its existing localhost defaults unchanged.
  if (command === 'build' && !env.VITE_SERVER_BASE_URL) {
    throw new Error(
      'VITE_SERVER_BASE_URL is required for a production build (it is baked into the ' +
      'bundle at build time and cannot be supplied later as a runtime App Setting). ' +
      'Set it to the real production URL, e.g. VITE_SERVER_BASE_URL=https://<app>.azurewebsites.net, ' +
      'before running `npm run build`.'
    )
  }
  return {
    plugins: [react()],
    // Root-relative, not './' — this app is always served from a fixed
    // origin by server/index.js's own Express static handler (never
    // opened via file://), and its client-side router uses real paths
    // like /admin/access or /users. A relative base resolves asset URLs
    // against the CURRENT URL path, so the exact same dist/index.html
    // (server/index.js's SPA fallback serves it for every unmatched path)
    // would ask for ./assets/index-*.js from /admin/access and actually
    // request /admin/assets/index-*.js — a 404 that leaves the app stuck
    // on the static "Loading application..." placeholder forever. This
    // was a real, previously-unnoticed bug: any hard refresh or direct/
    // bookmarked navigation to a nested route (not just /admin/access)
    // broke the whole app.
    base: '/',
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/auth': { target, changeOrigin: true }
      }
    }
  }
})
