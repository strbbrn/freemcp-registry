<p align="center">
  <img src="https://img.shields.io/badge/MCP-Registry-6366f1?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkwyIDdsOTkuOTk5IDUgMTAtNS0xMC01ek0yIDE3bDEwIDUgMTAtNUMyIDEybDEwIDUgMTAtNSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+" alt="FreeMCP Registry" />
  <img src="https://img.shields.io/badge/100%25-Free%20%26%20Open%20Source-34d399?style=for-the-badge" alt="Free & Open Source" />
  <img src="https://img.shields.io/badge/License-MIT-818cf8?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/Infra%20Cost-%240%2Fmo-22d3ee?style=for-the-badge" alt="$0/mo" />
</p>

<h1 align="center">FreeMCP.in</h1>

<p align="center">
  <strong>The community-curated registry of 100% free and open-source<br/>Model Context Protocol (MCP) servers.</strong>
</p>

<p align="center">
  <a href="https://freemcp.in">🌐 Live Site</a> &nbsp;·&nbsp;
  <a href="#-submit-a-server">📬 Submit a Server</a> &nbsp;·&nbsp;
  <a href="#-contributing">🤝 Contribute</a> &nbsp;·&nbsp;
  <a href="https://github.com/strbbrn/freemcp-registry/registry/discussions">💬 Discussions</a>
</p>

---

## 🧠 What is MCP?

The **Model Context Protocol (MCP)** is an open standard created by Anthropic that provides a universal way for AI models and agents to connect to external tools, data sources, and services. Think of it as a USB-C port for AI — one protocol, infinite possibilities.

MCP servers expose capabilities (tools, resources, prompts) that any compatible AI client — Claude Desktop, Cursor, LangChain, LangGraph, CrewAI — can instantly use without custom integration code.

**FreeMCP.in** exists because finding reliable, truly free MCP servers shouldn't require digging through scattered GitHub repos or hitting enterprise paywalls.

## ✨ What is FreeMCP?

FreeMCP is a fast, searchable, static registry that curates **only** free and open-source MCP servers. No freemium traps. No enterprise tiers. No vendor lock-in.

### Why FreeMCP?

| Problem | FreeMCP Solution |
|---|---|
| Existing directories mix paid and free tools | **Strictly 100% free & open-source servers only** |
| Hard to find servers by use case | **Category filters + real-time search by name, tags, description** |
| No standardized quality bar | **Community-vetted with clear submission criteria** |
| Registries require expensive backends | **Zero-cost static site — JSON data + Cloudflare Pages** |
| Discovery is fragmented across GitHub | **One central hub for the community** |

### Who is this for?

- 🤖 **AI Engineers** building autonomous agents with LangGraph, LangChain, or CrewAI
- 🛡️ **DevSecOps Teams** looking for security and ASM tooling via MCP
- 🧑‍💻 **Developers** integrating MCP servers into Claude Desktop or Cursor
- 🌍 **Open-source contributors** who want to help the ecosystem grow

## 🗂️ Registry Structure

All server data lives in a single static JSON file:

```
src/data/registry.json
```

Each entry follows this schema:

```json
{
  "id": "unique-server-id",
  "name": "Server Display Name",
  "description": "What this server does and why it's useful for agents.",
  "githubUrl": "https://github.com/author/repo",
  "author": "github-username",
  "category": "Database | Development | Security | DevOps | Utilities | Search | Communication | Cloud",
  "stars": 1234,
  "tags": ["tag1", "tag2", "langchain", "devsecops"],
  "featured": false
}
```

### Current Categories

| Category | Description | Examples |
|---|---|---|
| 🗄️ **Database** | SQL/NoSQL access for agents | SQLite, PostgreSQL |
| ⌨️ **Development** | Code, repos, and dev workflows | GitHub, Filesystem |
| 🛡️ **Security** | Scanning, SAST, recon, ASM | Shodan, Nmap, Semgrep |
| 🚀 **DevOps** | Containers, CI/CD, infra | Docker |
| 🔧 **Utilities** | General-purpose tools | Puppeteer, Browser automation |
| 🔍 **Search** | Web and data search | Brave Search |
| 💬 **Communication** | Messaging and notifications | Slack |
| ☁️ **Cloud** | Cloud provider integrations | AWS Knowledge Base |

---

## 📬 Submit a Server

Found a great open-source MCP server that's not listed? We'd love to add it!

### Submission Criteria

Before submitting, make sure the server meets **all** of these:

