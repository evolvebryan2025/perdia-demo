-- Align system_settings key names with quality score consumers.
--
-- The seed migration (20250101000002_seed_settings.sql) uses
--   target_word_count_min / target_word_count_max
-- but qualityScoreService.js reads
--   min_word_count / max_word_count / min_faq_count
-- The mismatch silently dropped values into the 800/2500/3 fallbacks.
--
-- We add the canonical keys (and FAQ minimum from the xlsx spec) without
-- removing the legacy keys, so anything still reading them keeps working.

INSERT INTO system_settings (key, value, category, description)
VALUES
  ('min_word_count', '1500', 'seo', 'Minimum word count enforced at publish (xlsx row 2)'),
  ('max_word_count', '2500', 'seo', 'Maximum word count for quality scoring (xlsx row 3)'),
  ('min_internal_links', '3', 'seo', 'Minimum GetEducated internal links (xlsx row 13, blocking)'),
  ('min_external_links', '1', 'seo', 'Minimum BLS/gov external citations (xlsx row 17)'),
  ('min_heading_count', '3', 'seo', 'Minimum total H2 + H3 headings (xlsx row 7)'),
  ('min_faq_count', '3', 'seo', 'Minimum FAQ items (xlsx rows 10-12, blocking)')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description;
