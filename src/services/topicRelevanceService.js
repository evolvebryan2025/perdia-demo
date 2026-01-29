/**
 * Topic Relevance Service
 *
 * Provides intelligent topic extraction and relevance scoring for internal linking.
 * Addresses the issue of irrelevant links (e.g., Digital Ministry → AACSB MBA).
 *
 * Key improvements:
 * 1. Subject area extraction from titles with keyword mapping
 * 2. Semantic topic grouping (related topics understood together)
 * 3. Mandatory subject filtering (not optional bonus points)
 * 4. Negative scoring for clearly unrelated content
 */

// =====================================================
// SUBJECT AREA DEFINITIONS
// =====================================================

/**
 * Subject area keyword mappings
 * Maps keywords in titles to subject areas for filtering
 */
const SUBJECT_KEYWORDS = {
  business: [
    'mba', 'business', 'management', 'accounting', 'finance', 'marketing',
    'entrepreneurship', 'economics', 'hr', 'human resources', 'supply chain',
    'operations', 'aacsb', 'bba', 'commerce', 'corporate', 'executive',
    'administration', 'organizational', 'leadership', 'strategic',
  ],
  nursing: [
    'nursing', 'nurse', 'rn', 'bsn', 'msn', 'dnp', 'lpn', 'healthcare',
    'clinical', 'patient care', 'ccne', 'acen', 'nlnac', 'practitioner',
    'midwife', 'anesthetist', 'pediatric', 'geriatric', 'oncology',
  ],
  education: [
    'education', 'teaching', 'teacher', 'curriculum', 'instruction',
    'special education', 'elementary', 'secondary', 'k-12', 'caep',
    'ncate', 'teac', 'principal', 'administrator', 'edd', 'mat',
    'early childhood', 'literacy', 'esl', 'tesol',
  ],
  healthcare: [
    'health', 'medical', 'clinical', 'therapy', 'therapist', 'counseling',
    'psychology', 'social work', 'public health', 'mph', 'epidemiology',
    'biostatistics', 'health administration', 'informatics', 'occupational',
    'physical therapy', 'speech pathology', 'mental health', 'addiction',
  ],
  technology: [
    'computer', 'technology', 'it', 'information technology', 'software',
    'programming', 'data science', 'cybersecurity', 'network', 'web',
    'cloud', 'artificial intelligence', 'machine learning', 'database',
    'systems', 'engineering', 'developer', 'computing',
  ],
  criminal_justice: [
    'criminal justice', 'law enforcement', 'criminology', 'forensic',
    'corrections', 'police', 'homeland security', 'security', 'paralegal',
    'legal studies', 'crime', 'juvenile justice', 'probation',
  ],
  religion: [
    'ministry', 'theology', 'divinity', 'religious', 'christian', 'biblical',
    'pastoral', 'church', 'faith', 'seminary', 'spiritual', 'worship',
    'missions', 'youth ministry', 'chaplain', 'counseling ministry',
  ],
  communications: [
    'communications', 'journalism', 'media', 'public relations', 'pr',
    'broadcasting', 'advertising', 'digital media', 'film', 'television',
    'radio', 'writing', 'creative writing', 'english', 'literature',
  ],
  arts: [
    'art', 'design', 'graphic design', 'music', 'fine arts', 'visual',
    'animation', 'photography', 'fashion', 'interior design', 'theater',
    'performance', 'studio art', 'illustration', 'creative',
  ],
  science: [
    'science', 'biology', 'chemistry', 'physics', 'environmental',
    'geology', 'astronomy', 'laboratory', 'research', 'biotechnology',
    'genetics', 'microbiology', 'ecology', 'natural science',
  ],
  engineering: [
    'engineering', 'mechanical', 'electrical', 'civil', 'chemical',
    'aerospace', 'industrial', 'biomedical', 'structural', 'abet',
  ],
  liberal_arts: [
    'liberal arts', 'humanities', 'history', 'philosophy', 'sociology',
    'anthropology', 'political science', 'government', 'international',
    'gender studies', 'ethnic studies', 'cultural studies',
  ],
}

/**
 * Related subject areas - for cross-linking when appropriate
 * Key: subject area, Value: array of related subject areas
 */
const RELATED_SUBJECTS = {
  business: ['technology', 'healthcare'],
  nursing: ['healthcare'],
  healthcare: ['nursing', 'science'],
  education: ['liberal_arts'],
  technology: ['engineering', 'science', 'business'],
  criminal_justice: ['liberal_arts'],
  religion: [], // Religion is typically self-contained
  communications: ['arts', 'liberal_arts'],
  arts: ['communications'],
  science: ['engineering', 'healthcare', 'technology'],
  engineering: ['technology', 'science'],
  liberal_arts: ['education', 'communications'],
}

