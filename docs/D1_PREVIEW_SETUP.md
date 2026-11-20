# D1 preview setup (Phase 3)

The Astro site remains static. Cloudflare Pages Functions serves `GET /api/servers` when the preview environment has a D1 binding named `DB`.

1. Create a **separate preview-only** D1 database named `freemcp-preview-registry` in Cloudflare.
2. In the **freemcp Pages project**, Settings → Bindings → Preview, bind the database with variable name `DB`. Do not bind production to this preview database.
3. Apply `migrations/0001_servers.sql` to the preview D1 database.
4. Run `node scripts/generate-d1-seed.mjs` and apply `seed/servers.sql` to the preview database.
5. Deploy the feature branch and test `/api/servers?page=1`, `/api/servers?q=github`, `/api/servers?category=...` and `/servers`.
6. The browser directory uses the API if available and falls back to its bundled catalogue if API is unavailable. This fallback is temporary and must be removed before claiming 10k-server scalability.

API returns `{servers,total,page,pages,pageSize}`, max 24 records per page. Query parameters: `q`, `category`, `sort=name|category`, `page`.

**Do not configure production bindings, merge the draft PR, or deploy to the production branch without explicit approval.** GitHub metadata syncing and removal of the client-side fallback are separate follow-up tasks.
