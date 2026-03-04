import db from "./client.js";

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
      port_mappings   TEXT DEFAULT '{}',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_craftsmen_status ON craftsmen(status);
  `);

  try {
    db.exec(`ALTER TABLE craftsmen ADD COLUMN task TEXT`);
  } catch {
    // Column already exists
  }
}