/**
 * Degree level keywords
 */
const DEGREE_LEVEL_KEYWORDS = {
  certificate: ['certificate', 'certification', 'cert', 'professional development'],
  associate: ['associate', "associate's", 'aa', 'as', 'aas', '2-year', 'two-year'],
  bachelors: ['bachelor', "bachelor's", 'bs', 'ba', 'bba', 'bsn', 'undergraduate', '4-year', 'four-year'],
  masters: ['master', "master's", 'ms', 'ma', 'mba', 'msn', 'med', 'graduate', 'mpa', 'mph'],
  doctorate: ['doctorate', 'doctoral', 'phd', 'edd', 'dnp', 'dba', 'jd', 'md'],
}

// =====================================================
// CORE FUNCTIONS
// =====================================================

/**
 * Extract subject area from article title
 * @param {string} title - Article title
 * @returns {string|null} - Subject area or null if not determined
 */
export function extractSubjectArea(title) {
  if (!title) return null

  const titleLower = title.toLowerCase()
  const scores = {}

  // Score each subject area by keyword matches
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    scores[subject] = 0
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        // Longer keywords are more specific, weight them higher
        scores[subject] += keyword.length
      }
    }
  }

  // Find the highest scoring subject
  const sortedSubjects = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])

  if (sortedSubjects.length > 0) {
    return sortedSubjects[0][0]
  }

  return null
}

/**
 * Extract degree level from article title
 * @param {string} title - Article title
 * @returns {string|null} - Degree level or null if not determined
 */
export function extractDegreeLevel(title) {
  if (!title) return null

  const titleLower = title.toLowerCase()

  for (const [level, keywords] of Object.entries(DEGREE_LEVEL_KEYWORDS)) {
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        return level
      }
    }
  }

  return null
}

/**
 * Check if two subject areas are related (can be cross-linked)
 * @param {string} subject1 - First subject area
 * @param {string} subject2 - Second subject area
 * @returns {boolean} - True if subjects are same or related
 */
export function areSubjectsRelated(subject1, subject2) {
  if (!subject1 || !subject2) return true // If unknown, allow
  if (subject1 === subject2) return true

  const related1 = RELATED_SUBJECTS[subject1] || []
  const related2 = RELATED_SUBJECTS[subject2] || []

  return related1.includes(subject2) || related2.includes(subject1)
}

/**
 * Extract meaningful topics from title (improved over simple word split)
 * @param {string} title - Article title
 * @returns {string[]} - Array of meaningful topics
 */
export function extractTopics(title) {
  if (!title) return []

  const titleLower = title.toLowerCase()
  const topics = new Set()

  // Add subject area as a topic
  const subject = extractSubjectArea(title)
  if (subject) topics.add(subject)

  // Add degree level as a topic
  const degreeLevel = extractDegreeLevel(title)
  if (degreeLevel) topics.add(degreeLevel)

  // Extract multi-word phrases (more meaningful than single words)
  const phrases = [
    // Degree types
    'online degree', 'online program', 'online school',
    'distance learning', 'accredited program',
    // Content types
    'best colleges', 'top programs', 'affordable', 'cheapest',
    'how to become', 'career guide', 'salary guide', 'job outlook',
    // Specific programs
    'data science', 'machine learning', 'artificial intelligence',
    'public health', 'social work', 'special education',
    'early childhood', 'health administration', 'business administration',
    'criminal justice', 'information technology', 'computer science',
  ]

  for (const phrase of phrases) {
    if (titleLower.includes(phrase)) {
      topics.add(phrase)
    }
  }

  // Add important single words (nouns, not common words)
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
    'how', 'why', 'when', 'where', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
    'best', 'top', 'online', 'degree', 'program', 'programs', 'degrees',
    'guide', 'review', 'overview', 'complete', 'ultimate', 'your',
  ])

  const words = titleLower.split(/\s+/)
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z0-9]/g, '')
    if (cleanWord.length > 4 && !stopWords.has(cleanWord)) {
      topics.add(cleanWord)
    }
  }

  return Array.from(topics)
}

/**
 * Calculate relevance score between two articles
 * @param {Object} sourceArticle - The article being written
 * @param {Object} targetArticle - Potential article to link to
 * @returns {Object} - { score, reasons, isRelevant }
 */
