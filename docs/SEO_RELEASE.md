# FreeMCP SEO release

## Rendering and deployment

FreeMCP keeps its static Astro build and Git-integrated Cloudflare Pages project. Static pages, styles, sponsorship, and promotion components use the existing build. Route-specific Pages Functions for the homepage and directory call D1 through `lib/registry.js` and use HTMLRewriter to populate the Astro page shell. The directory renders each row once. GET forms and anchor links work before scripts run. JavaScript submits category and sort changes automatically. Keyword search submits with Enter or the Search button.

The preliminary branch intercepted all routes and rendered rows in middleware and again in the browser. The homepage and directory now share the same data access as the existing detail renderer, registry API, and sitemap. An Astro Cloudflare adapter would add another runtime integration to a static Pages project with working native Functions and separate bindings. Build-time registry rendering would require a rebuild to publish new data. Scoped shell rewriting keeps the current deployment and presentation, with selector and markup integration covered by production-build and real Pages runtime tests.

The directory uses slash-terminated canonical URLs. Listing profiles retain their existing slashless canonical URLs and badge destinations. The first directory page has no page parameter. Valid unfiltered pages have self canonicals. Search, category, and alternate sorts are crawlable with `noindex, follow`. Their pagination keeps the selected controls in its URLs. Invalid and out-of-range HTML page numbers return 404. The JSON API retains its parameter bounds and last-page clamping. Obsolete design-preview URLs permanently redirect to the directory. A top-level `404.html` opts Pages out of its SPA fallback.

## Registry and security

D1 remains authoritative. Valid legacy JSON objects without a review object and records explicitly marked published are visible. Pending, test-only, unknown review states, malformed review metadata, and invalid listing slugs are excluded uniformly. Malformed tags produce an empty array. Active HTML escapes third-party text and configuration is displayed and copied as inert text. External listing and documentation URLs require HTTPS and exclude userinfo. Structured data JSON escapes script delimiters. Checkout, build, and runtime tests use the existing schema. No migration is required.

Directory requests load no more than 24 listings, and the homepage loads up to six by insertion order. Related lookups return up to five listings with a deterministic tie-break. FTS5 matches bound quoted prefixes and looks up rowids. Category and name queries retain the existing indexes. The listing HTML and API declare 30 seconds of browser freshness. The sitemap declares 300 seconds. These headers do not configure Cloudflare cache rules. Outages return uncached 503 responses for public HTML and sitemap routes. The JSON API preserves its existing backend error statuses.

The sitemap keeps real canonical URLs. It omits `lastmod` because the D1 timestamp also changes during metadata syncs. Splitting starts after 2,000 listings, with 2,000 rows per shard and a sitemap index at the original URL. Directory page links are bounded at 10,000 pages. Offset cost and exact counts grow with the matching result set. Review D1 rows read and p95 latency as listings grow. If deep-page cost becomes material, use a keyset cursor for API traversal and retain stable crawlable pagination for the HTML directory.

## Agent discovery

The build serves the current ARD manifest at `/.well-known/ard.json` and its compatible 1.0 representation at `/.well-known/ai-catalog.json` for older Lighthouse clients. Both describe FreeMCP's public read-only API via a published OpenAPI document. The manifest does not claim to operate upstream MCP servers or implement the ARD federated registry protocol. Automated tests use both upstream schemas pinned by commit in the test fixtures. The current manifest is discoverable through an HTML link and a robots Agentmap entry. The plain-text `/llms.txt` links to the directory, public API, guides and submission workflow. A separate full-text catalogue would duplicate the live registry and the guides.

- [Current ARD specification](https://agenticresourcediscovery.org/spec/)
- [Lighthouse 13.6 discovery implementation](https://github.com/GoogleChrome/lighthouse/blob/v13.6.0/core/gather/gatherers/agentic/ard.js)
- [Lighthouse 13.5 legacy audit](https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/audits/agentic/ard-schema.js)
- [llms.txt recommendations](https://llmstxt.org/)

## Validation and rollback

Run `npm ci`, `npm run build`, `npm test`, `npm run test:browser`, and `npm audit --audit-level=low`. Browser tests seed an isolated local D1 database and serve the real Pages Functions through Wrangler. To run browser tests against a review deployment, set `FREEMCP_TEST_URL` to its origin. Tests requiring synthetic fixtures are local only.

Review and approve the pull request before merging. Confirm that preview runs with `freemcp-preview-registry` and that the production project still uses `freemcp-prod-registry`. Check the new production deploy and public sitemap after approval. If a production regression appears, use Cloudflare Pages Deployments to roll back to the last healthy production deployment, then revert the merge on GitHub to keep the branch and deployment consistent. Confirm the rollback with GET requests to the homepage, directory, representative detail, API and sitemap. This release has no database migrations to reverse.

After production verification, use Search Console to inspect representative listing, directory, pagination and guide URLs, check declared and Google-selected canonicals, and resubmit the sitemap if needed. Request indexing for a small number of important pages and monitor crawl coverage and impressions. The Cloudflare email-obfuscation helper is a separate edge feature. The project can keep it enabled even when Search Console reports the helper URL as 404.
