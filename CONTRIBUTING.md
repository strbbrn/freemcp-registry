# Contributing to FreeMCP

Thanks for helping improve the FreeMCP open-source MCP server registry.

## Submit an MCP server

**Do not edit `src/data/registry.json` to publish a listing.** The live directory is backed by Cloudflare D1.

1. Visit [FreeMCP Submit](https://freemcp.in/submit).
2. Provide the URL of a public GitHub repository and analyze it.
3. Review repository metadata, installation instructions, permissions and security evidence.
4. Submit the generated GitHub issue for maintainer review.

A root `freemcp.json` is optional but recommended for structured metadata. See the [freemcp.json v1 JSON Schema](schemas/freemcp-v1.schema.json) and [complete manifest documentation](docs/SUBMISSION_SCHEMA.md). Never include live secrets or credentials in manifests or issues.

Maintainers review submissions and may generate SQL/JSON review artifacts. **Approval does not automatically publish a server.** See [moderation policy](docs/SUBMISSION_MODERATION.md).

## Contribute code or documentation

```bash
git clone https://github.com/strbbrn/freemcp-registry.git
cd freemcp-registry
npm install
npm run dev
npm run build
```

Create a feature branch, make your change, run applicable tests and `npm run build`, then open a pull request against `main`. For D1-backed Pages Functions, use a separate development D1 binding rather than production. Do not include secrets in commits or logs.

Helpful contributions include documented installation configurations, verified upstream source links, accessibility improvements, security reviews, bug fixes, and manifest documentation.

## Report a problem

[Open an issue](https://github.com/strbbrn/freemcp-registry/issues) with reproduction steps, expected and actual results, and relevant logs without secrets. For security-sensitive issues, avoid publicly disclosing exploitable details.

## Review principles

- Confirm upstream repository identity, license, archival status and installation evidence.
- Distinguish documented claims from runtime-tested claims.
- Never treat GitHub stars or a successful manifest import as a security endorsement.
- Do not automatically publish unreviewed submissions.

See the [README](README.md) for the current architecture, API, and feature overview.
