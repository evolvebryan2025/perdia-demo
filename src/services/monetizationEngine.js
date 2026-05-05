/**
 * Monetization Engine for GetEducated
 *
 * Core engine that decides:
 * - Which degrees and schools should be promoted in each article
 * - How those offers are rendered (via WordPress shortcodes)
 * - Where they appear in the article
 * - That all complies with GetEducated business rules
 *
 * IMPORTANT: Uses ACTUAL GetEducated WordPress shortcodes (updated 2025-12-17):
 * - [su_ge-picks] for degree tables/picks
 * - [su_ge-cta] for links (school, degree, internal, external)
 * - [su_ge-qdf] for Quick Degree Find widget
 *
 * See shortcodeService.js for full shortcode documentation.
 */

import { supabase } from './supabaseClient'
import {
  generateGePicksShortcode,
  generateQuickDegreeFindShortcode,
  buildCtaUrl,
} from './shortcodeService'

/**
 * Default configuration for monetization engine
 */
const DEFAULT_CONFIG = {
  // Minimum programs before relaxing filters
  minProgramsRequired: 3,

  // Maximum programs from same school per block
  maxProgramsPerSchool: 2,

  // Default max programs per slot
  defaultMaxPrograms: 5,

  // Sponsored priority ratio (0-1, percentage of sponsored in top positions)
  sponsoredPriorityRatio: 1.0, // 100% sponsored first when available

  // Fallback behavior when few programs match
  enableCategoryFallback: true,
  enableRelatedConcentrationFallback: true,
}

/**
 * Slot type definitions
 * Updated to use correct GetEducated shortcodes
 */
const SLOT_TYPES = {
  table: {
    shortcodeType: 'su_ge-picks',  // Was: 'degree_table'
    defaultMax: 5,
    minPrograms: 3,
  },
  hero: {
    shortcodeType: 'su_ge-picks',  // Was: 'degree_offer' - GE Picks can show single item
    defaultMax: 1,
    minPrograms: 1,
  },
  compact: {
    shortcodeType: 'su_ge-picks',  // Was: 'degree_table'
    defaultMax: 3,
    minPrograms: 2,
  },
  qdf: {
    shortcodeType: 'su_ge-qdf',    // Quick Degree Find widget
    defaultMax: null,
    minPrograms: 0,
  },
}

/**
 * Default slot configurations by article type
 */
const ARTICLE_SLOT_CONFIGS = {
  ranking: [
    { name: 'after_intro', maxPrograms: 5, type: 'table' },
    { name: 'mid_article', maxPrograms: 3, type: 'compact' },
    { name: 'near_conclusion', maxPrograms: 1, type: 'hero' },
  ],
  guide: [
    { name: 'after_intro', maxPrograms: 3, type: 'compact' },
    { name: 'near_conclusion', maxPrograms: 1, type: 'hero' },
  ],
  listicle: [
    { name: 'after_intro', maxPrograms: 5, type: 'table' },
    { name: 'mid_article', maxPrograms: 3, type: 'table' },
  ],
  explainer: [
    { name: 'after_intro', maxPrograms: 3, type: 'compact' },
  ],
  review: [
    { name: 'after_intro', maxPrograms: 1, type: 'hero' },
    { name: 'near_conclusion', maxPrograms: 3, type: 'compact' },
  ],
  default: [
    { name: 'after_intro', maxPrograms: 5, type: 'table' },
    { name: 'mid_article', maxPrograms: 3, type: 'compact' },
  ],
}

/**
 * Main Monetization Engine class
 */
