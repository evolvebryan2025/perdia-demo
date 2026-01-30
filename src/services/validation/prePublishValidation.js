/**
 * Pre-Publish Validation Service
 * Comprehensive validation before publishing articles to WordPress
 *
 * Checks:
 * - Author authorization (only 4 approved GetEducated authors)
 * - Link compliance (no .edu, no competitors, external whitelist)
 * - Risk level assessment
 * - Quality score thresholds
 * - Content requirements (FAQs, headings, word count)
 */

import { validateContent, canPublish as checkLinkPublish } from './linkValidator'
import { assessRisk, checkAutoPublishEligibility } from './riskAssessment'
import { APPROVED_AUTHORS } from '../../hooks/useContributors'
import {
  extractShortcodes,
  validateShortcodeParams,
  checkMonetizationCompliance,
  validateNoUnknownShortcodes,
  findLegacyShortcodes,
  SHORTCODE_TYPES,
  LEGACY_SHORTCODE_TAGS,
} from '../shortcodeService'
import { validateStatistics } from './factChecker'

/**
 * Validation result structure
 */
const createValidationResult = () => ({
  canPublish: true,
  blockingIssues: [],
  warnings: [],
  riskLevel: 'LOW',
  qualityScore: 0,
  checks: {
    author: { passed: false, message: '' },
    links: { passed: false, message: '' },
    risk: { passed: false, message: '' },
    quality: { passed: false, message: '' },
    content: { passed: false, message: '' },
    statistics: { passed: false, message: '' }, // FIX #3: Fact checking
    shortcodes: { passed: false, message: '' },
    unknownShortcodes: { passed: false, message: '' },
    legacyShortcodes: { passed: false, message: '' },
  }
})

/**
 * Run complete pre-publish validation on an article
 * @param {Object} article - Article to validate
 * @param {Object} options - Validation options
 * @returns {Object} Complete validation result
 */
