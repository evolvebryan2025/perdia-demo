/**
 * Sitemap Service for GetEducated
 *
 * Fetches and parses the GetEducated sitemap to:
 * 1. Populate the site catalog with ALL URLs including /online-degrees/
 * 2. Detect sponsored schools via page crawling
 * 3. Track lastmod dates for freshness
 *
 * CRITICAL: The sitemap is the source of truth for all URL whitelisting.
 * Per Dec 18, 2025 meeting with Justin.
 */

import { supabase } from './supabaseClient'

// Use Vercel proxy rewrites to avoid CORS issues in production
const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')

// GetEducated sitemap URL
const SITEMAP_URL = isVercel ? '/api/wp-prod/sitemap.xml' : 'https://www.geteducated.com/sitemap.xml'

// Sitemap index may contain multiple sitemaps
const SITEMAP_INDEX_URLS = isVercel
  ? [
      '/api/wp-prod/sitemap.xml',
      '/api/wp-prod/page-sitemap.xml',
      '/api/wp-prod/post-sitemap.xml',
    ]
  : [
      'https://www.geteducated.com/sitemap.xml',
      'https://www.geteducated.com/page-sitemap.xml',
      'https://www.geteducated.com/post-sitemap.xml',
    ]

// URL patterns to include (priority order)
// CRITICAL: Must include ALL content types per Dec 2025 meeting
const INCLUDE_PATTERNS = [
  '/online-degrees/',           // School directory - HIGHEST PRIORITY
  '/online-college-ratings-and-rankings/', // Ranking reports
  '/resources/',                // Resource articles
  '/blog/',                     // Blog posts
  '/online-schools/',           // School pages
  '/careers/',                  // Career guides
  '/article-contributors/',     // Contributor/author pages (BERT pages)
  '/degree-',                   // Degree type pages (e.g., /degree-programs/)
  '/category/',                 // Category archive pages
  '/accreditation/',            // Accreditation info pages
  '/subject/',                  // Subject area pages
  '/best-',                     // Best-of listicle pages
  '/how-to-',                   // How-to guides
  '/what-is-',                  // Explainer pages
  '/guide/',                    // Guide pages
  '/financial-aid/',            // Financial aid resources
  '/scholarships/',             // Scholarship pages
]

// URL patterns to exclude
const EXCLUDE_PATTERNS = [
  '/wp-content/',
  '/wp-admin/',
  '/cart/',
  '/checkout/',
  '/my-account/',
  '/tag/',
  '/page/',                     // Pagination pages like /page/2/
  '/feed/',                     // RSS feeds
  '/attachment/',               // Media attachments
]

/**
 * Parse a sitemap XML string into an array of URL entries
 * @param {string} xml - Sitemap XML content
 * @returns {Array} Array of {loc, lastmod, changefreq, priority}
 */
export function parseSitemap(xml) {
  const urls = []

  // Match all <url> entries
  const urlMatches = xml.matchAll(/<url>([\s\S]*?)<\/url>/g)

  for (const match of urlMatches) {
    const urlBlock = match[1]

    // Extract fields
    const locMatch = urlBlock.match(/<loc>(.*?)<\/loc>/)
    const lastmodMatch = urlBlock.match(/<lastmod>(.*?)<\/lastmod>/)
    const changefreqMatch = urlBlock.match(/<changefreq>(.*?)<\/changefreq>/)
    const priorityMatch = urlBlock.match(/<priority>(.*?)<\/priority>/)

    if (locMatch) {
      urls.push({
        loc: locMatch[1].trim(),
        lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
        changefreq: changefreqMatch ? changefreqMatch[1].trim() : null,
        priority: priorityMatch ? parseFloat(priorityMatch[1]) : null,
      })
    }
  }

  // Also check for sitemap index entries
  const sitemapMatches = xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)
  for (const match of sitemapMatches) {
    const sitemapBlock = match[1]
    const locMatch = sitemapBlock.match(/<loc>(.*?)<\/loc>/)
    if (locMatch) {
      urls.push({
        loc: locMatch[1].trim(),
        isSitemapIndex: true,
      })
    }
  }

  return urls
}

