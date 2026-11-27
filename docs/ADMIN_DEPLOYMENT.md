# FreeMCP Admin deployment and rollback

## Environment setup

Production and preview use separate D1 databases and separate GitHub OAuth applications. Create each OAuth app in the maintainer's GitHub account or organization. Use the exact homepage and authorization callback below and leave GitHub callback wildcard matching disabled.

| Environment | Homepage | Authorization callback | D1 binding |
| --- | --- | --- | --- |
| Preview | https://feature-admin-dashboard.freemcp.pages.dev/admin/ | https://feature-admin-dashboard.freemcp.pages.dev/admin/oauth/callback/ | freemcp-preview-registry |
| Production | https://freemcp.in/admin/ | https://freemcp.in/admin/oauth/callback/ | freemcp-prod-registry |

Use Cloudflare Pages → Settings → Variables and Secrets for the corresponding deployment environment. Production configuration requires explicit maintainer approval. Preview uses the branch alias above. Individual deployment URLs, other branch aliases and the production Pages alias cannot authenticate.

| Value | Configuration |
| --- | --- |
| `ADMIN_ENV` | Environment name inherited from Wrangler. |
| `ADMIN_GITHUB_CLIENT_ID` | GitHub OAuth client ID for this environment. |
| `ADMIN_GITHUB_CLIENT_SECRET` | OAuth client secret, stored as a Cloudflare secret. |
| `ADMIN_GITHUB_IDS` | Comma-separated immutable numeric GitHub user IDs. See the account's `id` from GitHub's users API. |
| `ADMIN_SESSION_SECRET` | Independent random secret of at least 32 characters. Updating it and redeploying the affected environment invalidates all existing sessions and CSRF forms there. |
| `ADMIN_HISTORY_KEY` | Independent, random, unpadded base64url encoding of exactly 32 bytes. It protects encrypted revisions and outstanding OAuth verifiers. Back up securely. Existing revisions depend on this key. |

