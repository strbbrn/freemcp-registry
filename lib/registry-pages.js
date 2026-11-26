import { breadcrumbs, canonicalUrl, directoryPath, escapeHtml as esc, jsonLd, listingPath, metadata, schema } from './seo.js';
import { htmlHeaders, unavailable } from './http.js';

export async function renderShell(context, transform, cacheControl) {
  const shell = await context.next();
  if (!shell.ok || !shell.headers.get('content-type')?.includes('text/html')) {
    return unavailable('Page temporarily unavailable');
  }
  const headers = htmlHeaders(context.request, shell.headers);
  if (cacheControl) headers.set('cache-control', cacheControl);
  // The resulting HTML has its own freshness policy, distinct from the static shell.
  for (const name of ['etag', 'last-modified', 'content-length', 'content-encoding']) headers.delete(name);
  const page = new Response(shell.body, { headers });
  return transform ? transform.transform(page) : page;
}

export const setHtml = html => ({ element: element => element.setInnerContent(html, { html: true }) });
export const setText = text => ({ element: element => element.setInnerContent(text) });
export const setAttribute = (name, value) => ({ element: element => element.setAttribute(name, value) });

export function recentCard(server) {
  return `<article class="featured-card"><span>${esc(server.category)}</span><h3><a href="${listingPath(server.id)}">${esc(server.name)}</a></h3><p>${esc(server.description)}</p>${server.author ? `<div class="featured-author">by ${esc(server.author)}</div>` : ''}</article>`;
}

export function directoryRow(server, last) {
  const link = listingPath(server.id);
  return `<article class="server-row"${last ? ' data-last-row' : ''}>
    <div class="server-identity"><span class="server-mark" aria-hidden="true">${esc(server.name.trim().charAt(0).toUpperCase())}</span>
    <div class="server-main"><h2><a href="${link}">${esc(server.name)}</a></h2><p class="server-description">${esc(server.description)}</p><span class="server-author">by ${esc(server.author)}</span></div></div>
    <div class="server-category"><span class="category-pill">${esc(server.category)}</span></div>
    <div class="server-status">${server.lifecycle === 'archived' ? '<span class="status-pill archived" title="Registry classification or last-known repository status">Archived</span>' : ''}</div>
    <a class="server-action" href="${link}" aria-label="View ${esc(server.name)} details">View details →</a>
  </article>`;
}

function pageLink(label, path, direction) {
  return path
    ? `<a class="page-link" rel="${direction}" href="${esc(path)}">${label}</a>`
    : `<span class="page-link" aria-disabled="true">${label}</span>`;
}

export function directoryPage(data, categories, filters) {
  const { servers, page, total, pages, pageSize } = data;
  const filtered = Boolean(filters.q || filters.category || filters.sort !== 'name');
  const path = directoryPath(page);
  const title = page === 1 ? 'Browse MCP servers — FreeMCP' : `Browse MCP servers, page ${page} — FreeMCP`;
  const description = (page > 1 ? `Page ${page} of the FreeMCP directory. ` : '') +
    'Search and filter open-source MCP servers by name, category, and tags.';
  const meta = metadata({ title, description, path, noindex: filtered });
  const structuredData = schema('CollectionPage', {
    name: title, description, url: meta.canonical,
    breadcrumb: breadcrumbs([['FreeMCP', '/'], ['MCP servers', '/servers/'], ...(page > 1 ? [[`Page ${page}`, path]] : [])]),
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: servers.map((server, index) => ({
        '@type': 'ListItem', position: (page - 1) * pageSize + index + 1,
        name: server.name, url: canonicalUrl(listingPath(server.id)),
      })),
    },
  });
  const rows = servers.map((server, index) => directoryRow(server, index === servers.length - 1));
  const choices = filters.category && !categories.includes(filters.category) ? [...categories, filters.category] : categories;
  const options = choices.map(name => `<option value="${esc(name)}"${name === filters.category ? ' selected' : ''}>${esc(name)}</option>`).join('');
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const rewriter = new HTMLRewriter()
    .on('title', setText(meta.title))
    .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', setAttribute('content', meta.description))
    .on('meta[property="og:title"], meta[name="twitter:title"]', setAttribute('content', meta.title))
    .on('link[rel="canonical"]', setAttribute('href', meta.canonical))
    .on('meta[property="og:url"]', setAttribute('content', meta.canonical))
    .on('head', { element(element) {
      if (meta.robots) element.append(`<meta name="robots" content="${meta.robots}">`, { html: true });
      if (!filtered) element.append(jsonLd(structuredData), { html: true });
    } })
    .on('#registry-query', setAttribute('value', filters.q))
    .on('#registry-category', { element(element) { element.append(options, { html: true }); } })
    .on(`#registry-sort option[value="${filters.sort === 'category' ? 'category' : 'name'}"]`, setAttribute('selected', ''))
    .on('#registry-count', setText(`${total} matching servers · showing ${first}–${Math.min(page * pageSize, total)}`))
    .on('#page-indicator', setText(`Page ${page} of ${pages}`))
    .on('#previous-page', setHtml(pageLink('← Previous', page > 1 && directoryPath(page - 1, filters), 'prev')))
    .on('#next-page', setHtml(pageLink('Next →', page < pages && directoryPath(page + 1, filters), 'next')));
  const boundaries = [0, 7, 14, 21, pageSize];
  for (const [index, start] of boundaries.slice(0, -1).entries()) {
    const html = rows.slice(start, boundaries[index + 1]).join('') ||
      (!start ? '<p>No matching servers. Try a different search or category.</p>' : '');
    rewriter.on(`[data-registry-start="${start}"]`, setHtml(html));
    if (start && rows.length < start) {
      rewriter.on(`[data-inline-position="${start}"]`, { element: element => element.remove() });
    }
  }
  return rewriter;
}
