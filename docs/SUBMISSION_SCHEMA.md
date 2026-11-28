# FreeMCP 2.0 — freemcp.json v1

Maintainers may place an optional `freemcp.json` in the **root** of a public GitHub repository. The submission form reads this file, validates its fields, and offers prefilled values for a **human-reviewed GitHub issue**. It does not execute installation commands or automatically publish entries.

The machine-readable contract is [schemas/freemcp-v1.schema.json](../schemas/freemcp-v1.schema.json). The submission analyzer uses [src/lib/manifest.mjs](../src/lib/manifest.mjs) to enforce the same field structure and additional safety checks.

## stdio example

```json
{
  "schemaVersion": 1,
  "name": "Example MCP Server",
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
        "description": "Provide your own API key; never put its value in this manifest"
      }
    }
  },
  "tools": [{"name": "search", "description": "Search example resources"}],
  "prerequisites": ["Node.js 20+", "An example service account"],
  "permissions": ["Read access to example resources"]
}
```

## Remote Streamable HTTP example

```json
{
  "schemaVersion": 1,
  "name": "Example Remote MCP",
  "description": "Remote example MCP endpoint.",
  "repository": "https://github.com/example/remote-mcp",
  "category": "Development",
  "transport": "http",
  "installation": {"endpoint": "https://mcp.example.com/mcp"},
  "permissions": ["Network access"]
}
```

## Rules

- Required: `schemaVersion` (integer 1), `name`, `description`, `repository`, `category`, `transport`.
- `repository` must identify the same GitHub owner/repository as the analyzed project. Equivalent casing and a trailing slash are accepted by the analyzer; other hosts and nested paths are not.
- Categories: Development, Database, Security, Search, Productivity, Communication, Cloud, Utilities, Other.
- Transports: `stdio`, `http` (Streamable HTTP), `sse` (legacy), `unknown`.
- Optional `installation` uses **either** `command` plus `args` for stdio, **or** HTTPS `endpoint` for remote HTTP/SSE. For `unknown` transport either installation shape is accepted.
- Optional `env` contains **descriptions** of environment variables, never their actual values. Each entry requires `required` and `secret` booleans and a `description`.
- Optional `tools` contains up to 50 objects with `name` and `description`. Optional `prerequisites` and `permissions` each contain up to 30 descriptive strings. These enrich the server detail page after review.
- The website adapts a valid root manifest to the listing editor. The manual GitHub template accepts documented tools in `name | description` format.
- Unknown properties, malformed structures, and possible embedded credentials are rejected. Secret detection is heuristic, not a guarantee.
- Metadata, compatibility and installation commands remain **unverified** until a maintainer reviews the upstream evidence. An archived GitHub repository is a review flag, not proof of server lifecycle.

## Review process

1. Open `/submit` on FreeMCP Preview.
2. Enter the public GitHub repository URL and click **Analyze GitHub repository**.
3. Inspect imported metadata, documentation, installation and security flags.
4. Confirm the details and open a prefilled GitHub issue for human review.
5. FreeMCP maintainers approve or reject; no automatic publication occurs.

The manifest is a metadata contract, not an executable configuration or security certification. Do not include passwords, tokens, private keys or other secrets.


## Website listing JSON and GitHub handoff

Open [the submission wizard](https://freemcp.in/submit/) to start from a repository, import a JSON file, or enter the listing manually. The wizard offers an edited JSON export. The richer listing JSON uses the administrator’s candidate shape and is separate from the versioned root manifest above. Keep the repository root manifest at v1.

| Listing field | Supported values and limits |
| --- | --- |
| `id`, `name`, `description`, `category`, `author`, `github_url` | Lowercase hyphenated ID up to 200 characters, name 120, description 1,200, category 100, maintainer 160, public GitHub repository |
| `tags` | Up to 50 strings of 100 characters |
| `details.summary`, `details.pricing`, `details.implementationKey` | Overview up to 1,200 characters, pricing 800, optional lowercase hyphenated implementation key 100 |
| `details.documentationUrl`, `details.documentationUrls` | Primary and up to 12 additional HTTPS URLs, up to 2,048 characters each |
| `details.transport`, `details.transports` | Primary transport and up to three distinct choices from `stdio`, `http`, and `sse`. An unknown transport can be submitted for review |
| `details.installations` | Up to 20 entries with `title`, optional `client`, `os`, `notes`, `transport`, and `config`. Preserve imported v1 variable declarations in `environment`. Use placeholders such as `${API_KEY}` in actual client configurations |
| `details.endpoints` | Up to 20 HTTPS endpoints with `transport` and `url` |
| `details.tools` | Up to 80 entries with a unique `name` and a `description`, limited to 100 and 500 characters respectively |
| `details.prerequisites`, `details.security`, `details.serviceDependencies` | Up to 30 prerequisites, 30 security considerations, and 20 dependencies, each up to 500 characters |

The wizard rejects administrative, review, lifecycle, publication, and claimed GitHub metadata. Imported configuration is checked but never executed. Credential detection is heuristic. Remove secrets from draft and public issue text. The draft stays in memory. The preview renders locally with inert links and no external resources. Repository analysis reads only public GitHub files. An optional duplicate check sends only the repository, implementation key, and endpoint URLs to FreeMCP and matches published listings. Maintainers still check private and public records before approval.

The website generates a public GitHub issue with readable headings and one `Structured listing (v1)` JSON block. Keep the generated section and its delimiters intact. A malformed or conflicting block stops structured ingestion. The original GitHub templates are still supported for direct submissions. GitHub sign-in and a final GitHub submission action are required. Opening the page creates no issue.

On an encoded handoff URL above 7,000 characters, use the copy controls or download the complete issue Markdown and paste the title and body on GitHub. This leaves room below common 8 KiB proxy request-target limits. The wizard also caps the complete issue at 65,000 characters, just below GitHub's body limit. If it is too large even for manual paste, export the listing JSON to keep all fields and reduce the submitted text. No tools or configurations are silently truncated.

### Preview acceptance checklist

1. Enter a public repository manually, then repeat with a root v1 manifest and rich listing JSON. Verify the analyzer only applies its results when requested and leaves manually entered fields intact.
2. Add two client configurations and transports, reorder tools, and switch between JSON and structured fields. Confirm invalid JSON blocks preview.
3. Compare desktop and mobile previews. Edit a field after previewing and check the updated result. Confirm the listing content stays in the browser unless you opt into the duplicate check or open a prefilled GitHub URL.
4. Test one small draft and one large tool inventory. Inspect the prefilled or copied issue body and the structured block. Stop before creating a real test issue.
5. Use local synthetic fixtures to check admin candidate recovery and exact-revision publication safeguards.