export function validateForPublish(article, options = {}) {
  const {
    requireMinQualityScore = 70,
    blockHighRisk = true,
    enforceApprovedAuthors = true,
    checkLinks = true,
    requireMonetization = true,      // Make missing monetization a blocking issue
    blockUnknownShortcodes = true,   // Block publish if unknown shortcodes found
    blockLegacyShortcodes = true,    // Block publish if legacy (incorrect) shortcodes found
  } = options

  const result = createValidationResult()
  result.qualityScore = article.quality_score || 0

  // 1. Author Validation
  if (enforceApprovedAuthors) {
    const authorName = article.contributor_name || article.article_contributors?.name
    const isApproved = APPROVED_AUTHORS.includes(authorName)

    if (!authorName) {
      result.checks.author.passed = false
      result.checks.author.message = 'No author assigned'
      result.blockingIssues.push({
        type: 'no_author',
        message: 'Article must have an assigned author before publishing',
      })
    } else if (!isApproved) {
      result.checks.author.passed = false
      result.checks.author.message = `"${authorName}" is not an approved author`
      result.blockingIssues.push({
        type: 'unauthorized_author',
        message: `Author "${authorName}" is not approved. Only Tony Huffman, Kayleigh Gilbert, Sara, and Charity are allowed.`,
      })
    } else {
      result.checks.author.passed = true
      result.checks.author.message = `${authorName} (approved)`
    }
  } else {
    result.checks.author.passed = true
    result.checks.author.message = 'Author check disabled'
  }

  // 2. Link Compliance Validation
  if (checkLinks && article.content) {
    const linkValidation = validateContent(article.content)
    const linkPublishCheck = checkLinkPublish(linkValidation)

    if (!linkPublishCheck.canPublish) {
      result.checks.links.passed = false
      result.checks.links.message = linkPublishCheck.reason
      result.blockingIssues.push(...linkValidation.blockingIssues.map(issue => ({
        type: 'blocked_link',
        message: issue.issues[0],
        url: issue.url,
      })))
    } else {
      result.checks.links.passed = true
      result.checks.links.message = `${linkValidation.internalLinks} internal, ${linkValidation.externalLinks} external`
    }

    // Add link warnings
    if (linkValidation.warnings.length > 0) {
      result.warnings.push(...linkValidation.warnings.map(warning => ({
        type: 'link_warning',
        message: warning.issues[0],
        url: warning.url,
      })))
    }
  } else {
    result.checks.links.passed = true
    result.checks.links.message = 'Link check skipped'
  }

  // 3. Risk Assessment
  const riskAssessment = assessRisk(article, { checkLinks: false, checkAuthor: false })
  result.riskLevel = riskAssessment.riskLevel

  if (blockHighRisk && (riskAssessment.riskLevel === 'HIGH' || riskAssessment.riskLevel === 'CRITICAL')) {
    result.checks.risk.passed = false
    result.checks.risk.message = `${riskAssessment.riskLevel} risk requires manual review`
    if (riskAssessment.riskLevel === 'CRITICAL') {
      result.blockingIssues.push({
        type: 'critical_risk',
        message: 'Article has CRITICAL risk level and cannot be published',
      })
    }
  } else {
    result.checks.risk.passed = true
    result.checks.risk.message = `Risk level: ${riskAssessment.riskLevel}`
  }

  // 4. Quality Score Check
  if (result.qualityScore >= requireMinQualityScore) {
    result.checks.quality.passed = true
    result.checks.quality.message = `Score: ${result.qualityScore}/100`
  } else {
    result.checks.quality.passed = false
    result.checks.quality.message = `Score ${result.qualityScore} below minimum ${requireMinQualityScore}`
    result.warnings.push({
      type: 'low_quality_score',
      message: `Quality score (${result.qualityScore}) is below the recommended minimum (${requireMinQualityScore})`,
    })
  }

  // 5. Content Requirements
  const contentIssues = []

  // Check word count
  const wordCount = article.content?.replace(/<[^>]*>/g, '').split(/\s+/).length || 0
  if (wordCount < 1500) {
    contentIssues.push('Word count below 1500')
  }

  // Check FAQs
  const faqs = article.faqs || []
  if (faqs.length < 3) {
    contentIssues.push('Fewer than 3 FAQ items')
  }

  // Check headings
  const h2Count = (article.content?.match(/<h2/gi) || []).length
  if (h2Count < 3) {
    contentIssues.push('Fewer than 3 H2 headings')
  }

  if (contentIssues.length === 0) {
    result.checks.content.passed = true
    result.checks.content.message = 'All content requirements met'
  } else {
    result.checks.content.passed = false
    result.checks.content.message = contentIssues.join(', ')
    contentIssues.forEach(issue => {
      result.warnings.push({
        type: 'content_issue',
        message: issue,
      })
    })
  }

  // 5b. FIX #3: Statistics/Fact Checking Validation
  // Validates that statistics have proper citations from authoritative sources
  if (article.content) {
    const statsValidation = validateStatistics(article.content)
    
    if (statsValidation.uncitedStatistics === 0 && statsValidation.weakCitations === 0) {
      result.checks.statistics.passed = true
      result.checks.statistics.message = `${statsValidation.totalStatistics} statistics, all properly cited`
    } else {
      result.checks.statistics.passed = false
      const issueCount = statsValidation.issues.length
      const warningCount = statsValidation.warnings.length
      result.checks.statistics.message = `${issueCount} uncited, ${warningCount} weak citations`
      
      // Add warnings for each uncited statistic
      statsValidation.issues.forEach(issue => {
        result.warnings.push({
          type: 'uncited_statistic',
          message: `Uncited: "${issue.statistic}" - ${issue.suggestion}`,
          severity: issue.severity,
        })
      })
      
      // Add warnings for weak citations
      statsValidation.warnings.forEach(warning => {
        result.warnings.push({
          type: 'weak_citation',
          message: `Weak source for "${warning.statistic}": ${warning.reason}. ${warning.suggestion}`,
        })
      })
      
      // High-severity uncited statistics are blocking issues
      const criticalUncited = statsValidation.issues.filter(i => i.severity === 'high')
      if (criticalUncited.length > 0) {
        result.blockingIssues.push({
          type: 'uncited_critical_statistic',
          message: `${criticalUncited.length} salary/cost claims without citations. These must be verified or removed.`,
          details: criticalUncited.map(i => i.statistic),
        })
      }
    }
    
    result.checks.statistics.details = {
      total: statsValidation.totalStatistics,
      cited: statsValidation.citedStatistics,
      uncited: statsValidation.uncitedStatistics,
      authoritative: statsValidation.authoritativeCitations,
      score: statsValidation.score,
    }
  } else {
    result.checks.statistics.passed = true
    result.checks.statistics.message = 'No content to check'
  }

  // 6. Shortcode Validation (monetization)
  // Updated 2025-12-17: Now validates against CORRECT GetEducated shortcodes:
  // - [su_ge-picks] for degree tables/picks
  // - [su_ge-cta] for links
  // - [su_ge-qdf] for Quick Degree Find
  if (article.content) {
    const monetizationCheck = checkMonetizationCompliance(article.content)
    const shortcodes = extractShortcodes(article.content)

    // Check for monetization shortcodes - BLOCKING BY DEFAULT
    if (!monetizationCheck.hasMonetization) {
      result.checks.shortcodes.passed = false
      result.checks.shortcodes.message = 'No monetization shortcodes found'

      if (requireMonetization) {
        // BLOCKING: Cannot publish without monetization
        result.blockingIssues.push({
          type: 'missing_monetization',
          message: 'Article requires at least one monetization shortcode ([su_ge-picks] or [su_ge-qdf]). Cannot publish without monetization.',
        })
      } else {
        // Non-blocking warning (for backwards compatibility if disabled)
        result.warnings.push({
          type: 'missing_shortcode',
          message: 'Article has no monetization shortcodes. Consider adding [su_ge-picks] or [su_ge-qdf] shortcodes.',
        })
      }
    } else {
      // Validate each shortcode's parameters
      const shortcodeIssues = []
      // Updated to use correct GetEducated shortcode types
      const monetizationTypes = [SHORTCODE_TYPES.GE_PICKS, SHORTCODE_TYPES.GE_QDF]

      for (const shortcode of shortcodes) {
        if (monetizationTypes.includes(shortcode.type)) {
          // Validate GE Picks parameters
          if (shortcode.type === SHORTCODE_TYPES.GE_PICKS) {
            const category = shortcode.params?.category
            const concentration = shortcode.params?.concentration
            if (!category || !concentration) {
              shortcodeIssues.push(`Missing required parameters in [su_ge-picks]: category and concentration required`)
            }
          }
        }
      }

      if (shortcodeIssues.length > 0) {
        result.checks.shortcodes.passed = false
        result.checks.shortcodes.message = shortcodeIssues.join('; ')
        shortcodeIssues.forEach(issue => {
          result.warnings.push({
            type: 'invalid_shortcode',
            message: issue,
          })
        })
      } else {
        result.checks.shortcodes.passed = true
        result.checks.shortcodes.message = `${monetizationCheck.monetizationCount} shortcode(s) found (${monetizationCheck.breakdown.gePicks} picks, ${monetizationCheck.breakdown.quickDegreeFind} QDF)`

        // Add recommendation if any
        if (monetizationCheck.recommendation) {
          result.warnings.push({
            type: 'shortcode_recommendation',
            message: monetizationCheck.recommendation,
          })
        }
      }
    }
  } else {
    result.checks.shortcodes.passed = false
    result.checks.shortcodes.message = 'No content to check'
    if (requireMonetization) {
      result.blockingIssues.push({
        type: 'no_content',
        message: 'Article has no content. Cannot validate monetization.',
      })
    }
  }

  // 6b. Legacy Shortcode Detection - BLOCKING CHECK
  // Detects our OLD incorrect shortcode formats that need migration
  if (article.content) {
    const legacyShortcodes = findLegacyShortcodes(article.content)

    if (legacyShortcodes.length === 0) {
      result.checks.legacyShortcodes.passed = true
      result.checks.legacyShortcodes.message = 'No legacy shortcodes detected'
    } else {
      result.checks.legacyShortcodes.passed = false
      const uniqueLegacyTags = [...new Set(legacyShortcodes.map(s => s.tag))]
      result.checks.legacyShortcodes.message = `Found ${legacyShortcodes.length} legacy shortcode(s): ${uniqueLegacyTags.join(', ')}`
      result.checks.legacyShortcodes.details = legacyShortcodes.map(s => ({
        tag: s.tag,
        raw: s.raw.substring(0, 100) + (s.raw.length > 100 ? '...' : ''),
        position: s.position,
      }))

      if (blockLegacyShortcodes) {
        // BLOCKING: Legacy shortcodes must be migrated
        result.blockingIssues.push({
          type: 'legacy_shortcode',
          message: `Article contains ${legacyShortcodes.length} legacy shortcode(s) that will not work in WordPress: ${uniqueLegacyTags.join(', ')}. These must be replaced with correct GetEducated shortcodes ([su_ge-picks], [su_ge-cta], [su_ge-qdf]).`,
          details: result.checks.legacyShortcodes.details,
          legacyTags: uniqueLegacyTags,
        })
      } else {
        // Non-blocking warning
        result.warnings.push({
          type: 'legacy_shortcode_warning',
          message: `Article contains legacy shortcodes that should be migrated: ${uniqueLegacyTags.join(', ')}`,
          details: result.checks.legacyShortcodes.details,
        })
      }
    }
  } else {
    result.checks.legacyShortcodes.passed = true
    result.checks.legacyShortcodes.message = 'No content to check'
  }

  // 7. Unknown Shortcode Detection - BLOCKING CHECK
  if (article.content) {
    const unknownCheck = validateNoUnknownShortcodes(article.content, {
      blockOnUnknown: blockUnknownShortcodes,
    })

    if (unknownCheck.isValid) {
      result.checks.unknownShortcodes.passed = true
      result.checks.unknownShortcodes.message = 'All shortcodes are valid'
    } else {
      result.checks.unknownShortcodes.passed = false
      result.checks.unknownShortcodes.message = unknownCheck.message
      result.checks.unknownShortcodes.details = unknownCheck.details

      if (blockUnknownShortcodes) {
        // BLOCKING: Unknown shortcodes prevent publishing
        result.blockingIssues.push({
          type: 'unknown_shortcode',
          message: unknownCheck.message,
          details: unknownCheck.details,
          uniqueTags: unknownCheck.uniqueTags,
        })
      } else {
        // Non-blocking warning
        result.warnings.push({
          type: 'unknown_shortcode_warning',
          message: unknownCheck.message,
          details: unknownCheck.details,
        })
      }
    }
  } else {
    result.checks.unknownShortcodes.passed = true
    result.checks.unknownShortcodes.message = 'No content to check'
  }

  // Determine if can publish
  result.canPublish = result.blockingIssues.length === 0

  return result
}

