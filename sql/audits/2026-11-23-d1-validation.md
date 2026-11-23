# Cloudflare D1 read-only SQL validation — 2026-11-23

## Result

**PASS: 20 of 20 proposed UPDATE statements compiled successfully** using the production D1 `/query` API with `EXPLAIN` prepended to each statement. The API returned 20 results, each `success: true`, with `meta.changes: 0`. No UPDATE was executed.

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
