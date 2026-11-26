export const ORIGIN = 'https://freemcp.in';
export const ARD_PATH = '/.well-known/ard.json';
export const listingPath = id => '/servers/' + encodeURIComponent(id);
export const canonicalUrl = path => ORIGIN + path;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function safeHttps(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\]/u.test(value)) return '';
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export const serializeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
export const jsonLd = value => '<script type="application/ld+json">' + serializeJson(value) + '</script>';

export const schema = (type, data) => ({ '@context': 'https://schema.org', '@type': type, ...data });
export const breadcrumbs = entries => ({
  '@type': 'BreadcrumbList',
  itemListElement: entries.map(([name, path], index) => ({
    '@type': 'ListItem', position: index + 1, name, item: canonicalUrl(path),
  })),
});

export function directoryPath(page = 1, { q, category, sort } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (sort && sort !== 'name') params.set('sort', sort);
  if (page > 1) params.set('page', String(page));
  return '/servers/' + (params.size ? '?' + params : '');
}

export function metadata({ title, description, path, type = 'website', noindex = false }) {
  return { title, description, canonical: canonicalUrl(path), type, robots: noindex ? 'noindex, follow' : undefined };
}
