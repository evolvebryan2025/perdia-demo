/**
 * Content Validator Service
 * Post-generation validation to catch hallucinations, truncation, and quality issues
 *
 * DEFENSE LAYERS:
 * 1. Truncation Detection - Blocks incomplete articles
 * 2. Placeholder Detection - Blocks obvious fabrications ("University A")
 * 3. Statistics Detection - Flags unverified statistics for review
 * 4. Legislation Detection - Flags legal references for review
 * 5. School Name Validation - Validates against known schools
 * 6. Internal Link Validation - Ensures real GetEducated links
 */

import { supabase } from '../supabaseClient'

// ============================================
// DETECTION PATTERNS
// ============================================

/**
 * Patterns that indicate fabricated/placeholder content
 * These are BLOCKING issues - article cannot proceed
 */
export const PLACEHOLDER_PATTERNS = [
  // Placeholder school names
  /\bUniversity\s+[A-Z](?:\s|,|\.|\)|:)/g,
  /\bCollege\s+[A-Z](?:\s|,|\.|\)|:)/g,
  /\bSchool\s+[A-Z](?:\s|,|\.|\)|:)/g,
  /\bInstitution\s+[A-Z](?:\s|,|\.|\)|:)/g,
  // Template markers
  /\[School Name\]/gi,
  /\[University\]/gi,
  /\[College\]/gi,
  /\[Institution Name\]/gi,
  /\[Program Name\]/gi,
  /\[Insert\s+\w+\]/gi,
  /\[TBD\]/gi,
  /\[TODO\]/gi,
  /\[PLACEHOLDER\]/gi,
  // Template bleeding
  /\(Sponsored Listing\)/gi,
  /University A,?\s*B,?\s*(and\s+)?C/gi,
  // Lorem ipsum
  /lorem ipsum/gi,
  /dolor sit amet/gi,
]

/**
 * Patterns that indicate fabricated statistics
 * These are WARNING issues - flagged for human review
 */
export const STATISTICS_PATTERNS = [
  // Percentage claims with context
  /\d{1,3}%\s*(of\s+)?(students?|programs?|schools?|graduates?|employers?|institutions?|respondents?)/gi,
  /\d{1,3}%\s*(report|say|found|show|indicate|believe|agree|prefer|choose)/gi,
  // Survey/study claims
  /(survey|study|research|poll|report)\s+(found|shows?|indicates?|reveals?|suggests?)\s+.*?\d+/gi,
  /according to\s+(a\s+)?(recent\s+)?(survey|study|report|poll).*?\d+/gi,
  /\d{1,3}%\s*(completion|retention|graduation|placement|satisfaction|employment)\s+rate/gi,
  // Specific organization claims without citation
  /(survey|study)\s+by\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*.*?\d+%/gi,
  // Year-specific survey claims (high hallucination risk)
  /(20\d{2})\s+(survey|study|report).*?\d+%/gi,
  /according to\s+.*?(20\d{2}).*?\d+%/gi,
]

/**
 * Patterns that indicate fabricated legislation
 * These are WARNING issues - flagged for human review
 */
export const LEGISLATION_PATTERNS = [
  // Bill numbers
  /\b(SB|HB|AB|HR|S\.|H\.R\.)\s*-?\s*\d{2,5}\b/gi,
  /\b(Senate|House)\s+Bill\s+\d+/gi,
  // Executive orders
  /\bExecutive Order\s+\d+/gi,
  /\bEO\s+\d{4,5}\b/gi,
  // Acts with years
  /\b\w+(\s+\w+)*\s+Act\s+of\s+\d{4}\b/gi,
  // Public laws
  /\bPublic Law\s+\d+-\d+/gi,
  /\bP\.L\.\s+\d+-\d+/gi,
  // CFR references
  /\d+\s+C\.?F\.?R\.?\s+\d+/gi,
  // State-specific codes
  /\b(California|Texas|New York|Florida)\s+(Education|Business)\s+Code\s+\d+/gi,
]

/**
 * Patterns that indicate content was truncated
 * Incomplete endings that shouldn't appear in finished content
 */