- [x] **Open source** — public GitHub repo with a recognized OSS license (MIT, Apache 2.0, GPL, etc.)
- [x] **100% free** — no paid tiers, no API key paywalls for core functionality
- [x] **MCP compliant** — implements the Model Context Protocol standard
- [x] **Working** — has a functional README with setup instructions
- [x] **Not a duplicate** — check the [live registry](https://freemcp.in) first

### How to Submit

**Option A: GitHub Issue (easiest)**

1. Go to [**Submit a Server →**](https://github.com/strbbrn/freemcp-registry/registry/issues/new?template=submit-server.md)
2. Fill out the issue template with the server details
3. A maintainer will review and add it to the registry

**Option B: Pull Request (for contributors)**

1. Fork this repository
2. Add the server entry to `src/data/registry.json`
3. Follow the schema above — make sure the JSON is valid
4. Open a PR with the title: `Add: [Server Name]`
5. A maintainer will review and merge

### What happens after submission?

```
You submit → Maintainer reviews → Merged to main → Cloudflare auto-deploys → Live on freemcp.in
```

Typical turnaround: **24–72 hours**. We review every submission manually to maintain quality.

---

## 🤝 Contributing

FreeMCP is built by the community, for the community. There are many ways to contribute beyond adding servers!

### Ways to Contribute

| Contribution | Description | Difficulty |
|---|---|---|
| 🆕 **Submit a server** | Add a new MCP server to the registry | Easy |
| 🐛 **Report a bug** | Found a broken link or UI issue? [Open an issue](https://github.com/strbbrn/freemcp-registry/registry/issues/new) | Easy |
| 📝 **Improve descriptions** | Help write clearer server descriptions | Easy |
| 🏷️ **Suggest categories/tags** | Help us organize better | Easy |
| 🎨 **UI/UX improvements** | Design tweaks, accessibility, mobile fixes | Medium |
| ⭐ **Star the repo** | Helps others discover FreeMCP | Easy |
| 📢 **Spread the word** | Share on Twitter/X, Reddit, Discord, HN | Easy |
| 🧪 **Test servers** | Verify listed servers still work | Medium |
| 🌐 **Add features** | Search improvements, new pages, PWA support | Advanced |

### Development Setup

```bash
# Clone the repo
git clone https://github.com/strbbrn/freemcp-registry/registry.git
cd registry

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Project Structure

```
freemcp-registry/
├── src/
│   ├── data/
│   │   └── registry.json       # ← The registry database (edit this to add servers)
│   ├── layouts/
│   │   └── Layout.astro        # Global layout, nav, footer, design system
│   └── pages/
│       └── index.astro         # Main page — hero, search, card grid
├── astro.config.mjs            # Astro configuration
├── tailwind.config.mjs         # Tailwind CSS configuration
├── wrangler.toml               # Cloudflare Pages deployment config
└── package.json
```

### Code Guidelines

- **Keep it static** — no backend, no databases, no API calls at runtime
- **Keep it fast** — the site should feel instant; minimize JS where possible
- **Keep it accessible** — semantic HTML, proper contrast, keyboard navigation
- **Keep it clean** — readable code with clear comments for complex sections
- **Test your changes** — run `npm run build` before submitting a PR

---

## 🏗️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Framework** | [Astro](https://astro.build) | Zero-JS by default, blazing fast static builds |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) + custom CSS | Utility-first with design token system |
| **Fonts** | Inter + JetBrains Mono | Premium readability for UI + code |
| **Data** | Static JSON | No database, no API, no cost |
| **Hosting** | [Cloudflare Pages](https://pages.cloudflare.com) | Free tier, global CDN, automatic deploys |
| **Domain** | [freemcp.in](https://freemcp.in) | Custom domain |

**Total infrastructure cost: $0/month** (forever on the free tier)

---

## 🗺️ Roadmap

We're just getting started. Here's what's planned:

- [ ] **Server detail pages** — individual pages with full README, install commands, and compatibility matrix
- [ ] **GitHub star count sync** — auto-update star counts via GitHub Actions (scheduled cron)
- [ ] **Server health checks** — automated testing to verify servers are still functional
- [ ] **One-click config generator** — paste-ready `claude_desktop_config.json` snippets
- [ ] **RSS feed** — subscribe to new server additions
- [ ] **Community voting** — upvote your favorite servers
- [ ] **MCP server compatibility matrix** — which servers work with which clients
- [ ] **Dark/light mode toggle** — for the light mode fans
- [ ] **PWA support** — install FreeMCP as a desktop/mobile app

Have an idea? [Start a discussion →](https://github.com/strbbrn/freemcp-registry/registry/discussions)

---

## 🌱 Help the Community Grow

FreeMCP is a zero-budget, community-driven project. The best way to help is to **spread the word**:

- ⭐ **Star this repo** — it's the #1 signal that helps others discover us
- 🐦 **Share on Twitter/X** — tag your AI engineering friends
- 💬 **Post in Discord/Slack communities** — LangChain, CrewAI, AI Engineering groups
- 📝 **Write about it** — blog posts, tutorials, mentions in newsletters
- 🎥 **Make a video** — showcase how you use MCP servers in your agent stack
- 🔗 **Link to freemcp.in** — from your README, docs, or blog

Every star, share, and contribution helps more AI engineers discover free tools. Let's build the definitive open-source MCP ecosystem together.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

You're free to use, modify, and distribute this project. Attribution is appreciated but not required.

---

<p align="center">
  <strong>Built with ❤️ for the AI engineering community</strong>
  <br/>
  <a href="https://freemcp.in">freemcp.in</a>
</p>
