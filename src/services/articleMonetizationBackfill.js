/**
 * Article Monetization Backfill Service
 *
 * Processes all existing articles to:
 * 1. Match topics to monetization categories
 * 2. Insert appropriate shortcodes if valid
 * 3. Mark as needs review if not compliant with new rules
 * 4. Add explanatory notes to articles that can't be auto-monetized
 *
 * Usage:
 *   import { runBackfill } from './articleMonetizationBackfill'
 *   const result = await runBackfill({ dryRun: true }) // Preview mode
 *   const result = await runBackfill({ dryRun: false }) // Execute
 */

import { supabase } from './supabaseClient'
import { MonetizationEngine, MonetizationValidator } from './monetizationEngine'
import {
  generateGePicksShortcode,
  generateQuickDegreeFindShortcode,
  insertShortcodeInContent,
  checkMonetizationCompliance,
  findLegacyShortcodes,
} from './shortcodeService'

// Status that indicates an article needs review
const NEEDS_REVIEW_STATUS = 'qa_review'

// Explanation note prepended to articles that couldn't be auto-monetized
const LEGACY_ARTICLE_NOTE = `
<div class="legacy-article-notice" style="background: #FEF3C7; border: 1px solid #F59E0B; padding: 16px; margin-bottom: 24px; border-radius: 8px;">
  <strong>⚠️ Pre-Monetization Article</strong>
  <p style="margin: 8px 0 0 0; font-size: 14px;">
    This article was generated before the current monetization and content rules were implemented.
    It requires manual review and updates to meet GetEducated publishing standards.
  </p>
</div>
`

/**
 * Backfill result structure
 */
const createResult = () => ({
  processed: 0,
  updated: 0,
  markedForReview: 0,
  skipped: 0,
  errors: [],
  details: [],
  startedAt: new Date().toISOString(),
  completedAt: null,
})

/**
 * Process a single article for monetization
 */
