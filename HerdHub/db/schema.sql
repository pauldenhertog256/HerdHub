-- HerdHub SQLite Schema
-- Supports multiple species, shared tags, and user-specific herd customizations.
-- Designed for idempotent application (safe to run multiple times).

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('guest', 'user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS breeds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  species     TEXT NOT NULL DEFAULT 'cattle',
  name        TEXT NOT NULL,
  origin      TEXT,
  subspecies  TEXT,
  image_url   TEXT,
  wiki_url    TEXT,
  props       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS breed_tags (
  breed_id INTEGER NOT NULL REFERENCES breeds(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (breed_id, tag_id)
);

CREATE TABLE IF NOT EXISTS user_herds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  breed_id         INTEGER NOT NULL REFERENCES breeds(id) ON DELETE CASCADE,
  custom_name      TEXT,
  custom_image_url TEXT,
  custom_notes     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, breed_id)
);

CREATE TABLE IF NOT EXISTS user_herd_tags (
  user_herd_id INTEGER NOT NULL REFERENCES user_herds(id) ON DELETE CASCADE,
  tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (user_herd_id, tag_id)
);

-- Indexes for Common Queries
CREATE INDEX IF NOT EXISTS idx_breeds_species_name ON breeds(species, name);
CREATE INDEX IF NOT EXISTS idx_user_herds_user ON user_herds(user_id);
CREATE INDEX IF NOT EXISTS idx_breed_tags_breed ON breed_tags(breed_id);
CREATE INDEX IF NOT EXISTS idx_breed_tags_tag ON breed_tags(tag_id);
