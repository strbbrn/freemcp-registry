# MCP submission moderation

The public `/submit` form creates a prefilled GitHub Issue in this repository. Submitting a form does **not** publish a listing. The submitter must confirm the issue on GitHub, and a maintainer must review it.

## Maintainer review

1. Confirm the submitted GitHub repository exists and check ownership, license and archival status.
2. Review the source README, installation instructions, permission scope, and any security flags. Never execute untrusted install commands during review.
3. Confirm all compatibility, transport and tool claims against documentation or testing; mark unknowns as unverified.
4. Reject spam, impersonation, credentials, malware and unverifiable claims.
5. For approved submissions, create `src/data/servers/<slug>.json` in a **new pull request** with the required registry fields. Do not change the legacy `src/data/registry.json`.
6. Require registry tests, migration checks, npm audit, production build, and human review before merging. Do not auto-merge or auto-publish based on issue labels.

There is no automatic approval bot or issue-to-PR conversion yet. The GitHub Issue is a moderation queue, not proof of verification.
