# FreeMCP 2.0 submission contract (proposal v1)

This document describes the proposed maintainer-authored `freemcp.json` manifest. **Client-side root-manifest discovery is implemented in the submission form; automated publishing is not implemented.** For now, submit through `/submit`, which prepares a GitHub issue for human review.

## Submission options

1. **Guided form**: enter repository URL and project details at `/submit`; the form opens a prefilled GitHub issue. No server-side account, extraction, or publication is performed.
2. **Optional future manifest**: maintain `freemcp.json` in the repository root, then submit the repository URL. The submission form reads and validates the root manifest from public GitHub repositories, but does not execute code or publish listings.

## Proposed manifest

```json
{
  "schemaVersion": 1,
  "name": "Example MCP Server",
  "description": "Search example resources.",
  "repository": "https://github.com/example/example-mcp",
  "category": "Development",
  "transport": "stdio",
  "installation": {
    "command": "npx",
    "args": ["-y", "@example/mcp-server"]
  },
  "tools": [
    { "name": "search", "description": "Search example resources" }
  ],
  "permissions": ["read:resources"]
}
```

### Field rules

- `schemaVersion`: integer `1`.
- `name`, `description`: required nonempty strings.
- `repository`: required HTTPS URL to the actual project repository; redirects and ownership claims require review.
- `category`: one of Development, Database, Security, Search, Productivity, Communication, Cloud, Utilities, Other.
- `transport`: `stdio`, `http`, `sse`, or `unknown`.
- `installation`: optional documented command and argument list; no secrets or executable shell interpolation.
- `tools`: optional list of documented tools; never infer capabilities from marketing text.
- `permissions`: optional human-readable list of access requirements. Sensitive permissions need explicit review.

## Evidence and trust

Maintainer-supplied information is **not** a FreeMCP security certification. Install commands must be corroborated against repository documentation. Compatibility is unknown unless documented or tested, and runtime testing must be labeled separately. Never request or store user tokens, private keys, or credentials in submissions. Review external URLs and submitted text as untrusted input.

## Future implementation milestones

- Strengthen manifest validation with a shared strict schema, secret scanning, and provenance checks.
- Fetch and parse repository metadata in an isolated, rate-limited worker with no execution of repository code.
- Open or update a reviewable pull request only after human approval.
- Render server pages from normalized metadata, replacing per-server hardcoded Astro components.
- Add a moderation queue, duplicate detection, ownership verification, and provenance tracking.