export const TRUNCATION_INDICATORS = [
  // Mid-sentence endings
  /\s+(the|a|an|and|or|but|with|for|to|in|on|at|by|from|as|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|must|shall|can)\s*$/i,
  // Incomplete tags
  /<[a-z]+[^>]*$/i,
  // Incomplete quotes
  /"[^"]*$/,
  /'[^']*$/,
  // Incomplete parentheses
  /\([^)]*$/,
  /\[[^\]]*$/,
  // Incomplete HTML entities
  /&[a-z]+$/i,
  /&#\d+$/,
]

/**
 * Valid sentence endings
 */
export const VALID_ENDINGS = [
  /[.!?]$/,
  /[.!?]["']$/,
  /[.!?]\s*<\/p>$/i,
  /[.!?]\s*<\/li>$/i,
  /[.!?]\s*<\/h[1-6]>$/i,
  /[.!?]\s*<\/blockquote>$/i,
  /<\/ul>$/i,
  /<\/ol>$/i,
]

// ============================================
// MAIN VALIDATION CLASS
// ============================================

class ContentValidator {
  constructor() {
    this.schoolCache = null
    this.schoolCacheExpiry = null
    this.CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  }

  /**
   * Main validation entry point
   * Runs all validation checks and returns comprehensive result
   *
   * @param {string} content - The HTML content to validate
   * @param {Object} options - Validation options
   * @returns {Object} ValidationResult
   */
  async validate(content, options = {}) {
    const {
      checkTruncation = true,
      checkPlaceholders = true,
      checkStatistics = true,
      checkLegislation = true,
      checkSchoolNames = true,
      checkInternalLinks = true,
      targetWordCount = 2000,
      faqs = [],
    } = options

    const result = {
      isValid: true,
      isBlocked: false,
      requiresReview: false,
      riskLevel: 'LOW',
      issues: [],
      warnings: [],
      blockingIssues: [],
      metrics: {},
    }

    // Extract text content for analysis
    const textContent = this.stripHtml(content)
    const wordCount = this.countWords(textContent)
    result.metrics.wordCount = wordCount

    // ========================================
    // BLOCKING CHECKS (must pass to proceed)
    // ========================================

    // 1. Truncation Check
    if (checkTruncation) {
      const truncationResult = this.checkTruncation(content, textContent, targetWordCount, faqs)
      if (truncationResult.isTruncated) {
        result.isBlocked = true
        result.isValid = false
        result.blockingIssues.push({
          type: 'truncation',
          severity: 'critical',
          message: truncationResult.reason,
          details: truncationResult.details,
        })
      }
    }

    // 2. Placeholder Detection
    if (checkPlaceholders) {
      const placeholderResult = this.checkPlaceholders(content)
      if (placeholderResult.hasPlaceholders) {
        result.isBlocked = true
        result.isValid = false
        result.blockingIssues.push({
          type: 'placeholder_content',
          severity: 'critical',
          message: 'Content contains placeholder/template text that must be replaced',
          matches: placeholderResult.matches,
        })
      }
    }

    // ========================================
    // WARNING CHECKS (flagged for review)
    // ========================================

    // 3. Statistics Detection
    if (checkStatistics) {
      const statsResult = this.checkStatistics(content)
      if (statsResult.hasUnverifiedStats) {
        result.requiresReview = true
        result.warnings.push({
          type: 'unverified_statistics',
          severity: 'warning',
          message: `Found ${statsResult.matches.length} unverified statistical claim(s) that may be hallucinated`,
          matches: statsResult.matches,
          recommendation: 'Verify these statistics with authoritative sources or rephrase to remove specific numbers',
        })
      }
    }

    // 4. Legislation Detection
    if (checkLegislation) {
      const legislationResult = this.checkLegislation(content)
      if (legislationResult.hasLegislationRefs) {
        result.requiresReview = true
        result.warnings.push({
          type: 'unverified_legislation',
          severity: 'warning',
          message: `Found ${legislationResult.matches.length} legislative reference(s) that may be hallucinated`,
          matches: legislationResult.matches,
          recommendation: 'Verify these legal references or remove specific bill/act numbers',
        })
      }
    }

    // 5. School Name Validation
    if (checkSchoolNames) {
      const schoolResult = await this.checkSchoolNames(content)
      if (schoolResult.hasUnknownSchools) {
        result.requiresReview = true
        result.warnings.push({
          type: 'unknown_schools',
          severity: 'warning',
          message: `Found ${schoolResult.unknownSchools.length} school name(s) not in GetEducated database`,
          matches: schoolResult.unknownSchools,
          recommendation: 'Verify these schools exist and have GetEducated pages, or remove specific mentions',
        })
      }
    }

    // 6. Internal Link Validation
    if (checkInternalLinks) {
      const linkResult = await this.checkInternalLinks(content)
      result.metrics.internalLinkCount = linkResult.validLinks.length
      result.metrics.invalidLinkCount = linkResult.invalidLinks.length

      if (linkResult.validLinks.length < 3) {
        // This could be blocking or warning depending on strictness
        result.warnings.push({
          type: 'insufficient_internal_links',
          severity: 'major',
          message: `Only ${linkResult.validLinks.length} valid internal link(s) found (minimum 3 required)`,
          validLinks: linkResult.validLinks,
          recommendation: 'Add more internal links to GetEducated articles',
        })
      }

      if (linkResult.invalidLinks.length > 0) {
        result.warnings.push({
          type: 'invalid_internal_links',
          severity: 'minor',
          message: `Found ${linkResult.invalidLinks.length} internal link(s) that don't exist in the catalog`,
          invalidLinks: linkResult.invalidLinks,
          recommendation: 'Verify these URLs exist or replace with valid GetEducated article links',
        })
      }
    }

    // ========================================
    // CALCULATE RISK LEVEL
    // ========================================
    result.riskLevel = this.calculateRiskLevel(result)

    // Combine all issues
    result.issues = [...result.blockingIssues, ...result.warnings]

    return result
  }

  // ============================================
  // INDIVIDUAL VALIDATION METHODS
  // ============================================

  /**
   * Check for content truncation
   * UPDATED: Much more lenient to avoid false positives on valid AI-generated content
   */
  checkTruncation(htmlContent, textContent, targetWordCount, faqs = []) {
    const result = {
      isTruncated: false,
      reason: '',
      details: {},
    }

    // Check 1: Word count significantly below target (less than 50% - very lenient)
    const wordCount = this.countWords(textContent)
    const minExpected = targetWordCount * 0.5
    if (wordCount < minExpected && wordCount < 500) {
      // Only flag if BOTH below 50% target AND very short (under 500 words)
      result.details.wordCount = wordCount
      result.details.expected = targetWordCount
      // Still don't mark as truncated - could just be concise content
    }

    // Check 2: Content ends mid-tag (most definitive truncation signal)
    const trimmedContent = htmlContent.trim()

    // ONLY check for the most DEFINITIVE truncation patterns
    // These are things that absolutely cannot appear in valid content
    const definiteTruncationPatterns = [
      // Incomplete HTML tags (opening tag that was cut off mid-attribute)
      /<[a-z]+\s+[a-z]+\s*=\s*["'][^"']*$/i,
      // Incomplete HTML entities at the very end
      /&[a-z]{1,6}$/i,
      /&#\d{1,4}$/,
      // Obvious mid-word truncation (word cut off with no space after)
      /\s[a-z]{1,3}$/i, // Single short word at end with no punctuation (like "the" "and" "or")
    ]

    for (const pattern of definiteTruncationPatterns) {
      if (pattern.test(trimmedContent)) {
        result.isTruncated = true
        result.reason = 'Content appears to end mid-tag or mid-word'
        result.details.indicator = pattern.toString()
        result.details.ending = trimmedContent.slice(-100)
        return result
      }
    }

    // Check 3: REMOVED - Don't check for "valid endings" as this causes too many false positives
    // AI-generated HTML content can end in many valid ways that don't match our patterns
    // The old check was: hasValidEnding + TRUNCATION_INDICATORS which was too aggressive

    // Check 4: FAQ answers are incomplete (only if FAQs exist and are very short)
    if (faqs && faqs.length > 0) {
      for (let i = 0; i < faqs.length; i++) {
        const faq = faqs[i]
        if (faq.answer) {
          const answer = faq.answer.trim()
          // Only flag if answer is very short (under 20 chars) AND doesn't end with punctuation
          // This catches obviously truncated answers like "The main benefit is th"
          if (answer.length > 5 && answer.length < 20 && !answer.match(/[.!?]$/)) {
            result.isTruncated = true
            result.reason = `FAQ answer ${i + 1} appears to be truncated (too short)`
            result.details.faqIndex = i
            result.details.answerEnding = answer
            return result
          }
        }
      }
    }

    // Check 5: Missing expected sections - just log, don't flag
    const hasConclusion = /conclusion|summary|wrap|final\s+thoughts|key\s+takeaways/i.test(textContent)
    const hasFAQSection = /frequently\s+asked|faq|questions/i.test(textContent)

    if (wordCount > 1000 && !hasConclusion && !hasFAQSection) {
      result.details.missingConclusion = true
      // Don't block - this is informational only
    }

    return result
  }

  /**
   * Check for placeholder/template content
   */
  checkPlaceholders(content) {
    const result = {
      hasPlaceholders: false,
      matches: [],
    }

    for (const pattern of PLACEHOLDER_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0

      let match
      while ((match = pattern.exec(content)) !== null) {
        result.hasPlaceholders = true
        result.matches.push({
          text: match[0].trim(),
          pattern: pattern.toString(),
          position: match.index,
        })
      }
    }

    // Deduplicate matches by text
    const seen = new Set()
    result.matches = result.matches.filter(m => {
      if (seen.has(m.text)) return false
      seen.add(m.text)
      return true
    })

    return result
  }

  /**
   * Check for unverified statistics
   */
  checkStatistics(content) {
    const result = {
      hasUnverifiedStats: false,
      matches: [],
    }

    for (const pattern of STATISTICS_PATTERNS) {
      pattern.lastIndex = 0

      let match
      while ((match = pattern.exec(content)) !== null) {
        // Skip if this looks like it might have a valid citation
        const context = content.slice(Math.max(0, match.index - 50), match.index + match[0].length + 50)
        const hasCitation = /BLS|Bureau of Labor|NCES|Department of Education|geteducated\.com/i.test(context)

        if (!hasCitation) {
          result.hasUnverifiedStats = true
          result.matches.push({
            text: match[0].trim(),
            context: context.replace(/<[^>]*>/g, '').trim(),
            position: match.index,
          })
        }
      }
    }

    // Deduplicate
    const seen = new Set()
    result.matches = result.matches.filter(m => {
      if (seen.has(m.text)) return false
      seen.add(m.text)
      return true
    })

    return result
  }

  /**
   * Check for unverified legislation references
   */
  checkLegislation(content) {
    const result = {
      hasLegislationRefs: false,
      matches: [],
    }

    for (const pattern of LEGISLATION_PATTERNS) {
      pattern.lastIndex = 0

      let match
      while ((match = pattern.exec(content)) !== null) {
        result.hasLegislationRefs = true

        const context = content.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30)
        result.matches.push({
          text: match[0].trim(),
          context: context.replace(/<[^>]*>/g, '').trim(),
          position: match.index,
        })
      }
    }

    // Deduplicate
    const seen = new Set()
    result.matches = result.matches.filter(m => {
      if (seen.has(m.text)) return false
      seen.add(m.text)
      return true
    })

    return result
  }

  /**
   * Check school names against known database
   */
  async checkSchoolNames(content) {
    const result = {
      hasUnknownSchools: false,
      knownSchools: [],
      unknownSchools: [],
    }

    // Extract potential school names from content
    const schoolMentions = this.extractSchoolNames(content)

    if (schoolMentions.length === 0) {
      return result
    }

    // Get known schools from cache or database
    const knownSchools = await this.getKnownSchools()
    const knownSchoolNames = new Set(knownSchools.map(s => s.name.toLowerCase()))
    const knownSchoolAliases = new Set(knownSchools.flatMap(s => (s.aliases || []).map(a => a.toLowerCase())))

    for (const mention of schoolMentions) {
      const lowerMention = mention.toLowerCase()

      // Check if it's a known school or alias
      const isKnown = knownSchoolNames.has(lowerMention) ||
                      knownSchoolAliases.has(lowerMention) ||
                      this.fuzzyMatchSchool(lowerMention, knownSchools)

      if (isKnown) {
        result.knownSchools.push(mention)
      } else {
        result.hasUnknownSchools = true
        result.unknownSchools.push(mention)
      }
    }

    return result
  }

  /**
   * Extract potential school names from content
   */
  extractSchoolNames(content) {
    const schools = []

    // Pattern for "University of X" or "X University" or "X College"
    const patterns = [
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+University\b/g,
      /\bUniversity\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+College\b/g,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+State\s+University\b/g,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+Institute\s+of\s+Technology\b/g,
    ]

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(content)) !== null) {
        schools.push(match[0])
      }
    }

    // Deduplicate
    return [...new Set(schools)]
  }

  /**
   * Fuzzy match school name against known schools
   */
  fuzzyMatchSchool(mention, knownSchools) {
    // Simple fuzzy matching - check if mention contains key parts of known school names
    for (const school of knownSchools) {
      const schoolLower = school.name.toLowerCase()

      // Check for substantial overlap
      const mentionWords = mention.split(/\s+/)
      const schoolWords = schoolLower.split(/\s+/)

      const commonWords = mentionWords.filter(w =>
        w.length > 3 && schoolWords.some(sw => sw.includes(w) || w.includes(sw))
      )

      if (commonWords.length >= 2) {
        return true
      }
    }
    return false
  }

  /**
   * Get known schools from database with caching
   */
  async getKnownSchools() {
    // Check cache
    if (this.schoolCache && this.schoolCacheExpiry && Date.now() < this.schoolCacheExpiry) {
      return this.schoolCache
    }

    try {
      // Try geteducated_schools table first
      let { data, error } = await supabase
        .from('geteducated_schools')
        .select('name, aliases')
        .limit(500)

      if (error || !data || data.length === 0) {
        // Fallback: extract school names from ranking_report_entries
        const { data: rankingData, error: rankingError } = await supabase
          .from('ranking_report_entries')
          .select('school_name')
          .limit(500)

        if (!rankingError && rankingData) {
          data = rankingData.map(r => ({ name: r.school_name, aliases: [] }))
        } else {
          data = []
        }
      }

      // Cache the results
      this.schoolCache = data
      this.schoolCacheExpiry = Date.now() + this.CACHE_TTL

      return data
    } catch (error) {
      console.error('[ContentValidator] Error fetching known schools:', error)
      return []
    }
  }

  /**
   * Check internal links point to real GetEducated articles
   */
  async checkInternalLinks(content) {
    const result = {
      validLinks: [],
      invalidLinks: [],
    }

    // Extract all GetEducated internal links
    const linkPattern = /<a\s+[^>]*href=["'](https?:\/\/(?:www\.)?geteducated\.com[^"']+)["'][^>]*>/gi
    let match

    const links = []
    while ((match = linkPattern.exec(content)) !== null) {
      links.push(match[1])
    }

    if (links.length === 0) {
      return result
    }

    // Deduplicate
    const uniqueLinks = [...new Set(links)]

    // Check each link against the catalog
    for (const url of uniqueLinks) {
      const exists = await this.checkUrlExists(url)
      if (exists) {
        result.validLinks.push(url)
      } else {
        result.invalidLinks.push(url)
      }
    }

    return result
  }

  /**
   * Check if a GetEducated URL exists in the catalog
   */
  async checkUrlExists(url) {
    try {
      // Normalize URL
      const normalizedUrl = url.replace(/\/$/, '').toLowerCase()

      // Check geteducated_articles table
      const { data, error } = await supabase
        .from('geteducated_articles')
        .select('id')
        .ilike('url', `%${normalizedUrl}%`)
        .limit(1)

      if (!error && data && data.length > 0) {
        return true
      }

      // If not found, check if it's a structural URL (rankings, degrees, schools)
      const structuralPaths = [
        '/online-college-ratings-and-rankings/',
        '/online-degrees/',
        '/online-schools/',
        '/article-contributors/',
      ]

      return structuralPaths.some(path => normalizedUrl.includes(path))
    } catch (error) {
      console.error('[ContentValidator] Error checking URL:', error)
      return false // Assume invalid on error
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Strip HTML tags from content
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  /**
   * Count words in text
   */
  countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length
  }

  /**
   * Calculate overall risk level
   */
  calculateRiskLevel(result) {
    if (result.isBlocked) {
      return 'CRITICAL'
    }

    const warningCount = result.warnings.length
    const hasMajorWarnings = result.warnings.some(w => w.severity === 'major')
    const hasStatisticsWarning = result.warnings.some(w => w.type === 'unverified_statistics')
    const hasLegislationWarning = result.warnings.some(w => w.type === 'unverified_legislation')

    if (hasMajorWarnings || (hasStatisticsWarning && hasLegislationWarning)) {
      return 'HIGH'
    }

    if (warningCount >= 2 || hasStatisticsWarning || hasLegislationWarning) {
      return 'MEDIUM'
    }

    return 'LOW'
  }

  /**
   * Get a summary of validation results for logging
   */
  getSummary(result) {
    return {
      status: result.isBlocked ? 'BLOCKED' : (result.requiresReview ? 'NEEDS_REVIEW' : 'PASSED'),
      riskLevel: result.riskLevel,
      blockingIssueCount: result.blockingIssues.length,
      warningCount: result.warnings.length,
      metrics: result.metrics,
    }
  }
}

