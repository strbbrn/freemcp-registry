-- Optional structured details; absent details use the generic installation fallback.
ALTER TABLE servers ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';
