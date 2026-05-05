-- Add WordPress CPT post ID column to geteducated_schools.
--
-- Per Tony Huffman's feedback (2026-05-04 Slack via Josh): school links in
-- published articles must use the school ID parameter, not the URL slug, so
-- WordPress can render them as monetized school cards instead of plain links:
--
--   incorrect: [su_ge-cta type="link" cta-copy="Emporia State University"
--              url="/online-schools/emporia-state-university/"]Emporia State University[/su_ge-cta]
--
--   correct:   [su_ge-cta type="link" cta-copy="Emporia State University"
--              school="3031"]Emporia State University[/su_ge-cta]
--
-- The IDs are WordPress post IDs of the "schools_and_degrees" CPT, sourced
-- from Tony's school spreadsheet. The CPT is NOT exposed via the public WP
-- REST API, so we cannot resolve them at runtime — they have to be loaded
-- into this column ahead of time.

ALTER TABLE geteducated_schools
  ADD COLUMN IF NOT EXISTS wordpress_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_geteducated_schools_wordpress_id
  ON geteducated_schools(wordpress_id)
  WHERE wordpress_id IS NOT NULL;

COMMENT ON COLUMN geteducated_schools.wordpress_id IS
  'WordPress CPT post ID for [su_ge-cta school="N"] shortcodes. Populate from Tony Huffman''s school IDs spreadsheet — not available via REST API.';