export class MonetizationEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Generate monetization for an article
   * Main entry point implementing the spec API contract
   *
   * @param {Object} input - Input parameters
   * @param {string} input.articleId - Article ID
   * @param {number} input.categoryId - Category ID from monetization_categories
   * @param {number} input.concentrationId - Concentration ID from monetization_categories
   * @param {number} input.degreeLevelCode - Degree level code from monetization_levels
   * @param {Array} input.slots - Slot configurations (optional, uses defaults based on articleType)
   * @param {string} input.articleType - Article type for default slots (ranking, guide, listicle, etc.)
   * @returns {Object} Monetization output with shortcodes and selected programs
   */
  async generateMonetization(input) {
    const {
      articleId,
      categoryId,
      concentrationId,
      degreeLevelCode,
      slots,
      articleType = 'default',
    } = input

    // Validate required inputs
    const validation = await this.validateInput(input)
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
        slots: [],
      }
    }

    // Get slot configurations
    const slotConfigs = slots || ARTICLE_SLOT_CONFIGS[articleType] || ARTICLE_SLOT_CONFIGS.default

    // Process each slot
    const processedSlots = []
    const usedProgramIds = new Set() // Track programs already used to avoid duplicates

    for (const slotConfig of slotConfigs) {
      const slotResult = await this.processSlot({
        categoryId,
        concentrationId,
        degreeLevelCode,
        slotConfig,
        usedProgramIds,
      })

      // Add selected programs to used set
      slotResult.selectedProgramIds.forEach(id => usedProgramIds.add(id))

      processedSlots.push(slotResult)
    }

    return {
      success: true,
      articleId,
      categoryId,
      concentrationId,
      degreeLevelCode,
      slots: processedSlots,
      totalProgramsSelected: usedProgramIds.size,
      metadata: {
        articleType,
        configUsed: this.config,
        generatedAt: new Date().toISOString(),
      },
    }
  }

  /**
   * Validate input parameters
   */
  async validateInput(input) {
    const { categoryId, concentrationId, degreeLevelCode } = input

    if (!categoryId || !concentrationId) {
      return { isValid: false, error: 'categoryId and concentrationId are required' }
    }

    // Validate category/concentration exists
    const { data: category, error: categoryError } = await supabase
      .from('monetization_categories')
      .select('*')
      .eq('category_id', categoryId)
      .eq('concentration_id', concentrationId)
      .eq('is_active', true)
      .single()

    if (categoryError || !category) {
      return {
        isValid: false,
        error: `Invalid category_id (${categoryId}) or concentration_id (${concentrationId})`
      }
    }

    // Validate degree level if provided
    if (degreeLevelCode) {
      const { data: level, error: levelError } = await supabase
        .from('monetization_levels')
        .select('*')
        .eq('level_code', degreeLevelCode)
        .eq('is_active', true)
        .single()

      if (levelError || !level) {
        return { isValid: false, error: `Invalid degree level code: ${degreeLevelCode}` }
      }
    }

    return { isValid: true, category }
  }

  /**
   * Process a single monetization slot
   */
  async processSlot({ categoryId, concentrationId, degreeLevelCode, slotConfig, usedProgramIds }) {
    const { name, maxPrograms, type, useSponsoredOnly = false } = slotConfig
    const slotType = SLOT_TYPES[type] || SLOT_TYPES.table

    // Select programs for this slot
    const programs = await this.selectPrograms({
      categoryId,
      concentrationId,
      degreeLevelCode,
      maxPrograms: maxPrograms || slotType.defaultMax,
      useSponsoredOnly,
      excludeProgramIds: Array.from(usedProgramIds),
    })

    // Generate appropriate shortcode
    const shortcode = this.generateSlotShortcode({
      type,
      categoryId,
      concentrationId,
      degreeLevelCode,
      maxPrograms: maxPrograms || slotType.defaultMax,
      programs,
    })

    return {
      name,
      type,
      shortcode,
      selectedProgramIds: programs.map(p => p.id),
      selectedPrograms: programs.map(p => ({
        id: p.id,
        programName: p.program_name,
        schoolName: p.school_name,
        schoolId: p.school_id,
        isSponsored: p.is_sponsored,
        sponsorshipTier: p.sponsorship_tier,
        geteducatedUrl: p.geteducated_url,
      })),
      programCount: programs.length,
      hasSponsored: programs.some(p => p.is_sponsored),
    }
  }

  /**
   * Select programs based on criteria with sponsored priority
   * Implements Section 4 of the spec: Program Selection Logic
   */
  async selectPrograms({
    categoryId,
    concentrationId,
    degreeLevelCode,
    maxPrograms,
    useSponsoredOnly = false,
    excludeProgramIds = [],
  }) {
    // Stage 1: Base query with exact filters
    let programs = await this.queryPrograms({
      categoryId,
      concentrationId,
      degreeLevelCode,
      excludeProgramIds,
    })

    // Stage 2: Fallback if too few results
    if (programs.length < this.config.minProgramsRequired && this.config.enableCategoryFallback) {
      // Try broader category (no concentration filter)
      const broaderPrograms = await this.queryPrograms({
        categoryId,
        concentrationId: null, // Relax concentration
        degreeLevelCode,
        excludeProgramIds,
      })

      // Merge, preferring exact matches
      const exactIds = new Set(programs.map(p => p.id))
      const additionalPrograms = broaderPrograms.filter(p => !exactIds.has(p.id))
      programs = [...programs, ...additionalPrograms]
    }

    // Stage 3: Apply sponsored priority partitioning
    const { sponsored, nonSponsored } = this.partitionBySponsorship(programs)

    // Stage 4: Apply diversity rules (max per school)
    const diverseSponsored = this.applyDiversityRules(sponsored)
    const diverseNonSponsored = this.applyDiversityRules(nonSponsored)

    // Stage 5: Combine with sponsored priority
    let finalSelection = []

    if (useSponsoredOnly) {
      finalSelection = diverseSponsored.slice(0, maxPrograms)
    } else {
      // Sponsored first, then fill with non-sponsored
      finalSelection = [
        ...diverseSponsored,
        ...diverseNonSponsored,
      ].slice(0, maxPrograms)
    }

    // Stage 6: Final ranking within selection
    return this.rankPrograms(finalSelection)
  }

  /**
   * Query programs from database
   */
  async queryPrograms({ categoryId, concentrationId, degreeLevelCode, excludeProgramIds = [] }) {
    let query = supabase
      .from('degrees')
      .select(`
        *,
        schools!inner(
          id,
          school_name,
          school_slug,
          geteducated_url,
          is_sponsored,
          has_logo,
          is_active
        )
      `)
      .eq('is_active', true)
      .eq('schools.is_active', true) // Only active schools

    // Apply category filter
    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }

    // Apply concentration filter (may be null for fallback)
    if (concentrationId) {
      query = query.eq('concentration_id', concentrationId)
    }

    // Apply degree level filter
    if (degreeLevelCode) {
      query = query.eq('degree_level_code', degreeLevelCode)
    }

    // Exclude already-used programs
    if (excludeProgramIds.length > 0) {
      query = query.not('id', 'in', `(${excludeProgramIds.join(',')})`)
    }

    // Order by sponsorship tier descending, then by name
    query = query
      .order('is_sponsored', { ascending: false })
      .order('sponsorship_tier', { ascending: false })
      .order('program_name', { ascending: true })
      .limit(50) // Get more than needed for filtering

    const { data, error } = await query

    if (error) {
      console.error('[MonetizationEngine] Query error:', error)
      return []
    }

    return data || []
  }

  /**
   * Partition programs into sponsored and non-sponsored
   */
  partitionBySponsorship(programs) {
    const sponsored = programs.filter(p => p.is_sponsored || p.schools?.is_sponsored)
    const nonSponsored = programs.filter(p => !p.is_sponsored && !p.schools?.is_sponsored)

    return { sponsored, nonSponsored }
  }

  /**
   * Apply diversity rules - limit programs per school
   */
  applyDiversityRules(programs) {
    const schoolCounts = new Map()
    const diverse = []

    for (const program of programs) {
      const schoolId = program.school_id
      const currentCount = schoolCounts.get(schoolId) || 0

      if (currentCount < this.config.maxProgramsPerSchool) {
        diverse.push(program)
        schoolCounts.set(schoolId, currentCount + 1)
      }
    }

    return diverse
  }

  /**
   * Rank programs within a selection
   * Order: is_sponsored DESC, sponsorship_tier DESC, total_cost ASC, program_name ASC
   */
  rankPrograms(programs) {
    return programs.sort((a, b) => {
      // Sponsored first
      const aSponsored = a.is_sponsored || a.schools?.is_sponsored ? 1 : 0
      const bSponsored = b.is_sponsored || b.schools?.is_sponsored ? 1 : 0
      if (bSponsored !== aSponsored) return bSponsored - aSponsored

      // Then by sponsorship tier
      const aTier = a.sponsorship_tier || 0
      const bTier = b.sponsorship_tier || 0
      if (bTier !== aTier) return bTier - aTier

      // Then by cost (cheaper first, if available)
      // Cost would come from ranking_report_entries join

      // Finally alphabetically
      return (a.program_name || '').localeCompare(b.program_name || '')
    })
  }

  /**
   * Generate shortcode for a slot
   * Updated to use correct GetEducated WordPress shortcodes
   */
  generateSlotShortcode({ type, categoryId, concentrationId, degreeLevelCode, maxPrograms, programs, category }) {
    const slotType = SLOT_TYPES[type] || SLOT_TYPES.table

    // Quick Degree Find widget
    if (slotType.shortcodeType === 'su_ge-qdf') {
      return generateQuickDegreeFindShortcode({
        type: 'simple',
        header: 'Find Your Degree',
      })
    }

    // GE Picks shortcode (correct GetEducated format)
    // Build the CTA URL from category/concentration/level. Per Tony's feedback
    // (2026-05-04 Slack via Josh), the URL must always include the level
    // segment — when no specific degree level is matched for an article, use
    // "all" as the level slug so the resulting URL stays valid on geteducated.com:
    //   correct:   /online-degrees/all/business/marketing/
    //   incorrect: /online-degrees/business/marketing/
    const levelSlugs = {
      1: 'associate',
      2: 'bachelor',
      3: 'bachelor', // bachelor completion
      4: 'master',
      5: 'doctorate',
      6: 'certificate',
    }
    const levelSlug = levelSlugs[degreeLevelCode] || 'all'
    let ctaUrl = `/online-degrees/${levelSlug}/`

    if (category) {
      const categorySlug = category.category?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || ''
      const concentrationSlug = category.concentration?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || ''
      if (categorySlug) ctaUrl += `${categorySlug}/`
      if (concentrationSlug) ctaUrl += `${concentrationSlug}/`
    }

    return generateGePicksShortcode({
      category: categoryId,
      concentration: concentrationId,
      level: degreeLevelCode,
      header: "GetEducated's Picks",
      ctaButton: 'View More Degrees',
      ctaUrl,
    })
  }

  /**
   * @deprecated Use generateGePicksShortcode from shortcodeService.js
   * Kept for backward compatibility
   */
  generateDegreeTableShortcode({ categoryId, concentrationId, degreeLevelCode }) {
    console.warn('MonetizationEngine.generateDegreeTableShortcode is deprecated. Use generateGePicksShortcode.')
    return generateGePicksShortcode({
      category: categoryId,
      concentration: concentrationId,
      level: degreeLevelCode,
    })
  }

  /**
   * @deprecated Single program highlight requires WordPress IDs we don't have
   * Use generateGePicksShortcode with limited results instead
   */
  generateDegreeOfferShortcode({ programId, schoolId }) {
    console.warn('MonetizationEngine.generateDegreeOfferShortcode is deprecated. WordPress school/degree IDs required.')
    // Return a GE Picks shortcode as fallback (will need proper IDs later)
    throw new Error('generateDegreeOfferShortcode requires WordPress school/degree IDs. Contact Tony for ID mapping.')
  }

  /**
   * Get slot configurations for an article type
   */
  getSlotConfigsForArticleType(articleType) {
    return ARTICLE_SLOT_CONFIGS[articleType] || ARTICLE_SLOT_CONFIGS.default
  }

  /**
   * Match article topic to monetization category
   * Enhanced version with better scoring
   */
  async matchTopicToCategory(topic, degreeLevel = null) {
    if (!topic) {
      return { matched: false, error: 'No topic provided' }
    }

    const topicLower = topic.toLowerCase()

    // Fetch all active categories
    const { data: categories, error } = await supabase
      .from('monetization_categories')
      .select('*')
      .eq('is_active', true)

    if (error) {
      return { matched: false, error: error.message }
    }

    // Score each category
    const scoredCategories = categories.map(cat => {
      let score = 0
      const categoryLower = cat.category.toLowerCase()
      const concentrationLower = cat.concentration.toLowerCase()

      // Exact concentration match (highest priority)
      if (topicLower.includes(concentrationLower)) {
        score += 100
      }

      // Exact category match
      if (topicLower.includes(categoryLower)) {
        score += 50
      }

      // Word-level matching for concentration
      const concentrationWords = concentrationLower.split(/\s+/)
      const topicWords = topicLower.split(/\s+/)

      for (const word of concentrationWords) {
        if (word.length > 3 && topicWords.some(tw => tw.includes(word) || word.includes(tw))) {
          score += 25
        }
      }

      // Word-level matching for category
      const categoryWords = categoryLower.split(/\s+/)
      for (const word of categoryWords) {
        if (word.length > 3 && topicWords.some(tw => tw.includes(word) || word.includes(tw))) {
          score += 15
        }
      }

      return { ...cat, score }
    })

    // Sort by score
    scoredCategories.sort((a, b) => b.score - a.score)
    const bestMatch = scoredCategories[0]

    if (!bestMatch || bestMatch.score === 0) {
      return { matched: false, error: 'No matching category found' }
    }

    // Get degree level code if provided
    let degreeLevelCode = null
    if (degreeLevel) {
      const { data: level } = await supabase
        .from('monetization_levels')
        .select('level_code')
        .ilike('level_name', `%${degreeLevel}%`)
        .single()

      if (level) {
        degreeLevelCode = level.level_code
      }
    }

    return {
      matched: true,
      categoryId: bestMatch.category_id,
      concentrationId: bestMatch.concentration_id,
      category: bestMatch,
      degreeLevelCode,
      confidence: bestMatch.score > 75 ? 'high' : bestMatch.score > 40 ? 'medium' : 'low',
      score: bestMatch.score,
    }
  }
}

