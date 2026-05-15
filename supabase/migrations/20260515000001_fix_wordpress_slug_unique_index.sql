-- Fix the unique index added in 20260515000000_add_wordpress_fields_to_article_contributors.sql
--
-- The original index was created with a partial predicate
-- (WHERE wordpress_slug IS NOT NULL). Partial unique indexes cannot satisfy
-- Postgres ON CONFLICT specifications — the sync endpoint's upsert call to
-- /rest/v1/article_contributors?on_conflict=wordpress_slug returns:
--
--   42P10: there is no unique or exclusion constraint matching the
--   ON CONFLICT specification
--
-- Drop the partial form and rebuild as a regular unique index. Postgres
-- still allows multiple NULL values in a unique index by default, so this
-- doesn't constrain pre-sync rows that haven't been linked to a WP CPT yet.

DROP INDEX IF EXISTS idx_article_contributors_wp_slug;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_contributors_wp_slug
  ON article_contributors(wordpress_slug);
