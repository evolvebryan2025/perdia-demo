/**
 * Fact Checker Service
 * FIX #3: Validates statistics and claims in generated content
 * 
 * The problem: AI generates statistics that look plausible but aren't verified
 * Example: "The average RN salary is $85,000" - but where did this come from?
 * 
 * This service:
 * 1. Extracts all statistics and claims from content
 * 2. Checks if they have citations
 * 3. Flags uncited statistics for review
 * 4. Validates cited statistics against known data sources
 */

import { supabase } from '../supabaseClient'

// Common statistical patterns to detect
const STATISTIC_PATTERNS = [
  // Dollar amounts
  /\$[\d,]+(?:\.\d{2})?(?:\s*(?:per\s+(?:year|month|hour|credit)|annually|a\s+year))?/gi,
  // Percentages
  /\d+(?:\.\d+)?%/g,
  // "X out of Y" or "X in Y"
  /\d+\s+(?:out\s+of|in)\s+\d+/gi,
  // "X to Y" ranges
  /\$?[\d,]+\s*(?:to|-)\s*\$?[\d,]+/g,
  // Growth/increase/decrease statements
  /(?:increase|decrease|grow|decline|rise|fall)(?:d|s|ing)?\s+(?:by\s+)?\d+(?:\.\d+)?%/gi,
  // Employment statistics
  /\d+(?:,\d{3})*\s+(?:jobs?|positions?|openings?|workers?|employees?)/gi,
  // Year references with statistics
  /(?:by|in|since|from)\s+20\d{2}/gi,
]

// Known authoritative sources for different data types
const AUTHORITATIVE_SOURCES = {
  salary: ['bls.gov', 'stats.bls.gov', 'indeed.com', 'glassdoor.com', 'payscale.com'],
  employment: ['bls.gov', 'stats.bls.gov', 'dol.gov'],
  education: ['nces.ed.gov', 'ed.gov', 'collegescorecard.ed.gov'],
  accreditation: ['chea.org', 'ed.gov'],
  cost: ['geteducated.com', 'collegescorecard.ed.gov', 'finaid.org'],
}

/**
 * Extract all statistics and claims from HTML content
 * @param {string} content - HTML content to analyze
 * @returns {Object[]} Array of extracted statistics with context
 */
export function extractStatistics(content) {
  if (!content) return []
  
  // Strip HTML tags for text analysis
  const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  
  const statistics = []
  const seenValues = new Set() // Deduplicate
  
  for (const pattern of STATISTIC_PATTERNS) {
    let match
    // Reset regex state
    pattern.lastIndex = 0
    
    while ((match = pattern.exec(text)) !== null) {
      const value = match[0].trim()
      
      // Skip if we've already seen this value
      if (seenValues.has(value)) continue
      seenValues.add(value)
      
      // Get surrounding context (100 chars before and after)
      const start = Math.max(0, match.index - 100)
      const end = Math.min(text.length, match.index + value.length + 100)
      const context = text.substring(start, end).trim()
      
      // Determine type of statistic
      let type = 'unknown'
      if (value.includes('$') || value.toLowerCase().includes('salary') || context.toLowerCase().includes('salary') || context.toLowerCase().includes('cost')) {
        type = 'salary'
      } else if (value.includes('%')) {
        type = 'percentage'
      } else if (context.toLowerCase().includes('job') || context.toLowerCase().includes('employ')) {
        type = 'employment'
      }
      
      // Check if there's a nearby link (citation)
      const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>/gi
      let hasCitation = false
      let citationUrl = null
      
      // Search for links within 200 chars of the statistic in original HTML
      const searchStart = Math.max(0, content.indexOf(value) - 200)
      const searchEnd = Math.min(content.length, content.indexOf(value) + value.length + 200)
      const searchArea = content.substring(searchStart, searchEnd)
      
      const linkMatch = linkPattern.exec(searchArea)
      if (linkMatch) {
        hasCitation = true
        citationUrl = linkMatch[1]
      }
      
      statistics.push({
        value,
        type,
        context,
        hasCitation,
        citationUrl,
        isVerified: false,
        verificationStatus: hasCitation ? 'pending' : 'uncited',
      })
    }
  }
  
  return statistics
}

