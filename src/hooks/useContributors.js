import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

/**
 * GetEducated approved authors - REAL NAMES for PUBLIC BYLINES
 * CRITICAL: Only these 4 people can be attributed as authors on GetEducated content
 * IMPORTANT: PUBLIC bylines use REAL NAMES, not aliases
 */
export const APPROVED_AUTHORS = ['Tony Huffman', 'Kayleigh Gilbert', 'Sara', 'Charity']

/**
 * Author display names for UI - maps internal name to public display name
 * For GetEducated, the display name is the same as the real name (no aliases for public bylines)
 */
export const AUTHOR_DISPLAY_NAMES = {
  'Tony Huffman': 'Tony Huffman',
  'Kayleigh Gilbert': 'Kayleigh Gilbert',
  'Sara': 'Sara',
  'Charity': 'Charity',
}

/**
 * Internal style proxy mapping - for AI voice matching ONLY
 * CRITICAL: These are INTERNAL style proxies - NEVER use as public bylines
 * Public byline = Real Name (Tony Huffman, Kayleigh Gilbert, Sara, Charity)
 * Style proxy = For AI voice matching only (Kif, Alicia, Danny, Julia)
 */
export const AUTHOR_STYLE_PROXIES = {
  'Tony Huffman': 'Kif',
  'Kayleigh Gilbert': 'Alicia',
  'Sara': 'Danny',
  'Charity': 'Julia',
}

/**
 * BLOCKED bylines - NEVER allow these as public author names
 * These are internal aliases or legacy names that should never be published
 */
export const BLOCKED_BYLINES = [
  'Julia Tell',
  'Kif Richmann',
  'Alicia Carrasco',
  'Daniel Catena',
  'Kif',
  'Alicia',
  'Danny',
  'Julia',
  'Admin',
  'GetEducated',
  'Editorial Team',
]

/**
 * Author-to-content-type mapping for automatic assignment
 */
export const AUTHOR_CONTENT_MAPPING = {
  'Tony Huffman': {
    specialties: ['rankings', 'affordability', 'data-analysis', 'landing-pages', 'best-buy-list'],
    keywords: ['ranking', 'cheapest', 'affordable', 'cost', 'best buy', 'tuition'],
  },
  'Kayleigh Gilbert': {
    specialties: ['professional-programs', 'healthcare', 'social-work', 'best-of-guides', 'hospitality'],
    keywords: ['lcsw', 'msw', 'nursing', 'healthcare', 'hospitality', 'professional', 'licensure'],
  },
  'Sara': {
    specialties: ['technical-education', 'degree-overviews', 'career-pathways', 'general-guides'],
    keywords: ['technical', 'career', 'degrees online', 'what degrees', 'overview', 'guide'],
  },
  'Charity': {
    specialties: ['teaching-degrees', 'education-careers', 'degree-comparisons', 'certification'],
    keywords: ['teaching', 'teacher', 'mat', 'med', 'education', 'certification', 'fast-track'],
  },
}

/**
 * Fetch all contributors
 */
