import { sponsorLink, sponsorOverrides } from '../lib/sponsorship.js';
import { head } from '../lib/http.js';
import { registry } from '../lib/registry.js';
import { recentCard, renderShell, setHtml, setText } from '../lib/registry-pages.js';

export async function onRequestGet(context) {
  const sponsorships = sponsorOverrides(context.env.DB);
  let data;
  try {
    data = await registry(context.env.DB).recent();
  } catch (error) {
    console.error('Homepage registry unavailable', error);
    return renderShell(context, null, 'no-store');
  }
  const html = data.servers.map(recentCard).join('') || '<p class="loading-message">No published servers yet.</p>';
  const transform = new HTMLRewriter()
    .on('#registry-summary', setText(`${data.total} servers across ${data.categories} categories`))
    .on('#recent-servers', setHtml(html));
  for (const row of await sponsorships) {
    if (!['gold','diamond','platinum'].includes(row.tier)) continue;
    const selector = '.sponsor-tier.' + row.tier;
    if (row.status === 'paused') {
      transform.on(selector, { element: element => element.remove() });
      continue;
    }
    const target = sponsorLink(row.target_url);
    if (!target) continue;
    transform.on(selector + ' h3', setText(row.name))
      .on(selector + ' p', setText(row.description))
      .on(selector + ' a', { element(element) {
        element.setAttribute('href', target);
        element.setInnerContent(row.cta_text + ' ↗');
      } });
  }
  return renderShell(context, transform);
}

export const onRequestHead = head(onRequestGet);