// ============================================
// ANTI-HALLUCINATION PROMPT RULES
// ============================================

/**
 * Standard anti-hallucination rules to inject into AI prompts
 */
export const ANTI_HALLUCINATION_RULES = `
=== CRITICAL: ANTI-HALLUCINATION RULES ===

NEVER fabricate or invent:
1. STATISTICS: Never cite percentages, survey results, or specific numbers unless provided in source data
   - BAD: "73% of students prefer online learning"
   - GOOD: "Many students prefer online learning"

2. STUDIES/SURVEYS: Never reference specific studies, surveys, or research unless provided
   - BAD: "According to a 2024 survey by the Online Learning Consortium..."
   - GOOD: "Research suggests..." or "Experts note that..."

3. SCHOOL NAMES: Never invent school names or use placeholders
   - BAD: "University A offers this program" or "[School Name]"
   - GOOD: Only mention schools if specific data is provided

4. LEGISLATION: Never cite specific bills, acts, or legal codes unless provided
   - BAD: "SB-1001 requires schools to..." or "The Education Act of 2024..."
   - GOOD: "State regulations may require..." or "Check with your state board for requirements"

5. ORGANIZATION NAMES: Never invent organization names or acronyms
   - BAD: "The National Online Education Association (NOEA) reports..."
   - GOOD: Only cite real organizations like BLS, NCES, DOE

INSTEAD OF SPECIFIC NUMBERS, USE:
- "Many students find..." instead of "73% of students..."
- "Research suggests..." instead of "A 2024 study found..."
- "Significant savings" instead of "$5,000 less"
- "Check current requirements" instead of citing specific regulations

=== END ANTI-HALLUCINATION RULES ===
`

