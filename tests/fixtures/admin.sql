-- Browser fixtures only. No identity bypass is present in the deployed app.
INSERT INTO admin_sessions VALUES ('TrbOjmjkULVeb3k1Zj3fk2sQngyegbSF1baMNjF49Lc','12345','fixture-maintainer','local',4102444800,4102444800);
CREATE TRIGGER test_admin_audit_failure BEFORE INSERT ON admin_audit_log
  WHEN NEW.reason='Fixture audit rejected'
BEGIN
  SELECT RAISE(ABORT, 'test audit insert rejected');
END;
CREATE TRIGGER test_admin_audit_ignored BEFORE INSERT ON admin_audit_log
  WHEN NEW.reason='Fixture audit omitted'
  OR (NEW.reason='Fixture placement audit omitted' AND NEW.entity_id LIKE '%detail-bottom')
BEGIN
  SELECT RAISE(IGNORE);
END;
INSERT INTO submission_reviews(number,status,issue_hash,source_commit,candidate_json,actor,updated_at,server_id) VALUES
  (901,'clarification','offline-browser-fixture','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   '{"candidate":{"id":"offline-browser-candidate","name":"Offline browser fixture","description":"An incomplete private fixture","category":"Other","author":"Fixture","github_url":"https://github.com/example/offline-browser-candidate","stars":0,"updated_at":"2026-11-27","tags_json":"[]","details_json":"{\"review\":{\"status\":\"pending-publication\",\"issue\":901,\"source\":\"approved-submission\"}}"},"exceptions":{},"serverVersion":null}',
   '12345','2026-11-27',NULL);