/**
 * Check if a citation URL is from an authoritative source
 * @param {string} url - URL to check
 * @param {string} type - Type of statistic (salary, employment, etc.)
 * @returns {Object} { isAuthoritative, domain, reason }
 */
export function checkCitationAuthority(url, type) {
  if (!url) return { isAuthoritative: false, domain: null, reason: 'No URL provided' }
  
  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.toLowerCase().replace(/^www\./, '')
    
    // Check if it's from GetEducated (always valid for cost data)
    if (domain.includes('geteducated.com')) {
      return { isAuthoritative: true, domain, reason: 'GetEducated internal source' }
    }
    
    // Check against authoritative sources for this type
    const validSources = AUTHORITATIVE_SOURCES[type] || []
    const isValid = validSources.some(source => domain.includes(source))
    
    if (isValid) {
      return { isAuthoritative: true, domain, reason: `Authoritative ${type} source` }
    }
    
    // Check if it's a government source
    if (domain.endsWith('.gov')) {
      return { isAuthoritative: true, domain, reason: 'Government source' }
    }
    
    // Check if it's an accreditation body
    if (domain.endsWith('.edu') && type === 'accreditation') {
      return { isAuthoritative: true, domain, reason: 'Educational institution (accreditation context)' }
    }
    
    return { isAuthoritative: false, domain, reason: 'Source not in authoritative list' }
    
  } catch (e) {
    return { isAuthoritative: false, domain: null, reason: 'Invalid URL format' }
  }
}

/**
 * Validate all statistics in content
 * @param {string} content - HTML content
 * @returns {Object} Validation results
 */
export function validateStatistics(content) {
  const statistics = extractStatistics(content)
  
  const results = {
    totalStatistics: statistics.length,
    citedStatistics: 0,
    uncitedStatistics: 0,
    authoritativeCitations: 0,
    weakCitations: 0,
    issues: [],
    warnings: [],
    statistics: [],
  }
  
  for (const stat of statistics) {
    if (stat.hasCitation) {
      results.citedStatistics++
      
      const authority = checkCitationAuthority(stat.citationUrl, stat.type)
      stat.authorityCheck = authority
      
      if (authority.isAuthoritative) {
        results.authoritativeCitations++
        stat.verificationStatus = 'authoritative'
      } else {
        results.weakCitations++
        stat.verificationStatus = 'weak_citation'
        results.warnings.push({
          type: 'weak_citation',
          statistic: stat.value,
          context: stat.context.substring(0, 80) + '...',
          citation: stat.citationUrl,
          reason: authority.reason,
          suggestion: `Consider citing from: ${(AUTHORITATIVE_SOURCES[stat.type] || ['bls.gov', 'ed.gov']).join(', ')}`,
        })
      }
    } else {
      results.uncitedStatistics++
      results.issues.push({
        type: 'uncited_statistic',
        statistic: stat.value,
        context: stat.context.substring(0, 80) + '...',
        severity: stat.type === 'salary' ? 'high' : 'medium',
        suggestion: 'Add a citation from an authoritative source, or rephrase to be less specific',
      })
    }
    
    results.statistics.push(stat)
  }
  
  // Calculate overall score
  results.score = results.totalStatistics > 0
    ? Math.round((results.authoritativeCitations / results.totalStatistics) * 100)
    : 100
    
  results.isValid = results.uncitedStatistics === 0 && results.weakCitations === 0
  results.requiresReview = results.issues.length > 0
  
  return results
}

/**
 * Get cost data from ranking reports for validation
 * @param {string} topic - Topic to search for
 * @returns {Object[]} Matching cost data entries
 */
