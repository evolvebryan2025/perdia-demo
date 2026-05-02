-- Remove stage.geteducated.com URLs from the geteducated_articles catalog.
--
-- Per Josh's feedback (Loom recording 2026-05-02): the SiteCatalog UI was
-- pulling articles from both stage and production sitemaps, so internal
-- linking suggestions and the catalog browser surfaced staging URLs. Only
-- www.geteducated.com content should appear.
--
-- The stage rows were imported during early scraping runs against the
-- staging sitemap. They're not load-bearing — the production crawler at
-- src/services/sitemapService.js already targets www exclusively, so this
-- one-time cleanup is sufficient.

DELETE FROM geteducated_articles
WHERE url LIKE 'https://stage.geteducated.com/%'
   OR url LIKE 'http://stage.geteducated.com/%'
   OR url ILIKE '%stage-geteducated.com%';
