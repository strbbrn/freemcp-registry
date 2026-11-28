# FreeMCP submission JSON

## Complete listing JSON example

Choose the example for your transport and paste it into **Upload or paste JSON** in the [submission wizard](https://freemcp.in/submit/). Replace the sample repository, commands, endpoints, and claims with your project's information.

- [Local stdio](#local-stdio--complete-listing-json)
- [Streamable HTTP](#streamable-http--complete-listing-json)
- [Both transports](#both-transports--complete-listing-json)
- [Optional root manifest](#optional-repository-manifest-freemcpjson-v1)

Use `details.security` in listing JSON and `permissions` in a root v1 manifest.

### Local stdio — complete listing JSON

```json
{
  "id": "example-project-notes",
  "name": "Project Notes MCP",
  "description": "Search project notes and retrieve references.",
  "category": "Productivity",
  "author": "Example Project",
  "github_url": "https://github.com/example/project-notes",
  "tags": [
    "notes",
    "search"
  ],
  "details": {
    "summary": "Search a local notes folder.",
    "documentationUrl": "https://example.org/project-notes/setup",
    "documentationUrls": [
      "https://example.org/project-notes/security"
    ],
    "transport": "stdio",
    "transports": [
      "stdio"
    ],
    "installations": [
      {
        "title": "Local notes folder",
        "client": "Generic MCP client",
        "os": "Linux and macOS",
        "transport": "stdio",
        "notes": "Install the example executable and point it at a read-only notes folder.",
        "config": {
          "mcpServers": {
            "notes": {
              "command": "project-notes",
              "args": [
                "--folder",
                "/path/to/notes"
              ]
            }
          }
        }
      }
    ],
    "endpoints": [],
    "tools": [
      {
        "name": "search_notes",
        "description": "Find notes by phrase or tag."
      }
    ],
    "prerequisites": [
      "A local notes folder"
    ],
    "security": [
      "Reads only the configured folder and makes no outbound requests."
    ],
    "pricing": "Free local setup.",
    "serviceDependencies": [],
    "implementationKey": "project-notes"
  }
}
```

### Streamable HTTP — complete listing JSON

```json
{
  "id": "example-project-notes",
  "name": "Project Notes MCP",
  "description": "Search project notes and retrieve references.",
  "category": "Productivity",
  "author": "Example Project",
  "github_url": "https://github.com/example/project-notes",
  "tags": [
    "notes",
    "search"
  ],
  "details": {
    "summary": "Search a hosted index of project notes.",
    "documentationUrl": "https://example.org/project-notes/setup",
    "documentationUrls": [
      "https://example.org/project-notes/security"
    ],
    "transport": "http",
    "transports": [
      "http"
    ],
    "installations": [
      {
        "title": "Hosted notes index",
        "client": "Client with Streamable HTTP support",
        "transport": "http",
        "notes": "Set the authorization header in your client.",
        "config": {
          "mcpServers": {
            "notes": {
              "type": "http",
              "url": "https://mcp.example.org/project-notes",
              "headers": {
                "Authorization": "${AUTHORIZATION}"
              }
            }
          }
        }
      }
    ],
    "endpoints": [
      {
        "transport": "http",
        "url": "https://mcp.example.org/project-notes"
      }
    ],
    "tools": [
      {
        "name": "search_notes",
        "description": "Find notes by phrase or tag."
      }
    ],
    "prerequisites": [
      "An account for the hosted index"
    ],
    "security": [
      "Sends search queries to the hosted index over HTTPS.",
      "Requires authentication and provides read-only access to indexed notes."
    ],
    "pricing": "The hosted index may require a paid account.",
    "serviceDependencies": [
      "Example Project hosted index"
    ],
    "implementationKey": "project-notes"
  }
}
```

### Both transports — complete listing JSON

```json
{
  "id": "example-project-notes",
  "name": "Project Notes MCP",
  "description": "Search project notes and retrieve references.",
  "category": "Productivity",
  "author": "Example Project",
  "github_url": "https://github.com/example/project-notes",
  "tags": ["notes", "search"],
  "details": {
    "summary": "Search a local notes folder or an optional hosted index.",
    "documentationUrl": "https://example.org/project-notes/setup",
    "documentationUrls": ["https://example.org/project-notes/security"],
    "transport": "stdio",
    "transports": ["stdio", "http"],
    "installations": [
      {
        "title": "Local notes folder",
        "client": "Generic MCP client",
        "os": "Linux and macOS",
        "transport": "stdio",
        "notes": "Install the example executable and point it at a read-only notes folder.",
        "config": {
          "mcpServers": {
            "notes": {
              "command": "project-notes",
              "args": ["--folder", "/path/to/notes"]
            }
          }
        }
      },
      {
        "title": "Optional hosted index",
        "client": "Client with Streamable HTTP support",
        "transport": "http",
        "notes": "Set the authorization header in your client.",
        "config": {
          "mcpServers": {
            "notes": {
              "type": "http",
              "url": "https://mcp.example.org/project-notes",
              "headers": {"Authorization": "${AUTHORIZATION}"}
            }
          }
        }
      }
    ],
    "endpoints": [
      {"transport": "http", "url": "https://mcp.example.org/project-notes"}
    ],
    "tools": [
      {"name": "search_notes", "description": "Find notes by phrase or tag."},
      {"name": "get_note", "description": "Read a matching note by ID."}
    ],
    "prerequisites": ["A local notes folder or an account for the optional hosted index"],
    "security": [
      "The local setup reads only the configured folder and makes no outbound requests.",
      "The hosted setup sends search queries to the index over HTTPS and requires authentication."
    ],
    "pricing": "Free local setup. The optional hosted index may require a paid account.",
    "serviceDependencies": ["Optional Example Project hosted index"],
    "implementationKey": "project-notes"
  }
}
```

## Optional repository manifest (freemcp.json v1)

These root `freemcp.json` examples describe the same Project Notes MCP setups as the complete listings above. The wizard adapts each manifest into listing JSON. Use the complete listing example when you want to include documentation URLs, pricing, dependencies, and client details in one paste.

| Root manifest v1 | Listing JSON |
| --- | --- |
| `repository` | `github_url` |
| `permissions` | `details.security` |
| `installation` | `details.installations` |
| `installation.env` declares credential names and requirements | Client configuration uses placeholders such as `${AUTHORIZATION}` |

Maintainers may place an optional `freemcp.json` in the **root** of a public GitHub repository. The submission form reads this file, validates its fields, and offers prefilled values for a **human-reviewed GitHub issue**. It does not execute installation commands or automatically publish entries.

The machine-readable contract is [schemas/freemcp-v1.schema.json](../schemas/freemcp-v1.schema.json). The submission analyzer uses [src/lib/manifest.mjs](../src/lib/manifest.mjs) to enforce the same field structure and additional safety checks.

### stdio root manifest

```json
{
  "schemaVersion": 1,
  "name": "Project Notes MCP",
  "description": "Search project notes and retrieve references.",
  "repository": "https://github.com/example/project-notes",
  "category": "Productivity",
  "transport": "stdio",
  "installation": {
    "command": "project-notes",
    "args": [
      "--folder",
      "/path/to/notes"
    ]
  },
  "tools": [
    {
      "name": "search_notes",
      "description": "Find notes by phrase or tag."
    }
  ],
  "prerequisites": [
    "A local notes folder"
  ],
  "permissions": [
    "Reads only the configured folder and makes no outbound requests."
  ]
}
```

### Streamable HTTP root manifest

```json
{
  "schemaVersion": 1,
  "name": "Project Notes MCP",
  "description": "Search project notes and retrieve references.",
  "repository": "https://github.com/example/project-notes",
  "category": "Productivity",
  "transport": "http",
  "installation": {
    "endpoint": "https://mcp.example.org/project-notes",
    "env": {
      "AUTHORIZATION": {
        "required": true,
        "secret": true,
        "description": "Full Authorization header value for the hosted index."
      }
    }
  },
  "tools": [
    {
      "name": "search_notes",
      "description": "Find notes by phrase or tag."
    }
  ],
  "prerequisites": [
    "An account for the hosted index"
  ],
  "permissions": [
    "Sends search queries to the hosted index over HTTPS.",
    "Requires authentication and provides read-only access to indexed notes."
  ]
}
```

### Manifest rules

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

1. Open the [submission wizard](https://freemcp.in/submit/).
2. Enter a public GitHub repository URL. To use a root manifest, click **Analyze GitHub repository**, then **Fill untouched fields**.
3. Review the listing details and open **Preview listing**. Add the documentation, installation, and security details you can verify.
4. Continue to submission and review the generated issue on GitHub. For a large issue, copy the title and body into GitHub.
5. Maintainers review the issue and approve the listing before publication.

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
| `details.installations` | Up to 20 entries with required `title` and `config`, plus optional `client`, `os`, `notes`, and `transport`. Preserve imported v1 variable declarations in `environment`. Use placeholders such as `${API_KEY}` in client configurations |
| `details.endpoints` | Up to 20 HTTPS endpoints with `transport` and `url` |
| `details.tools` | Up to 80 entries with a unique `name` and a `description`, limited to 100 and 500 characters respectively |
| `details.prerequisites`, `details.security`, `details.serviceDependencies` | Up to 30 prerequisites, 30 security considerations, and 20 dependencies, each up to 500 characters |

The wizard rejects administrative, review, lifecycle, publication, and claimed GitHub metadata. Imported configuration is checked but never executed. Credential detection is heuristic. Remove secrets from draft and public issue text. The draft stays in memory. The preview renders locally with section navigation and no external resources. Repository analysis reads only public GitHub files. An optional duplicate check sends only the repository, implementation key, and endpoint URLs to FreeMCP and matches published listings. Maintainers still check private and public records before approval.

The website generates a public GitHub issue with readable headings and one `Structured listing (v1)` JSON block. Keep the generated section and its delimiters intact. A malformed or conflicting block stops structured ingestion. The direct GitHub template also accepts optional maintainer, overview, tags, extra documentation and transports, pricing, dependencies and an implementation key. Use the website to attach structured client configurations and endpoints. GitHub sign-in and a final GitHub submission action are required. Opening the page creates no issue.

On an encoded handoff URL above 7,000 characters, use the copy controls or download the complete issue Markdown and paste the title and body on GitHub. This leaves room below common 8 KiB proxy request-target limits. The wizard also caps the complete issue at 65,000 characters, just below GitHub's body limit. If it is too large even for manual paste, export the listing JSON to keep all fields and reduce the submitted text. No tools or configurations are silently truncated.

### Preview acceptance checklist

1. Enter a public repository manually, then repeat with a root v1 manifest and rich listing JSON. Verify the analyzer only applies its results when requested and leaves manually entered fields intact.
2. Add two client configurations and transports, reorder tools, and switch between JSON and structured fields. Confirm invalid JSON blocks preview.
3. Compare desktop and mobile previews. Edit a field after previewing and check the updated result. Confirm the listing content stays in the browser unless you opt into the duplicate check or open a prefilled GitHub URL.
4. Test one small draft and one large tool inventory. Inspect the prefilled or copied issue body and the structured block. Stop before creating a real test issue.
5. Use local synthetic fixtures to check admin candidate recovery and exact-revision publication safeguards.
