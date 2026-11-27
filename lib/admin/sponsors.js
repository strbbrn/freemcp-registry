import { sponsorDefaults, sponsorLink, tiers } from '../sponsorship.js';
import { assertVersion, commitMutation, fieldDiff, loadRevision } from './audit.js';
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
  const action=options(data.action??'save',['save','restore'],'sponsorship action');
  const db = config.db;
  const old = await sponsorRow(db,tier);
  await assertVersion(old,data.version);
  let values=data;
  if (action==='restore') {
    if (data.confirm!=='yes') invalid('Confirm the sponsorship restore.');
    values=await loadRevision(config,'sponsor',tier,data.revision);
    if (!values) invalid('The first revision has no previous sponsorship.');
  }
  const link = text(values.target_url,'contact link',2048);
  const target_url = link.startsWith('mailto:') ? sponsorLink(link) : url(link,'contact link');
  if (!target_url) invalid('Use HTTPS or the FreeMCP contact email with an optional subject.');
  const row = {tier,name:text(values.name,'tier name',80),description:text(values.description,'description',500),
    cta_text:text(values.cta_text,'button text',80),target_url,
    status:options(values.status,['draft','active','paused'],'status'),updated_at:new Date().toISOString()};
  if (action==='save'&&(row.status!=='draft'||old?.status==='active'||old?.status==='paused')&&data.confirm!=='yes') {
    invalid('Confirm changes to the public homepage sponsorship.');
  }
  const fields = Object.keys(row);
  const mutation = old
    ? db.prepare(`UPDATE sponsorships SET ${fields.slice(1).map(key=>key+'=?').join(',')} WHERE ${fields.map(key=>key+' IS ?').join(' AND ')} RETURNING tier`)
      .bind(...fields.slice(1).map(key=>row[key]),...fields.map(key=>old[key]))
    : db.prepare('INSERT INTO sponsorships SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sponsorships WHERE tier=?) RETURNING tier')
      .bind(...fields.map(key=>row[key]),tier);
  const visible = value=>value&&{name:value.name,description:value.description,cta_text:value.cta_text,status:value.status};
  const before=visible(old), after=visible(row);
  const changedFields=fieldDiff(before,after);
  if (old?.target_url!==row.target_url) changedFields.push('target_url');
  await commitMutation(config,actor,mutation,{action,entity:'sponsor',entityId:tier,reason:data.reason,
    before,after:{...after,changedFields},revision:old??defaultTier(tier)});
  return row;
}
