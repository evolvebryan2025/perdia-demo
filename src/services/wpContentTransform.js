/**
 * WordPress Publish-Time Content Transformer for GetEducated
 *
 * Applies GE-specific transformations to article HTML right before it's POSTed
 * to the WordPress REST API. Per the canonical Disruptors shortcode doc, every
 * published article must:
 *   1. Use [su_ge-cta type="link" ...] shortcodes for ALL hyperlinks (no raw <a>)
 *      — internal: relative URL, no target — external: full URL, target="blank"
 *   2. Open with [su_ge-article-contributors position="top" written-by="<slug>" ...]
 *   3. Close with [su_ge-article-contributors position="bottom" ...] wrapping a
 *      <strong>Sources:</strong> list of cited external URLs
 *   4. Append [su_ge-article-share-icons] at the very end
 *   5. Use the focus keyword (slugified) as the WordPress slug, not the full title
 *
 * Pure-JS module: no imports, safe to use from both the browser (publishService)
 * and Vercel serverless functions (api/publish-wp.js).
 */

const GE_HOST_REGEX = /^https?:\/\/(www\.)?geteducated\.com/i

/**
 * Maps internal contributor names (as stored in articles.contributor_name) to
 * the WordPress contributor URL slug used by the [su_ge-article-contributors]
 * shortcode.
 *
 * Production GetEducated has all 4 approved authors as contributor pages:
 *   tony-huffman, kayleigh-gilbert, sara-warner, charity-derrow
 *
 * Stage GetEducated only has 10 contributors and is MISSING sara-warner and
 * charity-derrow (confirmed via article_contributor-sitemap.xml on 2026-05-15).
 * Publishing to stage with those slugs renders a broken author shortcode in WP.
 *
 * Environment-aware fallbacks pick the closest stage-available equivalent so
 * stage QA still produces a valid author block. Per J Day (2026-05-15): "code
 * on whatever Article Contributors are at-hand since last sync".
 */
const AUTHOR_SLUGS_PROD = {
  'Tony Huffman': 'tony-huffman',
  'Kayleigh Gilbert': 'kayleigh-gilbert',
  'Sara': 'sara-warner',
  'Charity': 'charity-derrow',
  'Sara Warner': 'sara-warner',
  'Charity Derrow': 'charity-derrow',
}

const AUTHOR_SLUGS_STAGE = {
  'Tony Huffman': 'tony-huffman',
  'Kayleigh Gilbert': 'kayleigh-gilbert',
  // Stage substitutes: sara-warner and charity-derrow don't exist on stage.
  // Sara → Sarah Raines (closest name); Charity → Tony Huffman (no closer match,
  // and Tony is always present so the shortcode always renders).
  'Sara': 'sarah-raines',
  'Charity': 'tony-huffman',
  'Sara Warner': 'sarah-raines',
  'Charity Derrow': 'tony-huffman',
}

/**
 * Resolve which contributor-slug map to use based on the target WP host.
 * Defaults to production mapping when host is unknown.
 *
 * @param {string} [siteUrl] - The WordPress site URL the article publishes to.
 * @returns {Record<string, string>}
 */
function pickAuthorSlugMap(siteUrl) {
  if (siteUrl && /stage\.geteducated\.com/i.test(siteUrl)) {
    return AUTHOR_SLUGS_STAGE
  }
  return AUTHOR_SLUGS_PROD
}

/**
 * @param {string} authorName
 * @param {{ siteUrl?: string }} [options]
 * @returns {string|null} Contributor slug for the shortcode, or null if unknown.
 */
export function getContributorSlug(authorName, options = {}) {
  if (!authorName) return null
  const map = pickAuthorSlugMap(options.siteUrl)
  return map[authorName] || null
}

/**
 * Lowercase a-z 0-9 + hyphens. Strips trailing/leading hyphens.
 */
