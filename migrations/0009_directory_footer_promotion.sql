-- Apply after 0008_promotion_slots.sql. Independent directory promotion below the site footer.
INSERT OR IGNORE INTO promotions (id,placement,slot,eyebrow,headline,description,cta_text,target_url,theme,status,rotation_seconds) VALUES
('agenticagi-directory-footer','directory','footer','DOMAIN FOR SALE','agenticagi.si','A name for the next wave of agentic AI.','Explore domain','https://agenticagi.si','violet','active',10),
('agentagi-directory-footer','directory','footer','DOMAIN FOR SALE','agentagi.si','A memorable home for your next AI product.','Explore domain','https://agentagi.si','cyan','active',10),
('autonomousagents-directory-footer','directory','footer','COMING SOON','autonomousagents.in','Something big is coming in autonomous AI.','Discover more','https://autonomousagents.in','emerald','active',10),
('creditcard-directory-footer','directory','footer','CREDIT CARD REVIEWS','Make your next card decision count.','Explore reviews at ltf.creditcard.','Visit now','https://ltf.creditcard','amber','active',10);
