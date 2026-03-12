/**
 * Subject Matcher Service
 * Ensures internal links are relevant by matching article subjects
 *
 * FIX #1: Digital Ministry articles were linking to MBA content because
 * word overlap ("online", "degree") outweighed subject relevance.
 *
 * FIX #2: Internal links always pointed to articles, ignoring more valuable
 * BERP and Ranking pages. Added page type detection from URL patterns and
 * multiplier-based scoring to prioritize BERPs > Ranks > Articles > Schools.
 *
 * This service:
 * 1. Detects the subject area from article title/topics
 * 2. Maps subjects to related subjects (affinity groups)
 * 3. Filters link candidates to only same/related subjects
 * 4. Detects page type from URL patterns (BERP, Rank, Article, School)
 * 5. Applies page type multipliers to boost high-value pages
 * 6. Selects a diverse mix of page types in final link set
 */

// Subject area definitions with keywords for detection
// Based on GetEducated's content taxonomy
export const SUBJECT_AREAS = {
  business: {
    keywords: ['business', 'mba', 'management', 'marketing', 'finance', 'accounting', 'entrepreneurship', 'leadership', 'economics', 'commerce', 'administration'],
    label: 'Business',
  },
  nursing: {
    keywords: ['nursing', 'nurse', 'rn', 'bsn', 'msn', 'dnp', 'lpn', 'healthcare', 'clinical'],
    label: 'Nursing',
  },
  healthcare: {
    keywords: ['healthcare', 'health', 'medical', 'public health', 'health administration', 'hsa', 'mha', 'epidemiology', 'gerontology'],
    label: 'Healthcare',
  },
  education: {
    keywords: ['education', 'teaching', 'teacher', 'curriculum', 'instruction', 'pedagogy', 'mat', 'med', 'edd', 'principal', 'superintendent', 'educational leadership'],
    label: 'Education',
  },
  technology: {
    keywords: ['technology', 'computer', 'it', 'information technology', 'cybersecurity', 'data science', 'software', 'programming', 'web development', 'artificial intelligence', 'ai', 'machine learning'],
    label: 'Technology',
  },
  psychology: {
    keywords: ['psychology', 'counseling', 'mental health', 'therapy', 'behavioral', 'clinical psychology', 'organizational psychology'],
    label: 'Psychology',
  },
  social_work: {
    keywords: ['social work', 'msw', 'bsw', 'lcsw', 'social services', 'human services', 'community services'],
    label: 'Social Work',
  },
  criminal_justice: {
    keywords: ['criminal justice', 'law enforcement', 'criminology', 'corrections', 'forensic', 'homeland security', 'public safety'],
    label: 'Criminal Justice',
  },
  religion: {
    keywords: ['religion', 'ministry', 'theology', 'divinity', 'biblical', 'christian', 'pastoral', 'church', 'seminary', 'faith'],
    label: 'Religion & Ministry',
  },
  liberal_arts: {
    keywords: ['liberal arts', 'humanities', 'english', 'history', 'philosophy', 'communications', 'journalism', 'writing', 'literature'],
    label: 'Liberal Arts',
  },
  science: {
    keywords: ['science', 'biology', 'chemistry', 'physics', 'environmental', 'natural science'],
    label: 'Science',
  },
  engineering: {
    keywords: ['engineering', 'electrical', 'mechanical', 'civil', 'industrial'],
    label: 'Engineering',
  },
  law: {
    keywords: ['law', 'legal', 'paralegal', 'juris', 'attorney'],
    label: 'Law',
  },
  hospitality: {
    keywords: ['hospitality', 'hotel', 'tourism', 'restaurant', 'culinary', 'event management'],
    label: 'Hospitality',
  },
}

// Subject affinity groups - subjects that are related enough to cross-link
// Key = subject, Value = array of related subjects
export const SUBJECT_AFFINITY = {
  business: ['accounting', 'finance', 'marketing', 'leadership'],
  nursing: ['healthcare'],
  healthcare: ['nursing', 'public_health', 'gerontology'],
  education: ['curriculum', 'instruction'],
  psychology: ['counseling', 'social_work', 'mental_health'],
  social_work: ['psychology', 'counseling', 'human_services'],
  criminal_justice: ['law', 'public_safety'],
  religion: [], // Religion is very specific - don't cross-link
  liberal_arts: ['communications', 'journalism', 'english'],
  technology: ['data_science', 'cybersecurity'],
}

