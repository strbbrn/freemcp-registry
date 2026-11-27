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
