# Phase 3 — D1-backed Preview registry

## Status and isolation

- Preview Pages project: `freemcp`, feature branch `feature/freemcp-v2-foundation`.
- Preview D1 binding: `DB` → `freemcp-preview-registry` (database ID `1d3540c0-d836-4f8e-b048-fd22d780b46b`).
- The production Pages configuration also currently has a `DB` binding to this preview database. **Remove that production binding before releasing**, but only with explicit approval. This feature branch does not change production.
- The directory is API-driven; `/api/servers` uses indexed FTS5, category filtering, ordering, and 24-record pages. `?meta=categories` reads category values from D1.
- Existing static server details retain their documentation. D1-only records are served by a Pages Function when a static detail route returns 404.

## Sync GitHub metadata

`.github/workflows/sync-github-metadata.yml` supports manual execution from the feature branch and is designed for a daily scheduled run **once this workflow exists on the default branch**. It explicitly checks out `feature/freemcp-v2-foundation`, and its SQL updates only the preview D1 database. It never updates production D1 or commits to `main`.

The workflow fetches GitHub star counts for each version-controlled server, writes a transaction SQL file, and uploads the SQL as a GitHub Actions artifact. GitHub API failures are skipped, not replaced with stale or zero counts.

**Required to apply the generated SQL automatically:** add repository Actions secret `CLOUDFLARE_API_TOKEN` with permission to execute queries against the preview D1 database. The workflow will still produce an inspectable SQL artifact without this secret, but will not update D1. Never commit tokens to the repository. Scheduled GitHub workflows only run when their workflow file is on the default branch; until release, use `workflow_dispatch` from the feature branch to run it manually. Do not merge this feature branch solely to enable the schedule without release approval.

## Local checks

```bash
npm ci
node --test tests/registry.test.mjs tests/d1-api.test.mjs
npm run build
node --test tests/build-smoke.test.mjs
node scripts/sync-github-metadata.mjs --output seed/github-metadata.sql
```

## Preview API checks

- `/api/servers`: expect 21 initial records, 24/page.
- `/api/servers?q=github`: expect filtered results.
- `/api/servers?category=Security`: expect category filtering.
- `/api/servers?meta=categories`: expect categories array.
- `/api/servers?page=2`: should clamp to page 1 with 21 records.
- To test real pagination, import a **synthetic dataset into a separate test D1 database** and verify 24 records/page across 10,000+ rows; do not pollute the preview or production registry.

The unit tests exercise 10,000-record pagination, bound FTS search parameters, category metadata, missing bindings, and D1-only detail rendering. These are simulated D1 responses, not a measured 10,000-record live load test.
