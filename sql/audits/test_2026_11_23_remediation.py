#!/usr/bin/env python3
"""In-memory SQLite JSON1 regression test for the proposed D1 migration.

This checks SQL execution and resulting JSON structure using synthetic fixtures.
It is NOT an upstream MCP runtime test or a production database clone.
"""
import json
import re
import sqlite3
from pathlib import Path

SQL = Path(__file__).with_name("2026-11-23-listing-remediation.sql")
IDS = ["aws-kb-mcp","brave-search-mcp","browserbase-mcp","cloudflare-mcp","context7-mcp","docker-mcp","fetch-mcp","filesystem-mcp","firecrawl-mcp","github-mcp","gitlab-mcp","google-maps-mcp","grafana-mcp","linear-mcp","memory-mcp","mgm-falcon-quelllm-mcp","mongodb-mcp","neon-mcp","nmap-mcp","notion-mcp","playwright-mcp","postgres-mcp","puppeteer-mcp","redis-mcp","remotify-mcp","semgrep-mcp","sentry-mcp","sequential-thinking-mcp","shodan-mcp","slack-mcp","sqlite-mcp","stripe-mcp"]
EXPECTED_TOOLS = {"filesystem-mcp": 15, "memory-mcp": 9, "playwright-mcp": 72,
                  "grafana-mcp": 127, "aws-bedrock-kb-retrieval-mcp": 3, "postgres-mcp-pro": 9}
conn = sqlite3.connect(":memory:")
conn.execute("""CREATE TABLE servers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
 category TEXT NOT NULL, author TEXT NOT NULL, tags_json TEXT NOT NULL,
 github_url TEXT NOT NULL, stars INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 details_json TEXT NOT NULL DEFAULT '{}')""")
for sid in IDS:
    details = {"tools": [{"name": "old_tool"}],
               "installations": [{"client": "Claude Desktop", "config": {"mcpServers": {"example": {"command": "npx", "args": []}}}}],
               "security": [], "prerequisites": [], "lifecycle": None}
    conn.execute("INSERT INTO servers(id,name,description,category,author,tags_json,github_url,details_json) VALUES (?,?,?,?,?,?,?,?)",
                 (sid,sid,"test","Utilities","test","[]","https://github.com/example/repo",json.dumps(details)))
conn.commit()
sql = SQL.read_text(encoding="utf-8")
statements = [line.strip().rstrip(";") for line in sql.splitlines() if line.strip()]
updates = [x for x in statements if x.startswith("UPDATE servers SET")]
assert len(updates) == 20, f"Expected 20 updates, got {len(updates)}"
backups = [x for x in statements if x.startswith("CREATE TABLE IF NOT EXISTS servers_backup_20261123")]
assert len(backups) == 1
conn.execute(backups[0])
assert conn.execute("SELECT COUNT(*) FROM servers_backup_20261123").fetchone()[0] == 15
targets = set(re.findall(r"WHERE id = '([^']+)'", sql))
assert len(targets) == 17 and targets.issubset(set(IDS) | {'aws-bedrock-kb-retrieval-mcp', 'postgres-mcp-pro'}), targets
inserts = [x for x in statements if x.startswith('INSERT INTO servers')]
assert len(inserts) == 2
for stmt in inserts:
    conn.execute(stmt)
for stmt in updates:
    conn.execute(stmt)
conn.commit()
assert conn.execute("SELECT COUNT(*) FROM servers").fetchone()[0] == 34
assert conn.execute("SELECT COUNT(*) FROM servers WHERE json_valid(details_json)=0").fetchone()[0] == 0
for sid in IDS + ['aws-bedrock-kb-retrieval-mcp', 'postgres-mcp-pro']:
    row = conn.execute("SELECT details_json FROM servers WHERE id=?", (sid,)).fetchone()
    assert row, sid
    obj = json.loads(row[0])
    assert isinstance(obj["tools"], list), sid
    assert isinstance(obj["installations"], list), sid
    assert isinstance(obj["security"], list), sid
    assert isinstance(obj["prerequisites"], list), sid
    names = [t.get("name") for t in obj["tools"]]
    assert len(names) == len(set(names)), f"Duplicate tool names in {sid}"
    if sid in EXPECTED_TOOLS:
        assert len(names) == EXPECTED_TOOLS[sid], (sid,len(names))
    if sid in targets:
        assert len(obj["installations"]) >= 1, sid
        for item in obj["installations"]:
            assert isinstance(item.get("config"), dict), sid
    if sid not in targets:
        assert names == ["old_tool"], f"Unexpected change to {sid}"
for archived_id in ("aws-kb-mcp", "postgres-mcp"):
    assert conn.execute("SELECT name FROM servers WHERE id=?", (archived_id,)).fetchone()[0] == archived_id
rollback_sql = Path(__file__).with_name("2026-11-23-rollback.sql").read_text(encoding="utf-8")
conn.executescript(rollback_sql)
assert conn.execute("SELECT COUNT(*) FROM servers s JOIN servers_backup_20261123 b ON b.id=s.id WHERE s.details_json=b.details_json AND s.name=b.name AND s.github_url=b.github_url AND s.updated_at=b.updated_at").fetchone()[0] == 15
assert conn.execute("SELECT COUNT(*) FROM servers").fetchone()[0] == 32
print("PASS: 20 updates executed in-memory, 15-row snapshot, 34 records before rollback, valid JSON, structured installations, full rollback")
