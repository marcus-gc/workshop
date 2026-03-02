import db from "./client.js";

function addColumnIfMissing(table: string, column: string, definition: string) {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      repo_url      TEXT NOT NULL,
      branch        TEXT DEFAULT 'main',
      github_token  TEXT,
      setup_cmd     TEXT,
      ports         TEXT DEFAULT '[]',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS craftsmen (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      project_id      TEXT NOT NULL REFERENCES projects(id),
      container_id    TEXT,
      status          TEXT DEFAULT 'pending',
      error_message   TEXT,
      session_id      TEXT,
      ports           TEXT DEFAULT NULL,
      port_mappings   TEXT DEFAULT '{}',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_craftsmen_status ON craftsmen(status);
  `);

  // Backfill columns added after initial schema
  addColumnIfMissing("projects", "ports", "TEXT DEFAULT '[]'");
  addColumnIfMissing("craftsmen", "ports", "TEXT DEFAULT NULL");
  addColumnIfMissing("craftsmen", "port_mappings", "TEXT DEFAULT '{}'");
}