/**
 * Business Rules Validator
 * Implements Section 7 of the spec: Business Rules & Constraints
 */
export class MonetizationValidator {
  constructor() {
    // Blocked competitor domains - NEVER link to these
    this.blockedDomains = [
      'onlineu.com',
      'usnews.com',
      'niche.com',
      'collegeboard.org',
      'petersons.com',
      'princetonreview.com',
      'cappex.com',
      'collegedata.com',
    ]

    // Approved external domains for citations
    this.approvedExternalDomains = [
      'bls.gov',           // Bureau of Labor Statistics
      'ed.gov',            // Department of Education
      'nces.ed.gov',       // National Center for Education Statistics
      'careeronestop.org', // Government career resource
      'onetcenter.org',    // O*NET
    ]
  }

  /**
   * Validate monetization output against business rules
   */
  async validate(monetizationOutput, articleContent) {
    const issues = []

    // Rule 7.1: Check link destinations
    const linkIssues = this.validateLinks(articleContent)
    issues.push(...linkIssues)

    // Rule 7.2: Check for sponsored content
    if (monetizationOutput.slots) {
      for (const slot of monetizationOutput.slots) {
        if (!slot.hasSponsored && slot.programCount > 0) {
          issues.push({
            type: 'warning',
            rule: 'sponsored_priority',
            message: `Slot "${slot.name}" has no sponsored programs`,
            severity: 'minor',
          })
        }
      }
    }

    // Rule 7.3: Check cost data sources
    const costIssues = this.validateCostData(articleContent)
    issues.push(...costIssues)

    return {
      isValid: !issues.some(i => i.severity === 'blocking'),
      issues,
      blockingIssues: issues.filter(i => i.severity === 'blocking'),
      warnings: issues.filter(i => i.severity !== 'blocking'),
    }
  }

