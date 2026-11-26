// Invalid review metadata fails closed. Records created before explicit review
// metadata remain public, as do records explicitly marked published.
const details = "CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END";
const review = "json_extract(" + details + ", '$.review.status')";
const publicListing = [
  "json_valid(details_json)",
  "json_type(" + details + ") = 'object'",
  "(" + review + " = 'published' OR json_type(" + details + ", '$.review') IS NULL)",
  "length(id) BETWEEN 1 AND 200",
  "id NOT GLOB '*[^a-z0-9-]*' AND id NOT GLOB '-*' AND id NOT GLOB '*-' AND id NOT GLOB '*--*'",
].join(' AND ');

export const PAGE_SIZE = 24;
export const MAX_PAGE = 10000;
const orders = {
  name: 'name COLLATE NOCASE, id',
  category: 'category COLLATE NOCASE, name COLLATE NOCASE, id',
  newest: 'rowid DESC',
};

export function isSlug(id) {
  return typeof id === 'string' && id.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

export function readFilters(params) {
  const sort = params.get('sort');
  return {
    q: (params.get('q') || '').trim().slice(0, 120),
    category: (params.get('category') || '').trim().slice(0, 100),
    sort: sort === 'newest' || sort === 'category' ? sort : 'name',
  };
}

function strings(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function registry(db) {
  if (!db) throw new Error('Missing registry binding');
  function listing(profile) {
    return db.prepare('SELECT id,name,description,category,author,tags_json,' +
      "json_extract(" + details + ", '$.lifecycle') AS lifecycle FROM servers WHERE " +
      profile.where + ' ORDER BY ' + orders[profile.sort] + ' LIMIT ? OFFSET ?');
  }

  function publicRow({ tags_json, lifecycle, ...row }) {
    return { ...row, tags: strings(tags_json), lifecycle: typeof lifecycle === 'string' ? lifecycle : null };
  }

  return {
    async directory({ q, category, sort, page, size, clampPage = false }) {
      const filters = [publicListing];
      const bindings = [];
      if (category) {
        filters.push('category = ?');
        bindings.push(category);
      }
      if (q) {
        const tokens = q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8);
        if (!tokens) return { servers: [], total: 0, page, pages: 1, pageSize: size };
        filters.push('rowid IN (SELECT rowid FROM servers_search WHERE servers_search MATCH ?)');
        bindings.push(tokens.map(token => '"' + token + '"*').join(' AND '));
      }
      const where = filters.join(' AND ');
      const count = await db.prepare('SELECT COUNT(*) AS total FROM servers WHERE ' + where).bind(...bindings).first();
      const total = count?.total || 0;
      const pages = Math.max(1, Math.ceil(total / size));
      const current = clampPage ? Math.min(page, pages) : page;
      const rows = current <= pages
        ? await listing({ where, sort }).bind(...bindings, size, (current - 1) * size).all()
        : { results: [] };
      return { servers: rows.results.map(publicRow), total, page: current, pages, pageSize: size };
    },
    async recent() {
      const [rows, totals] = await db.batch([
        listing({ where: publicListing, sort: 'newest' }).bind(6, 0),
        db.prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT category) AS categories FROM servers WHERE ' + publicListing),
      ]);
      return { servers: rows.results.map(publicRow), ...totals.results[0] };
    },
    async categories() {
      const rows = await db.prepare('SELECT DISTINCT category FROM servers WHERE ' + publicListing +
        ' ORDER BY category COLLATE NOCASE, category').all();
      return rows.results.map(row => row.category);
    },
    async detail(id) {
      if (!isSlug(id)) return null;
      const row = await db.prepare('SELECT id,name,description,category,author,tags_json,github_url,stars,details_json FROM servers WHERE id = ? AND ' + publicListing)
        .bind(id).first();
      if (!row) return null;
      return { ...row, tags: strings(row.tags_json), details: JSON.parse(row.details_json) };
    },
    async related({ category, id }) {
      const rows = await db.prepare('SELECT id,name,description FROM servers WHERE category = ? AND id <> ? AND ' +
        publicListing + ' ORDER BY stars DESC, id LIMIT 5').bind(category, id).all();
      return rows.results;
    },
    async sitemapCount() {
      const count = await db.prepare('SELECT COUNT(*) AS total FROM servers WHERE ' + publicListing).first();
      return count.total;
    },
    async sitemapIds(limit, offset) {
      const rows = await db.prepare('SELECT id FROM servers WHERE ' + publicListing + ' ORDER BY id LIMIT ? OFFSET ?')
        .bind(limit, offset).all();
      return rows.results.map(row => row.id);
    },
  };
}
