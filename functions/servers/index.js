import { head, notFound, redirect, unavailable } from '../../lib/http.js';
import { MAX_PAGE, PAGE_SIZE, readFilters, registry } from '../../lib/registry.js';
import { directoryPath } from '../../lib/seo.js';
import { directoryPage, renderShell } from '../../lib/registry-pages.js';

// Keep standard campaign tags and common ad click IDs on the landing URL.
const campaignParam = /^(?:utm_[a-z0-9_]+|gclid|dclid|gbraid|wbraid|fbclid|msclkid|ttclid|li_fat_id)$/i;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const params = url.searchParams;
  const rawPage = params.get('page') ?? '1';
  const page = Number(rawPage);
  if (params.getAll('page').length > 1 || !/^\d{1,5}$/.test(rawPage) || page < 1 || page > MAX_PAGE) {
    return notFound();
  }
  const filters = readFilters(params);
  const path = directoryPath(page, filters);
  const tracking = new URLSearchParams();
  const navigation = new URLSearchParams();
  for (const [key, value] of params) {
    (campaignParam.test(key) ? tracking : navigation).append(key, value);
  }
  const requestedPath = url.pathname + (navigation.size ? '?' + navigation : '');
  if (requestedPath !== path) {
    const target = new URL(path, url);
    for (const [key, value] of tracking) target.searchParams.append(key, value);
    return redirect(target.pathname + target.search);
  }
  try {
    const store = registry(context.env.DB);
    const data = await store.directory({ ...filters, size: PAGE_SIZE, page, includeCategories: true });
    if (page > data.pages) return notFound();
    // Stop generating links beyond the supported offset window.
    data.pages = Math.min(data.pages, MAX_PAGE);
    return await renderShell(context, directoryPage(data, data.categories, filters));
  } catch (error) {
    console.error('Directory registry unavailable', error);
    return unavailable();
  }
}

export const onRequestHead = head(onRequestGet);
