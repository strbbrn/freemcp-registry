import { publicListing } from '../registry.js';
import { isSlug } from '../registry.js';
import { invalid } from './http.js';
import { object, parsed, text } from './validation.js';

export function endpointExceptions(value) {
  const input = parsed(value ?? {},'Shared endpoint exceptions');
  if (!object(input) || Object.keys(input).length > 25) invalid('Enter shared endpoint exceptions keyed by listing ID.');
  return Object.fromEntries(Object.entries(input).map(([id,why])=>{
    if (!isSlug(id)) invalid('Enter a valid listing ID for each shared endpoint exception.');
    return [id,text(why,'shared endpoint justification',300)];
  }));
}
const safe = column => `CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END`;
const rawRepository = column => `rtrim(substr(${column},1,MIN(instr(${column}||'#','#'),instr(${column}||'?','?'))-1),'/')`;
const repositoryPath = column => {
  const raw=rawRepository(column);
  const project=`substr(${raw},20)`; // First character after https://github.com/
  const ownerSlash=`instr(${project},'/')`;
  const pathSlash=`instr(substr(${project},${ownerSlash}+1),'/')`;
  const rootEnd=`19+${ownerSlash}+${pathSlash}`;
  const root=`CASE WHEN ${pathSlash}=0 THEN lower(${raw}) ELSE lower(substr(${raw},1,${rootEnd}-1)) END`;
  return `(CASE WHEN substr((${root}),-4)='.git' THEN substr((${root}),1,length((${root}))-4) ELSE (${root}) END)
    || CASE WHEN ${pathSlash}=0 THEN '' ELSE substr(${raw},${rootEnd}) END`;
};
const urls = (column, alias, trusted = false) => `SELECT DISTINCT ${alias}.atom FROM json_tree(${trusted?column:safe(column)}) AS ${alias}
  WHERE ${alias}.type='text' AND ${alias}.key IN ('url','endpoint')
  AND (${alias}.path LIKE '$.endpoints[%' OR ${alias}.path LIKE '$.installations[%].config%')`;

// Preserve the case and semantics of paths and queries. Normalize the host,
// HTTPS default port, redundant trailing slashes and client-side fragments.
const endpointKey = atom => {
  const value = `trim(${atom})`;
  const withoutFragment = `substr(${value},1,instr(${value}||'#','#')-1)`;
  const base = `substr(${withoutFragment},1,instr(${withoutFragment}||'?','?')-1)`;
  const query = `substr(${withoutFragment},instr(${withoutFragment}||'?','?'))`;
  const hostStart = `(instr(${base},'://')+3)`;
  const hostAndPath = `substr(${base},${hostStart})`;
  const hostLength = `(instr(${hostAndPath}||'/','/')-1)`;
  const host = `lower(substr(${hostAndPath},1,${hostLength}))`;
  const normalizedHost = `CASE WHEN lower(substr(${base},1,${hostStart}-1))='https://' AND substr(${host},-4)=':443'
    THEN substr(${host},1,length(${host})-4) ELSE ${host} END`;
  return `lower(substr(${base},1,${hostStart}-1)) || (${normalizedHost}) || rtrim(substr(${hostAndPath},${hostLength}+1),'/') || ${query}`;
};
const query = scope => `SELECT existing.id FROM servers AS existing CROSS JOIN (SELECT ? AS repository) AS proposed WHERE ${scope}existing.id<>? AND (
  (${repositoryPath('existing.github_url')}=(${repositoryPath('proposed.repository')}) AND
  COALESCE(json_extract(${safe('existing.details_json')},'$.implementationKey'),'')=?)
  OR (NOT EXISTS (SELECT 1 FROM json_each(?) WHERE key=existing.id) AND EXISTS (
    WITH proposed(atom) AS (${urls('?', 'candidate_url',true)}), stored(atom) AS (${urls('existing.details_json', 'stored_url')})
    SELECT 1 FROM proposed JOIN stored ON (${endpointKey('proposed.atom')})=(${endpointKey('stored.atom')})
  )))`;
export const duplicateQuery=query('');
export const publishedCollision = (db,row) => db.prepare(`WITH
  requested(repository, implementation, details) AS (VALUES (?,?,?)),
  endpoints(key) AS MATERIALIZED (
    SELECT DISTINCT ${endpointKey('candidate.atom')}
    FROM requested, json_tree(requested.details,'$.endpoints') AS candidate
    WHERE candidate.key='url' AND candidate.type='text'
  )
  SELECT 1 AS match FROM servers AS existing CROSS JOIN requested WHERE ${publicListing} AND (
    (${repositoryPath('existing.github_url')}=(${repositoryPath('requested.repository')})
      AND COALESCE(json_extract(${safe('existing.details_json')},'$.implementationKey'),'')=requested.implementation)
    OR (EXISTS (SELECT 1 FROM endpoints) AND EXISTS (
      SELECT 1 FROM (${urls('existing.details_json','stored')}) AS stored
      WHERE ${endpointKey('stored.atom')} IN (SELECT key FROM endpoints)
    ))
  ) LIMIT 1`).bind(row.github_url,JSON.parse(row.details_json).implementationKey||'',row.details_json).first();
export const duplicateCondition = 'NOT EXISTS ('+duplicateQuery+')';
export function duplicateArgs(row) {
  const details = JSON.parse(row.details_json);
  return [row.github_url,row.id,details.implementationKey || '',
    JSON.stringify(details.review?.sharedEndpoints ?? {}),row.details_json];
}
export async function listingCollision(db,row,existing = false) {
  return db.prepare(`${duplicateQuery}${existing?'':' UNION ALL SELECT id FROM servers WHERE id=?'} LIMIT 1`)
    .bind(...duplicateArgs(row),...(existing?[]:[row.id])).first();
}
export async function assertNoDuplicate(db,row,existing = false) {
  const duplicate = await listingCollision(db,row,existing);
  if (duplicate) invalid('This ID, implementation or MCP endpoint is already listed under '+duplicate.id+'.');
}

export async function earlierImportEndpoint(db,row,accepted) {
  if (!accepted.length) return null;
  return db.prepare(`SELECT entry.key AS id FROM json_each(?) AS entry WHERE EXISTS (
    WITH proposed(atom) AS (${urls('?', 'candidate_url',true)}), stored(atom) AS (${urls('entry.value','stored_url',true)})
    SELECT 1 FROM proposed JOIN stored ON (${endpointKey('proposed.atom')})=(${endpointKey('stored.atom')})
  ) LIMIT 1`).bind(JSON.stringify(Object.fromEntries(accepted.map(item=>[item.id,JSON.parse(item.details_json)]))),row.details_json).first();
}