export function useContributors(filters = {}) {
  const { user } = useAuth()
  const sort = filters.sort || { column: 'name', direction: 'asc' }

  return useQuery({
    queryKey: ['contributors', filters],
    queryFn: async () => {
      let query = supabase
        .from('article_contributors')
        .select('*')
        .order(sort.column, { ascending: sort.direction === 'asc' })

      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,bio.ilike.%${filters.search}%`)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
  })
}

/**
 * Fetch only active contributors
 */
export function useActiveContributors() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['contributors', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('article_contributors')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: !!user,
  })
}

/**
 * Fetch only the 4 approved GetEducated authors
 * CRITICAL: Use this for all author selection in the GetEducated workflow
 */
export function useApprovedContributors() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['contributors', 'approved'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('article_contributors')
        .select('*')
        .eq('is_active', true)
        .in('name', APPROVED_AUTHORS)
        .order('name', { ascending: true })

      if (error) throw error

      // Ensure we only return approved authors even if DB has others
      const approved = (data || []).filter(c => APPROVED_AUTHORS.includes(c.name))

      // If no approved authors in DB, return placeholder data
      if (approved.length === 0) {
        console.warn('No approved contributors found in database. Using fallback data.')
        return APPROVED_AUTHORS.map(name => ({
          id: null,
          name,
          display_name: name,  // PUBLIC BYLINE = Real name (not alias)
          style_proxy: AUTHOR_STYLE_PROXIES[name],  // INTERNAL ONLY
          is_active: true,
          expertise_areas: AUTHOR_CONTENT_MAPPING[name]?.specialties || [],
          content_types: [],
        }))
      }

      return approved
    },
    enabled: !!user,
  })
}

/**
 * Check if an author name is approved for GetEducated
 * @param {string} authorName - The author name to check
 * @returns {boolean} True if author is approved
 */
export function isApprovedAuthor(authorName) {
  return APPROVED_AUTHORS.includes(authorName)
}

/**
 * Check if a byline is blocked (alias names that should never be published)
 * @param {string} byline - The byline to check
 * @returns {boolean} True if byline is blocked
 */
export function isBlockedByline(byline) {
  return BLOCKED_BYLINES.includes(byline)
}

/**
 * Validate a byline for publication
 * @param {string} byline - The byline to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateByline(byline) {
  if (!byline) {
    return { valid: false, error: 'Byline is required' }
  }

  if (isBlockedByline(byline)) {
    return {
      valid: false,
      error: `"${byline}" is an internal alias and cannot be used as a public byline. Use the real author name instead.`
    }
  }

  if (!isApprovedAuthor(byline)) {
    return {
      valid: false,
      error: `"${byline}" is not an approved author. Only ${APPROVED_AUTHORS.join(', ')} can be used as bylines.`
    }
  }

  return { valid: true }
}

/**
 * Get the style proxy for an author (INTERNAL USE ONLY - for AI voice matching)
 * CRITICAL: The style proxy should NEVER be published as a public byline
 * @param {string} authorName - The real author name
 * @returns {string} The internal style proxy name
 */
export function getAuthorStyleProxy(authorName) {
  return AUTHOR_STYLE_PROXIES[authorName] || null
}

/**
 * Get the public byline for an author (the REAL name to publish)
 * CRITICAL: This returns the REAL NAME which should be used for all public bylines
 * @param {string} authorName - The author identifier
 * @returns {string} The public byline (real name)
 */
export function getPublicByline(authorName) {
  // If it's already an approved author name, return it
  if (APPROVED_AUTHORS.includes(authorName)) {
    return authorName
  }

  // If someone accidentally passes a style proxy, find the real name
  const realName = Object.entries(AUTHOR_STYLE_PROXIES).find(([, proxy]) => proxy === authorName)?.[0]
  if (realName) {
    console.warn(`Style proxy "${authorName}" passed to getPublicByline. Converting to real name "${realName}".`)
    return realName
  }

  // Unknown - return as-is but log warning
  console.warn(`Unknown author "${authorName}" - not in approved list`)
  return authorName
}

/**
 * Recommend an author based on content topic/type
 * @param {string} topic - The article topic or title
 * @param {string} contentType - The content type (ranking, guide, etc.)
 * @returns {string|null} Recommended author name or null
 */
export function recommendAuthor(topic, contentType) {
  const topicLower = (topic || '').toLowerCase()
  const typeLower = (contentType || '').toLowerCase()

  for (const [author, mapping] of Object.entries(AUTHOR_CONTENT_MAPPING)) {
    // Check content type specialties
    if (mapping.specialties.some(s => typeLower.includes(s))) {
      return author
    }

    // Check topic keywords
    if (mapping.keywords.some(k => topicLower.includes(k))) {
      return author
    }
  }

  return null
}

/**
 * Fetch a single contributor by ID with full profile data
 */
export function useContributor(contributorId) {
  return useQuery({
    queryKey: ['contributor', contributorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('article_contributors')
        .select('*')
        .eq('id', contributorId)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!contributorId,
  })
}

/**
 * Fetch contributor by name
 */
export function useContributorByName(name) {
  return useQuery({
    queryKey: ['contributor', 'name', name],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('article_contributors')
        .select('*')
        .eq('name', name)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!name,
  })
}

/**
 * Get articles written by a contributor
 */
export function useContributorArticles(contributorId, limit = 10) {
  return useQuery({
    queryKey: ['contributor', contributorId, 'articles', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('articles')
        .select('id, title, status, quality_score, created_at, published_at')
        .eq('contributor_id', contributorId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data || []
    },
    enabled: !!contributorId,
  })
}

/**
 * Build the author system prompt section from contributor profile
 * This is used by the AI generation pipeline
 */
export function buildAuthorPromptSection(contributor) {
  if (!contributor) return ''

  const sections = []

  // Voice description
  if (contributor.voice_description) {
    sections.push(`## Author Voice\n${contributor.voice_description}`)
  }

  // Writing guidelines
  if (contributor.writing_guidelines) {
    sections.push(`## Writing Guidelines\n${contributor.writing_guidelines}`)
  }

  // Signature phrases to use
  if (contributor.signature_phrases?.length > 0) {
    sections.push(`## Signature Phrases to Incorporate\nNaturally use phrases like: ${contributor.signature_phrases.join(', ')}`)
  }

  // Phrases to avoid
  if (contributor.phrases_to_avoid?.length > 0) {
    sections.push(`## Phrases to Avoid\nNEVER use these words/phrases: ${contributor.phrases_to_avoid.join(', ')}`)
  }

  // Target audience
  if (contributor.target_audience) {
    sections.push(`## Target Audience\n${contributor.target_audience}`)
  }

  // Preferred structure
  if (contributor.preferred_structure) {
    sections.push(`## Preferred Article Structure\n${contributor.preferred_structure}`)
  }

  // Intro style
  if (contributor.intro_style) {
    sections.push(`## Introduction Style\n${contributor.intro_style}`)
  }

  // Conclusion style
  if (contributor.conclusion_style) {
    sections.push(`## Conclusion Style\n${contributor.conclusion_style}`)
  }

  // SEO approach
  if (contributor.seo_approach) {
    sections.push(`## SEO Approach\n${contributor.seo_approach}`)
  }

  // Personality traits
  if (contributor.personality_traits?.length > 0) {
    sections.push(`## Personality Traits to Reflect\nYour writing should come across as: ${contributor.personality_traits.join(', ')}`)
  }

  // Writing style profile (legacy field)
  if (contributor.writing_style_profile) {
    const style = contributor.writing_style_profile
    if (style.tone) sections.push(`## Tone: ${style.tone}`)
    if (style.style_notes) sections.push(`## Style Notes: ${style.style_notes}`)
  }

  // Sample excerpts for reference
  if (contributor.sample_excerpts?.length > 0) {
    const excerptText = contributor.sample_excerpts
      .map((e, i) => `Example ${i + 1}:\n"${e.excerpt}"`)
      .join('\n\n')
    sections.push(`## Sample Writing Excerpts\nHere are examples of this author's style:\n${excerptText}`)
  }

  return sections.join('\n\n')
}

/**
 * Get the full author prompt - either custom or built from profile
 */
export function getAuthorSystemPrompt(contributor) {
  if (!contributor) return ''

  // If custom system prompt is set, use it exclusively
  if (contributor.custom_system_prompt) {
    return contributor.custom_system_prompt
  }

  // Otherwise build from profile fields
  return buildAuthorPromptSection(contributor)
}

/**
 * Get contributor statistics
 */
export function useContributorStats() {
  const { data: contributors = [] } = useContributors()

  return {
    total: contributors.length,
    active: contributors.filter(c => c.is_active).length,
    // article_contributors table uses 'articles_count' (see initial_schema.sql line 24)
    totalArticles: contributors.reduce((sum, c) => sum + (c.articles_count || 0), 0),
  }
}

/**
 * Create a new contributor
 */
export function useCreateContributor() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (contributorData) => {
      const { data, error } = await supabase
        .from('article_contributors')
        .insert({
          ...contributorData,
          user_id: user?.id,
          is_active: true,
          articles_count: 0, // Column name is 'articles_count' per initial_schema.sql
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributors'] })
    },
  })
}

/**
 * Update a contributor
 */
export function useUpdateContributor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, updates }) => {
      const { data, error } = await supabase
        .from('article_contributors')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contributors'] })
      queryClient.invalidateQueries({ queryKey: ['contributor', data.id] })
    },
  })
}

/**
 * Toggle contributor active status
 */
export function useToggleContributorStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, isActive }) => {
      const { data, error } = await supabase
        .from('article_contributors')
        .update({ is_active: isActive })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributors'] })
    },
  })
}

/**
 * Delete a contributor
 */
export function useDeleteContributor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('article_contributors')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributors'] })
    },
  })
}

/**
 * Increment article count for a contributor
 */
export function useIncrementContributorArticleCount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (contributorId) => {
      const { data: current, error: fetchError } = await supabase
        .from('article_contributors')
        .select('articles_count')
        .eq('id', contributorId)
        .single()

      if (fetchError) throw fetchError

      const { data, error } = await supabase
        .from('article_contributors')
        .update({ articles_count: (current.articles_count || 0) + 1 })
        .eq('id', contributorId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributors'] })
    },
  })
}
