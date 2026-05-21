/**
 * Unified Quality Score Service
 *
 * CRITICAL: This is the SINGLE source of truth for quality score calculation.
 * Both generation pipeline and editor must use this service to ensure consistency.
 *
 * The score shown in lists MUST match the score shown in article editor.
 *
 * SIMPLIFIED CHECKS (v2 - Jan 2026):
 * Only checks what GetEducated actually cares about:
 * 1. Word Count (800-2500) - Basic length
 * 2. Internal Links (3+) - CRITICAL for monetization
 * 3. External Citations (1+) - BLS/gov sources
 * 4. Headings (3+ H2/H3) - Structure
 * 5. No Banned Links (.edu/competitors) - CRITICAL client requirement
 * 6. Author Assigned - Attribution
 *
 * REMOVED: Images, keyword density, readability score, FAQ schema
 */

import { supabase } from './supabaseClient'
import { validateContent, BLOCKED_COMPETITORS, findDuplicateExternalAnchors } from './validation/linkValidator'
import { detectTriplicates } from './validation/contentValidator'

// Default thresholds (used when system_settings unavailable)
const DEFAULT_THRESHOLDS = {
  minWordCount: 800,
  maxWordCount: 2500,
  minInternalLinks: 3,
  minExternalLinks: 1,
  requireHeadings: true,
  minHeadingCount: 3,
  minFaqCount: 3,
}

// Cache for system settings
let settingsCache = null
let settingsCacheTime = 0
const CACHE_TTL = 60000 // 1 minute

/**
 * Fetch quality thresholds from system_settings table
 * Uses caching to avoid excessive DB calls
 */
export async function getQualityThresholds() {
  const now = Date.now()

  // Return cached settings if still valid
  if (settingsCache && (now - settingsCacheTime) < CACHE_TTL) {
    return settingsCache
  }

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value')

    if (error) {
      console.warn('Failed to fetch system_settings, using defaults:', error)
      return DEFAULT_THRESHOLDS
    }

    // Build settings object from DB
    const settingsMap = {}
    data?.forEach(row => {
      settingsMap[row.key] = row.value
    })

    // Simplified thresholds - only what GetEducated cares about.
    // Accept both legacy key names (target_word_count_min/max) and the
    // canonical names (min_word_count/max_word_count) so seeded settings
    // are honoured regardless of which migration produced them.
    const thresholds = {
      minWordCount: parseInt(settingsMap.min_word_count || settingsMap.target_word_count_min) || DEFAULT_THRESHOLDS.minWordCount,
      maxWordCount: parseInt(settingsMap.max_word_count || settingsMap.target_word_count_max) || DEFAULT_THRESHOLDS.maxWordCount,
      minInternalLinks: parseInt(settingsMap.min_internal_links) || DEFAULT_THRESHOLDS.minInternalLinks,
      minExternalLinks: parseInt(settingsMap.min_external_links) || DEFAULT_THRESHOLDS.minExternalLinks,
      requireHeadings: settingsMap.require_headings !== 'false',
      minHeadingCount: parseInt(settingsMap.min_heading_count) || DEFAULT_THRESHOLDS.minHeadingCount,
      minFaqCount: parseInt(settingsMap.min_faq_count) || DEFAULT_THRESHOLDS.minFaqCount,
    }

    // Update cache
    settingsCache = thresholds
    settingsCacheTime = now

    return thresholds
  } catch (e) {
    console.warn('Error fetching quality thresholds:', e)
    return DEFAULT_THRESHOLDS
  }
}

/**
 * Clear settings cache (call when settings are updated)
 */
export function clearQualitySettingsCache() {
  settingsCache = null
  settingsCacheTime = 0
}

/**
 * Validate cost and salary data in article content.
 * Flags suspicious values that likely indicate data entry errors:
 * - Total program cost under $3,000 (likely per-credit, not total)
 * - Total program cost over $200,000 (unusually high)
 * - Salary under $20,000 or over $500,000 (outside common BLS ranges)
 *
 * These are WARNING severity — they don't block publishing.
 *
 * @param {string} plainText - Plain text content (HTML stripped)
 * @returns {Object} - Validation results with flagged values
 */
