-- Apply after 0007_promotions.sql. Adds multiple independent ad slots per page.
ALTER TABLE promotions ADD COLUMN slot TEXT NOT NULL DEFAULT 'primary';
CREATE INDEX IF NOT EXISTS idx_promotions_slot ON promotions(placement,slot,status);
INSERT OR IGNORE INTO promotions (id,placement,slot,eyebrow,headline,description,cta_text,target_url,theme,status,rotation_seconds) VALUES
('agenticagi-strip','home','strip','DOMAIN FOR SALE','agenticagi.si','A name for your next AI venture.','Explore domain','https://agenticagi.si','violet','active',7),
('agentagi-strip','home','strip','DOMAIN FOR SALE','agentagi.si','A memorable name for an AI-first product.','Explore domain','https://agentagi.si','cyan','active',7),
('autonomousagents-strip','home','strip','COMING SOON','Something big is coming.','autonomousagents.in','Discover more','https://autonomousagents.in','emerald','active',7),
('creditcard-strip','home','strip','CREDIT CARD REVIEWS','Is your card really worth it?','Read reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active',7),
('agenticagi-inline','directory','inline','DOMAIN FOR SALE','agenticagi.si','A distinctive AI domain available for ownership.','Explore domain','https://agenticagi.si','violet','active',10),
('agentagi-inline','directory','inline','DOMAIN FOR SALE','agentagi.si','Short. Memorable. AI-first.','Explore domain','https://agentagi.si','cyan','active',10),
('autonomousagents-inline','directory','inline','COMING SOON','autonomousagents.in','Something big is coming.','Discover more','https://autonomousagents.in','emerald','active',10),
('creditcard-inline','directory','inline','CREDIT CARD REVIEWS','Review your next card.','Explore ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active',10),
('agenticagi-sidebar','detail','sidebar','DOMAIN FOR SALE','agenticagi.si','A domain for the next wave of agentic AI.','Explore domain','https://agenticagi.si','violet','active',8),
('agentagi-sidebar','detail','sidebar','DOMAIN FOR SALE','agentagi.si','A memorable AI domain.','Explore domain','https://agentagi.si','cyan','active',8),
('autonomousagents-sidebar','detail','sidebar','COMING SOON','autonomousagents.in','Something big is coming.','Discover more','https://autonomousagents.in','emerald','active',8),
('creditcard-sidebar','detail','sidebar','CREDIT CARD REVIEWS','Is your card worth keeping?','Read reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active',8),
('agenticagi-bottom','detail','bottom','DOMAIN FOR SALE','agenticagi.si','An AI domain available for ownership.','Explore domain','https://agenticagi.si','violet','active',10),
('agentagi-bottom','detail','bottom','DOMAIN FOR SALE','agentagi.si','A memorable name for your AI venture.','Explore domain','https://agentagi.si','cyan','active',10),
('autonomousagents-bottom','detail','bottom','COMING SOON','Something big is coming.','autonomousagents.in','Discover more','https://autonomousagents.in','emerald','active',10),
('creditcard-bottom','detail','bottom','CREDIT CARD REVIEWS','Is your credit card worth keeping?','Read reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active',10);
