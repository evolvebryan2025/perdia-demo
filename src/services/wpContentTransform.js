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
 * shortcode. The full last names "Warner" and "Derrow" come from the
 * Disruptors shortcode spec — internally the DB still uses first names only.
 */
const AUTHOR_SLUGS = {
  'Tony Huffman': 'tony-huffman',
  'Kayleigh Gilbert': 'kayleigh-gilbert',
  'Sara': 'sara-warner',
  'Charity': 'charity-derrow',
  'Sara Warner': 'sara-warner',
  'Charity Derrow': 'charity-derrow',
}

/**
 * @param {string} authorName
 * @returns {string|null} Contributor slug for the shortcode, or null if unknown.
 */
export function getContributorSlug(authorName) {
  if (!authorName) return null
  return AUTHOR_SLUGS[authorName] || null
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
 * Convert every <a href="..."> tag in HTML to a [su_ge-cta type="link"] shortcode.
 * Internal links use the relative path; external links carry target="blank".
 *
 * Anchor text may contain inline HTML (e.g. <strong>); we preserve it as the
 * inner text but use a plain-text version for the cta-copy attribute (which
 * cannot contain markup).
 *
 * Existing [su_ge-cta] shortcodes already in the content are left untouched.
 */
export function convertLinksToShortcodes(html) {
  if (!html) return html

  const linkRegex = /<a\s+([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi

  return html.replace(linkRegex, (match, _attrsBefore, url, _attrsAfter, anchorText) => {
    const innerText = anchorText
    const ctaCopy = anchorText.replace(/<[^>]+>/g, '').replace(/"/g, '&quot;').trim()

    if (!ctaCopy) return match

    if (isInternalUrl(url)) {
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

export function buildAuthorTopShortcode(authorName) {
  const slug = getContributorSlug(authorName)
  if (!slug) return ''
  return `[su_ge-article-contributors position="top" written-by="${slug}" expert-review-by="0" edited-by="0"][/su_ge-article-contributors]`
}

export function buildAuthorBottomShortcode(authorName, sources = []) {
  const slug = getContributorSlug(authorName)
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
 * @returns {{ content: string, slug: string, authorSlug: string|null, sources: string[] }}
 */
export function transformContentForPublish(article) {
  const authorName = article.contributor_name || article.article_contributors?.name || ''
  const authorSlug = getContributorSlug(authorName)

  let content = convertLinksToShortcodes(article.content || '')

  const sources = extractExternalSources(article.content || '')

  const topShortcode = buildAuthorTopShortcode(authorName)
  const hasTopAlready = /\[su_ge-article-contributors[^\]]*position=["']top["']/i.test(content)
  if (topShortcode && !hasTopAlready) {
    content = `${topShortcode}\n\n${content}`
  }

  const bottomShortcode = buildAuthorBottomShortcode(authorName, sources)
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