// =====================================================
// PAGE TYPE DETECTION & SCORING
// =====================================================

/**
 * Page type priority order: BERP > Rank > School > Article
 * BERPs (Browse Education Results Pages) are the most valuable for SEO
 * because they are browse/filter pages that aggregate content.
 * School/program pages are prioritized over generic blog posts.
 *
 * Multipliers are applied to the base relevance score after subject/topic scoring.
 */
export const PAGE_TYPE_MULTIPLIERS = {
  berp: 4.0,     // BERPs - highest value (browse/filter pages)
  rank: 3.0,     // Rankings/comparisons - second highest
  school: 2.0,   // School/program profile pages - prioritize over blog posts
  article: 1.0,  // Articles/blog posts - baseline (no boost)
}

/**
 * Labels for page types (used in logging/debugging)
 */
export const PAGE_TYPE_LABELS = {
  berp: 'BERP (Browse Education Results Page)',
  rank: 'Ranking/Comparison Page',
  school: 'School/Program Profile Page',
  article: 'Article/Blog Post',
}

/**
 * Detect the page type from a GetEducated URL pattern.
 *
 * GetEducated URL patterns:
 * - BERPs: /online-degrees/... or /online-schools/... (browse/filter pages, NOT individual school profiles)
 * - Ranks: /online-college-ratings-and-rankings/...
 * - Articles: /blog/... or /articles/... or general content paths
 * - Schools: /online-schools/[school-name] (individual school profile pages)
 *
 * The distinction between a BERP /online-schools/ page and a School profile:
 * - /online-schools/ alone or with filter segments (e.g., /online-schools/bachelors/) = BERP
 * - /online-schools/[specific-school-slug] with a recognizable school name = School
 *
 * @param {string} url - Full URL or path (e.g., "https://geteducated.com/online-degrees/bachelors/business/")
 * @returns {string} One of: 'berp', 'rank', 'article', 'school'
 */
export function getPageType(url) {
  if (!url) return 'article'

  // Normalize: extract pathname, lowercase, remove trailing slash for consistency
  let path = url
  try {
    // Handle full URLs
    if (url.startsWith('http')) {
      path = new URL(url).pathname
    }
  } catch (e) {
    // If URL parsing fails, use as-is
  }
  path = path.toLowerCase().replace(/\/+$/, '')

  // --- Rankings (check first because it's the most specific pattern) ---
  // Catches both /online-college-ratings-and-rankings/ and /online-college-ratings/
  if (path.includes('/online-college-ratings')) {
    return 'rank'
  }

  // --- BERPs: /online-degrees/... paths are always BERPs ---
  if (path.startsWith('/online-degrees')) {
    return 'berp'
  }

  // --- Program/degree pages: /programs/... or /degrees/... ---
  if (path.startsWith('/programs') || path.startsWith('/degrees')) {
    return 'berp'
  }

  // --- /online-schools/ requires more nuance ---
  if (path.startsWith('/online-schools')) {
    // Extract the segment after /online-schools/
    const segments = path.replace('/online-schools', '').split('/').filter(Boolean)

    if (segments.length === 0) {
      // /online-schools/ root = BERP (browse all schools)
      return 'berp'
    }

    // Check if the segment looks like a filter/category vs a school name
    // Filter segments: degree levels, subject areas, generic qualifiers
    const filterSegments = new Set([
      'bachelors', 'masters', 'associate', 'doctorate', 'certificate',
      'phd', 'mba', 'bsn', 'msn', 'dnp', 'rn-to-bsn',
      'business', 'nursing', 'education', 'healthcare', 'technology',
      'psychology', 'criminal-justice', 'social-work', 'engineering',
      'liberal-arts', 'science', 'law', 'religion', 'hospitality',
      'communications', 'arts', 'public-health', 'data-science',
      'cybersecurity', 'accounting', 'finance', 'marketing',
      'accredited', 'affordable', 'cheapest', 'best', 'top',
      'state', 'nonprofit', 'public', 'private',
    ])

    const firstSegment = segments[0]

    // If the first segment is a known filter keyword, it's a BERP
    if (filterSegments.has(firstSegment)) {
      return 'berp'
    }

    // If we have 2+ segments, the first is likely a school name, still a school
    // If we have 1 segment that's not a filter, it's likely a specific school profile
    return 'school'
  }

  // --- Articles: /blog/..., /articles/..., and everything else ---
  // These are general content pages
  return 'article'
}