function validateCostAndSalaryData(plainText) {
  const result = {
    hasSuspiciousCost: false,
    hasSuspiciousSalary: false,
    suspiciousCosts: [],
    suspiciousSalaries: [],
    costMentions: 0,
    salaryMentions: 0,
  }

  if (!plainText) return result

  // Match dollar amounts: $1,234 or $1234 or $1,234.56 or $1234.56
  // Also handles "$1,234 per year", "$1,234/year", etc.
  const dollarPattern = /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g
  let match

  // Collect all dollar amounts with their surrounding context
  const amounts = []
  while ((match = dollarPattern.exec(plainText)) !== null) {
    const rawValue = match[1].replace(/,/g, '')
    const numValue = parseFloat(rawValue)
    // Get surrounding context (80 chars before and after)
    const start = Math.max(0, match.index - 80)
    const end = Math.min(plainText.length, match.index + match[0].length + 80)
    const context = plainText.substring(start, end).toLowerCase()
    amounts.push({ numValue, display: match[0], context })
  }

  // Classify amounts by context keywords
  const costKeywords = ['cost', 'tuition', 'price', 'program', 'degree', 'total', 'per credit', 'per-credit', 'credit hour', 'fee', 'afford', 'expensive', 'cheap', 'budget']
  const salaryKeywords = ['salary', 'salaries', 'earn', 'earning', 'income', 'wage', 'pay', 'compensation', 'median', 'annual', 'per year', 'per annum', 'yearly', 'bls']
  const perCreditKeywords = ['per credit', 'per-credit', 'credit hour', '/credit', 'each credit']

  for (const amt of amounts) {
    const isCostContext = costKeywords.some(kw => amt.context.includes(kw))
    const isSalaryContext = salaryKeywords.some(kw => amt.context.includes(kw))
    const isPerCredit = perCreditKeywords.some(kw => amt.context.includes(kw))

    // Skip per-credit costs — those are expected to be small
    if (isPerCredit) continue

    if (isCostContext && !isSalaryContext) {
      result.costMentions++
      // Flag total program cost under $3,000 (likely per-credit being used as total)
      if (amt.numValue < 3000) {
        result.hasSuspiciousCost = true
        result.suspiciousCosts.push({
          value: amt.numValue,
          display: `${amt.display} (under $3,000 — likely per-credit, not total)`,
        })
      }
      // Flag total program cost over $200,000
      if (amt.numValue > 200000) {
        result.hasSuspiciousCost = true
        result.suspiciousCosts.push({
          value: amt.numValue,
          display: `${amt.display} (over $200,000 — unusually high)`,
        })
      }
    }

    if (isSalaryContext && !isCostContext) {
      result.salaryMentions++
      // Flag salary under $20,000 (below typical BLS minimums)
      if (amt.numValue < 20000) {
        result.hasSuspiciousSalary = true
        result.suspiciousSalaries.push({
          value: amt.numValue,
          display: `${amt.display} (under $20,000 — below typical BLS range)`,
        })
      }
      // Flag salary over $500,000 (above typical BLS maximums)
      if (amt.numValue > 500000) {
        result.hasSuspiciousSalary = true
        result.suspiciousSalaries.push({
          value: amt.numValue,
          display: `${amt.display} (over $500,000 — above typical BLS range)`,
        })
      }
    }
  }

  return result
}

/**
 * Calculate quality metrics for an article
 *
 * SIMPLIFIED v2: Only checks what GetEducated actually cares about
 * - Word count, internal links (CRITICAL), external citations, headings
 * - Banned links (.edu, competitors) - CRITICAL
 * - Author assignment
 *
 * @param {string} content - HTML content of the article
 * @param {Object} article - Article object (for contributor, etc.)
 * @param {Object} thresholds - Quality thresholds (optional, will fetch from DB if not provided)
 * @returns {Object} - { score, checks, issues, canPublish }
 */
