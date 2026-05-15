-- Add WordPress linkage fields to article_contributors so we can sync the
-- WP-side contributor CPT data (id, slug, bio) into our DB and use it to
-- power smart author attribution at generation time.
--
-- Per J Day's /disruptors/v1/data endpoint (verified 2026-05-15), every
-- contributor on GE's WP has:
--   - id            → WP CPT post_id (used for [su_ge-article-contributors written-by] and the
--                                     written_by postmeta value)
--   - post_name     → URL slug (e.g. "tony-huffman")
--   - post_title    → display name
--   - post_content  → bio HTML (stored as "bio" in existing schema)
--   - url           → contributor page path
--
-- These columns let api/sync-geteducated-data.js keep contributors fresh
-- daily from the WP source of truth.

ALTER TABLE article_contributors
  ADD COLUMN IF NOT EXISTS wordpress_id INTEGER,
  ADD COLUMN IF NOT EXISTS wordpress_slug TEXT,
  ADD COLUMN IF NOT EXISTS wordpress_url TEXT,
  ADD COLUMN IF NOT EXISTS wp_last_synced_at TIMESTAMP WITH TIME ZONE;

-- Unique index on wordpress_slug so we can upsert from /data without
-- introducing duplicate contributor rows. NULLs allowed since older rows
-- and our internal style-proxy entries may not have a corresponding WP CPT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_article_contributors_wp_slug
  ON article_contributors(wordpress_slug)
  WHERE wordpress_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_article_contributors_wp_id
  ON article_contributors(wordpress_id)
  WHERE wordpress_id IS NOT NULL;

COMMENT ON COLUMN article_contributors.wordpress_id IS
  'WP CPT post_id from /disruptors/v1/data — used in [su_ge-article-contributors] shortcode and written_by postmeta.';
COMMENT ON COLUMN article_contributors.wordpress_slug IS
  'WP CPT post_name (URL slug) — what the shortcode written-by attribute references.';
COMMENT ON COLUMN article_contributors.wp_last_synced_at IS
  'Last successful refresh from /disruptors/v1/data. NULL means never synced.';