/**
 * Get a summary of the validation result for display
 * @param {Object} result - Validation result
 * @returns {Object} Summary for UI display
 */
export function getValidationSummary(result) {
  const passedChecks = Object.values(result.checks).filter(c => c.passed).length
  const totalChecks = Object.keys(result.checks).length

  return {
    passedChecks,
    totalChecks,
    percentage: Math.round((passedChecks / totalChecks) * 100),
    status: result.canPublish ? 'ready' : 'blocked',
    statusMessage: result.canPublish
      ? 'Ready to publish'
      : `${result.blockingIssues.length} blocking issue(s)`,
  }
}

/**
 * Check if article can be auto-published based on all criteria
 * @param {Object} article - Article to check
 * @param {Object} settings - System settings
 * @returns {Object} Auto-publish eligibility
 */
export function canAutoPublish(article, settings = {}) {
  const {
    autoPublishEnabled = false,
    blockHighRiskPublish = true,
    requireMinQualityScore = 80,
  } = settings

  if (!autoPublishEnabled) {
    return {
      eligible: false,
      reason: 'Auto-publish is disabled',
    }
  }

  // Run full validation
  const validation = validateForPublish(article, {
    requireMinQualityScore,
    blockHighRisk: blockHighRiskPublish,
  })

  if (!validation.canPublish) {
    return {
      eligible: false,
      reason: validation.blockingIssues[0]?.message || 'Article has blocking issues',
    }
  }

  if (validation.riskLevel === 'HIGH' || validation.riskLevel === 'CRITICAL') {
    return {
      eligible: false,
      reason: `${validation.riskLevel} risk articles require manual review`,
    }
  }

  return {
    eligible: true,
    reason: null,
    validation,
  }
}