export function calculateQualityScore(content, article = {}, thresholds = DEFAULT_THRESHOLDS) {
  if (!content) {
    return {
      score: 0,
      checks: {},
      issues: [],
      canPublish: false,
      word_count: 0,
    }
  }

  const t = thresholds

  // Calculate basic metrics
  const plainText = content.replace(/<[^>]*>/g, '')
  const wordCount = plainText.split(/\s+/).filter(w => w).length

  // Use link validator for comprehensive link analysis
  const linkValidation = validateContent(content)
  const internalLinks = linkValidation.internalLinks
  const externalLinks = linkValidation.externalLinks
  const hasBannedLinks = !linkValidation.isCompliant
  const bannedLinkCount = linkValidation.blockingIssues.length

  // Headings
  const h2Count = (content.match(/<h2/gi) || []).length
  const h3Count = (content.match(/<h3/gi) || []).length
  const totalHeadings = h2Count + h3Count

  // Triplicate detection
  const triplicateResult = detectTriplicates(content)

  // Author assignment check
  const hasAuthor = !!(article?.contributor_id || article?.article_contributors)

  // Cost/Salary data validation
  // Extract dollar amounts from content to flag suspicious values
  const costSalaryValidation = validateCostAndSalaryData(plainText)

  // Build checks object - SIMPLIFIED to 6 checks + cost/salary warnings
  const checks = {
    wordCount: {
      type: wordCount < t.minWordCount ? 'word_count_low' : 'word_count_high',
      passed: wordCount >= t.minWordCount && wordCount <= t.maxWordCount,
      critical: false,
      enabled: true,
      label: `${t.minWordCount}-${t.maxWordCount} words`,
      value: `${wordCount} words`,
      issue: wordCount < t.minWordCount
        ? `Add ${t.minWordCount - wordCount} more words`
        : wordCount > t.maxWordCount
          ? `Remove ${wordCount - t.maxWordCount} words`
          : null
    },
    internalLinks: {
      type: 'missing_internal_links',
      passed: internalLinks >= t.minInternalLinks,
      critical: true,
      enabled: true,
      label: `At least ${t.minInternalLinks} internal links`,
      value: `${internalLinks} link${internalLinks !== 1 ? 's' : ''}`,
      issue: internalLinks < t.minInternalLinks
        ? `Add ${t.minInternalLinks - internalLinks} more internal link(s) to GetEducated`
        : null
    },
    externalLinks: {
      type: 'missing_external_links',
      passed: externalLinks >= t.minExternalLinks,
      critical: false,
      enabled: true,
      label: `At least ${t.minExternalLinks} external citation${t.minExternalLinks !== 1 ? 's' : ''}`,
      value: `${externalLinks} citation${externalLinks !== 1 ? 's' : ''}`,
      issue: externalLinks < t.minExternalLinks
        ? `Add ${t.minExternalLinks - externalLinks} external citation(s) (BLS, gov sites)`
        : null
    },
    headings: {
      type: 'weak_headings',
      passed: !t.requireHeadings || totalHeadings >= t.minHeadingCount,
      critical: false,
      enabled: t.requireHeadings,
      label: `At least ${t.minHeadingCount} headings (H2/H3)`,
      value: `${totalHeadings} heading${totalHeadings !== 1 ? 's' : ''}`,
      issue: totalHeadings < t.minHeadingCount && t.requireHeadings
        ? `Add ${t.minHeadingCount - totalHeadings} more heading(s)`
        : null
    },
    bannedLinks: {
      type: 'bannedLinks',
      passed: !hasBannedLinks,
      critical: true,
      enabled: true,
      label: 'No banned links (.edu, competitors)',
      value: hasBannedLinks ? `${bannedLinkCount} banned link${bannedLinkCount !== 1 ? 's' : ''} found` : 'Clean',
      issue: hasBannedLinks
        ? `Remove ${bannedLinkCount} banned link(s): ${linkValidation.blockingIssues.map(i => i.url).slice(0, 3).join(', ')}${bannedLinkCount > 3 ? '...' : ''}`
        : null
    },
    authorAssigned: {
      type: 'missing_author',
      passed: hasAuthor,
      critical: false,
      enabled: true,
      label: 'Author assigned',
      value: hasAuthor ? 'Assigned' : 'Missing',
      issue: !hasAuthor ? 'Assign an author/contributor' : null
    },
    faqCount: (() => {
      // xlsx spec rows 10–12: minimum 3 FAQs. v2 had removed the FAQ
      // check; restored here per the May 19 review.
      const faqs = Array.isArray(article?.faqs) ? article.faqs : []
      const passes = faqs.length >= t.minFaqCount
      return {
        type: 'insufficient_faqs',
        passed: passes,
        critical: false,
        enabled: true,
        label: `At least ${t.minFaqCount} FAQs`,
        value: `${faqs.length} FAQ${faqs.length !== 1 ? 's' : ''}`,
        issue: passes ? null : `Add ${t.minFaqCount - faqs.length} more FAQ item(s)`,
      }
    })(),
    triplicates: {
      type: 'triplicates',
      passed: triplicateResult.count < 10,
      critical: false,
      enabled: true,
      label: 'Fewer than 10 triplicate patterns',
      value: `${triplicateResult.count} found`,
      issue: triplicateResult.count >= 10
        ? `Reduce triplicate patterns (${triplicateResult.count} found). Vary sentence structure instead of always listing 3 items.`
        : null
    },
    suspiciousCost: {
      passed: !costSalaryValidation.hasSuspiciousCost,
      critical: false,
      enabled: true,
      severity: 'warning',
      label: 'Program costs in valid range ($3,000-$200,000)',
      value: costSalaryValidation.hasSuspiciousCost
        ? `${costSalaryValidation.suspiciousCosts.length} suspicious cost(s) found`
        : costSalaryValidation.costMentions > 0
          ? `${costSalaryValidation.costMentions} cost figure(s) look valid`
          : 'No cost data detected',
      issue: costSalaryValidation.hasSuspiciousCost
        ? `Suspicious program cost(s): ${costSalaryValidation.suspiciousCosts.map(c => c.display).join('; ')}. Verify these are total program costs, not per-credit costs.`
        : null
    },
    suspiciousSalary: {
      passed: !costSalaryValidation.hasSuspiciousSalary,
      critical: false,
      enabled: true,
      severity: 'warning',
      label: 'Salary figures in BLS range ($20,000-$500,000)',
      value: costSalaryValidation.hasSuspiciousSalary
        ? `${costSalaryValidation.suspiciousSalaries.length} suspicious salary(ies) found`
        : costSalaryValidation.salaryMentions > 0
          ? `${costSalaryValidation.salaryMentions} salary figure(s) look valid`
          : 'No salary data detected',
      issue: costSalaryValidation.hasSuspiciousSalary
        ? `Suspicious salary figure(s): ${costSalaryValidation.suspiciousSalaries.map(s => s.display).join('; ')}. Verify against BLS data.`
        : null
    },
    accreditationLanguage: (() => {
      // Tony's May 19 review: "Some certifications and some employers may
      // prefer..." is too weak. Flag hedge phrases when the article
      // discusses accreditation so the editor can strengthen them.
      const text = plainText.toLowerCase()
      const mentionsAccreditation = /accredit/.test(text)
      const weakPatterns = [
        /some\s+(?:certifications?|employers?|programs?)\s+(?:may|might|could)\s+prefer/i,
        /could\s+be\s+beneficial/i,
        /it'?s\s+(?:often|sometimes)\s+considered/i,
        /it'?s\s+a\s+good\s+idea\s+to\s+check/i,
      ]
      const offenders = weakPatterns.filter((re) => re.test(plainText))
      const hasWeak = mentionsAccreditation && offenders.length > 0
      return {
        type: 'weak_accreditation_language',
        passed: !hasWeak,
        critical: false,
        enabled: true,
        severity: 'warning',
        label: 'Strong, direct accreditation language',
        value: !mentionsAccreditation
          ? 'No accreditation mention'
          : hasWeak
            ? `${offenders.length} weak phrase(s) found`
            : 'Strong language',
        issue: hasWeak
          ? 'Accreditation is discussed with hedge phrases ("may prefer", "could be beneficial"). Rewrite with concrete consequences (federal aid eligibility, transfer credit, licensure) and cite ed.gov/CHEA.'
          : null,
      }
    })(),
    duplicateExternalLinks: (() => {
      // Tony's May 21 round-3 review flagged the same BLS URL being
      // linked twice in the BSN article. The dedupe pass at generation
      // time should catch this for new articles; this check guards
      // against any that slip through (re-publish, manual edits, etc.).
      const dupes = findDuplicateExternalAnchors(content)
      return {
        type: 'duplicate_external_links',
        passed: dupes.length === 0,
        critical: false,
        enabled: true,
        severity: 'warning',
        label: 'No duplicate external citations',
        value: dupes.length === 0 ? 'No duplicates' : `${dupes.length} URL(s) linked more than once`,
        issue: dupes.length > 0
          ? `Duplicate external link(s): ${dupes.slice(0, 3).join(', ')}${dupes.length > 3 ? '…' : ''}. Each external source should be cited once.`
          : null,
      }
    })(),
  }

  // Filter to enabled checks only
  const enabledChecks = Object.entries(checks).reduce((acc, [key, check]) => {
    if (check.enabled !== false) {
      acc[key] = check
    }
    return acc
  }, {})

  // Calculate score as percentage of passed checks
  const totalChecks = Object.keys(enabledChecks).length
  const passedChecks = Object.values(enabledChecks).filter(c => c.passed).length
  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0

  // Check for critical failures
  const criticalFailed = Object.values(enabledChecks).some(c => c.critical && !c.passed)

  // Build issues array
  const issues = Object.values(enabledChecks)
    .filter(c => !c.passed && c.issue)
    .map(c => ({
      description: c.issue,
      critical: c.critical,
      severity: c.severity === 'warning' ? 'warning' : (c.critical ? 'major' : 'minor')
    }))

  return {
    score,
    checks: enabledChecks,
    issues,
    canPublish: !criticalFailed,
    word_count: wordCount,
    internal_links: internalLinks,
    external_links: externalLinks,
    has_banned_links: hasBannedLinks,
    thresholds_used: t,
  }
}

