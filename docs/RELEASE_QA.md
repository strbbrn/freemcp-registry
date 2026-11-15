# FreeMCP 2.0 — browser and accessibility release QA

Automated build-smoke tests run in GitHub Actions after Astro builds. They verify all server routes, homepage and preview catalogue inclusion, navigation landmarks, skip links, and submission form controls. **They are not a substitute for a real browser or assistive-technology audit.**

## Manual browser matrix (pending execution)

Test at 375px mobile, 768px tablet, and 1440px desktop in Chromium, Firefox, and WebKit/Safari.

- [ ] Homepage: all servers visible; category filtering, links, and layout work without horizontal overflow
- [ ] /v2-preview: discovery search/filter and cards operate with keyboard and touch
- [ ] /servers/sqlite-mcp and /servers/github-mcp: headings, installation guide, source links, and mobile aside remain usable
- [ ] /submit: required-field validation; valid GitHub repository analysis; manifest and README hints; error handling on API 404/403
- [ ] /submit: credential-bearing repository and docs URLs blocked; issue preview contains correct values; **do not publish a test issue**
- [ ] Tab/Shift+Tab navigation; visible focus indication; skip-to-content; no keyboard traps
- [ ] Form labels, live status and error messages announced by screen reader
- [ ] Dark/light theme toggling, persistence, contrast and zoom to 200%
- [ ] Check browser console for errors and broken network requests

Record browser/version, device size, date, and evidence before checking these boxes. Do not mark release ready until manual QA and approval are complete.
