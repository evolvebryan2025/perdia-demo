/**
 * Cost Data Service for GetEducated
 * Retrieves cost/tuition data from ranking reports for AI RAG
 *
 * This is the ONLY approved source for cost data in generated content.
 * Never use external sources or invented numbers.
 */

import { supabase } from './supabaseClient'

/**
 * Search for relevant cost data based on topic/keywords
 * @param {string} topic - Article topic or title
 * @param {Object} options - Search options
 * @returns {Array} Relevant cost data entries
 */
export async function searchCostData(topic, options = {}) {
  const {
    degreeLevel = null,
    limit = 10,
    prioritizeSponsored = true,
  } = options

  if (!topic) return []

  // Extract keywords from topic
  const keywords = extractKeywords(topic)

  // Build search query
  let query = supabase
    .from('ranking_report_entries')
    .select(`
      *,
      ranking_reports!inner(
        report_title,
        report_url,
        degree_level,
        field_of_study
      )
    `)

  // Filter by degree level if specified
  if (degreeLevel) {
    query = query.ilike('degree_level', `%${degreeLevel}%`)
  }

  // Search by keywords in program name and school name
  // Note: Cannot filter on nested table (ranking_reports) inside or() - PostgREST limitation
  // Build a single OR condition with all keyword matches
  if (keywords.length > 0) {
    // Build OR conditions for each keyword against program_name and school_name only
    // Format: program_name.ilike.%kw1%,school_name.ilike.%kw1%,program_name.ilike.%kw2%,...
    const conditions = []
    for (const kw of keywords) {
      // Escape any special characters in keyword for safety
      const safeKw = kw.replace(/[%_]/g, '')
      if (safeKw.length > 0) {
        conditions.push(`program_name.ilike.%${safeKw}%`)
        conditions.push(`school_name.ilike.%${safeKw}%`)
      }
    }

    if (conditions.length > 0) {
      query = query.or(conditions.join(','))
    }
  }

  // Order by sponsorship status if prioritizing
  if (prioritizeSponsored) {
    query = query.order('is_sponsored', { ascending: false })
  }

  // Order by cost for "best buy" relevance
  query = query.order('total_cost', { ascending: true })
  query = query.limit(limit)

  const { data, error } = await query

  if (error) {
    console.error('Cost data search error:', error)
    return []
  }

  return data || []
}

/**
 * Get cost data for a specific school
 * @param {string} schoolName - School name to search
 * @returns {Array} Cost entries for the school
 */
export async function getCostBySchool(schoolName) {
  const { data, error } = await supabase
    .from('ranking_report_entries')
    .select(`
      *,
      ranking_reports(report_title, report_url)
    `)
    .ilike('school_name', `%${schoolName}%`)
    .order('total_cost', { ascending: true })
    .limit(20)

  if (error) {
    console.error('School cost lookup error:', error)
    return []
  }

  return data || []
}

/**
 * Get cost data for a specific program type
 * @param {string} programType - Program type (e.g., "MBA", "Nursing")
 * @param {string} degreeLevel - Degree level (e.g., "Master", "Bachelor")
 * @returns {Array} Cost entries for the program type
 */
export async function getCostByProgram(programType, degreeLevel = null) {
  let query = supabase
    .from('ranking_report_entries')
    .select(`
      *,
      ranking_reports(report_title, report_url, field_of_study)
    `)
    .ilike('program_name', `%${programType}%`)

  if (degreeLevel) {
    query = query.ilike('degree_level', `%${degreeLevel}%`)
  }

  query = query
    .order('is_sponsored', { ascending: false })
    .order('total_cost', { ascending: true })
    .limit(20)

  const { data, error } = await query

  if (error) {
    console.error('Program cost lookup error:', error)
    return []
  }

  return data || []
}

/**
 * Get top affordable programs (Best Buys)
 * @param {Object} filters - Filters for the search
 * @returns {Array} Top affordable programs
 */
export async function getTopAffordable(filters = {}) {
  const {
    degreeLevel = null,
    fieldOfStudy = null,
    limit = 10,
  } = filters

  let query = supabase
    .from('ranking_report_entries')
    .select(`
      *,
      ranking_reports(report_title, report_url, degree_level, field_of_study)
    `)
    .not('total_cost', 'is', null)

  if (degreeLevel) {
    query = query.ilike('degree_level', `%${degreeLevel}%`)
  }

  if (fieldOfStudy) {
    query = query.ilike('ranking_reports.field_of_study', `%${fieldOfStudy}%`)
  }

  query = query
    .order('total_cost', { ascending: true })
    .limit(limit)

  const { data, error } = await query

  if (error) {
    console.error('Top affordable lookup error:', error)
    return []
  }

  return data || []
}

/**
 * Format cost data for inclusion in AI prompts
 * @param {Array} costData - Array of cost data entries
 * @returns {string} Formatted string for AI prompt
 */
export function formatCostDataForPrompt(costData) {
  if (!costData || costData.length === 0) {
    return 'No specific cost data available from GetEducated ranking reports for this topic. Use qualitative language instead of specific numbers.'
  }

  let formatted = '=== APPROVED COST DATA FROM GETEDUCATED RANKING REPORTS ===\n\n'
  formatted += 'USE ONLY THESE NUMBERS FOR TUITION/COST INFORMATION:\n\n'

  for (const entry of costData) {
    formatted += `📊 ${entry.school_name} - ${entry.program_name}\n`

    if (entry.total_cost) {
      formatted += `   Total Cost: $${entry.total_cost.toLocaleString()}\n`
    }
    if (entry.in_state_cost) {
      formatted += `   In-State: $${entry.in_state_cost.toLocaleString()}\n`
    }
    if (entry.out_of_state_cost) {
      formatted += `   Out-of-State: $${entry.out_of_state_cost.toLocaleString()}\n`
    }
    if (entry.accreditation) {
      formatted += `   Accreditation: ${entry.accreditation}\n`
    }
    if (entry.is_sponsored) {
      formatted += `   ⭐ SPONSORED LISTING - Prioritize mentioning this program\n`
    }
    if (entry.geteducated_school_url) {
      formatted += `   Link to: ${entry.geteducated_school_url}\n`
    }
    if (entry.ranking_reports?.report_url) {
      formatted += `   Source: ${entry.ranking_reports.report_url}\n`
    }

    formatted += '\n'
  }

  formatted += '=== END APPROVED COST DATA ===\n'
  formatted += '\nIMPORTANT: Only use the numbers above. Do not invent or estimate costs.\n'
  formatted += 'If mentioning cost, cite GetEducated\'s ranking reports as the source.\n'

  return formatted
}