/**
 * Get the score multiplier for a given page type
 * @param {string} pageType - One of 'berp', 'rank', 'article', 'school'
 * @returns {number} Multiplier to apply to base relevance score
 */
export function getPageTypeMultiplier(pageType) {
  return PAGE_TYPE_MULTIPLIERS[pageType] || PAGE_TYPE_MULTIPLIERS.article
}

/**
 * Client school priority boost.
 *
 * If the article's URL or metadata indicates it belongs to a client (sponsored) school,
 * apply an additional multiplier to boost its ranking in link selection.
 *
 * TODO: When client school data is available (e.g., from the geteducated_schools table
 * with a `is_client` or `school_priority` field, or from the sponsored schools spreadsheet),
 * implement actual client detection here. For now, this checks the article object for
 * a `school_priority` field (populated from the database) or an `is_client` boolean.
 *
 * @param {Object} article - Article object, may contain school_priority or is_client fields
 * @returns {number} Additional multiplier (2.0 for client schools, 1.0 otherwise)
 */
export function getClientSchoolBoost(article) {
  // Check for explicit client/sponsored flag
  if (article.is_client === true) {
    return 2.0
  }

  // Check for school_priority >= 5 (paid client threshold per spec)
  if (typeof article.school_priority === 'number' && article.school_priority >= 5) {
    return 2.0
  }

  // No client data available - no boost
  // NOTE: When client school data becomes available in the geteducated_articles or
  // geteducated_schools tables, update this function to cross-reference and apply
  // the 2x boost for sponsored/paid schools.
  return 1.0
}

/**
 * Normalize a URL for comparison purposes.
 * Strips protocol, www prefix, and trailing slash so that
 * "https://www.geteducated.com/foo/" and "http://geteducated.com/foo" are treated as equal.
 *
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL string (lowercase)
 */
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return ''
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * Select a diverse set of links that includes a mix of page types when possible.
 *
 * Instead of simply taking the top N by score (which tends to be all articles),
 * this function ensures representation from different page types:
 * - First, guarantee at least 1 BERP if available
 * - Then, guarantee at least 1 Rank if available
 * - Fill remaining slots with highest-scored articles of any type
 * - Never exceed the requested count
 *
 * @param {Object[]} scoredArticles - Articles sorted by relevanceScore descending
 * @param {number} count - Number of links to select (default 5)
 * @param {Object} options - Additional options
 * @param {string[]|Set<string>} options.excludeUrls - URLs to exclude (already in article content)
 * @returns {Object[]} Selected articles with diverse page types
 */
