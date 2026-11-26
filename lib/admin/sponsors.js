import { sponsorDefaults, sponsorLink, tiers } from '../sponsorship.js';
import { assertVersion, commitMutation } from './audit.js';
import { invalid } from './http.js';
import { options, text, url } from './validation.js';

export function defaultTier(tier) {
  const base = sponsorDefaults[tier];
  return {...base,tier,cta_text:'Contact about '+base.name,
    target_url:'mailto:agents@freemcp.in?subject=FreeMCP%20'+base.name+'%20Sponsorship%20Inquiry',status:'draft'};
}
export const sponsorRow = (db,tier) => db.prepare('SELECT * FROM sponsorships WHERE tier=?').bind(tier).first();
export async function editSponsor(config,actor,tier,data) {
  options(tier,tiers,'sponsorship tier');
  const db = config.db;
  const old = await sponsorRow(db,tier);
  await assertVersion(old,data.version);
  const link = text(data.target_url,'contact link',2048);
  const target_url = link.startsWith('mailto:') ? sponsorLink(link) : url(link,'contact link');
  if (!target_url) invalid('Use HTTPS or the FreeMCP contact email with an optional subject.');
  const row = {tier,name:text(data.name,'tier name',80),description:text(data.description,'description',500),
    cta_text:text(data.cta_text,'button text',80),target_url,
    status:options(data.status,['draft','active','paused'],'status'),updated_at:new Date().toISOString()};
  const fields = Object.keys(row);
  const mutation = old
    ? db.prepare(`UPDATE sponsorships SET ${fields.slice(1).map(key=>key+'=?').join(',')} WHERE ${fields.map(key=>key+' IS ?').join(' AND ')}`)
      .bind(...fields.slice(1).map(key=>row[key]),...fields.map(key=>old[key]))
    : db.prepare('INSERT INTO sponsorships SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sponsorships WHERE tier=?)')
      .bind(...fields.map(key=>row[key]),tier);
  await commitMutation(config,actor,mutation,{action:'save',entity:'sponsor',entityId:tier,reason:data.reason,
    before:old&&{status:old.status},after:{status:row.status}});
  return row;
}