Generate each secret with a secure random generator such as `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Enter values directly in Cloudflare. Keep browser tests on an isolated local binding. The public site remains usable if the admin settings are missing.

### Optional issue synchronization

Keep `ADMIN_GITHUB_SYNC` unset until approving outbound actions. Create a separate GitHub App installed only on `strbbrn/freemcp-registry`. Grant repository Issues write and the automatic Metadata read permission. Set production-only `ADMIN_GITHUB_SYNC=enabled`, `ADMIN_GITHUB_APP_ID`, `ADMIN_GITHUB_INSTALLATION_ID` and secret `ADMIN_GITHUB_APP_PRIVATE_KEY`. Convert the downloaded private key to unencrypted PKCS#8 PEM in a secure local environment if needed. Use `openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem`. Remove unnecessary local key copies after provisioning. Create the labels `freemcp-needs-clarification`, `freemcp-rejected` and `freemcp-published` in the repository before enabling. Changes to GitHub issues are performed from Activity. Preview never sends GitHub issue mutations.

Set `ADMIN_GITHUB_REVIEW_TOKEN` as an environment-specific Pages secret to avoid relying on the shared anonymous quota. Use a fine-grained personal access token limited to `strbbrn/freemcp-registry` with Issues read and automatic Metadata read. Public upstream reads use the same credential. The dashboard sends it only to allowlisted GitHub REST GET paths for registry issues and comments and public upstream repository metadata, commits, and SHA-pinned READMEs. It rejects redirects, never falls back to a second credential after a rate limit, and keeps issue writes on the separate GitHub App. Redeploy the affected environment after setting its secret.

Migration 0012 persists five-minute mutable evidence, separately keyed commit-pinned README headings, ETags, and a shared environment cooldown. Opening a saved draft and editing, previewing, validating, or saving it make no GitHub requests. Approval and publication require freshly checked issue, repository, and commit responses. A live 304 can confirm unchanged evidence. GitHub quota failures block publication while leaving draft work available. Settings reports aggregate outbound requests, cache and stale hits, conditional requests, and rate-limit responses. It also shows whether the read credential is configured. The dashboard never records credential values in those counters. Read caches expire unused entries after 30 days with periodic cleanup. The dashboard never executes submitted commands, renders submitted HTML, or contacts submitted MCP endpoints.

## Database migration review

Apply `migrations/0010_admin.sql` once to the intended binding. It creates eight tables and supporting indexes. Then apply `migrations/0011_admin_outbox_decisions.sql` once. It adds two nullable columns and an index to the admin outbox. Existing rows remain readable and legacy completed deliveries have an unknown outcome. Then apply `migrations/0012_admin_github_evidence.sql` once to create the independent evidence and quota tables. It does not touch existing submission drafts. Apply `migrations/0013_promotion_campaigns.sql` before deploying code that edits promotion campaigns. Registry and FTS tables, triggers and backups are unchanged. Existing migrations may have been applied manually. Check migration history and schema before applying a file.

- Local fixture setup uses `npm run build` and `npm run test:browser`. The test runner seeds an isolated database, applies all migrations there and starts Pages locally.
- For preview, verify the name is `freemcp-preview-registry` and that its UUID matches the preview binding in `wrangler.toml`. Run only the unapplied admin file with `npx wrangler d1 execute freemcp-preview-registry --remote --env preview --file migrations/0013_promotion_campaigns.sql`. Apply earlier admin migrations in sequence if they are missing.
- After explicit production approval, capture the current D1 Time Travel bookmark, verify the production database name and UUID, and apply only the reviewed admin files in order. Apply the schema before setting OAuth credentials and enabling the dashboard.
- Verify tables, public listing counts, FTS behavior, sponsor defaults, all eight promotion placements, sitemap and public routes. Check the two admin origins independently, then complete a real OAuth round trip with an allowlisted and a non-allowlisted account. Test a preview draft and confirm its exclusion from public pages and APIs.

D1 batches verify that their audit and recovery rows exist before commit. A missing row makes the batch fail, including multi-placement promotion batches. Server, promotion and sponsorship recovery snapshots are AES-GCM encrypted and associated with the audit event. Registry restores preserve current GitHub metadata, visibility and submission linkage. An unpublished submission keeps its listing ID and requires a fresh approval and publication decision.

Publication requires a documentation URL, a compatible installation and transport, and evidence of tools, prerequisites and security. A reviewer can record a reason when one of those last three categories does not apply. Shared endpoints require explicit listing IDs and reasons. Imports always create private drafts. Compatible unknown detail fields are preserved. Review, lifecycle and cached GitHub fields are excluded and surfaced in the import result.

For emergency revocation, remove the affected GitHub ID and redeploy, or rotate the environment’s session secret and redeploy to revoke every session in that environment. Setting changes take effect when the new deployment is active. For immediate incident response, disable the admin branch deployment or remove the admin configuration and deploy the disabled state. Restrict rollback access and rotate again if a rollback restores older secrets. History encryption and OAuth client credentials are independent. Preserve the previous history key securely until any needed revisions are recovered because changing it makes existing snapshots unreadable. The initial upgrade to secret-bound session hashes requires users to sign in again.

## Threat model

| Risk | Control |
| --- | --- |
| Unauthorized GitHub account or renamed username | Authorize the numeric account ID on login and each later request. |
| Login CSRF, callback substitution and replay | Short-lived random browser-bound state, atomic consumption, encrypted verifier, S256 PKCE and fixed callback. |
| Session theft and fixation | New random 256-bit token on login and refresh, hashed token storage, host-only Secure HttpOnly SameSite cookie, idle and absolute validity windows, logout and all-session revocation. |
| Cross-environment or alias access | Exact environment origin and branch checks, separate cookies, scoped session rows and independent database bindings. |
| Cross-site requests and repeated attempts | Exact Origin, per-session CSRF value, bounded request bodies and D1 counters for login, callbacks and writes. |
| Stored HTML, unsafe links and untrusted GitHub evidence | Escaped server output, DOM text APIs, restrictive CSP, typed validators and HTTPS links. Fixed GitHub endpoints handle evidence fetches. |
| Lost writes, duplicates and incomplete audit | Bound SQL, exact-row compare-and-swap, in-batch uniqueness checks and atomic audit. Concurrent registry sync changes produce a conflict. |
| GitHub transient failure or partial external update | Separate leased outbox, recorded retry delay, a bot-authored per-operation comment marker, idempotent labels and closure. A later decision can supersede a pending update. |
| Audit exposure | Audit stores state projections and reasons. Tokens, OAuth credentials, installation configurations and raw issue bodies are excluded. Full revision snapshots are encrypted separately. Reject likely secrets and require staff to keep credentials out of all forms. |

An authorized maintainer is trusted to review publication and links. Credential detection is heuristic, and raw URLs and configurations require human review. If a session is revoked during an in-flight request, the next request is denied. The application relies on Cloudflare's authenticated request boundary for the client IP rate limit. GitHub and D1 availability govern login and authenticated actions. No app token is sent to upstream repositories. Public reads and evidence cannot prove runtime compatibility.

## Rollback

1. Disable the admin environment or remove its OAuth settings. Revoke sessions and the GitHub OAuth app credentials if the incident requires it. Turn off the GitHub App integration and revoke the installation token or installation if needed.
2. Roll back Pages or revert the deployment commit. Leave additive tables in place for audit and recovery. Keep the prior history key available in secure storage.
3. Inspect audited record changes and restore affected listings through a reviewed revision or targeted recovery. Rolling back Pages does not undo public writes already committed to D1. Reserve database-wide recovery for incidents where losing subsequent writes has been assessed and approved.
4. Recheck the public directory, detail pages, promotions, sponsorship, sitemap, and discovery documents.


## Campaign migration and release checks

- Migration 0013 assigns one campaign ID per known catalog group based on the exact IDs in migrations 0007–0009. It recognizes the three preview UAT rows only when all three exist and their original creation audits match. Other older rows receive distinct IDs. The migration preserves IDs, statuses, schedules, copy, destinations, and revision history. The public ad API does not read the new column.
- New multi-placement campaigns share an immutable ID. Use the associated placement controls for activation or pausing. A synchronized copy edit keeps the status of each associated placement. In a multi-placement restore, select one prior revision per placement. These transactions check each placement’s current version and write a correlated audit entry for each selected row.
- Before production deployment, obtain final approval, record the D1 Time Travel bookmark, verify the production binding UUID against `wrangler.toml`, confirm secret values separately with the maintainer, and apply only the missing migrations in order. Keep GitHub synchronization disabled. Verify the public ad counts and schedule, then repeat the hosted mobile and authentication checks with approved test data.
- Roll back the deployment without reversing the additive campaign column. Older code can continue to query and insert promotion rows. An older insert receives a standalone campaign ID. For a data incident, restore the selected placement revisions and record the incident separately. Avoid rolling back the whole database unless reviewed, since it can discard unrelated changes.
- Preview and production use different D1 bindings, origins, branches and session environments. Before promoting a release, check the actual Pages bindings independently of Wrangler. The application trusts that deployment configuration for the physical database binding. Never point preview at production or copy preview outbox rows to the production database.
- GitHub writes require production, the main branch, explicit enablement, and a current decision stamped as originating in production. Older decisions without provenance stay in the audit trail and are skipped on retry. Use an installation limited to the FreeMCP repository with Issues write and automatic Metadata read. Clarification reopens the issue, publication closes it as complete, and rejection closes it as not planned. A retry reuses an existing bot-authored comment marker and reconciles the dashboard’s decision labels while preserving unrelated labels.
- Automated security tests use mocked GitHub users and deliveries and isolated D1. A successful maintainer login in preview does not cover rejection of a real GitHub account outside the allowlist. Run that check and a fresh session-expiration or revocation check in the hosted preview before production approval. Never use issue #47 for delivery testing.

## Registry JSON and submission revisions

The registry editor exports the selected listing's editable document and its protected metadata. Paste a replacement, then explicitly select JSON or use a synchronization button. Omitted details are preserved. Use a top-level `removeDetails` array to remove specific editable detail keys. The server checks the listing version, duplicate records, protected metadata, and publication readiness before applying public JSON edits. Saving an already public listing records a separate editorial change in registry history with its reason. Its submission's original approval remains part of the review history.

Submission save checks readiness for the saved revision. Review the saved preview before approving it. An unsaved preview uses the current form and is labeled separately. Approval and publication each require the saved revision and the current review version. Drafts saved before this release can be reopened and saved again to record validation. Earlier approvals must be reviewed and approved again before publication. Published listings and historical approvals remain readable. No schema migration is needed for these changes.

The dedicated preview branch is `feature/registry-json-revisions`. To sign in, add `https://feature-registry-json-revisions.freemcp.pages.dev/admin/oauth/callback/` to the preview GitHub OAuth application's redirect URIs. Keep this callback in the preview OAuth application and verify the preview D1 binding. Keep GitHub write synchronization disabled. Use a synthetic listing and an authorized test issue or local mock to exercise publication.

After merge approval, confirm production still binds to production D1, take a Time Travel bookmark, deploy the approved commit, and check the registry and submissions pages. The added revision properties live in the existing candidate document. A rollback is a redeploy of the previous Pages version. Pause submission publication while rolled back, since the previous version does not enforce exact revision approval. Use registry revision history to recover individual content edits.
