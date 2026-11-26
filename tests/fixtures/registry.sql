-- Synthetic data for local test databases only.
WITH RECURSIVE numbers(i) AS (
  SELECT 1 UNION ALL SELECT i+1 FROM numbers WHERE i < 32
)
INSERT INTO servers (id, name, description, category, author, github_url, details_json)
SELECT printf('fixture-%02d', i), printf('Fixture server %02d', i),
       'Discoverable fixture for checking pagination and promotions.', 'Fixture', 'FreeMCP tests',
       'https://github.com/example/fixture', '{"review":{"status":"published"}}'
FROM numbers;
INSERT INTO servers (id, name, description, category, author, github_url, details_json, tags_json) VALUES
('draft-fixture', 'Hidden draft fixture', 'Pending review.', 'Pending fixture', 'FreeMCP tests', 'https://github.com/example/draft', '{"review":{"status":"pending-publication"}}', '[]'),
('test-only-fixture', 'Hidden test-only fixture', 'Not for publication.', 'Fixture', 'FreeMCP tests', 'https://github.com/example/test', '{"review":{"status":"test-only"}}', '[]'),
('broken-review-fixture', 'Hidden invalid fixture', 'Sensitive state unknown.', 'Fixture', 'FreeMCP tests', 'https://github.com/example/broken', '{', '[]'),
('escaping-fixture', 'Example <&> "metadata"', 'Escaped <asset> description.', 'Fixture', 'FreeMCP tests', 'http://example.com/not-https', '{"review":{"status":"published"},"documentationUrl":"ftp://example.com","summary":"Safe summary."}', '{');

-- The former sync mirrored GitHub flags into lifecycle. Keep fixtures for
-- archived, editorial, and active cases with independently checked metadata.
UPDATE servers SET details_json = json_patch(details_json, '{"lifecycle":"archived","githubMetadata":{"checkedAt":"2026-01-01T00:00:00Z","archived":1,"disabled":0}}')
 WHERE id = 'fixture-01';
UPDATE servers SET details_json = json_patch(details_json, '{"lifecycle":"archived","lifecycleSource":"registry","githubMetadata":{"checkedAt":"2026-01-01T00:00:00Z","archived":false,"disabled":false}}')
 WHERE id = 'fixture-02';
UPDATE servers SET details_json = json_patch(details_json, '{"githubMetadata":{"checkedAt":"2026-01-01T00:00:00Z","archived":false,"disabled":false}}')
 WHERE id = 'fixture-03';
UPDATE servers SET details_json = json_patch(details_json, '{"lifecycle":"archived","lifecycleSource":"registry","githubMetadata":{"checkedAt":"2026-01-01T00:00:00Z","archived":true,"disabled":false}}')
 WHERE id = 'fixture-04';
UPDATE servers SET details_json = json_patch(details_json, '{"githubMetadata":{"checkedAt":"2026-01-01T00:00:00Z","archived":true,"disabled":true}}')
 WHERE id = 'fixture-05';