/**
 * Async version of validateForPublish that includes database validation for shortcodes
 * @param {Object} article - Article to validate
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} Complete validation result with database-validated shortcodes
 */
export async function validateForPublishAsync(article, options = {}) {
  // Start with sync validation
  const result = validateForPublish(article, options)

  // If we have content and shortcodes, do async database validation
  if (article.content) {
    const shortcodes = extractShortcodes(article.content)
    const monetizationTypes = [SHORTCODE_TYPES.MONETIZATION, SHORTCODE_TYPES.DEGREE_TABLE, SHORTCODE_TYPES.DEGREE_OFFER]
    const monetizationShortcodes = shortcodes.filter(s => monetizationTypes.includes(s.type))

    if (monetizationShortcodes.length > 0) {
      const dbValidationIssues = []

      for (const shortcode of monetizationShortcodes) {
        if (shortcode.categoryId && shortcode.concentrationId) {
          try {
            const validation = await validateShortcodeParams({
              categoryId: shortcode.categoryId,
              concentrationId: shortcode.concentrationId,
              levelCode: shortcode.levelCode,
            })

            if (!validation.isValid) {
              dbValidationIssues.push(...validation.errors.map(err => ({
                shortcode: shortcode.raw,
                error: err,
              })))
            }
          } catch (err) {
            // If database validation fails, add warning but don't block
            console.warn('Shortcode database validation failed:', err)
          }
        }
      }

      if (dbValidationIssues.length > 0) {
        result.checks.shortcodes.passed = false
        result.checks.shortcodes.message = `${dbValidationIssues.length} shortcode(s) failed database validation`
        result.checks.shortcodes.dbValidation = dbValidationIssues

        dbValidationIssues.forEach(issue => {
          result.warnings.push({
            type: 'invalid_shortcode_db',
            message: `${issue.error} in shortcode: ${issue.shortcode.substring(0, 50)}...`,
          })
        })
      } else if (result.checks.shortcodes.passed) {
        result.checks.shortcodes.message += ' (database validated)'
      }
    }
  }

  return result
}

export default {
  validateForPublish,
  validateForPublishAsync,
  getValidationSummary,
  canAutoPublish,
}
