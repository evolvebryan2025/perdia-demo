/**
 * Publishing Service for GetEducated
 * Handles publishing articles via WordPress REST API or webhook fallback
 *
 * Primary: Direct WordPress REST API with Application Password auth
 * Fallback: POST to n8n webhook (legacy)
 *
 * IMPORTANT: This service enforces pre-publish validation including:
 * - Monetization shortcode requirements
 * - Unknown shortcode blocking
 * - Author authorization
 * - Link compliance
 */

import { supabase } from './supabaseClient'
import { validateForPublish, validateForPublishAsync } from './validation/prePublishValidation'
import { AUTHOR_DISPLAY_NAMES } from '../hooks/useContributors'
import WordPressClient, { WORDPRESS_CONTRIBUTOR_IDS } from './wordpressClient'

// Webhook endpoints for n8n WordPress publishing
// Use environment variables with fallback to development URL
const WEBHOOK_URL_STAGING = import.meta.env.VITE_N8N_PUBLISH_WEBHOOK_STAGING ||
  'https://willdisrupt.app.n8n.cloud/webhook-test/144c3e6f-63e7-4bca-b029-0a470f2e3f79'
const WEBHOOK_URL_PRODUCTION = import.meta.env.VITE_N8N_PUBLISH_WEBHOOK_PRODUCTION || WEBHOOK_URL_STAGING

// Default to staging for safety
const DEFAULT_ENVIRONMENT = 'staging'

// Rate limiting configuration (per Dec 18, 2025 meeting with Justin)
// "Put throttling in there, maybe like 5 every minute"
const PUBLISH_RATE_LIMIT = {
  maxPerMinute: 5,
  delayBetweenMs: 12000,  // 12 seconds between publishes
}

// Track publish rate
let lastPublishTime = 0
let publishCountThisMinute = 0
let minuteStartTime = Date.now()

/**
 * Get the webhook URL for the specified environment
 * @param {string} environment - 'staging' or 'production'
 * @returns {string} Webhook URL
 */
export function getWebhookUrl(environment = DEFAULT_ENVIRONMENT) {
  return environment === 'production' ? WEBHOOK_URL_PRODUCTION : WEBHOOK_URL_STAGING
}

/**
 * Apply rate limiting before publishing
 * Ensures max 5 publishes per minute with 12-second minimum delay
 * @returns {Promise<void>}
 */
