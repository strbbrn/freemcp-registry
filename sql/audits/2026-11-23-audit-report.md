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
| `context7-mcp` | unchanged | Leave lifecycle unset pending individual release verification; repository itself not archived | Proposed correction |
| `docker-mcp` | unchanged | Leave lifecycle unset pending individual release verification; repository itself not archived | Proposed correction |
| `fetch-mcp` | unchanged | Leave lifecycle unset pending individual release verification; repository itself not archived; add prerequisites | Proposed correction |
| `filesystem-mcp` | 7 → 15 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `firecrawl-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `github-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `gitlab-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `google-maps-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `grafana-mcp` | 7 → 127 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `linear-mcp` | unchanged | Only 6 recorded tools; official hosted inventory not proven exhaustive | No SQL change |
| `memory-mcp` | 7 → 9 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `mgm-falcon-quelllm-mcp` | unchanged | Leave lifecycle unset pending individual release verification; repository itself not archived; add security guidance | Proposed correction |
| `mongodb-mcp` | unchanged | 54 recorded tools; upstream dynamic toolsets need separate exhaustive check | No SQL change |
| `neon-mcp` | unchanged | 117 recorded tools; profile and access-dependent availability needs validation | No SQL change |
| `nmap-mcp` | unchanged | Upstream README confirms Docker image must be built before launching; add explicit build prerequisite | Proposed correction |
| `notion-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `playwright-mcp` | 5 → 72 | Replace incomplete tool inventory using upstream documentation/source; add prerequisites | Proposed correction |
| `postgres-mcp` | 1 → 9 | Replace incomplete tool inventory using upstream documentation/source; migrate archived listing to maintained implementation | Proposed correction |
| `puppeteer-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `redis-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `remotify-mcp` | unchanged | Leave lifecycle unset pending individual release verification; repository itself not archived | Proposed correction |
| `semgrep-mcp` | unchanged | Prior batch changed installation to semgrep mcp; six tools not revalidated | No SQL change |
| `sentry-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `sequential-thinking-mcp` | unchanged | Leave lifecycle unset pending individual release verification; repository itself not archived; add prerequisites | Proposed correction |
| `shodan-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `slack-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |
| `sqlite-mcp` | unchanged | Archived reference remains archived; flag migration pending (no unverified replacement) | Proposed correction |
| `stripe-mcp` | unchanged | Existing fields retained; full runtime and upstream tool completeness not verified | No SQL change |

## Source links

- Nmap MCP Docker build and tool reference: https://github.com/Vorota-ai/nmap-mcp

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
5. Six lifecycle-null listings deliberately retain unset lifecycle: a non-archived repository does not establish implementation maintenance.
6. Four archived listings are deliberately not migrated. Their archived commands remain visible and should be clearly labeled legacy in the UI.
7. Existing listings not changed by this SQL are not certified correct; runtime testing, complete default-tool inventory checks and live frontend rendering remain unverified.
8. SQL is intended for the `servers` table in Cloudflare D1. Review and back up the database before executing. The SQL file contains no comments and does not write to production by itself.

## Verification

The migration updates 17 distinct listings, but the six repository-status-only rows do not set lifecycle. Missing lifecycle values remain unresolved and must not be described as fixed.


After application, re-query each row's top-level description, author, repository URL, summary, installations, security, prerequisites, lifecycle and tools. Validate `json_valid(details_json)` for every row, duplicate tool names, and ensure all 32 records remain present. Check actual detail-page rendering independently.


## Additional upstream README retrieval — 2026-11-23

Successfully fetched and inspected the existence of current README content for these 15 repositories: `brave/brave-search-mcp-server`, `browserbase/stagehand`, `cloudflare/mcp`, `firecrawl/firecrawl-mcp-server`, `github/github-mcp-server`, `zereight/gitlab-mcp`, `mongodb-js/mongodb-mcp-server`, `neondatabase/mcp-server-neon`, `Vorota-ai/nmap-mcp`, `makenotion/notion-mcp-server`, `redis/mcp-redis`, `semgrep/semgrep`, `w0h1v/mcp-shodan`, `slackapi/slack-skills-plugin`, and `stripe/ai`.

**Evidence boundary:** README retrieval confirms the referenced repositories are accessible; it does **not** verify that every tool listed in production matches the default-enabled upstream inventory. In particular, `slackapi/slack-skills-plugin` is a plugin repository and not necessarily the implementation of the hosted Slack MCP service; `browserbase/stagehand` is a broader automation repository, not necessarily the source of the hosted MCP endpoint. These source-identity ambiguities must be resolved rather than presented as verified source code.

Read-only production-row simulation succeeded for every proposed `json_set` expression (20/20): valid JSON, preserved array types for tools, installations, security. The complete SQL with `updated_at` changes was also recompiled against D1 using `EXPLAIN` (20/20 passed, no writes).


## Tool-name README text cross-check — 2026-11-23

This is a **literal name-occurrence check only**, not proof that tools exist at runtime, are enabled by default, or have matching descriptions. Production tool names were compared case-insensitively with the linked repository's root README:

| Listing | Tool names found / listed | Interpretation |
|---|---:|---|
| Brave Search | 8/8 | All names occur in README |
| Browserbase | 6/6 | All names occur in Stagehand README; hosted service identity still separate |
| Cloudflare | 4/4 | All names occur in README |
| Firecrawl | 34/34 | All names occur in README |
| GitHub | 95/95 | All names occur in README |
| GitLab | 40/40 | All names occur in README |
| MongoDB | 53/54 | `remote-atlas-connect` not found in root README; check dedicated tool docs before deciding whether to remove |
| Neon | 117/117 | All names occur in README |
| Nmap | 6/6 | All names occur in README |
| Notion | 0/36 | Root README covers local package; listing describes hosted service with separate tool documentation. **Not evidence of 36 invalid tools** |
| Redis | 6/53 | Root README is not an exhaustive tool catalog; inspect module documentation/source before concluding missing tools |
| Semgrep | 0/6 | Root project README does not document MCP-specific tools; inspect MCP module documentation |
| Shodan | 11/11 | All names occur in README |
| Slack | 0/27 | Linked Slack Skills Plugin README is not the hosted MCP tool reference. Source identity remains unresolved |
| Stripe | 0/15 | Root Stripe AI README does not list hosted MCP tool names; use Stripe MCP documentation |

The numbers above **must not be represented as runtime validation**. They identify documentation coverage and gaps for follow-up; no tool was removed based solely on absence from a root README.


## Registry admission-policy conflict (requires owner decision)

The repository's public README describes FreeMCP as a registry of **100% free and open-source MCP servers**, with a public repository and recognized OSS license as submission requirements. Several existing listings instead use vendor-hosted OAuth HTTP endpoints (e.g., Linear, Notion, Slack, Stripe, Neon, Browserbase, Cloudflare). An open-source SDK, client library, or adjacent plugin repository **does not establish that the hosted MCP server implementation is open source**. Free use of an MCP endpoint also does not prove its underlying API has no usage charges.

This is a **policy-verification gap**, not evidence that all named vendors violate the policy. Before certifying the entire registry, either (a) verify each hosted server's source license and free core usage, (b) explicitly broaden the directory's admission criteria to include free-to-connect proprietary hosted MCP services with transparent pricing disclosures, or (c) unlist entries that cannot meet the published rules. Do not silently delete or relabel vendor listings as open-source without evidence.