export async function getCostDataForValidation(topic) {
  try {
    const keywords = topic.toLowerCase().split(' ').filter(w => w.length > 3)
    
    const { data, error } = await supabase
      .from('ranking_report_entries')
      .select(`
        *,
        ranking_reports(title, url, report_date)
      `)
      .limit(50)
    
    if (error) throw error
    
    // Filter by keyword relevance
    return (data || []).filter(entry => {
      const entryText = `${entry.school_name} ${entry.program_name} ${entry.degree_level}`.toLowerCase()
      return keywords.some(kw => entryText.includes(kw))
    })
    
  } catch (error) {
    console.error('[FactChecker] Error fetching cost data:', error)
    return []
  }
}

/**
 * Validate a specific dollar amount against ranking report data
 * @param {string} amount - Dollar amount string (e.g., "$15,000")
 * @param {string} context - Surrounding text context
 * @returns {Object} Validation result
 */
export async function validateCostClaim(amount, context) {
  // Parse the dollar amount
  const numericValue = parseFloat(amount.replace(/[$,]/g, ''))
  if (isNaN(numericValue)) {
    return { isValid: false, reason: 'Could not parse amount' }
  }
  
  // Get relevant cost data
  const costData = await getCostDataForValidation(context)
  
  if (costData.length === 0) {
    return { 
      isValid: false, 
      reason: 'No matching cost data in ranking reports',
      suggestion: 'Remove specific dollar amount or add citation to external source',
    }
  }
  
  // Check if the claimed amount is within a reasonable range of our data
  const costs = costData.map(d => d.total_cost || d.cost_per_credit * 30).filter(c => c > 0)
  if (costs.length === 0) {
    return { isValid: false, reason: 'Cost data unavailable' }
  }
  
  const minCost = Math.min(...costs)
  const maxCost = Math.max(...costs)
  
  // Allow 20% variance
  const isInRange = numericValue >= minCost * 0.8 && numericValue <= maxCost * 1.2
  
  return {
    isValid: isInRange,
    claimedAmount: numericValue,
    dataRange: { min: minCost, max: maxCost },
    matchingPrograms: costData.length,
    reason: isInRange 
      ? 'Amount is within expected range based on ranking reports'
      : `Amount ${numericValue} is outside expected range ($${minCost.toLocaleString()} - $${maxCost.toLocaleString()})`,
  }
}

/**
 * Full content validation for statistics
 * Returns actionable feedback for the content editor
 * @param {string} content - HTML content to validate
 * @param {Object} options - Validation options
 * @returns {Object} Complete validation report
 */
export async function validateContentStatistics(content, options = {}) {
  const { 
    strictMode = false, // If true, fail on any uncited statistic
    checkCostData = true, // Validate costs against ranking reports
  } = options
  
  const validation = validateStatistics(content)
  
  // Additional cost validation if enabled
  if (checkCostData) {
    const costStats = validation.statistics.filter(s => 
      s.type === 'salary' && s.value.includes('$')
    )
    
    for (const stat of costStats) {
      const costValidation = await validateCostClaim(stat.value, stat.context)
      stat.costValidation = costValidation
      
      if (!costValidation.isValid) {
        validation.issues.push({
          type: 'cost_mismatch',
          statistic: stat.value,
          context: stat.context.substring(0, 80) + '...',
          severity: 'high',
          reason: costValidation.reason,
          suggestion: costValidation.suggestion || 'Verify this cost claim against ranking report data',
        })
      }
    }
  }
  
  // Determine if content passes validation
  validation.passed = strictMode 
    ? validation.isValid 
    : validation.issues.filter(i => i.severity === 'high').length === 0
    
  return validation
}

export default {
  extractStatistics,
  validateStatistics,
  checkCitationAuthority,
  getCostDataForValidation,
  validateCostClaim,
  validateContentStatistics,
  AUTHORITATIVE_SOURCES,
}