async function applyRateLimiting() {
  const now = Date.now()

  // Reset counter every minute
  if (now - minuteStartTime >= 60000) {
    publishCountThisMinute = 0
    minuteStartTime = now
  }

  // Check rate limit
  if (publishCountThisMinute >= PUBLISH_RATE_LIMIT.maxPerMinute) {
    const waitTime = 60000 - (now - minuteStartTime)
    console.log(`[PublishService] Rate limit reached (${PUBLISH_RATE_LIMIT.maxPerMinute}/min), waiting ${Math.round(waitTime / 1000)}s`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
    publishCountThisMinute = 0
    minuteStartTime = Date.now()
  }

  // Ensure minimum delay between publishes
  const timeSinceLastPublish = now - lastPublishTime
  if (lastPublishTime > 0 && timeSinceLastPublish < PUBLISH_RATE_LIMIT.delayBetweenMs) {
    const delay = PUBLISH_RATE_LIMIT.delayBetweenMs - timeSinceLastPublish
    console.log(`[PublishService] Throttling: waiting ${Math.round(delay / 1000)}s before next publish`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  // Update tracking
  lastPublishTime = Date.now()
  publishCountThisMinute++
}

/**
 * Publish an article via WordPress REST API (preferred method)
 * @param {Object} article - The article to publish
 * @param {Object} options - Publishing options
 * @returns {Object} Result with success status and details
 */
export async function publishToWordPress(article, options = {}) {
  const {
    status = 'draft',
    validateFirst = true,
    updateDatabase = true,
    environment = DEFAULT_ENVIRONMENT,
    requireMonetization = true,
    blockUnknownShortcodes = true,
    useAsyncValidation = true,
  } = options

  // Run pre-publish validation
  if (validateFirst) {
    const validationOptions = {
      requireMonetization,
      blockUnknownShortcodes,
    }

    const validation = useAsyncValidation
      ? await validateForPublishAsync(article, validationOptions)
      : validateForPublish(article, validationOptions)

    if (!validation.canPublish) {
      return {
        success: false,
        error: 'Validation failed',
        blockingIssues: validation.blockingIssues,
        validation,
        environment,
        method: 'wordpress',
      }
    }
  }

  // Apply rate limiting
  await applyRateLimiting()

  try {
    // Create WordPress client for the target environment
    const wpClient = new WordPressClient({ environment })

    // Publish via WordPress REST API
    console.log(`[PublishService] Publishing to WordPress (${environment}): ${article.title}`)

    const result = await wpClient.createPost(article, {
      status: status === 'publish' ? 'publish' : 'draft',
    })

    // Update article in database
    if (updateDatabase && result.success) {
      const updateData = {
        status: 'published',
        published_at: new Date().toISOString(),
        wordpress_post_id: result.post_id,
        published_url: result.url,
      }

      const { error: updateError } = await supabase
        .from('articles')
        .update(updateData)
        .eq('id', article.id)

      if (updateError) {
        console.error('Failed to update article status:', updateError)
      }

      // Sync to catalog for internal linking
      if (result.url) {
        await syncToGetEducatedCatalog(article, result.url)
      }
    }

    return {
      success: true,
      method: 'wordpress',
      articleId: article.id,
      postId: result.post_id,
      url: result.url,
      contributorId: result.contributor_id,
      contributorName: result.contributor_name,
      publishedAt: new Date().toISOString(),
      environment,
    }

  } catch (error) {
    console.error('[PublishService] WordPress publishing error:', error)
    return {
      success: false,
      method: 'wordpress',
      error: error.message,
      articleId: article.id,
      environment,
    }
  }
}

/**
 * Publish an article via webhook (legacy fallback)
 * @param {Object} article - The article to publish
 * @param {Object} options - Publishing options
 * @returns {Object} Result with success status and details
 */
export async function publishArticle(article, options = {}) {
  const {
    status = 'draft', // 'draft' or 'publish'
    validateFirst = true,
    updateDatabase = true,
    environment = DEFAULT_ENVIRONMENT, // 'staging' or 'production'
    requireMonetization = true,        // Enforce monetization shortcodes
    blockUnknownShortcodes = true,     // Block unknown/hallucinated shortcodes
    useAsyncValidation = true,         // Use database-backed validation
  } = options

  // Run pre-publish validation (async for full DB validation)
  if (validateFirst) {
    const validationOptions = {
      requireMonetization,
      blockUnknownShortcodes,
    }

    const validation = useAsyncValidation
      ? await validateForPublishAsync(article, validationOptions)
      : validateForPublish(article, validationOptions)

    if (!validation.canPublish) {
      return {
        success: false,
        error: 'Validation failed',
        blockingIssues: validation.blockingIssues,
        validation,
        environment,
      }
    }
  }

  // Prepare payload for webhook
  const payload = buildWebhookPayload(article, status, environment)

  // Get the appropriate webhook URL
  const webhookUrl = getWebhookUrl(environment)

  console.log(`[PublishService] Publishing to ${environment}: ${webhookUrl}`)

  // Apply rate limiting before publishing
  await applyRateLimiting()

  try {
    // POST to webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Webhook error: ${response.status} - ${errorText}`)
    }

    // Parse response (may contain WordPress post ID)
    let webhookResponse = {}
    try {
      webhookResponse = await response.json()
    } catch {
      // Response might not be JSON
      webhookResponse = { raw: await response.text() }
    }

    // Update article status in database
    if (updateDatabase) {
      const updateData = {
        status: 'published',
        published_at: new Date().toISOString(),
      }

      // Store WordPress post ID if returned
      if (webhookResponse.post_id || webhookResponse.wordpress_post_id) {
        updateData.wordpress_post_id = webhookResponse.post_id || webhookResponse.wordpress_post_id
      }

      if (webhookResponse.url || webhookResponse.published_url) {
        updateData.published_url = webhookResponse.url || webhookResponse.published_url
      }

      const { error: updateError } = await supabase
        .from('articles')
        .update(updateData)
        .eq('id', article.id)

      if (updateError) {
        console.error('Failed to update article status:', updateError)
        // Don't fail the whole operation, just log it
      }

      // Sync to GetEducated site catalog for internal linking
      const publishedUrl = webhookResponse.url || webhookResponse.published_url
      if (publishedUrl) {
        await syncToGetEducatedCatalog(article, publishedUrl)
      }
    }

    return {
      success: true,
      articleId: article.id,
      webhookResponse,
      publishedAt: new Date().toISOString(),
    }

  } catch (error) {
    console.error('Publishing error:', error)
    return {
      success: false,
      error: error.message,
      articleId: article.id,
    }
  }
}

/**
 * Build the webhook payload from an article
 * @param {Object} article - The article object
 * @param {string} status - 'draft' or 'publish'
 * @param {string} environment - 'staging' or 'production'
 * @returns {Object} Webhook payload
 */
export function buildWebhookPayload(article, status = 'draft', environment = DEFAULT_ENVIRONMENT) {
  const authorName = article.contributor_name || article.article_contributors?.name
  const displayName = AUTHOR_DISPLAY_NAMES[authorName] || authorName

  // Get WordPress Article Contributor CPT ID for wp_postmeta mapping
  const wordpressContributorId = article.article_contributors?.wordpress_contributor_id || null
  const contributorPageUrl = article.article_contributors?.contributor_page_url || null

  return {
    // Article identification
    article_id: article.id,

    // Content
    title: article.title,
    content: article.content,
    excerpt: article.excerpt || generateExcerpt(article.content),

    // Author info (legacy fields for backwards compatibility)
    author: authorName,
    author_display_name: displayName,

    // WordPress Article Contributor CPT mapping
    // These map to wp_postmeta keys for GetEducated's custom author system
    // See: https://stage.geteducated.com/wp-admin/edit.php?post_type=article_contributor
    written_by: wordpressContributorId,        // Primary author - wp_postmeta.meta_key
    edited_by: null,                            // Editor - set if different from author
    expert_review_by: null,                     // Expert reviewer - for EEAT signals
    contributor_page_url: contributorPageUrl,   // Public profile URL

    // SEO metadata
    meta_title: article.meta_title || article.title,
    meta_description: article.meta_description || article.excerpt,
    focus_keyword: article.focus_keyword,
    slug: article.slug || generateSlug(article.title),

    // Structured data
    faqs: article.faqs || [],

    // Publishing settings
    status: status,
    environment: environment,
    published_at: new Date().toISOString(),

    // Quality metrics (for reference)
    quality_score: article.quality_score,
    risk_level: article.risk_level,
    word_count: article.word_count,
  }
}

/**
 * Generate an excerpt from content
 * @param {string} content - HTML content
 * @param {number} maxLength - Maximum excerpt length
 * @returns {string} Plain text excerpt
 */
function generateExcerpt(content, maxLength = 160) {
  if (!content) return ''

  // Strip HTML tags
  const plainText = content.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (plainText.length <= maxLength) return plainText

  // Cut at word boundary
  const truncated = plainText.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return truncated.substring(0, lastSpace) + '...'
}

/**
 * Generate a URL-safe slug from title
 * @param {string} title - Article title
 * @returns {string} URL slug
 */
function generateSlug(title) {
  if (!title) return ''

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100)
}

/**
 * Bulk publish multiple articles with built-in throttling
 * @param {Array} articles - Array of articles to publish
 * @param {Object} options - Publishing options
 * @returns {Object} Results summary
 */
export async function bulkPublish(articles, options = {}) {
  const results = {
    total: articles.length,
    successful: 0,
    failed: 0,
    results: [],
    startTime: Date.now(),
  }

  console.log(`[PublishService] Starting bulk publish of ${articles.length} articles (rate limit: ${PUBLISH_RATE_LIMIT.maxPerMinute}/min)`)

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]
    console.log(`[PublishService] Publishing ${i + 1}/${articles.length}: ${article.title?.substring(0, 50)}...`)

    // Rate limiting is handled inside publishArticle via applyRateLimiting()
    const result = await publishArticle(article, options)
    results.results.push(result)

    if (result.success) {
      results.successful++
    } else {
      results.failed++
    }
  }

  results.endTime = Date.now()
  results.durationMs = results.endTime - results.startTime
  results.avgTimePerArticle = results.durationMs / results.total

  console.log(`[PublishService] Bulk publish complete: ${results.successful}/${results.total} successful in ${Math.round(results.durationMs / 1000)}s`)

  return results
}

