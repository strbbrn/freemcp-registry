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
- The submission form asks for documented tools (`name | description`, one per line), setup prerequisites, installation instructions and permissions. A valid root manifest can prefill the tools and prerequisites.
- Unknown properties, malformed structures, and possible embedded credentials are rejected. Secret detection is heuristic, not a guarantee.
- Metadata, compatibility and installation commands remain **unverified** until a maintainer reviews the upstream evidence. An archived GitHub repository is a review flag, not proof of server lifecycle.

## Review process

1. Open `/submit` on FreeMCP Preview.
2. Enter the public GitHub repository URL and click **Analyze GitHub repository**.
3. Inspect imported metadata, documentation, installation and security flags.
4. Confirm the details and open a prefilled GitHub issue for human review.
5. FreeMCP maintainers approve or reject; no automatic publication occurs.

The manifest is a metadata contract, not an executable configuration or security certification. Do not include passwords, tokens, private keys or other secrets.