  /**
   * Validate links in content
   */
  validateLinks(content) {
    const issues = []

    if (!content) return issues

    // Check for blocked domain links
    for (const domain of this.blockedDomains) {
      const regex = new RegExp(`https?://([\\w.-]*\\.)?${domain.replace('.', '\\.')}`, 'gi')
      if (regex.test(content)) {
        issues.push({
          type: 'error',
          rule: 'blocked_domain',
          message: `Content contains link to blocked competitor domain: ${domain}`,
          severity: 'blocking',
          domain,
        })
      }
    }

    // Check for direct .edu links (should use GetEducated URLs instead)
    const eduLinkRegex = /href=["']https?:\/\/[^"']*\.edu[^"']*["']/gi
    const eduMatches = content.match(eduLinkRegex)
    if (eduMatches && eduMatches.length > 0) {
      issues.push({
        type: 'warning',
        rule: 'edu_direct_link',
        message: `Content contains ${eduMatches.length} direct .edu link(s). Use GetEducated school pages instead.`,
        severity: 'major',
        count: eduMatches.length,
      })
    }

    return issues
  }

  /**
   * Validate cost data in content
   */
  validateCostData(content) {
    const issues = []

    if (!content) return issues

    // Check for cost/price mentions without proper attribution
    const costRegex = /\$[\d,]+(?:\.\d{2})?/g
    const costMatches = content.match(costRegex)

    if (costMatches && costMatches.length > 0) {
      // Check if GetEducated is mentioned as source
      const hasAttribution = /geteducated|ranking report/i.test(content)

      if (!hasAttribution) {
        issues.push({
          type: 'warning',
          rule: 'cost_attribution',
          message: `Content mentions ${costMatches.length} cost figure(s) without GetEducated attribution`,
          severity: 'minor',
          suggestion: 'Add "according to GetEducated ranking reports" or similar attribution',
        })
      }
    }

    return issues
  }

  /**
   * Check if a URL is from a blocked domain
   */
  isBlockedDomain(url) {
    if (!url) return false
    const urlLower = url.toLowerCase()
    return this.blockedDomains.some(domain => urlLower.includes(domain))
  }

  /**
   * Check if a URL is an approved external source
   */
  isApprovedExternalDomain(url) {
    if (!url) return false
    const urlLower = url.toLowerCase()
    return this.approvedExternalDomains.some(domain => urlLower.includes(domain))
  }
}

// Export singleton instances for convenience
export const monetizationEngine = new MonetizationEngine()
export const monetizationValidator = new MonetizationValidator()

// Export config constants for external use
export { DEFAULT_CONFIG, SLOT_TYPES, ARTICLE_SLOT_CONFIGS }

export default MonetizationEngine
