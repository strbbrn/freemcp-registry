-- Browser fixtures only. No identity bypass is present in the deployed app.
INSERT INTO admin_sessions VALUES ('tZUEIZt43pubYseZjA2Bj15FIBx11dG7-JJOV1t_Nwg','12345','fixture-maintainer','local',4102444800,4102444800);
CREATE TRIGGER test_admin_audit_failure BEFORE INSERT ON admin_audit_log
  WHEN NEW.reason='Fixture audit rejected'
BEGIN
  SELECT RAISE(ABORT, 'test audit insert rejected');
END;
