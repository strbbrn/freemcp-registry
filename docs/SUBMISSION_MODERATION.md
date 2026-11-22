# MCP submission moderation

The public `/submit` form creates a prefilled GitHub Issue in this repository. Submitting a form does **not** publish a listing. The submitter must confirm the issue on GitHub, and a maintainer must review it.

## Maintainer review

1. Confirm the submitted GitHub repository exists and check ownership, license and archival status.
2. Review the source README, installation instructions, permission scope, and any security flags. Never execute untrusted install commands during review.
3. Confirm all compatibility, transport and tool claims against documentation or testing; mark unknowns as unverified.
4. Reject spam, impersonation, credentials, malware and unverifiable claims.
5. For approved submissions, a maintainer may apply the `freemcp-approved` issue label and manually dispatch **Prepare approved MCP registration** with the issue number. For website-form and existing legacy GitHub Issue submissions, the maintainer provides the reviewed installation executable and JSON arguments (or HTTPS endpoint) as manual workflow inputs. A `freemcp.json` manifest is optional, not mandatory. The workflow checks those inputs against the issue's installation evidence, then creates downloadable SQL and JSON review artifacts only; it never writes to D1. The workflow must exist on the default branch for normal manual dispatch.
6. Verify the issue, source commit, installation evidence, generated SQL, and live D1 duplicates before any separate, explicitly authorized database publication. Newly generated records have `pending-publication` status and must remain hidden until reviewed and intentionally published.
7. Require registry tests, migration checks, npm audit, production build, and human review before merging. Do not auto-merge or auto-publish based on issue labels.

The GitHub Issue is a moderation queue, not proof of verification. Automated triage is preliminary only. No automatic issue-to-PR conversion or production publication is provided.