/**
 * Throttled publish with explicit rate control
 * Use this for manual publishing to ensure rate limits are respected
 * @param {Object} article - Article to publish
 * @param {Object} options - Publishing options
 * @returns {Object} Publish result
 */
export async function throttledPublish(article, options = {}) {
  // This is now the same as publishArticle since rate limiting is built in
  return publishArticle(article, options)
}

/**
 * Check if an article is eligible for publishing
 * @param {Object} article - Article to check
 * @returns {Object} Eligibility result
 */
export function checkPublishEligibility(article) {
  const validation = validateForPublish(article)

  return {
    eligible: validation.canPublish,
    riskLevel: validation.riskLevel,
    qualityScore: validation.qualityScore,
    blockingIssues: validation.blockingIssues,
    warnings: validation.warnings,
    checks: validation.checks,
  }
}

/**
 * Retry a failed publish
 * @param {string} articleId - Article ID to retry
 * @param {Object} options - Publishing options
 * @returns {Object} Result
 */
export async function retryPublish(articleId, options = {}) {
  // Fetch the article fresh from database
  const { data: article, error } = await supabase
    .from('articles')
    .select('*, article_contributors(*)')
    .eq('id', articleId)
    .single()

  if (error) {
    return {
      success: false,
      error: `Failed to fetch article: ${error.message}`,
    }
  }

  return publishArticle(article, options)
}

