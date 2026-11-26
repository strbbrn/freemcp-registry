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