/**
 * Calculate quality score asynchronously (fetches thresholds from DB)
 * Use this when you don't have thresholds already loaded
 */
export async function calculateQualityScoreAsync(content, article = {}) {
  const thresholds = await getQualityThresholds()
  return calculateQualityScore(content, article, thresholds)
}

/**
 * Update article quality score in database
 * Call this after any content change to keep DB in sync
 */
export async function updateArticleQualityScore(articleId, content, article = {}) {
  const result = await calculateQualityScoreAsync(content, article)

  try {
    const { error } = await supabase
      .from('articles')
      .update({
        quality_score: result.score,
        quality_issues: result.issues,
      })
      .eq('id', articleId)

    if (error) {
      console.error('Failed to update quality score:', error)
    }
  } catch (e) {
    console.error('Error updating quality score:', e)
  }

  return result
}

/**
 * Batch recalculate quality scores for all articles
 * Use this to sync all scores after updating the scoring algorithm
 * @param {Function} onProgress - Optional callback for progress updates (current, total)
 * @returns {Object} - { updated: number, errors: number, details: [] }
 */
export async function batchRecalculateQualityScores(onProgress = null) {
  const thresholds = await getQualityThresholds()
  const results = { updated: 0, errors: 0, details: [] }

  try {
    // Fetch all articles with content
    // Include contributor_id for the "author assigned" check
    const { data: articles, error } = await supabase
      .from('articles')
      .select('id, content, contributor_id, quality_score')
      .not('content', 'is', null)

    if (error) {
      console.error('Failed to fetch articles:', error)
      return { ...results, errors: 1, details: [{ error: error.message }] }
    }

    const total = articles?.length || 0
    console.log(`[QualityScore] Recalculating scores for ${total} articles...`)

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]

      try {
        const result = calculateQualityScore(article.content, article, thresholds)
        const oldScore = article.quality_score

        // Only update if score changed
        if (oldScore !== result.score) {
          const { error: updateError } = await supabase
            .from('articles')
            .update({
              quality_score: result.score,
              quality_issues: result.issues,
            })
            .eq('id', article.id)

          if (updateError) {
            results.errors++
            results.details.push({ id: article.id, error: updateError.message })
          } else {
            results.updated++
            results.details.push({
              id: article.id,
              oldScore,
              newScore: result.score,
              change: result.score - (oldScore || 0)
            })
          }
        }

        // Report progress
        if (onProgress) {
          onProgress(i + 1, total)
        }
      } catch (e) {
        results.errors++
        results.details.push({ id: article.id, error: e.message })
      }
    }

    console.log(`[QualityScore] Recalculation complete: ${results.updated} updated, ${results.errors} errors`)
    return results
  } catch (e) {
    console.error('Batch recalculation failed:', e)
    return { ...results, errors: 1, details: [{ error: e.message }] }
  }
}

export default {
  calculateQualityScore,
  calculateQualityScoreAsync,
  getQualityThresholds,
  clearQualitySettingsCache,
  updateArticleQualityScore,
  batchRecalculateQualityScores,
  DEFAULT_THRESHOLDS,
}