async function processArticle(article, engine, validator, dryRun = false) {
  const result = {
    id: article.id,
    title: article.title || article.seo_title,
    status: 'pending',
    action: null,
    reason: null,
    changes: [],
  }

  try {
    // Skip already published articles to avoid breaking live content
    if (article.status === 'published') {
      result.status = 'skipped'
      result.action = 'none'
      result.reason = 'Already published - manual review required'
      return result
    }

    // Check if article already has valid monetization
    const existingCompliance = checkMonetizationCompliance(article.content || '')
    if (existingCompliance.hasMonetization && existingCompliance.monetizationCount >= 1) {
      // Check for legacy shortcodes that need updating
      const legacyShortcodes = findLegacyShortcodes(article.content || '')
      if (legacyShortcodes.length === 0) {
        result.status = 'skipped'
        result.action = 'none'
        result.reason = 'Already has valid monetization shortcodes'
        return result
      } else {
        result.changes.push(`Found ${legacyShortcodes.length} legacy shortcode(s) needing migration`)
      }
    }

    // Try to match article topic to monetization category
    const topic = article.title || article.seo_title || ''
    const degreeLevel = extractDegreeLevelFromContent(article)

    const match = await engine.matchTopicToCategory(topic, degreeLevel)

    if (!match.matched) {
      // No matching category - mark for review
      result.status = 'marked_for_review'
      result.action = 'add_note'
      result.reason = `No matching monetization category found: ${match.error}`

      if (!dryRun) {
        await markArticleForReview(article, result.reason)
      }
      return result
    }

    // Validate against business rules
    const validation = await validator.validate({}, article.content || '')

    if (validation.blockingIssues.length > 0) {
      // Blocking issues found - mark for review
      result.status = 'marked_for_review'
      result.action = 'add_note'
      result.reason = `Business rule violations: ${validation.blockingIssues.map(i => i.message).join('; ')}`

      if (!dryRun) {
        await markArticleForReview(article, result.reason)
      }
      return result
    }

    // Check confidence level - low confidence needs manual review
    if (match.confidence === 'low') {
      result.status = 'marked_for_review'
      result.action = 'add_note'
      result.reason = `Low confidence category match (score: ${match.score}). Topic: "${topic}" matched to "${match.category.concentration}"`

      if (!dryRun) {
        await markArticleForReview(article, result.reason)
      }
      return result
    }

    // Generate monetization shortcode
    const ctaUrl = buildCtaUrlFromMatch(match)
    const shortcode = generateGePicksShortcode({
      category: match.categoryId,
      concentration: match.concentrationId,
      level: match.degreeLevelCode,
      header: "GetEducated's Picks",
      ctaButton: "View More Degrees",
      ctaUrl,
    })

    // Insert shortcode into content
    let updatedContent = article.content || ''

    // Add primary monetization after intro
    updatedContent = insertShortcodeInContent(updatedContent, shortcode, 'after_intro')

    // For longer articles, add QDF widget mid-content
    const wordCount = (updatedContent.match(/\S+/g) || []).length
    if (wordCount > 1500) {
      const qdfShortcode = generateQuickDegreeFindShortcode({
        type: 'simple',
        header: 'Find Your Degree',
      })
      updatedContent = insertShortcodeInContent(updatedContent, qdfShortcode, 'mid_content')
      result.changes.push('Added Quick Degree Find widget (long article)')
    }

    result.changes.push(`Added GE Picks shortcode (category=${match.categoryId}, concentration=${match.concentrationId})`)
    result.changes.push(`Matched topic to: ${match.category.category} > ${match.category.concentration}`)

    // Update article in database
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('articles')
        .update({
          content: updatedContent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', article.id)

      if (updateError) {
        throw updateError
      }

      // Create article_monetization record
      await createMonetizationRecord(article.id, match, shortcode)
    }

    result.status = 'updated'
    result.action = 'monetized'
    result.reason = `Successfully matched to ${match.category.concentration} (${match.confidence} confidence)`

    return result

  } catch (error) {
    result.status = 'error'
    result.action = 'none'
    result.reason = error.message
    return result
  }
}

/**
 * Extract degree level from article content/metadata
 */
function extractDegreeLevelFromContent(article) {
  const text = `${article.title || ''} ${article.seo_title || ''} ${article.content || ''}`.toLowerCase()

  // Check for degree level keywords
  if (text.includes('associate')) return 'Associate'
  if (text.includes("bachelor's") || text.includes('bachelor') || text.includes('baccalaureate')) return "Bachelor's"
  if (text.includes("master's") || text.includes('master') || text.includes('mba') || text.includes('msn')) return "Master's"
  if (text.includes('doctorate') || text.includes('doctoral') || text.includes('phd') || text.includes('dnp')) return 'Doctorate'
  if (text.includes('certificate') || text.includes('certification')) return 'Certificate'

  return null
}

/**
 * Build CTA URL from match result
 */
function buildCtaUrlFromMatch(match) {
  // Live GetEducated URL pattern: /online-degrees/{level OR all}/{category}/{concentration}/
  // The level segment is REQUIRED — when no specific level applies, use "all".
  const levelSlugs = {
    1: 'associate',
    2: 'bachelor',
    3: 'bachelor',
    4: 'master',
    5: 'doctorate',
    6: 'certificate',
  }
  const levelSlug = (match.degreeLevelCode && levelSlugs[match.degreeLevelCode]) || 'all'
  let url = `/online-degrees/${levelSlug}/`

  if (match.category) {
    const categorySlug = match.category.category?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || ''
    const concentrationSlug = match.category.concentration?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || ''
    if (categorySlug) url += `${categorySlug}/`
    if (concentrationSlug) url += `${concentrationSlug}/`
  }

  return url
}

/**
 * Mark article for review with explanatory note
 */
async function markArticleForReview(article, reason) {
  // Prepend legacy notice to content
  const updatedContent = LEGACY_ARTICLE_NOTE + (article.content || '')

  const { error } = await supabase
    .from('articles')
    .update({
      status: NEEDS_REVIEW_STATUS,
      content: updatedContent,
      risk_level: 'HIGH',
      updated_at: new Date().toISOString(),
      // Add note to quality_score_details
      quality_score_details: {
        ...(article.quality_score_details || {}),
        backfill_review_reason: reason,
        backfill_date: new Date().toISOString(),
        needs_manual_monetization: true,
      },
    })
    .eq('id', article.id)

  if (error) {
    throw error
  }
}

/**
 * Create article_monetization record
 */
async function createMonetizationRecord(articleId, match, shortcodeOutput) {
  // First, get the UUID of the monetization_category record
  const { data: category, error: catError } = await supabase
    .from('monetization_categories')
    .select('id')
    .eq('category_id', match.categoryId)
    .eq('concentration_id', match.concentrationId)
    .single()

  if (catError || !category) {
    console.warn(`[Backfill] Could not find category UUID for category_id=${match.categoryId}, concentration_id=${match.concentrationId}`)
    return
  }

  // Get the level UUID if we have a degree level code
  let levelId = null
  if (match.degreeLevelCode) {
    const { data: level } = await supabase
      .from('monetization_levels')
      .select('id')
      .eq('level_code', match.degreeLevelCode)
      .single()

    if (level) {
      levelId = level.id
    }
  }

  // Check if record already exists
  const { data: existing } = await supabase
    .from('article_monetization')
    .select('id')
    .eq('article_id', articleId)
    .single()

  if (existing) {
    // Update existing
    await supabase
      .from('article_monetization')
      .update({
        category_id: category.id,
        level_id: levelId,
        shortcode_output: shortcodeOutput,
      })
      .eq('id', existing.id)
  } else {
    // Insert new
    await supabase
      .from('article_monetization')
      .insert({
        article_id: articleId,
        category_id: category.id,
        level_id: levelId,
        position_in_article: 'after_intro',
        shortcode_output: shortcodeOutput,
      })
  }
}

/**
 * Main backfill function
 *
 * @param {Object} options - Backfill options
 * @param {boolean} options.dryRun - If true, only preview changes without applying
 * @param {number} options.limit - Max articles to process (default: all)
 * @param {string[]} options.statuses - Article statuses to include
 * @param {Function} options.onProgress - Progress callback (current, total, article)
 * @returns {Object} Backfill result summary
 */
export async function runBackfill(options = {}) {
  const {
    dryRun = true,
    limit = null,
    statuses = ['idea', 'drafting', 'refinement', 'qa_review', 'ready_to_publish'],
    onProgress = null,
  } = options

  const result = createResult()
  const engine = new MonetizationEngine()
  const validator = new MonetizationValidator()

  console.log(`[Backfill] Starting ${dryRun ? 'DRY RUN' : 'LIVE'} backfill...`)
  console.log(`[Backfill] Processing statuses: ${statuses.join(', ')}`)

  try {
    // Fetch all articles to process
    let query = supabase
      .from('articles')
      .select('*')
      .in('status', statuses)
      .order('created_at', { ascending: true })

    if (limit) {
      query = query.limit(limit)
    }

    const { data: articles, error } = await query

    if (error) {
      throw error
    }

    if (!articles || articles.length === 0) {
      console.log('[Backfill] No articles found to process')
      result.completedAt = new Date().toISOString()
      return result
    }

    console.log(`[Backfill] Found ${articles.length} articles to process`)

    // Process each article
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]

      if (onProgress) {
        onProgress(i + 1, articles.length, article)
      }

      console.log(`[Backfill] Processing ${i + 1}/${articles.length}: ${article.title || article.id}`)

      const articleResult = await processArticle(article, engine, validator, dryRun)
      result.details.push(articleResult)
      result.processed++

      switch (articleResult.status) {
        case 'updated':
          result.updated++
          break
        case 'marked_for_review':
          result.markedForReview++
          break
        case 'skipped':
          result.skipped++
          break
        case 'error':
          result.errors.push({
            articleId: article.id,
            title: article.title,
            error: articleResult.reason,
          })
          break
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }

  } catch (error) {
    console.error('[Backfill] Fatal error:', error)
    result.errors.push({
      articleId: null,
      title: 'Fatal error',
      error: error.message,
    })
  }

  result.completedAt = new Date().toISOString()

  // Summary
  console.log('\n[Backfill] ====== SUMMARY ======')
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes made)' : 'LIVE'}`)
  console.log(`Processed: ${result.processed}`)
  console.log(`Updated with monetization: ${result.updated}`)
  console.log(`Marked for review: ${result.markedForReview}`)
  console.log(`Skipped: ${result.skipped}`)
  console.log(`Errors: ${result.errors.length}`)
  console.log('================================\n')

  return result
}

/**
 * Get backfill status/preview without making changes
 */
export async function getBackfillPreview(options = {}) {
  return runBackfill({ ...options, dryRun: true })
}

/**
 * Run the actual backfill (makes changes)
 */
export async function executeBackfill(options = {}) {
  return runBackfill({ ...options, dryRun: false })
}

export default {
  runBackfill,
  getBackfillPreview,
  executeBackfill,
}
