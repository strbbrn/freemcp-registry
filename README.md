# FreeMCP.in

**A community-curated directory of open-source Model Context Protocol (MCP) servers.**

[Live site](https://freemcp.in) · [Explore servers](https://freemcp.in/servers) · [Submit a server](https://freemcp.in/submit) · [freemcp.json v1 JSON Schema](schemas/freemcp-v1.schema.json) · [Manifest guide](docs/SUBMISSION_SCHEMA.md)

FreeMCP is built with **Astro + Cloudflare Pages Functions + Cloudflare D1**. Published listings come from a live database, not the old static `src/data/registry.json`. Listings are curated, but are **not** automatically runtime-tested or security-certified.

## Features

- **Live server directory:** search by keyword, filter by category, sort, and paginate D1-backed listings.
- **Server detail pages:** maintainer and repository links, installation configurations where documented, security notes, and lifecycle indicators.
- **Live GitHub metadata:** details pages fetch GitHub stars and archived/disabled status on page load; successful responses are cached in the visitor's browser for 15 minutes. GitHub API failures show an unavailable state rather than a fabricated zero.
- **Recently added servers** sourced from the live registry on the homepage.
- **Responsive design** with light and dark themes.
- **Submission wizard:** analyze a public GitHub repository, import JSON, or fill in listing details manually. Preview the listing before opening a GitHub issue.
- **Human moderation:** no automatic approval or production publication. Approved-registration workflows generate review artifacts, not D1 writes.

## Pages and API

| URL | Description |
| --- | --- |
| [`/`](https://freemcp.in) | Homepage and recently added listings |
| [`/servers`](https://freemcp.in/servers) | Browse, search, filter, and paginate |
| `/servers/{id}` | Details, installation examples, live GitHub metadata |
| [`/submit`](https://freemcp.in/submit) | Repository analysis, JSON editing, listing preview, and human-reviewed submission |
| [`/api/servers`](https://freemcp.in/api/servers) | Published listings in JSON |
| [`/api/servers?meta=categories`](https://freemcp.in/api/servers?meta=categories) | Available categories |

The `GET /api/servers` endpoint accepts `q`, `category`, `sort` (`name`, `category`, `newest`), `page`, and `limit` (maximum 24). The response contains `servers`, `total`, `page`, `pages`, and `pageSize`. Pending-publication and test-only listings are hidden.

## Submit a server

1. Visit [freemcp.in/submit](https://freemcp.in/submit). Enter a repository, import JSON, or use the GitHub analyzer.
2. Edit the listing and check the local desktop or mobile preview. Keep all credentials out of the form and use placeholders.
3. Review the GitHub handoff. Small issues open prefilled. For a larger issue, copy the title and complete body or download the Markdown, then paste it into GitHub.
4. Review and submit the public issue on GitHub. Maintainers approve and publish listings separately.

A `freemcp.json` manifest is **optional**. You can submit a server without it. Submitting an issue does not publish the listing. See [moderation policy](docs/SUBMISSION_MODERATION.md).

## `freemcp.json` v1 specification

Maintainers may add a **`freemcp.json` file at the root of their public GitHub repository**. FreeMCP's analyzer reads this metadata to prefill a submission. This file is **not** a Claude Desktop `mcpServers` runtime configuration.

### Local stdio server example

```json
{
  "schemaVersion": 1,
  "name": "Example Search MCP",
  "description": "Search example resources.",
  "repository": "https://github.com/example/example-mcp",
  "category": "Search",
  "transport": "stdio",
  "installation": {
    "command": "npx",
    "args": ["-y", "@example/mcp-server"],
    "env": {
      "EXAMPLE_API_KEY": {
        "required": true,
        "secret": true,
        "description": "Provide your own API key; never include its value"
      }
    }
  },
  "tools": [{"name": "search", "description": "Search example resources"}],
  "permissions": ["Read access to example resources"]
}
```

### Remote Streamable HTTP server example

```json
{
  "schemaVersion": 1,
  "name": "Example Remote MCP",
  "description": "Remote MCP tools over HTTPS.",
  "repository": "https://github.com/example/remote-mcp",
  "category": "Development",
  "transport": "http",
  "installation": {"endpoint": "https://mcp.example.com/mcp"},
  "permissions": ["Network access"]
}
```

### Field reference

| Field | Required | Constraints |
| --- | --- | --- |
| `schemaVersion` | Yes | Integer `1` |
| `name` | Yes | Nonempty, max 120 characters |
| `description` | Yes | Nonempty, max 1200 characters |
| `repository` | Yes | Public GitHub owner/repository URL matching the analyzed project |
| `category` | Yes | Development, Database, Security, Search, Productivity, Communication, Cloud, Utilities, Other |
| `transport` | Yes | `stdio`, `http`, `sse` (legacy), `unknown` |
| `installation` | No | `command` + `args` for stdio, or HTTPS `endpoint` for remote |
| `tools` | No | Up to 50 `name`/`description` objects |
| `permissions` | No | Up to 30 descriptive strings |

Environment variables under `installation.env` contain **descriptions**, not actual secret values. Each variable requires `required` (boolean), `secret` (boolean), and `description` (string). Unknown properties and suspected embedded credentials are rejected.

**Official freemcp.json references:** [Version 1 JSON Schema](schemas/freemcp-v1.schema.json) · [Full manifest specification and examples](docs/SUBMISSION_SCHEMA.md) · [Submission moderation](docs/SUBMISSION_MODERATION.md). Copy the examples above into a file named `freemcp.json` at the root of your own public GitHub repository; do not place the manifest in this registry repository.

## Publication workflow

```text
GitHub repository -> optional root freemcp.json -> Analyze -> GitHub issue
  -> human review -> optional approved-registration workflow
  -> SQL/JSON review artifacts -> explicit maintainer D1 publication
  -> public listing
```

The `freemcp.json` manifest schema is distinct from the internal D1 `servers` table and `details_json` schema. Installation commands are never executed by the submission analyzer.

## Development

```bash
git clone https://github.com/strbbrn/freemcp-registry.git
cd freemcp-registry
npm install
npm run dev
npm run build
```

The Astro dev server does not automatically emulate Cloudflare D1. For local testing of Pages Functions, configure a separate development D1 binding named `DB`; do not point development operations at production.

| Component | Location |
| --- | --- |
| Astro pages | `src/pages/` |
| D1 directory API | `functions/api/servers.js` |
| Server detail handler | `functions/servers/[id].js` |
| Manifest analyzer | `src/lib/manifest.mjs` |
| Manifest JSON Schema | `schemas/freemcp-v1.schema.json` |
| Submission moderation | `docs/SUBMISSION_MODERATION.md` |
| Cloudflare deployment | `wrangler.toml` |

## Contributing

Contributions are welcome: suggest documented MCP servers, improve installation examples, report issues, and submit code fixes. Check repository ownership, license, maintenance, installation commands, and security implications. See [issues](https://github.com/strbbrn/freemcp-registry/issues) and [submission guidance](docs/SUBMISSION_SCHEMA.md).

## License

See [LICENSE](LICENSE).

**[FreeMCP.in](https://freemcp.in)** — discover open-source MCP servers.
