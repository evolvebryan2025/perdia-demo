-- Tony's May 19 content review flagged the bottom "How we researched and
-- created this article" block as removable ("can be removed if you want,
-- but not mission critical"). The block is emitted by
-- transformContentForPublish via buildAuthorBottomShortcode in
-- wpContentTransform.js. We gate it on a system_settings flag so it's
-- stripped by default but can be turned back on without a code change.

INSERT INTO system_settings (key, value, category, description)
VALUES (
  'include_research_block',
  'false',
  'publishing',
  'When true, append the [su_ge-article-contributors position="bottom"] block (How we researched...) to published articles. Default false per Tony 5/19/2026 review.'
)
ON CONFLICT (key) DO NOTHING;
