import { ORIGIN } from './seo.js';
import { MAX_PAGE, PAGE_SIZE } from './registry.js';

const apiType = 'application/vnd.oai.openapi+json';
export const openApiPath = '/api/openapi.json';

export const discoveryManifest = {
  specVersion: '1.0',
  host: { displayName: 'FreeMCP', documentationUrl: ORIGIN + '/about/' },
  entries: [{
    identifier: 'urn:air:freemcp.in:registry-api',
    displayName: 'FreeMCP public registry API',
    type: apiType,
    url: ORIGIN + openApiPath,
    description: 'Search and browse public directory metadata for open-source MCP servers.',
    representativeQueries: [
      'Find open-source MCP listings matching a name or keyword.',
      'List public MCP server categories.',
      'Show recently added public MCP server listings.',
    ],
    capabilities: ['search-listings', 'list-categories', 'browse-recent-listings'],
    tags: ['mcp', 'directory', 'open-source'],
  }],
};

const string = { type: 'string' };
const integer = { type: 'integer' };
const query = (name, schema, description) => ({ in: 'query', name, description, schema });
const response = (description, schema) => ({ description, content: { 'application/json': { schema } } });
const ref = name => ({ $ref: '#/components/schemas/' + name });
const ErrorBody = { type: 'object', required: ['error'], properties: { error: string } };

export const openApi = {
  openapi: '3.1.0',
  info: {
    title: 'FreeMCP public registry API',
    version: '1.0.0',
    description: 'Read-only discovery of community-curated MCP server listings. Use the listing page and the upstream repository for installation and lifecycle information.',
  },
  servers: [{ url: ORIGIN }],
  paths: {
    '/api/servers': {
      get: {
        operationId: 'browseRegistry',
        summary: 'Search listings or read category metadata',
        parameters: [
          query('meta', { enum: ['categories'] }, 'Return category metadata instead of a page of listings.'),
          query('q', { ...string, maxLength: 120 }, 'Keyword, tag, category, or maintainer search.'),
          query('category', { ...string, maxLength: 100 }, 'Exact category name.'),
          query('sort', { enum: ['name', 'category', 'newest'], default: 'name' }, 'Listing order.'),
          query('page', { ...integer, minimum: 1, maximum: MAX_PAGE, default: 1 }, 'Page number. Requests beyond the results are capped at the last page.'),
          query('limit', { ...integer, minimum: 1, maximum: PAGE_SIZE, default: PAGE_SIZE }, 'Results per page.'),
        ],
        responses: {
          200: response('Public listings or category names', { oneOf: [ref('ListingPage'), ref('Categories')] }),
          500: response('Registry query failed', ErrorBody),
          503: response('Registry binding unavailable', ErrorBody),
        },
      },
    },
  },
  components: { schemas: {
    Listing: {
      type: 'object',
      required: ['id', 'name', 'description', 'category', 'author', 'tags', 'lifecycle'],
      properties: {
        id: { ...string, description: 'Listing slug. The HTML profile is at /servers/{id}.' },
        name: string, description: string, category: string, author: string,
        tags: { type: 'array', items: string }, lifecycle: { type: ['string', 'null'] },
      },
    },
    ListingPage: {
      type: 'object', required: ['servers', 'total', 'page', 'pages', 'pageSize'],
      properties: { servers: { type: 'array', items: ref('Listing') }, total: integer, page: integer, pages: integer, pageSize: integer },
    },
    Categories: {
      type: 'object', required: ['categories'],
      properties: { categories: { type: 'array', items: string } },
    },
  } },
};
