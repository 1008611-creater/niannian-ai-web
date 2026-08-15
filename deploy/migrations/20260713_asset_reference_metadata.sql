-- Additive and rollback-compatible. The previous application ignores this
-- table, so code rollback must not drop it or restore an older database.
CREATE TABLE IF NOT EXISTS asset_reference_metadata (
  asset_id TEXT PRIMARY KEY REFERENCES uploaded_assets(id) ON DELETE CASCADE,
  reference_intent TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  chinese_duty TEXT NOT NULL,
  created_at TEXT NOT NULL
);