/**
 * Extract keywords from topic for searching
 * @param {string} topic - Topic string
 * @returns {Array} Array of keywords
 */
function extractKeywords(topic) {
  if (!topic) return []

  // Remove common words and extract meaningful keywords
  const stopWords = [
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'how', 'best', 'top', 'most', 'online', 'degree', 'program', 'programs',
    'guide', 'complete', 'ultimate', 'your'
  ]

  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))

  // Return unique keywords, max 5
  return [...new Set(words)].slice(0, 5)
}

/**
 * Get cost data context for an article idea
 * This is the main function to call before AI generation
 * @param {Object} idea - Content idea object
 * @returns {Object} Cost data context for AI
 */
export async function getCostDataContext(idea) {
  const topic = idea.title || idea.description || ''
  const seedTopics = idea.seed_topics || []

  // Determine degree level from topic
  let degreeLevel = null
  const topicLower = topic.toLowerCase()

  if (topicLower.includes('master') || topicLower.includes("master's") || topicLower.includes('mba')) {
    degreeLevel = 'Master'
  } else if (topicLower.includes('bachelor') || topicLower.includes("bachelor's")) {
    degreeLevel = 'Bachelor'
  } else if (topicLower.includes('associate')) {
    degreeLevel = 'Associate'
  } else if (topicLower.includes('doctorate') || topicLower.includes('phd') || topicLower.includes('doctoral')) {
    degreeLevel = 'Doctorate'
  } else if (topicLower.includes('certificate')) {
    degreeLevel = 'Certificate'
  }

  // Search for relevant cost data
  const costData = await searchCostData(topic, {
    degreeLevel,
    limit: 15,
    prioritizeSponsored: true,
  })

  // Also search by seed topics if available
  let additionalData = []
  for (const seedTopic of seedTopics.slice(0, 3)) {
    const seedData = await searchCostData(seedTopic, {
      degreeLevel,
      limit: 5,
    })
    additionalData.push(...seedData)
  }

  // Combine and deduplicate
  const allData = [...costData, ...additionalData]
  const uniqueData = allData.filter((item, index, self) =>
    index === self.findIndex(t => t.id === item.id)
  )

  // Prioritize sponsored listings
  uniqueData.sort((a, b) => {
    if (a.is_sponsored && !b.is_sponsored) return -1
    if (!a.is_sponsored && b.is_sponsored) return 1
    return (a.total_cost || 0) - (b.total_cost || 0)
  })

  return {
    costData: uniqueData.slice(0, 10),
    degreeLevel,
    hasData: uniqueData.length > 0,
    promptText: formatCostDataForPrompt(uniqueData.slice(0, 10)),
  }
}

/**
 * Find the best-match ranking reports for an article topic + degree levels.
 *
 * Tony's May 19 review: a cybersecurity article should link to
 * `bachelors-in-cyber-security-online` and `online-masters-cybersecurity`
 * ranking reports — not generic ones. Returns at most one report per
 * requested degree level, scored by token overlap between the topic and
 * the report's `field_of_study` / `report_title`.
 *
 * @param {string} topic - Article topic/title.
 * @param {Array<string>} degreeLevelNames - e.g. ["Bachelor's", "Master's"].
 *        If empty, returns the single best match overall.
 * @returns {Promise<Array<{report_title, report_url, degree_level, field_of_study, score}>>}
 */
export async function findRelevantRankingReports(topic, degreeLevelNames = []) {
  if (!topic) return []

  const { data: reports, error } = await supabase
    .from('ranking_reports')
    .select('id, report_title, report_url, degree_level, field_of_study')

  if (error || !reports?.length) return []

  const topicTokens = extractKeywords(topic)
  if (!topicTokens.length) return []

  const scoreReport = (report) => {
    const haystack = `${report.report_title || ''} ${report.field_of_study || ''}`.toLowerCase()
    let score = 0
    for (const token of topicTokens) {
      if (haystack.includes(token)) score += 10
    }
    // Exact field_of_study contained in topic is the strongest signal
    if (report.field_of_study && topic.toLowerCase().includes(report.field_of_study.toLowerCase())) {
      score += 25
    }
    return score
  }

  const scored = reports
    .map((r) => ({ ...r, score: scoreReport(r) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  if (degreeLevelNames.length === 0) {
    return scored.slice(0, 1)
  }

  // One report per requested degree level
  const picked = []
  const seen = new Set()
  for (const wantedLevel of degreeLevelNames) {
    const match = scored.find(
      (r) => !seen.has(r.id) && r.degree_level?.toLowerCase().includes(wantedLevel.toLowerCase())
    )
    if (match) {
      picked.push(match)
      seen.add(match.id)
    }
  }
  return picked
}

export default {
  searchCostData,
  getCostBySchool,
  getCostByProgram,
  getTopAffordable,
  formatCostDataForPrompt,
  getCostDataContext,
  findRelevantRankingReports,
}