/**
 * Sync published article to GetEducated site catalog
 * This adds the article to the geteducated_articles table for internal linking
 * @param {Object} article - The article that was published
 * @param {string} publishedUrl - The URL where the article was published
 */
async function syncToGetEducatedCatalog(article, publishedUrl) {
  try {
    // Strip HTML for text content
    const textContent = (article.content || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const wordCount = textContent.split(' ').filter(w => w.length > 0).length

    // Generate slug from URL
    const slug = publishedUrl
      .replace('https://www.geteducated.com/', '')
      .replace(/\/$/, '')

    // Determine content type, degree level, subject area from article metadata or title
    const title = (article.title || '').toLowerCase()
    let contentType = 'guide'
    let degreeLevel = null
    let subjectArea = null

    // Content type detection
    if (title.includes('ranking') || title.includes('best') || title.includes('top') || title.includes('cheapest')) {
      contentType = 'ranking'
    } else if (title.includes('career') || title.includes('job') || title.includes('salary')) {
      contentType = 'career'
    } else if (title.includes('how to')) {
      contentType = 'how_to'
    }

    // Degree level detection
    if (title.includes('doctorate') || title.includes('phd') || title.includes('dnp') || title.includes('edd')) {
      degreeLevel = 'doctorate'
    } else if (title.includes('master') || title.includes('mba') || title.includes('msn')) {
      degreeLevel = 'masters'
    } else if (title.includes('bachelor') || title.includes('bsn')) {
      degreeLevel = 'bachelors'
    } else if (title.includes('associate')) {
      degreeLevel = 'associate'
    }

    // Subject area detection
    const subjectMap = {
      nursing: ['nursing', 'nurse', 'bsn', 'msn', 'dnp', 'rn'],
      business: ['business', 'mba', 'management', 'accounting', 'finance', 'marketing'],
      education: ['education', 'teaching', 'teacher', 'med', 'edd'],
      technology: ['technology', 'computer', 'cybersecurity', 'data science', 'software'],
      healthcare: ['healthcare', 'health', 'medical', 'public health'],
      psychology: ['psychology', 'counseling', 'mental health'],
      social_work: ['social work', 'msw'],
    }

    for (const [subject, keywords] of Object.entries(subjectMap)) {
      if (keywords.some(kw => title.includes(kw))) {
        subjectArea = subject
        break
      }
    }

    // Extract topics from focus keyword and title
    const topics = []
    if (article.focus_keyword) {
      topics.push(article.focus_keyword)
    }
    if (degreeLevel) topics.push(degreeLevel)
    if (subjectArea) topics.push(subjectArea.replace('_', ' '))

    // Upsert to GetEducated catalog
    const { error } = await supabase
      .from('geteducated_articles')
      .upsert({
        url: publishedUrl,
        slug,
        title: article.title,
        meta_description: article.meta_description || article.excerpt,
        excerpt: article.excerpt || textContent.substring(0, 300),
        content_html: article.content,
        content_text: textContent,
        word_count: wordCount,
        content_type: contentType,
        degree_level: degreeLevel,
        subject_area: subjectArea,
        topics: topics.length > 0 ? topics : null,
        primary_topic: topics[0] || null,
        author_name: article.contributor_name || null,
        published_at: new Date().toISOString(),
        scraped_at: new Date().toISOString(),
        needs_rewrite: false,
        times_linked_to: 0,
      }, { onConflict: 'url' })

    if (error) {
      console.error('[PublishService] Failed to sync to GetEducated catalog:', error.message)
    } else {
      console.log('[PublishService] Article synced to GetEducated catalog:', publishedUrl)
    }
  } catch (error) {
    // Non-blocking - log but don't fail the publish
    console.error('[PublishService] Error syncing to GetEducated catalog:', error)
  }
}

/**
 * Smart publish - tries WordPress REST API first, falls back to webhook
 * @param {Object} article - The article to publish
 * @param {Object} options - Publishing options
 * @returns {Object} Result with success status and details
 */
export async function publish(article, options = {}) {
  const { preferWebhook = false, ...rest } = options

  // Check if WordPress credentials are configured
  const hasWpCredentials = import.meta.env.VITE_WP_USERNAME && import.meta.env.VITE_WP_APP_PASSWORD

  if (hasWpCredentials && !preferWebhook) {
    // Try WordPress first
    const wpResult = await publishToWordPress(article, rest)
    if (wpResult.success) {
      return wpResult
    }

    // Fall back to webhook on failure
    console.warn('[PublishService] WordPress failed, falling back to webhook:', wpResult.error)
  }

  // Use webhook (legacy or fallback)
  return publishArticle(article, rest)
}

/**
 * Test WordPress connection
 * @param {string} environment - 'staging' or 'production'
 * @returns {Object} Connection test result
 */
export async function testWordPressConnection(environment = 'staging') {
  const wpClient = new WordPressClient({ environment })
  return wpClient.testConnection()
}

/**
 * Get WordPress contributor ID for an author
 * @param {string} authorName - Author name or alias
 * @param {string} environment - 'staging' or 'production'
 * @returns {number|null} WordPress CPT ID
 */
export function getWordPressContributorId(authorName, environment = 'staging') {
  const ids = WORDPRESS_CONTRIBUTOR_IDS[environment] || WORDPRESS_CONTRIBUTOR_IDS.staging
  const displayName = AUTHOR_DISPLAY_NAMES[authorName] || authorName
  return ids[displayName] || ids[authorName] || null
}

export default {
  // Primary publishing methods
  publish,
  publishToWordPress,
  publishArticle,  // webhook-based (legacy)
  // Utilities
  buildWebhookPayload,
  bulkPublish,
  throttledPublish,
  checkPublishEligibility,
  retryPublish,
  syncToGetEducatedCatalog,
  getWebhookUrl,
  // WordPress helpers
  testWordPressConnection,
  getWordPressContributorId,
  // Environment constants
  WEBHOOK_URL_STAGING,
  WEBHOOK_URL_PRODUCTION,
  DEFAULT_ENVIRONMENT,
  // Rate limiting config (exposed for testing/monitoring)
  PUBLISH_RATE_LIMIT,
}
