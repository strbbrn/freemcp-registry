import { head } from '../lib/http.js';
import { registry } from '../lib/registry.js';
import { recentCard, renderShell, setHtml, setText } from '../lib/registry-pages.js';

export async function onRequestGet(context) {
  let data;
  try {
    data = await registry(context.env.DB).recent();
  } catch (error) {
    console.error('Homepage registry unavailable', error);
    return renderShell(context, null, 'no-store');
  }
  const html = data.servers.map(recentCard).join('') || '<p class="loading-message">No published servers yet.</p>';
  return renderShell(context, new HTMLRewriter()
    .on('#registry-summary', setText(`${data.total} servers across ${data.categories} categories`))
    .on('#recent-servers', setHtml(html)));
}

export const onRequestHead = head(onRequestGet);
