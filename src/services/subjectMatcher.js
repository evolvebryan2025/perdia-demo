/**
 * Subject Matcher Service
 * Ensures internal links are relevant by matching article subjects
 * 
 * FIX #1: Digital Ministry articles were linking to MBA content because
 * word overlap ("online", "degree") outweighed subject relevance.
 * 
 * This service:
 * 1. Detects the subject area from article title/topics
 * 2. Maps subjects to related subjects (affinity groups)
 * 3. Filters link candidates to only same/related subjects
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
 * This replaces the simple word-overlap scoring
 * @param {Object[]} articles - Candidate articles from database
 * @param {string} title - Title of article being written
 * @param {string[]} topics - Topics/keywords of article being written
 * @returns {Object[]} Scored and sorted articles
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
    let score = 0
    const reasons = []
    const articleSubject = article.subject_area?.toLowerCase()
    const articleTitleLower = article.title?.toLowerCase() || ''
    const articleTopics = article.topics || []

    // SUBJECT MATCHING (highest priority)
    if (targetSubject && articleSubject) {
      if (articleSubject === targetSubject) {
        score += 100
        reasons.push(`Exact subject match: ${articleSubject}`)
      } else if (areSubjectsRelated(targetSubject, articleSubject)) {
        score += 50
        reasons.push(`Related subject: ${articleSubject} ↔ ${targetSubject}`)
      } else {
        // HEAVY PENALTY for unrelated subjects
        score -= 200
        reasons.push(`UNRELATED subject: ${articleSubject} vs ${targetSubject}`)
      }
    }

    // TOPIC MATCHING (secondary)
    if (articleTopics.length > 0) {
      for (const topic of articleTopics) {
        const topicLower = topic.toLowerCase()
        if (titleWords.some(w => topicLower.includes(w))) {
          score += 15
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
      score += commonWords.length * 5 // Reduced from 10
      reasons.push(`Title words: ${commonWords.join(', ')}`)
    }

    // DEGREE LEVEL MATCHING (bonus)
    // Extract degree level from title
    const degreeLevels = ['associate', 'bachelor', 'master', 'doctorate', 'phd', 'certificate']
    const titleDegreeLevel = degreeLevels.find(d => title.toLowerCase().includes(d))
    if (titleDegreeLevel && article.degree_level?.toLowerCase().includes(titleDegreeLevel)) {
      score += 25
      reasons.push(`Degree level match: ${titleDegreeLevel}`)
    }

    // Prefer less-linked articles (slight bonus)
    if (article.times_linked_to === 0) {
      score += 5
      reasons.push('Never linked before')
    } else if (article.times_linked_to < 3) {
      score += 2
      reasons.push('Rarely linked')
    }

    return {
      ...article,
      relevanceScore: score,
      scoringReasons: reasons,
      targetSubject,
      articleSubject,
    }
  })

  // Sort by score descending, filter out heavily penalized articles
  return scoredArticles
    .filter(a => a.relevanceScore > -50) // Exclude badly mismatched articles
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
}

export default {
  SUBJECT_AREAS,
  SUBJECT_AFFINITY,
  detectSubjectArea,
  areSubjectsRelated,
  filterBySubjectRelevance,
  scoreBySubjectRelevance,
  scoreArticlesForLinking,
}
