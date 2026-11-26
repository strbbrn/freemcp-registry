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
| `ADMIN_SESSION_SECRET` | Independently generated random secret, at least 32 characters. Rotation invalidates CSRF forms. To revoke existing sessions, use Settings or clear that environment's session table during a credential incident. |
| `ADMIN_HISTORY_KEY` | Independent, random, unpadded base64url encoding of exactly 32 bytes. It protects encrypted revisions and outstanding OAuth verifiers. Back up securely. Existing revisions depend on this key. |

Generate each secret with a secure random generator such as `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Enter values directly in Cloudflare. Keep browser tests on an isolated local binding. The public site remains usable if the admin settings are missing.

### Optional issue synchronization

Keep `ADMIN_GITHUB_SYNC` unset until approving outbound actions. Create a separate GitHub App installed only on `strbbrn/freemcp-registry`. Grant repository Issues write and the automatic Metadata read permission. Set production-only `ADMIN_GITHUB_SYNC=enabled`, `ADMIN_GITHUB_APP_ID`, `ADMIN_GITHUB_INSTALLATION_ID` and secret `ADMIN_GITHUB_APP_PRIVATE_KEY`. Convert the downloaded private key to unencrypted PKCS#8 PEM in a secure local environment if needed. Use `openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem`. Remove unnecessary local key copies after provisioning. Create the labels `freemcp-needs-clarification`, `freemcp-rejected` and `freemcp-published` in the repository before enabling. Changes to GitHub issues are performed from Activity. Preview never sends GitHub issue mutations.

The dashboard uses public, unauthenticated GitHub REST reads for the public repository and upstream evidence. Rate limits can temporarily affect issue browsing and source verification. Review URLs and submitted content are evidence. The dashboard never executes submitted commands, renders submitted Markdown as HTML, or contacts submitted MCP endpoints.

## Database migration review

Apply `migrations/0010_admin.sql` once to the intended binding. It creates eight tables and supporting indexes. It contains no changes to existing tables, triggers, backups or rows. Live databases were inspected through read-only schema queries. Existing migrations may have been applied manually. Do not replay the entire migration directory on either hosted database without checking its migration history.

- Local fixture setup uses `npm run build` and `npm run test:browser`. The test runner seeds an isolated database, applies all migrations there and starts Pages locally.
- For preview, verify the database name and UUID in Wrangler or the dashboard, then execute only the new file against the named preview database. The command is `npx wrangler d1 execute freemcp-preview-registry --remote --env preview --file migrations/0010_admin.sql`.
- After explicit production approval, capture the current D1 Time Travel bookmark, verify the production database name and UUID, and apply only the reviewed file to production. Apply the schema before setting OAuth credentials and enabling the dashboard.
- Verify tables, public listing counts, FTS behavior, sponsor defaults, all eight promotion placements, sitemap and public routes. Check the two admin origins independently, then complete a real OAuth round trip with an allowlisted and a non-allowlisted account. Test a preview draft and confirm its exclusion from public pages and APIs.

D1 batches combine mutations with audit entries on the same database. Server revisions are AES-GCM encrypted and associated with the audit event. Restore uses the previous managed values while preserving current GitHub metadata. Restoring a historical public revision to a currently private listing keeps the listing private until a new publication decision.

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
