# Contributing to FreeMCP

First off — **thank you!** Every contribution, no matter how small, helps the AI engineering community find better tools.

## Quick Start

```bash
git clone https://github.com/strbbrn/freemcp-registry.git
cd freemcp-registry
npm install
npm run dev
```

The site will be available at `http://localhost:4321`.

## Adding a New MCP Server

This is the most common and most valuable contribution. Here's how:

### 1. Fork & Clone

```bash
git fork https://github.com/strbbrn/freemcp-registry.git
git clone https://github.com/YOUR_USERNAME/freemcp-registry.git
cd freemcp-registry
```

### 2. Edit `src/data/registry.json`

Add your entry to the array. Follow this schema exactly:

```json
{
  "id": "your-server-id",
  "name": "Your Server Name",
  "description": "A clear, 1-2 sentence description of what this MCP server does and why it's useful for AI agents.",
  "githubUrl": "https://github.com/author/repo",
  "author": "github-username",
  "category": "Database",
  "stars": 0,
  "tags": ["relevant", "tags", "here"],
  "featured": false
}
```

**Rules:**
- `id` must be unique, lowercase, hyphen-separated
- `category` must be one of: `Database`, `Development`, `Security`, `DevOps`, `Utilities`, `Search`, `Communication`, `Cloud`
- `tags` should be 3–5 relevant lowercase keywords
- `featured` should always be `false` in submissions (maintainers set this)
- `stars` can be approximate — we'll update it periodically

### 3. Validate

```bash
npm run build
```

If the build succeeds with no errors, your JSON is valid.

### 4. Submit a PR

```bash
git add src/data/registry.json
git commit -m "Add: Your Server Name"
git push origin main
```

Then open a Pull Request with:
- **Title:** `Add: [Server Name]`
- **Description:** Brief note about the server and why it's useful

## Other Contributions

### Bug Reports

Found something broken? [Open an issue](https://github.com/strbbrn/freemcp-registry/issues/new) with:
- What you expected to happen
- What actually happened
- Browser and device info
- Screenshot if it's a UI issue

### UI/UX Improvements

We welcome design improvements! Please:
- Open an issue first to discuss the change
- Include a screenshot or mockup of your proposed change
- Test on both desktop and mobile
- Ensure accessibility (keyboard nav, contrast, semantic HTML)

### Feature Requests

Have an idea? [Start a discussion](https://github.com/strbbrn/freemcp-registry/discussions) to gauge community interest before building.

## Code Guidelines

- **No runtime JS unless necessary** — Astro ships zero JS by default; keep it that way where possible
- **No backend dependencies** — this is a static site, keep it static
- **Readable code** — clear variable names, comments for non-obvious logic
- **Mobile-first** — test responsive layouts
- **Run `npm run build`** before submitting — ensure no build errors

## Review Process

1. A maintainer will review your PR within 1–3 days
2. We may request changes or ask questions
3. Once approved, we'll merge and Cloudflare will auto-deploy
4. Your contribution goes live on [freemcp.in](https://freemcp.in) within minutes

## Code of Conduct

Be kind. Be constructive. We're all here to build something useful for the community. Harassment, trolling, and spam will not be tolerated.

---

**Questions?** Open a [discussion](https://github.com/strbbrn/freemcp-registry/discussions) or reach out via issues. We're happy to help!
