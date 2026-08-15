-- Additive and reversible-by-state migration. Application rollback may leave
-- this table in place; unhide restores every library item without data copying.
CREATE TABLE IF NOT EXISTS asset_library_visibility (
  asset_id TEXT PRIMARY KEY REFERENCES uploaded_assets(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS asset_library_visibility_user_hidden
  ON asset_library_visibility(user_id, hidden, updated_at);
