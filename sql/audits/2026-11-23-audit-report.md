# FreeMCP.in production listing audit — 2026-11-23

## Scope and limitations

Production Cloudflare D1 inventory: 32 listings. This PR supplies a **review-only migration**, not an executed production change. The audit checks structural fields for all 32 listings and upstream documentation/source for selected high-risk listings. It does **not** claim runtime testing or exhaustive source verification for all 32. Tool inventories from upstream documentation may include optional toolsets and feature-gated capabilities. Do not merge or execute without reviewing the caveats below.

## Per-listing findings

| Listing | Before → proposed tool count | Fix / finding | Status |
|---|---:|---|---|
| `aws-kb-mcp` | 1 → 3 | Replace incomplete tool inventory using upstream documentation/source; migrate archived listing to maintained implementation | Proposed correction |
| `brave-search-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `browserbase-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `cloudflare-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `context7-mcp` | unchanged | Fill missing lifecycle; repository not archived, runtime not tested | Proposed correction |
| `docker-mcp` | unchanged | Fill missing lifecycle; repository not archived, runtime not tested | Proposed correction |
| `fetch-mcp` | unchanged | Fill missing lifecycle; repository not archived, runtime not tested; add prerequisites | Proposed correction |
| `filesystem-mcp` | 7 → 15 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `firecrawl-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `github-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `gitlab-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `google-maps-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `grafana-mcp` | 7 → 127 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `linear-mcp` | unchanged | Only 6 recorded tools; official hosted inventory not proven exhaustive | No SQL change |
| `memory-mcp` | 7 → 9 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `mgm-falcon-quelllm-mcp` | unchanged | Fill missing lifecycle; repository not archived, runtime not tested; add security guidance | Proposed correction |
| `mongodb-mcp` | unchanged | 54 recorded tools; upstream dynamic toolsets need separate exhaustive check | No SQL change |
| `neon-mcp` | unchanged | 117 recorded tools; profile and access-dependent availability needs validation | No SQL change |
| `nmap-mcp` | unchanged | Docker command may require local image build; installation not runtime tested | No SQL change |
| `notion-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `playwright-mcp` | 5 → 72 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `postgres-mcp` | 1 → 9 | Replace incomplete tool inventory using upstream documentation/source; migrate archived listing to maintained implementation | Proposed correction |
| `puppeteer-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `redis-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `remotify-mcp` | unchanged | Fill missing lifecycle; repository not archived, runtime not tested | Proposed correction |
| `semgrep-mcp` | unchanged | Prior batch changed installation to semgrep mcp; six tools not revalidated | No SQL change |
| `sentry-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `sequential-thinking-mcp` | unchanged | Fill missing lifecycle; repository not archived, runtime not tested; add prerequisites | Proposed correction |
| `shodan-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `slack-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `sqlite-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `stripe-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |

## Source links

- AWS Labs: https://github.com/awslabs/mcp/tree/main/src/bedrock-kb-retrieval-mcp-server
- Postgres MCP Pro: https://github.com/crystaldba/postgres-mcp
- Filesystem and Memory reference implementations: https://github.com/modelcontextprotocol/servers
- Playwright: https://github.com/microsoft/playwright-mcp
- Grafana: https://github.com/grafana/mcp-grafana
- Sentry successor (not migrated): https://github.com/getsentry/toolkit
- Chrome DevTools alternative (not migrated): https://github.com/ChromeDevTools/chrome-devtools-mcp
- Google Maps third-party alternative (not migrated): https://github.com/HasData/google-maps-mcp

## Important cautions

1. Grafana's 127 README-listed tools are across categories; actual exposed tools depend on Grafana version, plugins, configuration and permissions.
2. Playwright's 72 README-listed tools include optional groups, some unsafe or experimental; the default surface may be smaller.
3. Filesystem's 15 and Memory's 9 are current README inventories; old counts were incomplete.
4. AWS and PostgreSQL migrations replace product identity, not just tool names. Review UI metadata, tags and client compatibility before applying.
5. Six lifecycle updates use non-archived GitHub repositories as evidence, **not** proof of release maintenance; review this status classification before production.
6. Four archived listings are deliberately not migrated. Their archived commands remain visible and should be clearly labeled legacy in the UI.
7. Existing listings not changed by this SQL are not certified correct; runtime testing, complete default-tool inventory checks and live frontend rendering remain unverified.
8. SQL is intended for the `servers` table in Cloudflare D1. Review and back up the database before executing. The SQL file contains no comments and does not write to production by itself.

## Verification

After application, re-query each row's top-level description, author, repository URL, summary, installations, security, prerequisites, lifecycle and tools. Validate `json_valid(details_json)` for every row, duplicate tool names, and ensure all 32 records remain present. Check actual detail-page rendering independently.
