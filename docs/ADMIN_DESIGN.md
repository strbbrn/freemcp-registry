# FreeMCP administration design

## Baseline

Main at `ebcfd94` uses static Astro and Pages Functions. Live production and preview D1 have the same server columns, FTS5 triggers, and promotion slots. Both have historical backup tables. The production and preview bindings point to different databases. The public visibility predicate accepts explicit published reviews and valid legacy rows with no review. Existing issue tooling recognizes two submission formats and prepares a pending-publication candidate without committing it. Sponsorship tiers are currently static Astro markup.

## Implementation

- Pages Functions own the complete admin route trees and serve HTML on demand. There are no built admin HTML assets. A shared dispatcher checks host, method, session, origin, and CSRF before dispatch. Admin HTML uses the existing typography and theme and works with ordinary forms on narrow screens.
- GitHub OAuth uses the authorization code flow with S256 PKCE and no additional scopes. The database consumes an expiring state once, and a host-only browser cookie binds the callback to the initiating browser. The provider token is used for identity and discarded. Authorization uses numeric GitHub user IDs.
- Environment and origin are fixed. Production uses `https://freemcp.in`. Preview uses the stable `feature-admin-dashboard.freemcp.pages.dev` branch alias. Explicit loopback configuration supports local fixtures. Missing configuration fails closed. Preview OAuth credentials are provisioned separately through Cloudflare environment secrets.
- Session tokens are random and hashed at rest. Session refresh rotates the token and retains an absolute expiration. Logout revokes it. Server-side checks use the allowlist on every protected request. Form CSRF and origin checks have distinct roles. D1 counters bound sign-in attempts and authenticated writes.
- Existing server and promotion tables stay in place. Add sessions, state, rate counters, a change log, submission reviews, an external operation queue and sponsorship overrides. The dashboard compares full-row versions, including fields edited by the existing sync. D1 batches combine compare-and-swap writes, audit rows and outbox entries. History keeps an approved field projection and excludes installation config, imported evidence and fingerprints from the audit display.
- Drafts have an explicit non-public review status. Editorial decisions use `lifecycleSource = registry`. The dashboard reuses the public visibility predicate, manifest and issue validation, and registry preparation. Duplicate review keys include repository identity and a concrete implementation reference, including a GitHub tree path or explicitly identified component in a monorepo.
- GitHub issue review is performed against the fixed repository API. Approval records a content and source revision. Publication verifies both again, with an explicit human confirmation. External comments, labels and closing run separately from D1 writes through a retryable outbox. An optional single-repository GitHub App grants issue write access. Preview never mutates upstream issues.
- Promotions use their current placements and slots. Multiple placements are added in one batch. Sponsorship uses per-tier overrides of the existing layout and defaults, with graceful fallback on older schemas.

GitHub OAuth and D1 transactions are documented at the following sources.

- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- https://developers.cloudflare.com/d1/worker-api/d1-database/
