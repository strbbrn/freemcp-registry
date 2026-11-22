-- First-party, text-only FreeMCP promotions. Apply to preview before production.
CREATE TABLE IF NOT EXISTS promotions (
 id TEXT PRIMARY KEY,
 placement TEXT NOT NULL CHECK(placement IN ('home','directory','detail')),
 eyebrow TEXT NOT NULL DEFAULT 'PROMOTED',
 headline TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 cta_text TEXT NOT NULL DEFAULT 'Learn more',
 target_url TEXT NOT NULL,
 theme TEXT NOT NULL DEFAULT 'violet' CHECK(theme IN ('violet','cyan','emerald','amber')),
 weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 20),
 rotation_seconds INTEGER NOT NULL DEFAULT 7 CHECK(rotation_seconds BETWEEN 5 AND 30),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')),
 starts_at TEXT,
 ends_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(placement,status,starts_at,ends_at);
INSERT OR IGNORE INTO promotions (id,placement,eyebrow,headline,description,cta_text,target_url,theme,status) VALUES
('agenticagi-home','home','DOMAIN FOR SALE','agenticagi.si','A distinctive domain for the next wave of agentic AI.','Explore domain','https://agenticagi.si','violet','active'),
('agentagi-home','home','DOMAIN FOR SALE','agentagi.si','Short. Memorable. Ready for an AI-first future.','Explore domain','https://agentagi.si','cyan','active'),
('autonomousagents-home','home','COMING SOON','Something big is coming.','autonomousagents.in — the next chapter in autonomous AI.','Discover more','https://autonomousagents.in','emerald','active'),
('creditcard-home','home','CREDIT CARD REVIEWS','Is your credit card really worth it?','Explore credit card reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active'),
('agenticagi-directory','directory','DOMAIN FOR SALE','agenticagi.si','A distinctive domain for the next wave of agentic AI.','Explore domain','https://agenticagi.si','violet','active'),
('agentagi-directory','directory','DOMAIN FOR SALE','agentagi.si','Short. Memorable. Ready for an AI-first future.','Explore domain','https://agentagi.si','cyan','active'),
('autonomousagents-directory','directory','COMING SOON','Something big is coming.','autonomousagents.in — the next chapter in autonomous AI.','Discover more','https://autonomousagents.in','emerald','active'),
('creditcard-directory','directory','CREDIT CARD REVIEWS','Is your credit card really worth it?','Explore credit card reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active'),
('agenticagi-detail','detail','DOMAIN FOR SALE','agenticagi.si','A distinctive domain for the next wave of agentic AI.','Explore domain','https://agenticagi.si','violet','active'),
('agentagi-detail','detail','DOMAIN FOR SALE','agentagi.si','Short. Memorable. Ready for an AI-first future.','Explore domain','https://agentagi.si','cyan','active'),
('autonomousagents-detail','detail','COMING SOON','Something big is coming.','autonomousagents.in — the next chapter in autonomous AI.','Discover more','https://autonomousagents.in','emerald','active'),
('creditcard-detail','detail','CREDIT CARD REVIEWS','Is your credit card really worth it?','Explore credit card reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active');
