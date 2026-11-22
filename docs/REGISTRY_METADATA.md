# FreeMCP registry metadata and verification

Each MCP server now has its own source-of-truth record at `src/data/servers/<id>.json`. `src/lib/registry.ts` loads these files at build time, and the shared `src/pages/servers/[slug].astro` route generates detail pages without creating individual page implementations. The original `src/data/registry.json` is retained only as a migration baseline for regression checks, not for rendering. Run `node scripts/validate-server-migration.mjs` to verify existing entries were copied without changes. To add a new server, create a new JSON file in `src/data/servers/` with a unique slug ID; do not edit the legacy catalogue. Entries provide discovery metadata only; descriptions, star counts and tags are not independently verified.

## Validation

`src/lib/registry.ts` exports `validateRegistry()`, invoked by the v2 preview and server detail routes during static generation. Checks include unique slug-style IDs, non-empty required fields, HTTPS GitHub links, tags and nonnegative numeric star counts.

## Installation evidence policy

Do not publish executable install commands without a source link to maintainer documentation, a review date and a test status. Do not infer package names from GitHub repository names. Never store secrets in the registry. Client compatibility should be recorded only when documented or tested; distinguish those evidence levels.

## Security evidence policy

An unreviewed listing must display `Not independently verified`. A security badge must include its exact scope, evidence and review timestamp. Repository activity and GitHub stars are not evidence of safety. Treat archived or moved repositories as requiring renewed review.

## Next schema migration

Add optional `installation`, `clientCompatibility`, `permissions`, `license`, `evidence` and `reviewedAt` fields, with strict validation and backwards-compatible defaults. Keep missing facts explicitly unknown instead of generating placeholder claims.