export function selectDiverseLinks(scoredArticles, count = 5, options = {}) {
  const { excludeUrls = [] } = options

  // Build a Set of normalized URLs to exclude for fast lookup
  const excludeSet = new Set()
  const urlsToExclude = excludeUrls instanceof Set ? [...excludeUrls] : (Array.isArray(excludeUrls) ? excludeUrls : [])
  for (const url of urlsToExclude) {
    excludeSet.add(normalizeUrl(url))
  }

  // Pre-filter: remove any candidates whose URL is already in the content
  let candidates = scoredArticles
  if (excludeSet.size > 0) {
    candidates = scoredArticles.filter(article => {
      const normalizedArticleUrl = normalizeUrl(article.url)
      const isExcluded = excludeSet.has(normalizedArticleUrl)
      if (isExcluded) {
        console.log(`[SubjectMatcher] Excluding already-linked URL: ${article.url}`)
      }
      return !isExcluded
    })
  }

  if (candidates.length <= count) {
    return candidates
  }

  const selected = []
  const used = new Set()

  // Group by page type
  const byType = { berp: [], rank: [], article: [], school: [] }
  for (const article of candidates) {
    const type = article.pageType || 'article'
    if (byType[type]) {
      byType[type].push(article)
    } else {
      byType.article.push(article)
    }
  }

  // Step 1: Guarantee at least 1 BERP (highest scored BERP)
  if (byType.berp.length > 0 && selected.length < count) {
    const best = byType.berp[0]
    selected.push(best)
    used.add(best.id || best.url)
  }

  // Step 2: Guarantee at least 1 Rank (highest scored rank)
  if (byType.rank.length > 0 && selected.length < count) {
    const best = byType.rank[0]
    if (!used.has(best.id || best.url)) {
      selected.push(best)
      used.add(best.id || best.url)
    }
  }

  // Step 2.5: Guarantee at least 1 School/program page (prioritize over blog posts)
  if (byType.school.length > 0 && selected.length < count) {
    const best = byType.school[0]
    if (!used.has(best.id || best.url)) {
      selected.push(best)
      used.add(best.id || best.url)
    }
  }

  // Step 3: Fill remaining slots from the overall sorted list (best scores first)
  for (const article of candidates) {
    if (selected.length >= count) break
    const key = article.id || article.url
    if (!used.has(key)) {
      selected.push(article)
      used.add(key)
    }
  }

  // Re-sort final selection by score descending for consistent output
  return selected.sort((a, b) => b.relevanceScore - a.relevanceScore)
}

/**
 * Detect the subject area from article title and topics
 * @param {string} title - Article title
 * @param {string[]} topics - Array of topics/keywords
 * @returns {Object} { subject: string, confidence: number, label: string }
 */
export function detectSubjectArea(title, topics = []) {
  const searchText = [
    title.toLowerCase(),
    ...(topics || []).map(t => t.toLowerCase()),
  ].join(' ')

  const scores = {}
  
  for (const [subject, config] of Object.entries(SUBJECT_AREAS)) {
    let score = 0
    for (const keyword of config.keywords) {
      // Exact word match (not substring)
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
      const matches = searchText.match(regex)
      if (matches) {
        // Weight by keyword specificity (longer = more specific)
        score += matches.length * (keyword.length > 5 ? 3 : 1)
      }
    }
    if (score > 0) {
      scores[subject] = score
    }
  }

  // Find highest scoring subject
  const sortedSubjects = Object.entries(scores).sort((a, b) => b[1] - a[1])
  
  if (sortedSubjects.length === 0) {
    return { subject: null, confidence: 0, label: 'Unknown' }
  }

  const [topSubject, topScore] = sortedSubjects[0]
  const secondScore = sortedSubjects[1]?.[1] || 0
  
  // Confidence based on score gap
  const confidence = topScore > 0 
    ? Math.min(100, Math.round((topScore / (topScore + secondScore + 1)) * 100))
    : 0

  return {
    subject: topSubject,
    confidence,
    label: SUBJECT_AREAS[topSubject]?.label || topSubject,
    allScores: scores,
  }
}

/**
 * Check if two subject areas are related (can cross-link)
 * @param {string} subject1 
 * @param {string} subject2 
 * @returns {boolean}
 */
export function areSubjectsRelated(subject1, subject2) {
  if (!subject1 || !subject2) return false
  if (subject1 === subject2) return true
  
  // Check affinity map
  const affinities1 = SUBJECT_AFFINITY[subject1] || []
  const affinities2 = SUBJECT_AFFINITY[subject2] || []
  
  return affinities1.includes(subject2) || affinities2.includes(subject1)
}

/**
 * Filter articles to only those with matching or related subjects
 * @param {Object[]} articles - Array of article objects with subject_area field
 * @param {string} targetSubject - The subject area we're writing about
 * @returns {Object[]} Filtered articles
 */
