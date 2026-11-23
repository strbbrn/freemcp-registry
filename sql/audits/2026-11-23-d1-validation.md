# Cloudflare D1 read-only SQL validation — 2026-11-23

## Result

**PASS: 20 of 20 proposed UPDATE statements compiled successfully (retested after adding `updated_at = CURRENT_TIMESTAMP`)** using the production D1 `/query` API with `EXPLAIN` prepended to each statement. The API returned 20 results, each `success: true`, with `meta.changes: 0`. No UPDATE was executed.

Production baseline read-only query:

| Metric | Before proposed SQL |
|---|---:|
| Listings | 32 |
| Invalid details JSON | 0 |
| Missing prerequisites | 5 |
| Missing lifecycle | 10 |
| Missing security | 1 |
| Missing summary | 0 |
| Missing installations | 0 |
| Missing documentation URL | 0 |

## Scope

This is **SQL compilation validation, not a write dry-run**. It does not prove that a JSON update produces the intended application behavior, that a tool name is enabled by default, or that installation commands succeed at runtime.

## Outstanding checks

- Compare proposed rows against upstream current tools and default/optional capability settings.
- Verify lifecycle status for ten baseline-null entries. The draft SQL intentionally does not assert maintenance merely because a repository is not archived.
- Test actual MCP startup and frontend detail-page rendering.
- After backup and approval, execute the migration and run `2026-11-23-postapply-checks.sql` to validate live state.

## Production-row transformation simulation (read-only)

Each proposed `details_json = json_set(details_json, ...)` expression was evaluated in a `SELECT` against its actual production row. All 20 expressions returned valid JSON, with `tools`, `installations`, and `security` retaining array types. All 20 targeted records existed.

Tool inventory counts in the proposed rows: Filesystem **15**, Memory **9**, Playwright **72**, Grafana **127**, AWS Bedrock KB **3**, PostgreSQL **9**. Playwright/Grafana are **documented capability inventories**, including tools that may require flags, plugins, permissions, or optional configuration; they are not guaranteed to be enabled in a default installation.

The first 12 transformations intentionally preserve some missing prerequisites/security fields until later updates in the same migration: Fetch prerequisites are populated by statement 13; Sequential Thinking prerequisites by statement 14; QuelLLM security by statement 15.

All 20 updated statements were rechecked with production D1 `EXPLAIN`: **20/20 passed, 0 changes**. This is not a full transaction simulation and no production write was performed.
