import { head, notFound, redirect, unavailable } from '../../lib/http.js';
import { MAX_PAGE, PAGE_SIZE, readFilters, registry } from '../../lib/registry.js';
import { directoryPath } from '../../lib/seo.js';
import { directoryPage, renderShell } from '../../lib/registry-pages.js';

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
  try {
    const store = registry(context.env.DB);
    const [data, categories] = await Promise.all([
      store.directory({ ...filters, size: PAGE_SIZE, page }),
      store.categories(),
    ]);
    if (page > data.pages) return notFound();
    if (url.pathname + url.search !== path) return redirect(path);
    // Stop generating links beyond the supported offset window.
    data.pages = Math.min(data.pages, MAX_PAGE);
    return await renderShell(context, directoryPage(data, categories, filters));
  } catch (error) {
    console.error('Directory registry unavailable', error);
    return unavailable();
  }
}

export const onRequestHead = head(onRequestGet);
