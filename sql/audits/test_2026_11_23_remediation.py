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
                  "grafana-mcp": 127, "aws-kb-mcp": 3, "postgres-mcp": 9}
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
targets = set(re.findall(r"WHERE id = '([^']+)'", sql))
assert len(targets) == 17 and targets.issubset(IDS), targets
for stmt in updates:
    conn.execute(stmt)
conn.commit()
assert conn.execute("SELECT COUNT(*) FROM servers").fetchone()[0] == 32
assert conn.execute("SELECT COUNT(*) FROM servers WHERE json_valid(details_json)=0").fetchone()[0] == 0
for sid in IDS:
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
print("PASS: 20 statements executed in-memory, 17 targets, 32 records, valid JSON and structured installations")
