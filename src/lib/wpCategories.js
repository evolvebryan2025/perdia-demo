/**
 * WordPress secondary-category resolution.
 *
 * Tony's May 19 review: published articles only had the primary "articles"
 * category assigned. WordPress needs a secondary, topic-specific category
 * (e.g. "nursing", "business", "online-degrees") for site navigation and
 * related-content suggestions.
 *
 * This module maps article topic keywords to WordPress category slugs. The
 * WP plugin / n8n webhook receiver is expected to resolve slugs to numeric
 * IDs server-side, so we don't need the real IDs hardcoded here.
 *
 * TODO (when Justin provides them): replace `slug` fields below with
 * numeric WordPress term IDs and update buildWebhookPayload to send
 * `category_ids` alongside `category_slugs`.
 */

// Always include this category on every published article.
export const PRIMARY_CATEGORY_SLUG = 'articles'

// Topic keyword -> WP category slug. First match wins. Keep the
// most-specific terms at the top of the list.
const TOPIC_TO_CATEGORY = [
  { keywords: ['cybersecurity', 'cyber security', 'cyber-security', 'information security', 'infosec'], slug: 'cybersecurity' },
  { keywords: ['nursing', 'nurse practitioner', 'msn', 'bsn', 'dnp'], slug: 'nursing' },
  { keywords: ['healthcare', 'health care', 'public health', 'healthcare administration'], slug: 'healthcare' },
  { keywords: ['psychology', 'mental health', 'counseling'], slug: 'psychology' },
  { keywords: ['social work', 'msw', 'human services'], slug: 'social-work' },
  { keywords: ['mba', 'business administration', 'business management'], slug: 'business' },
  { keywords: ['accounting', 'cpa', 'forensic accounting'], slug: 'business' },
  { keywords: ['finance', 'financial management'], slug: 'business' },
  { keywords: ['marketing', 'digital marketing'], slug: 'business' },
  { keywords: ['data science', 'data analytics', 'analytics'], slug: 'data-science' },
  { keywords: ['computer science', 'software engineering', 'programming'], slug: 'computer-science' },
  { keywords: ['information technology', 'it management', 'network administration'], slug: 'technology' },
  { keywords: ['engineering', 'mechanical engineering', 'electrical engineering'], slug: 'engineering' },
  { keywords: ['education', 'teaching', 'teacher', 'curriculum', 'instructional design'], slug: 'education' },
  { keywords: ['criminal justice', 'law enforcement', 'criminology'], slug: 'criminal-justice' },
  { keywords: ['paralegal', 'legal studies'], slug: 'law' },
  { keywords: ['public administration', 'mpa'], slug: 'public-administration' },
  { keywords: ['communication', 'journalism', 'public relations'], slug: 'communications' },
]

/**
 * Pick the best-fit secondary WordPress category slug for an article.
 * @param {Object} article - { title, focus_keyword, content, ... }
 * @returns {string|null} category slug or null if no match
 */
export function pickSecondaryCategorySlug(article) {
  if (!article) return null
  const haystack = [
    article.title || '',
    article.focus_keyword || '',
    article.meta_title || '',
    // First ~500 chars of content for topical signal without scanning the
    // entire body
    (article.content || '').replace(/<[^>]*>/g, ' ').slice(0, 500),
  ]
    .join(' ')
    .toLowerCase()

  for (const entry of TOPIC_TO_CATEGORY) {
    if (entry.keywords.some((kw) => haystack.includes(kw))) {
      return entry.slug
    }
  }
  return null
}

/**
 * Build the full categories array for the webhook payload.
 * @returns {{slugs: string[], primary: string, secondary: string|null}}
 */
export function buildCategoriesForArticle(article) {
  const secondary = pickSecondaryCategorySlug(article)
  const slugs = secondary && secondary !== PRIMARY_CATEGORY_SLUG
    ? [PRIMARY_CATEGORY_SLUG, secondary]
    : [PRIMARY_CATEGORY_SLUG]
  return { slugs, primary: PRIMARY_CATEGORY_SLUG, secondary }
}
