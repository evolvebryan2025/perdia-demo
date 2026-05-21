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
      degreeLevelCodes,
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

    // Per Tony's May 19 review: when an article discusses multiple degree
    // levels (e.g. "bachelor's and master's"), each GE Picks block should
    // target a DIFFERENT level so users see a broader school spread. If a
    // distinct level array was provided, distribute it across slots; falls
    // back to the single degreeLevelCode otherwise.
    const distinctLevels = Array.isArray(degreeLevelCodes) && degreeLevelCodes.length
      ? Array.from(new Set(degreeLevelCodes))
      : null

    // Tony's May 21 round-3 review: when two GE Picks share the same
    // (category, concentration, level) — including the case "both have
    // level=2" or "both have no level" — the FIRST slot drops its level
    // so it becomes the generic "any level / all" view, leaving the
    // second to keep its specific level. This guarantees the two cards
    // expose different school spreads.
    //
    // Identify which slot indices emit su_ge-picks (i.e. monetization
    // slots, excluding the qdf widget) so we only enforce uniqueness on
    // those.
    const monetizationSlotIndices = slotConfigs
      .map((cfg, i) => ((SLOT_TYPES[cfg.type] || SLOT_TYPES.table).shortcodeType === 'su_ge-picks' ? i : -1))
      .filter((i) => i >= 0)

    const baseLevels = distinctLevels && distinctLevels.length
      ? distinctLevels
      : (degreeLevelCode ? [degreeLevelCode] : [])

    // Build per-slot level assignment ahead of the loop.
    const levelBySlotIndex = new Map()
    if (monetizationSlotIndices.length >= 2 && baseLevels.length < monetizationSlotIndices.length) {
      // Fewer levels than picks slots → FIRST slot becomes generic (null),
      // remaining slots rotate through baseLevels.
      levelBySlotIndex.set(monetizationSlotIndices[0], null)
      monetizationSlotIndices.slice(1).forEach((slotIdx, i) => {
        levelBySlotIndex.set(slotIdx, baseLevels[i % Math.max(baseLevels.length, 1)] || null)
      })
    } else {
      // Enough levels (or single slot): one unique level per slot.
      monetizationSlotIndices.forEach((slotIdx, i) => {
        levelBySlotIndex.set(slotIdx, baseLevels[i] ?? null)
      })
    }

    // Process each slot
    const processedSlots = []
    const usedProgramIds = new Set() // Track programs already used to avoid duplicates

    for (let i = 0; i < slotConfigs.length; i++) {
      const slotConfig = slotConfigs[i]
      // Use the pre-computed level assignment so duplicate (cat, conc, level)
      // triples can't happen. Falls back to degreeLevelCode for non-monetization
      // slots (e.g. qdf widget — which ignores it anyway).
      const slotLevel = levelBySlotIndex.has(i) ? levelBySlotIndex.get(i) : degreeLevelCode

      const slotResult = await this.processSlot({
        categoryId,
        concentrationId,
        degreeLevelCode: slotLevel,
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
      degreeLevelCodes: distinctLevels,
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
   * Auto-link degree-mention phrases in article content.
   *
   * Tony's May 19 review flagged paragraphs that mention bachelor's and
   * master's pathways with no internal link to the matching
   * /online-degrees/{level}/{category}/{concentration}/ URL. This pass
   * wraps the FIRST occurrence per level in a [su_ge-cta] shortcode so
   * readers can jump to the actual program directory.
   *
   * Safeguards:
   *  - Skips matches already inside an <a>, [su_ge-...], <h1-3>, or
   *    monetization-block paragraph.
   *  - Limits to one link per degree level per article (avoids over-linking).
   *  - No-ops if category/concentration slugs are missing.
   */
  autoLinkDegreeMentions(content, matchedCategory) {
    if (!content || !matchedCategory) return content

    const categorySlug = matchedCategory.category?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || ''
    const concentrationSlug = matchedCategory.concentration?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || ''
    if (!categorySlug || !concentrationSlug) return content

    const LEVEL_SLUG = {
      associate: 'associate',
      bachelor: 'bachelor',
      master: 'master',
      doctorate: 'doctorate',
    }

    // Mask regions we must NOT modify: existing links, shortcodes, headings,
    // and monetization-block paragraphs. We replace them with sentinel
    // placeholders, do the find/replace pass on the remaining text, then
    // restore.
    const masks = []
    const mask = (s) => {
      const id = masks.length
      masks.push(s)
      return ` MASK${id} `
    }

    // CRITICAL: single alternation pass. Sequential .replace calls let
    // pass N+1 wrap a MASK token from pass N inside its own sentinel,
    // producing a nested MASK that the linear restore can't unwind —
    // that's how literal "MASK3" leaked into Tony's 5/21 published article.
    const protectedRegions = /<a\b[^>]*>[\s\S]*?<\/a>|\[su_ge-[\w-]+[^\]]*\][\s\S]*?\[\/su_ge-[\w-]+\]|<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>|<p\b[^>]*class="[^"]*monetization-block[^"]*"[^>]*>[\s\S]*?<\/p>/gi

    let masked = content.replace(protectedRegions, mask)

    const linkedLevels = new Set()
    const phrasePattern = /\b(associate|bachelor|master|doctorate)(?:'s)?\s+(?:degree|degrees)?\b/gi

    masked = masked.replace(phrasePattern, (match, level) => {
      const lvl = level.toLowerCase()
      if (linkedLevels.has(lvl)) return match
      const slug = LEVEL_SLUG[lvl]
      if (!slug) return match
      linkedLevels.add(lvl)
      const url = `/online-degrees/${slug}/${categorySlug}/${concentrationSlug}/`
      return `[su_ge-cta type="link" cta-copy="${match}" url="${url}"]${match}[/su_ge-cta]`
    })

    // Defensive restore: loop until stable. Single-pass mask above already
    // prevents nested sentinels, but this keeps the restore robust if the
    // mask logic ever changes again.
    for (let i = 0; i < 5; i++) {
      const next = masked.replace(/ MASK(\d+) /g, (_, id) => masks[Number(id)] ?? '')
      if (next === masked) break
      masked = next
    }

    // Final sanity scrub: strip any literal MASK\d+ that somehow survived
    // so we never ship a sentinel to the DB or the live site again.
    masked = masked.replace(/\s*MASK\d+\s*/g, ' ')

    return masked
  }

  /**
   * Detect distinct degree levels mentioned in article content.
   * Returns level codes (matching monetization_levels.level_code) for any
   * degree level explicitly named in the body. Used to distribute
   * complementary levels across multiple GE Picks blocks.
   */
  detectDegreeLevelsInContent(content) {
    if (!content) return []
    const text = String(content).toLowerCase()
    const found = new Set()
    if (/\bassociate(?:'s)?\s+degree|associates?\b/.test(text)) found.add(1)
    if (/\bbachelor(?:'s)?\b|\bbaccalaureate\b|\bbs\b|\bba\b/.test(text)) found.add(2)
    if (/\bmaster(?:'s)?\b|\bmba\b|\bmsn\b|\bms\b|\bma\b/.test(text)) found.add(4)
    if (/\bdoctorate\b|\bdoctoral\b|\bphd\b|\bdnp\b|\bedd\b/.test(text)) found.add(5)
    if (/\bcertificate\b|\bcertification\b/.test(text)) found.add(6)
    return Array.from(found)
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

    // Look up the category row so the slot generator can build a proper
    // /online-degrees/{level}/{category}/{concentration}/ URL. Without this
    // the URL falls back to /online-degrees/all/ which sends users to the
    // global degree directory instead of the matched concentration.
    const { data: category } = await supabase
      .from('monetization_categories')
      .select('category, concentration')
      .eq('category_id', categoryId)
      .eq('concentration_id', concentrationId)
      .maybeSingle()

    // Generate appropriate shortcode
    const shortcode = this.generateSlotShortcode({
      type,
      categoryId,
      concentrationId,
      degreeLevelCode,
      maxPrograms: maxPrograms || slotType.defaultMax,
      programs,
      category,
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
   * Enhanced version with better scoring + domain-word sanity check.
   *
   * Tony's May 19 review flagged a Nursing article that was assigned the
   * Business Administration category. To prevent silent mismatches we now:
   *   1. Require a minimum match score (MIN_MATCH_SCORE) before returning
   *      matched=true. Below the floor we return matched=false so callers
   *      surface the failure instead of falling back to whatever sorted
   *      first by alphabetic tiebreak.
   *   2. Run a "domain word" sanity check: if the topic mentions a strong
   *      subject domain (nursing, business, engineering, etc.) and the
   *      candidate category doesn't share any of those words, the match
   *      is downgraded to low confidence.
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

    // Detect strong domain words present in the topic
    const DOMAIN_WORDS = [
      'nursing', 'healthcare', 'business', 'engineering', 'education',
      'teaching', 'technology', 'computer', 'cyber', 'security',
      'psychology', 'criminal', 'law', 'science', 'art', 'design',
      'finance', 'accounting', 'management', 'social', 'religion',
      'philosophy', 'math', 'biology',
    ]
    const topicDomains = DOMAIN_WORDS.filter((d) => topicLower.includes(d))

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

      // Domain sanity penalty: if the topic clearly belongs to a domain
      // (e.g. "nursing"), the candidate category MUST share at least one
      // of those domain words or it gets a 30-point penalty. Stops a
      // nursing article from sliding into "Business Administration".
      if (topicDomains.length > 0) {
        const catText = `${categoryLower} ${concentrationLower}`
        const shared = topicDomains.some((d) => catText.includes(d))
        if (!shared) score -= 30
      }

      return { ...cat, score }
    })

    // Sort by score
    scoredCategories.sort((a, b) => b.score - a.score)
    const bestMatch = scoredCategories[0]

    // Minimum match score floor. Below this we refuse to match so the
    // article isn't silently routed to whatever category happened to sort
    // first. Caller can surface a "topic could not be confidently
    // classified" warning to the editor.
    const MIN_MATCH_SCORE = 25
    if (!bestMatch || bestMatch.score < MIN_MATCH_SCORE) {
      return {
        matched: false,
        error: bestMatch
          ? `Best category match scored ${bestMatch.score} (below minimum ${MIN_MATCH_SCORE}) — topic could not be confidently classified`
          : 'No matching category found',
        bestCandidate: bestMatch || null,
      }
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