export function calculateRelevanceScore(sourceArticle, targetArticle) {
  const reasons = []
  let score = 0

  const sourceSubject = sourceArticle.subject_area || extractSubjectArea(sourceArticle.title)
  const targetSubject = targetArticle.subject_area || extractSubjectArea(targetArticle.title)

  const sourceLevel = sourceArticle.degree_level || extractDegreeLevel(sourceArticle.title)
  const targetLevel = targetArticle.degree_level || extractDegreeLevel(targetArticle.title)

  // CRITICAL: Subject area must match or be related
  if (sourceSubject && targetSubject) {
    if (sourceSubject === targetSubject) {
      score += 50
      reasons.push(`Same subject area: ${sourceSubject}`)
    } else if (areSubjectsRelated(sourceSubject, targetSubject)) {
      score += 25
      reasons.push(`Related subject areas: ${sourceSubject} ↔ ${targetSubject}`)
    } else {
      // PENALTY for unrelated subjects
      score -= 100
      reasons.push(`UNRELATED subjects: ${sourceSubject} vs ${targetSubject}`)
    }
  }

  // Degree level matching
  if (sourceLevel && targetLevel && sourceLevel === targetLevel) {
    score += 20
    reasons.push(`Same degree level: ${sourceLevel}`)
  }

  // Topic overlap
  const sourceTopics = sourceArticle.topics || extractTopics(sourceArticle.title)
  const targetTopics = targetArticle.topics || []

  const matchingTopics = sourceTopics.filter(topic =>
    targetTopics.some(t => t.toLowerCase().includes(topic) || topic.includes(t.toLowerCase()))
  )

  if (matchingTopics.length > 0) {
    score += matchingTopics.length * 15
    reasons.push(`Matching topics: ${matchingTopics.join(', ')}`)
  }

  // Title word overlap (lower weight than topics)
  const sourceWords = new Set(sourceArticle.title.toLowerCase().split(/\s+/).filter(w => w.length > 4))
  const targetWords = new Set(targetArticle.title.toLowerCase().split(/\s+/).filter(w => w.length > 4))

  const commonWords = [...sourceWords].filter(w => targetWords.has(w))
  if (commonWords.length > 0) {
    score += commonWords.length * 5
  }

  // Determine if relevant enough to link
  const isRelevant = score >= 30 // Minimum threshold

  return {
    score,
    reasons,
    isRelevant,
    sourceSubject,
    targetSubject,
    subjectsMatch: sourceSubject === targetSubject || areSubjectsRelated(sourceSubject, targetSubject),
  }
}

/**
 * Filter and score articles for internal linking
 * Only returns articles that are genuinely relevant
 *
 * @param {Object} sourceArticle - The article being written { title, subject_area?, degree_level?, topics? }
 * @param {Array} candidateArticles - Array of potential articles to link to
 * @param {Object} options - { limit: 5, minScore: 30, requireSubjectMatch: true }
 * @returns {Array} - Sorted array of relevant articles with scores
 */
export function filterRelevantArticles(sourceArticle, candidateArticles, options = {}) {
  const { limit = 5, minScore = 30, requireSubjectMatch = true } = options

  const sourceSubject = sourceArticle.subject_area || extractSubjectArea(sourceArticle.title)

  const scoredArticles = candidateArticles
    .map(article => {
      const relevance = calculateRelevanceScore(sourceArticle, article)
      return {
        article,
        ...relevance,
      }
    })
    .filter(item => {
      // Filter out articles below minimum score
      if (item.score < minScore) return false

      // If requireSubjectMatch is true and source has a subject, target must match
      if (requireSubjectMatch && sourceSubject && !item.subjectsMatch) {
        return false
      }

      return item.isRelevant
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scoredArticles
}

/**
 * Generate a detailed explanation for why articles were selected
 * (For AI reasoning/debugging)
 */
export function explainLinkSelections(sourceArticle, selectedArticles) {
  const sourceSubject = extractSubjectArea(sourceArticle.title)
  const sourceLevel = extractDegreeLevel(sourceArticle.title)

  const explanation = {
    source: {
      title: sourceArticle.title,
      subject: sourceSubject,
      degreeLevel: sourceLevel,
      topics: extractTopics(sourceArticle.title),
    },
    selections: selectedArticles.map(item => ({
      title: item.article.title,
      url: item.article.url,
      score: item.score,
      reasons: item.reasons,
    })),
  }

  return explanation
}

// Export everything
export default {
  extractSubjectArea,
  extractDegreeLevel,
  extractTopics,
  areSubjectsRelated,
  calculateRelevanceScore,
  filterRelevantArticles,
  explainLinkSelections,
  SUBJECT_KEYWORDS,
  RELATED_SUBJECTS,
  DEGREE_LEVEL_KEYWORDS,
}
