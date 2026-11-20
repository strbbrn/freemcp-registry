CREATE TABLE IF NOT EXISTS servers (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 category TEXT NOT NULL,
 author TEXT NOT NULL,
 tags_json TEXT NOT NULL DEFAULT '[]',
 github_url TEXT NOT NULL,
 stars INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_servers_name ON servers(name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_servers_category_name ON servers(category, name COLLATE NOCASE, id);
CREATE VIRTUAL TABLE IF NOT EXISTS servers_search USING fts5(id UNINDEXED, name, description, category, author, tags, tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS servers_ai AFTER INSERT ON servers BEGIN
 INSERT INTO servers_search(rowid,id,name,description,category,author,tags) VALUES(new.rowid,new.id,new.name,new.description,new.category,new.author,new.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS servers_ad AFTER DELETE ON servers BEGIN
 DELETE FROM servers_search WHERE rowid=old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS servers_au AFTER UPDATE ON servers BEGIN
 DELETE FROM servers_search WHERE rowid=old.rowid;
 INSERT INTO servers_search(rowid,id,name,description,category,author,tags) VALUES(new.rowid,new.id,new.name,new.description,new.category,new.author,new.tags_json);
END;