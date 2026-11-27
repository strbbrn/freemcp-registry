-- Campaign identity is administrative metadata. Public queries do not use it.
ALTER TABLE promotions ADD COLUMN campaign_id TEXT;

-- Explicit catalog IDs from migrations 0007–0009. Their copy differs by slot.
WITH seeds(campaign) AS (VALUES ('agenticagi'),('agentagi'),('autonomousagents'),('creditcard')),
     slots(suffix) AS (VALUES ('home'),('directory'),('detail'),('strip'),('inline'),('sidebar'),('bottom'),('directory-footer'))
UPDATE promotions
SET campaign_id='catalog:'||(SELECT campaign FROM seeds CROSS JOIN slots WHERE promotions.id=campaign||'-'||suffix)
WHERE id IN (SELECT campaign||'-'||suffix FROM seeds CROSS JOIN slots);

-- Reviewed preview UAT cohort. Its three original creation events are 22–24
-- in preview. Require the full trio and matching original creation metadata.
WITH uat(id) AS (VALUES ('preview-test-promo-home-primary'),('preview-test-promo-directory-primary'),('preview-test-promo-detail-primary')),
     confirmed AS (
       SELECT a.actor,a.created_at,a.reason
       FROM admin_audit_log a JOIN uat ON uat.id=a.entity_id
       WHERE a.entity='promotion' AND a.action='create'
       GROUP BY a.actor,a.created_at,a.reason HAVING count(DISTINCT a.entity_id)=3
     )
UPDATE promotions SET campaign_id='uat:preview-test-promo'
WHERE id IN (SELECT id FROM uat) AND EXISTS (SELECT 1 FROM confirmed)
  AND (SELECT count(*) FROM promotions WHERE id IN (SELECT id FROM uat))=3;

-- No reliable campaign provenance for these older rows.
UPDATE promotions SET campaign_id='legacy:'||id WHERE campaign_id IS NULL;
CREATE INDEX admin_promotions_campaign ON promotions(campaign_id,id);

CREATE TRIGGER admin_promotions_campaign_immutable
BEFORE UPDATE OF campaign_id ON promotions WHEN OLD.campaign_id IS NOT NULL AND NEW.campaign_id IS NOT OLD.campaign_id
BEGIN
  SELECT RAISE(ABORT,'Campaign identity is immutable');
END;

-- Older code can still insert placements after a code rollback.
CREATE TRIGGER admin_promotions_campaign_legacy_insert
AFTER INSERT ON promotions WHEN NEW.campaign_id IS NULL
BEGIN
  UPDATE promotions SET campaign_id='legacy:'||NEW.id WHERE id=NEW.id;
END;
