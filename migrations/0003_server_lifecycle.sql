-- Explicit lifecycle metadata for legacy reference implementations whose upstream
-- source lives in the archived Model Context Protocol reference repository.
-- Do not mark maintained replacements (e.g. github-mcp) as archived.
UPDATE servers
SET details_json = json_set(details_json, '$.lifecycle', 'archived')
WHERE id IN (
 'sqlite-mcp', 'brave-search-mcp', 'postgres-mcp', 'puppeteer-mcp',
 'aws-kb-mcp', 'gitlab-mcp', 'sentry-mcp', 'google-maps-mcp'
);
