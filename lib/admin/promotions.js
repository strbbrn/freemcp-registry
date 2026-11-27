import { token } from './crypto.js';
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
const visibleFields = row => row && ({campaign_id:row.campaign_id,placement:row.placement,slot:row.slot,status:row.status,
  headline:row.headline,eyebrow:row.eyebrow,description:row.description,cta_text:row.cta_text,
  starts_at:row.starts_at,ends_at:row.ends_at,theme:row.theme,weight:row.weight,rotation_seconds:row.rotation_seconds});
function promotionAudit(action, id, reason, old, row, operationId) {
  const before = visibleFields(old), after = visibleFields(row);
  const changedFields = fieldDiff(before,after);
  if (old?.target_url!==row.target_url) changedFields.push('target_url');
  return { action,entity:'promotion',entityId:id,reason,before,after:{...after,...(operationId?{operationId}:{}),changedFields},revision:old };
}
export const getPromotion = (db,id) => db.prepare('SELECT * FROM promotions WHERE id=?').bind(id).first();
export async function promotionPeers(db,row) {
  if (!row.campaign_id) return [];
  return (await db.prepare(`SELECT * FROM promotions WHERE campaign_id=? AND id<>?
    ORDER BY placement,slot,id`).bind(row.campaign_id,row.id).all()).results;
}
const comparedFields=['id','campaign_id',...fields];
const updatePromotion = (db,old,row) => db.prepare(`UPDATE promotions SET ${fields.map(field=>field+'=?').join(',')}
  WHERE ${comparedFields.map(field=>field+' IS ?').join(' AND ')} RETURNING id`)
  .bind(...fields.map(field=>row[field]),...comparedFields.map(field=>old[field]));

async function promotionBatch(db,statements) {
  try { await db.batch(statements); }
  catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message)) throw new AdminError(409,'A promotion ID already exists. Choose a different ID.');
    if (String(error.message).includes('freemcp_write_missing')) throw new AdminError(409,'A placement changed or its audit could not be saved.');
    if (/no such column: campaign_id|no column named campaign_id/i.test(error.message)) {
      throw new AdminError(503,'Apply promotion campaign migration 0013 before editing promotions.');
    }
    throw error;
  }
}

export async function editPromotion(config,actor,id,data) {
  const db = config.db;
  const action = options(data.action,['create','save','duplicate','pause','activate','restore'],'promotion action');
  const old = id ? await getPromotion(db,id) : null;
  if (action !== 'create') {
    if (!old) throw new AdminError(404,'Promotion not found.');
    if (!old.campaign_id) throw new AdminError(503,'Apply promotion campaign migration 0013 before editing promotions.');
    await assertVersion(old,data.version);
  }
  if (['activate','pause'].includes(action) || (['create','save'].includes(action)&&(data.status==='active'||old?.status==='active'))) {
    if (data.confirm!=='yes') invalid('Confirm changes to public promotion placements.');
  }
  if (action === 'create' || action === 'duplicate') {
    const base = data.id;
    if (!isSlug(base) || base.length > 120) invalid('Enter a valid lowercase promotion ID.');
    const selections = data.placements ?? placements.filter(slot=>data['slot_'+slot]==='yes');
    if (!Array.isArray(selections)||!selections.length||new Set(selections).size!==selections.length) invalid('Select one or more unique placements.');
    const statements=[], ids=[];
    const campaign=token();
    if (old) statements.push(requireRow(db,`SELECT 1 FROM promotions WHERE ${comparedFields.map(key=>key+' IS ?').join(' AND ')}`,
      ...comparedFields.map(key=>old[key])));
    for (const selection of selections) {
      const values=action==='duplicate'?{...old,status:'draft'}:data;
      const row={...promotionCandidate(values,selection),campaign_id:campaign};
      const target=selections.length===1?base:base+'-'+selection.replace('/','-');
      ids.push(target);
      statements.push(db.prepare(`INSERT INTO promotions(id,campaign_id,${fields.join(',')}) VALUES(?,?,${fields.map(()=>'?').join(',')})`)
        .bind(target,campaign,...fields.map(field=>row[field])));
      const audit=await auditStatements(config,actor,promotionAudit(action,target,data.reason,null,row,campaign));
      statements.push(...audit.statements);
    }
    await promotionBatch(db,statements);
    return ids;
  }
  const requested=Object.keys(data).filter(key=>key.startsWith('also_')&&data[key]==='yes').map(key=>key.slice(5));
  const peers=requested.length?await promotionPeers(db,old):[];
  const selected=peers.filter(peer=>requested.includes(peer.id));
  if (selected.length!==requested.length) throw new AdminError(409,'Campaign membership changed. Reload the promotion.');
  if ((action==='restore'||selected.some(peer=>peer.status==='active'))&&data.confirm!=='yes') {
    invalid('Confirm changes to the selected promotion placements.');
  }

  const targets=[];
  for (const original of [old,...selected]) {
    const primary=original.id===id;
    if (!primary) await assertVersion(original,data['version_'+original.id]);
    let values;
    if (action==='restore') {
      const revision=primary?data.revision:data['revision_'+original.id];
      if (typeof revision!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(revision)) invalid('Select a prior revision for each placement.');
      values=await loadRevision(config,'promotion',original.id,revision);
      if (!values) invalid('Select a revision with previous values for each placement.');
    } else if (action==='activate'||action==='pause') {
      values={...original,status:action==='activate'?'active':'paused'};
    } else {
      values={...data,status:primary?data.status:original.status};
    }
    const selection=action==='restore'?values.placement+'/'+values.slot:
      primary&&action==='save'?(data.selection??original.placement+'/'+original.slot):original.placement+'/'+original.slot;
    if (action==='activate'||action==='pause') {
      if (action==='activate') promotionCandidate(values,selection);
      targets.push([original,{...original,status:values.status,updated_at:new Date().toISOString()}]);
    } else {
      targets.push([original,{...promotionCandidate(values,selection),campaign_id:original.campaign_id}]);
    }
  }
  if (targets.length===1) {
    const [original,next]=targets[0];
    await commitMutation(config,actor,updatePromotion(db,original,next),promotionAudit(action,id,data.reason,original,next));
  } else {
    const statements=[], operationId=token();
    for (const [original,next] of targets) {
      statements.push(updatePromotion(db,original,next));
      const audit=await auditStatements(config,actor,promotionAudit(action,original.id,data.reason,original,next,operationId));
      statements.push(...audit.statements);
    }
    await promotionBatch(db,statements);
  }
  return targets.map(([original])=>original.id);
}