export function slugify(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isInternalUrl(url) {
  if (!url) return false
  if (url.startsWith('/')) return true
  if (url.startsWith('#')) return false
  if (url.startsWith('mailto:') || url.startsWith('tel:')) return false
  return GE_HOST_REGEX.test(url)
}

/**
 * Strip "https://www.geteducated.com" prefix and trailing "#" from a URL,
 * returning a relative path starting with "/". Per the shortcode spec:
 *   "remove 'www.geteducated.com' from the address and '#' at the end of the URL".
 */
function normalizeInternalUrl(url) {
  let cleaned = String(url || '').trim()
  cleaned = cleaned.replace(GE_HOST_REGEX, '')
  cleaned = cleaned.replace(/#+$/, '')
  if (!cleaned.startsWith('/')) cleaned = '/' + cleaned
  return cleaned
}

/**
 * If the URL is a /online-schools/<slug>/ page and the slug is in the
 * schoolIdBySlug map, return the WordPress school CPT ID. Used to emit the
 * monetized school-card variant of [su_ge-cta] instead of a plain URL link.
 *
 * Per Tony (2026-05-04): /online-schools/<slug> URLs MUST become
 * `school="<id>"` shortcodes so WordPress renders them as school cards.
 *
 * @param {string} url - URL or path
 * @param {Record<string, number>} [schoolIdBySlug] - slug → WP CPT ID map
 * @returns {number|null} School CPT ID, or null if no match
 */
function lookupSchoolId(url, schoolIdBySlug) {
  if (!schoolIdBySlug || !url) return null
  const path = normalizeInternalUrl(url)
  const match = path.match(/^\/online-schools\/([a-z0-9-]+)\/?$/i)
  if (!match) return null
  const slug = match[1].toLowerCase()
  const id = schoolIdBySlug[slug]
  return typeof id === 'number' && id > 0 ? id : null
}

/**
 * Convert every <a href="..."> tag in HTML to a [su_ge-cta type="link"] shortcode.
 * - Internal /online-schools/<slug>/ links emit `school="<id>"` when the slug is
 *   present in schoolIdBySlug; otherwise fall back to the url-based variant.
 * - Other internal links use the relative path; external links carry target="blank".
 *
 * Anchor text may contain inline HTML (e.g. <strong>); we preserve it as the
 * inner text but use a plain-text version for the cta-copy attribute (which
 * cannot contain markup).
 *
 * Existing [su_ge-cta] shortcodes already in the content are left untouched.
 *
 * @param {string} html
 * @param {{ schoolIdBySlug?: Record<string, number> }} [options]
 */
export function convertLinksToShortcodes(html, options = {}) {
  if (!html) return html

  const { schoolIdBySlug } = options
  const linkRegex = /<a\s+([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi

  return html.replace(linkRegex, (match, _attrsBefore, url, _attrsAfter, anchorText) => {
    const innerText = anchorText
    const ctaCopy = anchorText.replace(/<[^>]+>/g, '').replace(/"/g, '&quot;').trim()

    if (!ctaCopy) return match

    if (isInternalUrl(url)) {
      const schoolId = lookupSchoolId(url, schoolIdBySlug)
      if (schoolId) {
        return `[su_ge-cta type="link" cta-copy="${ctaCopy}" school="${schoolId}"]${innerText}[/su_ge-cta]`
      }
      const internalUrl = normalizeInternalUrl(url)
      return `[su_ge-cta type="link" cta-copy="${ctaCopy}" url="${internalUrl}"]${innerText}[/su_ge-cta]`
    }

    return `[su_ge-cta type="link" cta-copy="${ctaCopy}" url="${url}" target="blank"]${innerText}[/su_ge-cta]`
  })
}

/**
 * Pull a deduplicated list of external URLs cited in the content. Looks at
 * both raw <a href> tags AND existing [su_ge-cta target="blank"] shortcodes
 * so the function works correctly whether or not link-conversion has already
 * been applied.
 */
export function extractExternalSources(html) {
  if (!html) return []

  const sources = new Set()

  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi
  let m
  while ((m = linkRegex.exec(html)) !== null) {
    if (!isInternalUrl(m[1])) sources.add(m[1])
  }

  const ctaExternalRegex = /\[su_ge-cta[^\]]*?url=["']([^"']+)["'][^\]]*?target=["']blank["'][^\]]*\]/gi
  while ((m = ctaExternalRegex.exec(html)) !== null) {
    sources.add(m[1])
  }

  return [...sources]
}

/**
 * @param {string} authorName
 * @param {{ siteUrl?: string }} [options]
 */
export function buildAuthorTopShortcode(authorName, options = {}) {
  const slug = getContributorSlug(authorName, options)
  if (!slug) return ''
  return `[su_ge-article-contributors position="top" written-by="${slug}" expert-review-by="0" edited-by="0"][/su_ge-article-contributors]`
}

/**
 * @param {string} authorName
 * @param {string[]} [sources]
 * @param {{ siteUrl?: string }} [options]
 */
export function buildAuthorBottomShortcode(authorName, sources = [], options = {}) {
  const slug = getContributorSlug(authorName, options)
  if (!slug) return ''

  const sourcesBlock = sources.length > 0
    ? `\n<strong>Sources:</strong>\n<ul>\n${sources.map(s => `<li>${s}</li>`).join('\n')}\n</ul>\n`
    : ''

  return `[su_ge-article-contributors position="bottom" written-by="${slug}" expert-review-by="0" edited-by="0"]${sourcesBlock}[/su_ge-article-contributors]`
}

export function buildShareIconsShortcode() {
  return `[su_ge-article-share-icons][/su_ge-article-share-icons]`
}

/**
 * GetEducated WordPress CMS taxonomy + page IDs (resolved from
 * https://www.geteducated.com/wp-json/wp/v2/categories and /pages on 2026-04-28).
 * Hardcoded because the IDs are stable across stage and prod and rarely change.
 */
export const WP_CATEGORY_IDS = {
  uncategorized: 1,
  articles: 4,
  'ranking-reports': 5,
  'popular-posts': 7,
  careers: 8,
  'career-center': 9,
  'college-choices': 10,
  'college-savings': 11,
  'education-guides': 12,
}

export const WP_PARENT_PAGE_IDS = {
  'top-online-colleges': 26704,
  careers: 26156,
}

/**
 * Pick the secondary WP category for an article based on title + focus keyword.
 * Per the Disruptors shortcode doc, every article gets the "Articles" category
 * PLUS one more relevant category. Returns the additional category ID, or null
 * if no specific match (in which case only "Articles" is sent).
 *
 * @param {Object} article
 * @returns {number|null}
 */
export function pickSecondaryCategoryId(article) {
  const text = `${article.title || ''} ${article.focus_keyword || ''}`.toLowerCase()

  if (/\b(best|top|cheapest|most affordable|ranking|rankings)\b/.test(text)) {
    return WP_CATEGORY_IDS['ranking-reports']
  }
  if (/\b(career|careers|job|jobs|salary|employment|profession)\b/.test(text)) {
    return WP_CATEGORY_IDS['career-center']
  }
  if (/\b(cost|savings|tuition|cheap|affordab|financial aid|scholarship)\b/.test(text)) {
    return WP_CATEGORY_IDS['college-savings']
  }
  if (/\bvs\b|\bversus\b|\bcompar/.test(text)) {
    return WP_CATEGORY_IDS['college-choices']
  }
  if (/\b(what is|what are|guide|overview|introduction|how to|how do)\b/.test(text)) {
    return WP_CATEGORY_IDS['education-guides']
  }
  return null
}

/**
 * Pick the WP parent page ID for an article. Per the doc, only two options
 * should be used: "Top Online Colleges" (default) or "Careers" (career-focused).
 *
 * @param {Object} article
 * @returns {number}
 */
export function pickParentPageId(article) {
  const text = `${article.title || ''} ${article.focus_keyword || ''}`.toLowerCase()
  if (/\b(career|careers|job|jobs|salary|employment|profession)\b/.test(text)) {
    return WP_PARENT_PAGE_IDS.careers
  }
  return WP_PARENT_PAGE_IDS['top-online-colleges']
}

/**
 * Apply all GE publish-time transformations and return ready-to-POST values.
 *
 * Idempotent: if the content already starts with a position="top" contributor
 * shortcode (e.g. the article is being re-published), we don't double up.
 *
 * @param {Object} article
 * @param {string} article.content - Raw article HTML
 * @param {string} [article.contributor_name] - Public byline, e.g. "Tony Huffman"
 * @param {Object} [article.article_contributors] - Joined contributor row
 * @param {string} [article.focus_keyword] - SEO focus keyword (used as slug)
 * @param {string} [article.title] - Fallback for slug when focus_keyword missing
 * @param {string} [article.slug] - Pre-set slug (overrides focus_keyword)
 * @param {{ schoolIdBySlug?: Record<string, number>, siteUrl?: string }} [options]
 * @returns {{ content: string, slug: string, authorSlug: string|null, sources: string[] }}
 */
export function transformContentForPublish(article, options = {}) {
  const authorName = article.contributor_name || article.article_contributors?.name || ''
  const slugOpts = { siteUrl: options.siteUrl }
  const authorSlug = getContributorSlug(authorName, slugOpts)

  let content = convertLinksToShortcodes(article.content || '', { schoolIdBySlug: options.schoolIdBySlug })

  const sources = extractExternalSources(article.content || '')

  const topShortcode = buildAuthorTopShortcode(authorName, slugOpts)
  const hasTopAlready = /\[su_ge-article-contributors[^\]]*position=["']top["']/i.test(content)
  if (topShortcode && !hasTopAlready) {
    content = `${topShortcode}\n\n${content}`
  }

  const bottomShortcode = buildAuthorBottomShortcode(authorName, sources, slugOpts)
  const hasBottomAlready = /\[su_ge-article-contributors[^\]]*position=["']bottom["']/i.test(content)
  if (bottomShortcode && !hasBottomAlready) {
    content = `${content}\n\n${bottomShortcode}`
  }

  const hasShareAlready = /\[su_ge-article-share-icons/i.test(content)
  if (!hasShareAlready) {
    content = `${content}\n\n${buildShareIconsShortcode()}`
  }

  const slug = article.slug
    ? slugify(article.slug)
    : (article.focus_keyword ? slugify(article.focus_keyword) : slugify(article.title || ''))

  return { content, slug, authorSlug, sources }
}