/**
 * Fetch sitemap content from a URL
 * @param {string} url - Sitemap URL
 * @returns {string} XML content
 */
async function fetchSitemap(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.status}`)
    }
    return await response.text()
  } catch (error) {
    console.error(`[SitemapService] Error fetching ${url}:`, error)
    throw error
  }
}

/**
 * Check if a URL should be included in the catalog
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function shouldIncludeUrl(url) {
  // Check exclusions first
  if (EXCLUDE_PATTERNS.some(pattern => url.includes(pattern))) {
    return false
  }

  // Check inclusions
  return INCLUDE_PATTERNS.some(pattern => url.includes(pattern))
}

/**
 * Categorize a URL based on its pattern
 * @param {string} url - URL to categorize
 * @returns {Object} Category info
 */
export function categorizeUrl(url) {
  const urlPath = new URL(url).pathname

  // Online degrees directory
  if (urlPath.includes('/online-degrees/')) {
    const parts = urlPath.split('/').filter(Boolean)
    // /online-degrees/category/concentration/level
    return {
      content_type: 'degree_directory',
      category: parts[1] || null,
      concentration: parts[2] || null,
      level: parts[3] || null,
      is_monetizable: true, // Degree directory is monetizable
    }
  }

  // Ranking reports
  if (urlPath.includes('/online-college-ratings-and-rankings/')) {
    return {
      content_type: 'ranking',
      is_monetizable: true,
    }
  }

  // School pages
  if (urlPath.includes('/online-schools/')) {
    return {
      content_type: 'school_page',
      is_monetizable: true,
    }
  }

  // Contributor/author pages (BERT pages)
  if (urlPath.includes('/article-contributors/')) {
    return {
      content_type: 'contributor',
      is_monetizable: false,
    }
  }

  // Category archive pages
  if (urlPath.includes('/category/')) {
    return {
      content_type: 'category',
      is_monetizable: false,
    }
  }

  // Subject area pages
  if (urlPath.includes('/subject/')) {
    return {
      content_type: 'subject',
      is_monetizable: true,
    }
  }

  // Accreditation pages
  if (urlPath.includes('/accreditation/')) {
    return {
      content_type: 'accreditation',
      is_monetizable: false,
    }
  }

  // Career guides
  if (urlPath.includes('/careers/')) {
    return {
      content_type: 'career',
      is_monetizable: false,
    }
  }

  // Blog posts
  if (urlPath.includes('/blog/')) {
    return {
      content_type: 'blog',
      is_monetizable: false,
    }
  }

  // Resources
  if (urlPath.includes('/resources/')) {
    return {
      content_type: 'resource',
      is_monetizable: false,
    }
  }

  // Financial aid and scholarships
  if (urlPath.includes('/financial-aid/') || urlPath.includes('/scholarships/')) {
    return {
      content_type: 'financial_aid',
      is_monetizable: false,
    }
  }

  // Best-of listicles
  if (urlPath.includes('/best-')) {
    return {
      content_type: 'listicle',
      is_monetizable: true,
    }
  }

  // How-to guides
  if (urlPath.includes('/how-to-')) {
    return {
      content_type: 'how_to',
      is_monetizable: false,
    }
  }

  // What-is explainers
  if (urlPath.includes('/what-is-')) {
    return {
      content_type: 'explainer',
      is_monetizable: false,
    }
  }

  // Guide pages
  if (urlPath.includes('/guide/')) {
    return {
      content_type: 'guide',
      is_monetizable: false,
    }
  }

  // Degree type pages
  if (urlPath.includes('/degree-')) {
    return {
      content_type: 'degree_type',
      is_monetizable: true,
    }
  }

  return {
    content_type: 'page',
    is_monetizable: false,
  }
}

/**
 * Detect if a page has sponsored school listings
 * @param {string} html - Page HTML content
 * @returns {Object} Sponsorship data
 */
export function detectSponsoredContent(html) {
  const result = {
    hasLogo: false,
    schoolPriority: null,
    isSponsored: false,
    sponsoredCount: 0,
  }

  // Check for school logos (non-placeholder)
  const hasLogoClass = html.includes('class="school-logo"') ||
                       html.includes('class="sponsor-logo"') ||
                       html.includes('school-logo-wrapper')
  const isPlaceholder = html.includes('placeholder-logo') ||
                        html.includes('no-logo')

  result.hasLogo = hasLogoClass && !isPlaceholder

  // Try to extract priority from LD+JSON
  const ldJsonMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
  for (const match of ldJsonMatches) {
    try {
      const data = JSON.parse(match[1])
      if (data.schoolPriority) {
        result.schoolPriority = parseInt(data.schoolPriority)
      }
      if (data.isSponsored || data.sponsor) {
        result.isSponsored = true
      }
    } catch (e) {
      // Invalid JSON, continue
    }
  }

  // Count school cards/logos
  const logoMatches = html.match(/class="school-logo"/g)
  if (logoMatches) {
    result.sponsoredCount = logoMatches.length
  }

  // Final sponsorship determination
  result.isSponsored = result.hasLogo ||
                       (result.schoolPriority !== null && result.schoolPriority >= 5)

  return result
}

/**
 * Sync the site catalog from the sitemap
 * @param {Object} options - Sync options
 * @returns {Object} Sync results
 */
export async function syncFromSitemap(options = {}) {
  const {
    fetchPageContent = false, // Whether to crawl pages for sponsor detection
    maxPages = 5000,          // Maximum pages to process
    onProgress = null,        // Progress callback
  } = options

  const results = {
    total: 0,
    synced: 0,
    skipped: 0,
    errors: [],
    byType: {},
    timestamp: new Date().toISOString(),
  }

  try {
    console.log('[SitemapService] Starting sitemap sync...')

    // Fetch main sitemap
    const sitemapXml = await fetchSitemap(SITEMAP_URL)
    let urls = parseSitemap(sitemapXml)

    // Check for sitemap index (contains links to other sitemaps)
    const sitemapIndexUrls = urls.filter(u => u.isSitemapIndex)
    if (sitemapIndexUrls.length > 0) {
      console.log(`[SitemapService] Found ${sitemapIndexUrls.length} child sitemaps`)

      for (const sitemap of sitemapIndexUrls) {
        try {
          const childXml = await fetchSitemap(sitemap.loc)
          const childUrls = parseSitemap(childXml)
          urls = urls.concat(childUrls.filter(u => !u.isSitemapIndex))
        } catch (e) {
          results.errors.push(`Failed to fetch ${sitemap.loc}: ${e.message}`)
        }
      }
    }

    // Filter to relevant URLs
    const relevantUrls = urls
      .filter(u => !u.isSitemapIndex && shouldIncludeUrl(u.loc))
      .slice(0, maxPages)

    results.total = relevantUrls.length
    console.log(`[SitemapService] Processing ${results.total} relevant URLs`)

    // Process in batches
    const batchSize = 50
    for (let i = 0; i < relevantUrls.length; i += batchSize) {
      const batch = relevantUrls.slice(i, i + batchSize)

      const entries = batch.map(url => {
        const category = categorizeUrl(url.loc)
        const slug = url.loc.replace('https://www.geteducated.com/', '').replace(/\/$/, '')

        return {
          url: url.loc,
          slug: slug,
          title: generateTitleFromSlug(slug),
          content_type: category.content_type,
          lastmod: url.lastmod ? new Date(url.lastmod).toISOString() : null,
          sitemap_priority: url.priority,
          is_from_sitemap: true,
          last_sitemap_sync: new Date().toISOString(),
          // Store category info
          degree_level: category.level,
          subject_area: category.category,
          scraped_at: new Date().toISOString(),
        }
      })

      // Upsert batch
      const { error } = await supabase
        .from('geteducated_articles')
        .upsert(entries, {
          onConflict: 'url',
          ignoreDuplicates: false,
        })

      if (error) {
        results.errors.push(`Batch ${i / batchSize}: ${error.message}`)
        results.skipped += batch.length
      } else {
        results.synced += batch.length

        // Count by type
        for (const entry of entries) {
          results.byType[entry.content_type] = (results.byType[entry.content_type] || 0) + 1
        }
      }

      // Progress callback
      if (onProgress) {
        onProgress({
          processed: Math.min(i + batchSize, relevantUrls.length),
          total: relevantUrls.length,
          synced: results.synced,
        })
      }

      // Small delay between batches
      await new Promise(r => setTimeout(r, 100))
    }

    console.log(`[SitemapService] Sync complete. Synced ${results.synced} URLs.`)

  } catch (error) {
    console.error('[SitemapService] Sync failed:', error)
    results.errors.push(error.message)
  }

  return results
}

/**
 * Generate a title from a URL slug
 * @param {string} slug - URL slug
 * @returns {string} Title
 */
function generateTitleFromSlug(slug) {
  // Remove common prefixes
  let title = slug
    .replace(/^online-degrees\//, '')
    .replace(/^online-schools\//, '')
    .replace(/^resources\//, '')
    .replace(/^blog\//, '')
    .replace(/^careers\//, '')

  // Convert dashes to spaces and title case
  title = title
    .split('/')
    .filter(Boolean)
    .map(part =>
      part
        .replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    )
    .join(' - ')

  return title || slug
}

/**
 * Get catalog statistics
 * @returns {Object} Statistics
 */
export async function getCatalogStats() {
  const { data: stats, error } = await supabase
    .from('geteducated_articles')
    .select('content_type, is_sponsored', { count: 'exact' })

  if (error) {
    console.error('[SitemapService] Failed to get stats:', error)
    return null
  }

  const byType = {}
  const sponsoredByType = {}

  for (const row of stats || []) {
    byType[row.content_type] = (byType[row.content_type] || 0) + 1
    if (row.is_sponsored) {
      sponsoredByType[row.content_type] = (sponsoredByType[row.content_type] || 0) + 1
    }
  }

  return {
    total: stats?.length || 0,
    byType,
    sponsoredByType,
    lastSync: new Date().toISOString(),
  }
}

/**
 * Mark stale entries not in the current sitemap
 * @param {Array<string>} currentUrls - URLs from current sitemap
 */
export async function markStaleEntries(currentUrls) {
  const urlSet = new Set(currentUrls)

  // Get all existing URLs
  const { data: existing, error } = await supabase
    .from('geteducated_articles')
    .select('url')
    .eq('is_from_sitemap', true)

  if (error || !existing) {
    console.error('[SitemapService] Failed to fetch existing URLs:', error)
    return
  }

  // Find URLs not in current sitemap
  const staleUrls = existing
    .filter(e => !urlSet.has(e.url))
    .map(e => e.url)

  if (staleUrls.length > 0) {
    console.log(`[SitemapService] Marking ${staleUrls.length} stale entries`)

    // Mark as stale (don't delete, just flag)
    const { error: updateError } = await supabase
      .from('geteducated_articles')
      .update({ is_stale: true })
      .in('url', staleUrls)

    if (updateError) {
      console.error('[SitemapService] Failed to mark stale entries:', updateError)
    }
  }
}

/**
 * Get relevant articles for a topic, preferring fresh content
 * @param {string} topic - Topic to search for
 * @param {Object} options - Search options
 * @returns {Array} Relevant articles
 */
export async function getRelevantArticles(topic, options = {}) {
  const {
    limit = 10,
    preferSponsored = true,
    maxAgeDays = 365,
  } = options

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays)

  let query = supabase
    .from('geteducated_articles')
    .select('*')
    .or(`title.ilike.%${topic}%,primary_topic.ilike.%${topic}%`)
    .gte('lastmod', cutoffDate.toISOString())
    .order('lastmod', { ascending: false })

  if (preferSponsored) {
    query = query.order('is_sponsored', { ascending: false })
  }

  const { data, error } = await query.limit(limit)

  if (error) {
    console.error('[SitemapService] Search failed:', error)
    return []
  }

  return data || []
}

export default {
  parseSitemap,
  shouldIncludeUrl,
  categorizeUrl,
  detectSponsoredContent,
  syncFromSitemap,
  getCatalogStats,
  markStaleEntries,
  getRelevantArticles,
  SITEMAP_URL,
  INCLUDE_PATTERNS,
}