export function filterBySubjectRelevance(articles, targetSubject) {
  if (!targetSubject) {
    console.warn('[SubjectMatcher] No target subject provided, returning all articles')
    return articles
  }

  return articles.filter(article => {
    const articleSubject = article.subject_area?.toLowerCase()
    
    // No subject on article - include but with warning
    if (!articleSubject) {
      return true
    }

    // Exact match
    if (articleSubject === targetSubject) {
      return true
    }

    // Related subjects
    if (areSubjectsRelated(targetSubject, articleSubject)) {
      return true
    }

    // Not related - exclude
    return false
  })
}

/**
 * Score articles by subject relevance (to be added to existing relevance scoring)
 * @param {Object[]} articles - Array of articles
 * @param {string} targetSubject - Subject we're writing about
 * @returns {Object[]} Articles with subjectScore added
 */
export function scoreBySubjectRelevance(articles, targetSubject) {
  return articles.map(article => {
    let subjectScore = 0
    const articleSubject = article.subject_area?.toLowerCase()

    if (!articleSubject) {
      // Unknown subject - neutral score
      subjectScore = 0
    } else if (articleSubject === targetSubject) {
      // Exact match - strong bonus
      subjectScore = 100
    } else if (areSubjectsRelated(targetSubject, articleSubject)) {
      // Related subject - moderate bonus
      subjectScore = 50
    } else {
      // Unrelated subject - HEAVY penalty
      subjectScore = -200
    }

    return {
      ...article,
      subjectScore,
      subjectMatch: articleSubject === targetSubject ? 'exact' : 
                    areSubjectsRelated(targetSubject, articleSubject) ? 'related' : 'unrelated',
    }
  })
}

/**
 * Enhanced article relevance scoring that prioritizes subject matching
 * and page type (BERPs > Ranks > Articles > Schools).
 *
 * Scoring pipeline:
 * 1. Base score from subject matching, topic matching, title words, degree level
 * 2. Page type multiplier applied (BERP x4, Rank x3, Article x1, School x0.5)
 * 3. Client school boost applied (x2 for sponsored/client schools)
 * 4. Final sort by adjusted score
 *
 * @param {Object[]} articles - Candidate articles from database
 * @param {string} title - Title of article being written
 * @param {string[]} topics - Topics/keywords of article being written
 * @returns {Object[]} Scored and sorted articles (with pageType, pageTypeMultiplier fields)
 */
