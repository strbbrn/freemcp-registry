SELECT COUNT(*) AS total_servers, SUM(CASE WHEN json_valid(details_json) = 0 THEN 1 ELSE 0 END) AS invalid_details_json FROM servers;
SELECT id, name, github_url, json_extract(details_json, '$.documentationUrl') AS documentation_url, json_extract(details_json, '$.lifecycle') AS lifecycle, json_array_length(json_extract(details_json, '$.tools')) AS tool_count FROM servers ORDER BY id;
SELECT id, json_extract(details_json, '$.lifecycle') AS lifecycle FROM servers WHERE json_extract(details_json, '$.lifecycle') IS NULL ORDER BY id;
SELECT id, json_extract(details_json, '$.prerequisites') AS prerequisites FROM servers WHERE json_extract(details_json, '$.prerequisites') IS NULL ORDER BY id;
SELECT id, json_extract(details_json, '$.contentVerification') AS verification FROM servers WHERE json_extract(details_json, '$.contentVerification') LIKE '%archived%' AND json_extract(details_json, '$.lifecycle') = 'maintained' ORDER BY id;
SELECT s.id, t.value ->> '$.name' AS tool_name, COUNT(*) AS occurrences FROM servers s, json_each(s.details_json, '$.tools') t GROUP BY s.id, tool_name HAVING COUNT(*) > 1 ORDER BY s.id;
SELECT id, name, json_extract(details_json, '$.summary') AS summary, json_extract(details_json, '$.installations') AS installations FROM servers WHERE id IN ('aws-kb-mcp', 'postgres-mcp') ORDER BY id;
