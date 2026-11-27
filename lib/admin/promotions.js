import { isSlug } from '../registry.js';
import { assertVersion, auditStatements, commitMutation, fieldDiff, loadRevision, requireRow } from './audit.js';
import { AdminError, invalid } from './http.js';
import { integer, options, text, url } from './validation.js';

export const placements = ['home/primary','home/strip','directory/primary','directory/inline','directory/footer','detail/primary','detail/sidebar','detail/bottom'];
export const themes = ['violet','cyan','emerald','amber'];
export const statuses = ['draft','active','paused'];
const fields = ['placement','slot','eyebrow','headline','description','cta_text','target_url','theme','weight','rotation_seconds','status','starts_at','ends_at','updated_at'];
function timestamp(value, label) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?Z?$/.test(value)) invalid('Use a valid UTC ' + label + '.');
  const time = new Date(value.replace(' ','T') + (value.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(time.valueOf()) || time.toISOString().slice(0,16) !== value.replace(' ','T').slice(0,16)) invalid('Use a valid UTC ' + label + '.');
  return time.toISOString();
}
export function promotionCandidate(data, selection) {
  const [placement,slot] = options(selection,placements,'placement and slot').split('/');
  const starts_at = timestamp(data.starts_at,'start time'), ends_at = timestamp(data.ends_at,'end time');
  if (starts_at && ends_at && starts_at >= ends_at) invalid('The end time must follow the start time.');
  const target_url = url(data.target_url,'promotion link');
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(target_url)) invalid('Use an HTTPS promotion link on a standard port.');
  return { placement,slot, eyebrow:text(data.eyebrow,'eyebrow',100), headline:text(data.headline,'headline',140),
    description:text(data.description,'description',500,false), cta_text:text(data.cta_text,'button text',80),
    target_url,theme:options(data.theme,themes,'theme'),
    weight:integer(data.weight,'weight',1,20), rotation_seconds:integer(data.rotation_seconds,'rotation',5,30),
    status:options(data.status,statuses,'status'), starts_at,ends_at,updated_at:new Date().toISOString() };
}
const visibleFields = row => row && ({placement:row.placement,slot:row.slot,status:row.status,
  headline:row.headline,eyebrow:row.eyebrow,description:row.description,cta_text:row.cta_text,
  starts_at:row.starts_at,ends_at:row.ends_at,theme:row.theme,weight:row.weight,rotation_seconds:row.rotation_seconds});
function promotionAudit(action, id, reason, old, row) {
  const before = visibleFields(old), after = visibleFields(row);
  const changedFields = fieldDiff(before,after);
  if (old?.target_url!==row.target_url) changedFields.push('target_url');
  return { action,entity:'promotion',entityId:id,reason,before,after:{...after,changedFields},revision:old };
}
export const getPromotion = (db,id) => db.prepare('SELECT * FROM promotions WHERE id=?').bind(id).first();

export async function editPromotion(config,actor,id,data) {
  const db = config.db;
  const action = options(data.action,['create','save','duplicate','pause','activate','restore'],'promotion action');
  const old = id ? await getPromotion(db,id) : null;
  if (action !== 'create') {
    if (!old) throw new AdminError(404,'Promotion not found.');
    await assertVersion(old,data.version);
  }
  if (action === 'create' || action === 'duplicate') {
    const base = data.id;
    if (!isSlug(base) || base.length > 120) invalid('Enter a valid lowercase promotion ID.');
    const selections = data.placements ?? placements.filter(slot=>data['slot_'+slot]==='yes');
    if (!Array.isArray(selections)||!selections.length||new Set(selections).size!==selections.length) invalid('Select one or more unique placements.');
    const statements = [], ids = [];
    if (old) statements.push(requireRow(db,`SELECT 1 FROM promotions WHERE ${['id',...fields].map(key=>key+' IS ?').join(' AND ')}`,
      ...['id',...fields].map(key=>old[key])));
    for (const selection of selections) {
      const values = action==='duplicate' ? {...old,status:'draft'} : data;
      const row = promotionCandidate(values,selection);
      const target = selections.length===1 ? base : base+'-'+selection.replace('/','-');
      ids.push(target);
      statements.push(db.prepare(`INSERT INTO promotions(id,${fields.join(',')}) VALUES(?,${fields.map(()=>'?').join(',')})`)
        .bind(target,...fields.map(field=>row[field])));
      const audit = await auditStatements(config,actor,promotionAudit(action,target,data.reason,null,row));
      statements.push(...audit.statements);
    }
    try { await db.batch(statements); }
    catch (error) {
      if (/UNIQUE constraint failed/i.test(error.message)) throw new AdminError(409,'A promotion ID already exists. Choose a different ID.');
      if (String(error.message).includes('freemcp_write_missing')) throw new AdminError(409,'The promotion batch conflicted or its audit could not be saved.');
      throw error;
    }
    return ids;
  }
  let values = action==='activate' || action==='pause' ? {...old,status:action==='activate'?'active':'paused'} : data;
  if (action==='restore') {
    if (data.confirm!=='yes') invalid('Confirm the promotion restore.');
    values = await loadRevision(config,'promotion',id,data.revision);
    if (!values) invalid('The first revision has no previous promotion.');
  }
  const row = promotionCandidate(values,values.selection ?? (values.placement?values.placement+'/'+values.slot:old.placement+'/'+old.slot));
  const where = ['id',...fields];
  const mutation = db.prepare(`UPDATE promotions SET ${fields.map(field=>field+'=?').join(',')} WHERE ${where.map(field=>field+' IS ?').join(' AND ')} RETURNING id`)
    .bind(...fields.map(field=>row[field]),...where.map(field=>old[field]));
  await commitMutation(config,actor,mutation,promotionAudit(action,id,data.reason,old,row));
  return [id];
}
