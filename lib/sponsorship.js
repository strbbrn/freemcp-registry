import { safeHttps } from './seo.js';

export const tiers = ['gold','diamond','platinum'];
export const sponsorDefaults = {
  gold: { name:'Gold', description:'Support the community and help more developers discover open MCP tools.' },
  diamond: { name:'Diamond', description:'Partner with FreeMCP to champion the growing open-source AI ecosystem.' },
  platinum: { name:'Platinum', description:'Explore a flagship partnership supporting the future of MCP discovery.' },
};
export function sponsorLink(value) {
  if (typeof value !== 'string') return '';
  if (/^mailto:agents@freemcp\.in(?:\?subject=[a-zA-Z0-9+% ._-]+)?$/i.test(value) &&
      !/%(?:0[ad]|25)/i.test(value)) return value;
  return safeHttps(value);
}
export async function sponsorOverrides(db) {
  if (!db) return [];
  try {
    const { results } = await db.prepare("SELECT * FROM sponsorships WHERE status IN ('active','paused')").all();
    return results;
  } catch {
    // The public homepage is also deployed against schemas before this migration.
    return [];
  }
}