/**
 * FIX: Ideas → Article Mismatch
 * Validate that generated content matches the original idea intent
 * @param {string} content - Generated HTML content
 * @param {Object} idea - Original content idea
 * @returns {Object} Validation result with matches and mismatches
 */
export function validateIdeaAlignment(content, idea) {
  const result = {
    isAligned: true,
    matches: [],
    mismatches: [],
    warnings: [],
    score: 100,
  }

  if (!content || !idea) {
    result.warnings.push('Missing content or idea for alignment check')
    return result
  }

  const contentLower = content.toLowerCase()
  const contentText = content.replace(/<[^>]*>/g, ' ').toLowerCase()

  // Check 1: Title keywords should appear in content
  if (idea.title) {
    const titleWords = idea.title.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4)
      .filter(w => !['online', 'degree', 'program', 'guide', 'best', 'programs'].includes(w))
    
    const missingTitleWords = titleWords.filter(word => !contentText.includes(word))
    
    if (missingTitleWords.length > titleWords.length / 2) {
      result.mismatches.push({
        type: 'title_mismatch',
        message: `Article missing key title words: ${missingTitleWords.join(', ')}`,
        severity: 'high',
      })
      result.isAligned = false
      result.score -= 30
    } else if (missingTitleWords.length > 0) {
      result.warnings.push(`Some title words not found: ${missingTitleWords.join(', ')}`)
      result.score -= 10
    } else {
      result.matches.push('Title keywords present in content')
    }
  }

  // Check 2: Featured schools MUST appear if specified
  if (idea.school_names?.length) {
    const missingSchools = idea.school_names.filter(school => 
      !contentLower.includes(school.toLowerCase())
    )
    
    if (missingSchools.length > 0) {
      result.mismatches.push({
        type: 'missing_schools',
        message: `CRITICAL: Article missing required schools: ${missingSchools.join(', ')}`,
        severity: 'critical',
      })
      result.isAligned = false
      result.score -= 50
    } else {
      result.matches.push(`All ${idea.school_names.length} featured schools mentioned`)
    }
  }

  // Check 3: Degree level should match
  if (idea.degree_level) {
    const levelTerms = {
      'associate': ['associate', "associate's"],
      'bachelors': ['bachelor', "bachelor's", 'undergraduate'],
      'masters': ['master', "master's", 'graduate'],
      'doctorate': ['doctorate', 'doctoral', 'phd', 'doctor'],
      'certificate': ['certificate', 'certification'],
    }
    
    const terms = levelTerms[idea.degree_level.toLowerCase()] || [idea.degree_level.toLowerCase()]
    const hasLevel = terms.some(term => contentText.includes(term))
    
    if (!hasLevel) {
      result.mismatches.push({
        type: 'degree_level_mismatch',
        message: `Article doesn't mention the expected degree level: ${idea.degree_level}`,
        severity: 'medium',
      })
      result.score -= 15
    } else {
      result.matches.push(`Degree level (${idea.degree_level}) referenced`)
    }
  }

  // Check 4: Target keywords should appear
  if (idea.target_keywords?.length) {
    const foundKeywords = idea.target_keywords.filter(kw => 
      contentText.includes(kw.toLowerCase())
    )
    
    const missingKeywords = idea.target_keywords.filter(kw => 
      !contentText.includes(kw.toLowerCase())
    )
    
    if (missingKeywords.length > idea.target_keywords.length / 2) {
      result.warnings.push(`Many target keywords missing: ${missingKeywords.join(', ')}`)
      result.score -= 10
    }
    
    if (foundKeywords.length > 0) {
      result.matches.push(`${foundKeywords.length}/${idea.target_keywords.length} target keywords found`)
    }
  }

  // Check 5: Subject area alignment
  if (idea.monetization_category || idea.subject_area) {
    const subject = idea.monetization_category || idea.subject_area
    if (!contentText.includes(subject.toLowerCase())) {
      result.warnings.push(`Subject area "${subject}" not explicitly mentioned`)
      result.score -= 5
    }
  }

  // Clamp score
  result.score = Math.max(0, result.score)
  
  return result
}

/**
 * Quick validation for draft stage (less strict)
 */
export async function validateDraft(content, options = {}) {
  const validator = new ContentValidator()
  return validator.validate(content, {
    ...options,
    checkSchoolNames: false, // Skip slower checks for draft
    checkInternalLinks: false,
  })
}

/**
 * Full validation for pre-publish stage
 */
export async function validateForPublish(content, options = {}) {
  const validator = new ContentValidator()
  return validator.validate(content, options)
}

// Export singleton instance
export const contentValidator = new ContentValidator()

export default ContentValidator