export function scoreArticlesForLinking(articles, title, topics = []) {
  // First, detect what subject we're writing about
  const { subject: targetSubject, confidence, label } = detectSubjectArea(title, topics)

  console.log(`[SubjectMatcher] Detected subject: ${label} (${targetSubject}) with ${confidence}% confidence`)

  // Prepare search terms from title (exclude common words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'online', 'degree', 'degrees', 'program', 'programs', 'best', 'top', 'guide', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those'])

  const titleWords = title.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))

  // Score each article
  const scoredArticles = articles.map(article => {
    let baseScore = 0
    const reasons = []
    const articleSubject = article.subject_area?.toLowerCase()
    const articleTitleLower = article.title?.toLowerCase() || ''
    const articleTopics = article.topics || []

    // SUBJECT MATCHING (highest priority)
    if (targetSubject && articleSubject) {
      if (articleSubject === targetSubject) {
        baseScore += 100
        reasons.push(`Exact subject match: ${articleSubject}`)
      } else if (areSubjectsRelated(targetSubject, articleSubject)) {
        baseScore += 50
        reasons.push(`Related subject: ${articleSubject} ↔ ${targetSubject}`)
      } else {
        // HEAVY PENALTY for unrelated subjects
        baseScore -= 200
        reasons.push(`UNRELATED subject: ${articleSubject} vs ${targetSubject}`)
      }
    }

    // TOPIC MATCHING (secondary)
    if (articleTopics.length > 0) {
      for (const topic of articleTopics) {
        const topicLower = topic.toLowerCase()
        if (titleWords.some(w => topicLower.includes(w))) {
          baseScore += 15
          reasons.push(`Topic match: ${topic}`)
        }
      }
    }

    // TITLE WORD MATCHING (tertiary) - reduced weight
    const articleTitleWords = articleTitleLower.split(/\s+/)
    const commonWords = titleWords.filter(w =>
      articleTitleWords.some(aw => aw.includes(w) && w.length > 4)
    )
    if (commonWords.length > 0) {
      baseScore += commonWords.length * 5 // Reduced from 10
      reasons.push(`Title words: ${commonWords.join(', ')}`)
    }

    // DEGREE LEVEL MATCHING (bonus)
    const degreeLevels = ['associate', 'bachelor', 'master', 'doctorate', 'phd', 'certificate']
    const titleDegreeLevel = degreeLevels.find(d => title.toLowerCase().includes(d))
    if (titleDegreeLevel && article.degree_level?.toLowerCase().includes(titleDegreeLevel)) {
      baseScore += 25
      reasons.push(`Degree level match: ${titleDegreeLevel}`)
    }

    // Prefer less-linked articles (slight bonus)
    if (article.times_linked_to === 0) {
      baseScore += 5
      reasons.push('Never linked before')
    } else if (article.times_linked_to < 3) {
      baseScore += 2
      reasons.push('Rarely linked')
    }

    // PAGE TYPE DETECTION & MULTIPLIER (FIX #2)
    // Derive page type from URL pattern since geteducated_articles has no page_type column.
    // Falls back to content_type from DB if URL detection returns 'article' and content_type
    // suggests a more specific type.
    let pageType = getPageType(article.url)

    // Cross-reference with DB content_type for better accuracy when URL is ambiguous
    if (pageType === 'article' && article.content_type) {
      const contentTypeMap = {
        'degree_category': 'berp',
        'ranking': 'rank',
        'school_profile': 'school',
      }
      if (contentTypeMap[article.content_type]) {
        pageType = contentTypeMap[article.content_type]
      }
    }

    const pageMultiplier = getPageTypeMultiplier(pageType)

    // CLIENT SCHOOL PRIORITY BOOST
    const clientBoost = getClientSchoolBoost(article)

    // Apply multipliers to base score (only when base score is positive)
    // For negative scores (unrelated subjects), multipliers should NOT rescue them
    let finalScore
    if (baseScore > 0) {
      finalScore = Math.round(baseScore * pageMultiplier * clientBoost)
    } else {
      finalScore = baseScore // Keep penalty scores as-is
    }

    // Log multiplier effects
    if (pageMultiplier !== 1.0) {
      reasons.push(`Page type: ${PAGE_TYPE_LABELS[pageType]} (x${pageMultiplier})`)
    }
    if (clientBoost > 1.0) {
      reasons.push(`Client school boost (x${clientBoost})`)
    }

    return {
      ...article,
      baseScore,
      relevanceScore: finalScore,
      pageType,
      pageTypeMultiplier: pageMultiplier,
      clientBoost,
      scoringReasons: reasons,
      targetSubject,
      articleSubject,
    }
  })

  // Sort by score descending, filter out heavily penalized articles
  const filtered = scoredArticles
    .filter(a => a.relevanceScore > -50) // Exclude badly mismatched articles
    .sort((a, b) => b.relevanceScore - a.relevanceScore)

  // Log page type distribution for debugging
  const typeCounts = { berp: 0, rank: 0, article: 0, school: 0 }
  for (const a of filtered) {
    typeCounts[a.pageType] = (typeCounts[a.pageType] || 0) + 1
  }
  console.log(`[SubjectMatcher] Page type distribution in candidates: BERP=${typeCounts.berp}, Rank=${typeCounts.rank}, Article=${typeCounts.article}, School=${typeCounts.school}`)

  return filtered
}

export default {
  SUBJECT_AREAS,
  SUBJECT_AFFINITY,
  PAGE_TYPE_MULTIPLIERS,
  PAGE_TYPE_LABELS,
  detectSubjectArea,
  areSubjectsRelated,
  filterBySubjectRelevance,
  scoreBySubjectRelevance,
  scoreArticlesForLinking,
  getPageType,
  getPageTypeMultiplier,
  getClientSchoolBoost,
  selectDiverseLinks,
  normalizeUrl,
}
