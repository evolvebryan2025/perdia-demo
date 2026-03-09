import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

/**
 * GetEducated Site Catalog Hooks
 *
 * These hooks provide access to the comprehensive GetEducated.com site catalog
 * stored in Supabase. This includes 1000+ articles with full content for:
 * - Internal linking during article generation
 * - Content analysis and AI training
 * - Finding relevant articles for topic matching
 */

// Content types to exclude from the catalog (non-article pages)
export const EXCLUDED_CONTENT_TYPES = [
  'contributor',
  'school_page',
  'degree_directory',
  'degree_category',
  'school_profile',
  'category',
  'subject',
  'ranking',
]

// Content types that are actual articles (for filtering)
export const ARTICLE_CONTENT_TYPES = [
  'guide',
  'career',
  'blog',
  'scholarship',
  'how_to',
  'listicle',
  'explainer',
  'accreditation',
  'resource',
  'financial_aid',
  'degree_type',
  'page',
  'other',
]

// ========================================
// ARTICLE HOOKS
// ========================================

/**
 * Fetch GetEducated articles with filtering
 * Only returns article content types (excludes non-article pages)
 * @param {Object} filters - Filter options
 * @param {string} filters.contentType - Filter by content type (career, blog, guide, etc.)
 * @param {string} filters.degreeLevel - Filter by degree level (doctorate, masters, bachelors, etc.)
 * @param {string} filters.subjectArea - Filter by subject area (nursing, business, education, etc.)
 * @param {string} filters.search - Search in title and content
 * @param {boolean} filters.hasContent - Filter to only enriched articles
 * @param {number} filters.limit - Maximum number of results
 */
export function useGetEducatedArticles(filters = {}) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['geteducated-articles', filters],
    queryFn: async () => {
      let query = supabase
        .from('geteducated_articles')
        .select('*')
        .in('content_type', ARTICLE_CONTENT_TYPES)
        .order('updated_at', { ascending: false })

      // Apply filters
      if (filters.contentType) {
        query = query.eq('content_type', filters.contentType)
      }

      if (filters.degreeLevel) {
        query = query.eq('degree_level', filters.degreeLevel)
      }

      if (filters.subjectArea) {
        query = query.eq('subject_area', filters.subjectArea)
      }

      if (filters.hasContent) {
        query = query.not('content_text', 'is', null)
      }

      if (filters.search) {
        query = query.or(`title.ilike.%${filters.search}%,slug.ilike.%${filters.search}%`)
      }

      if (filters.limit) {
        query = query.limit(filters.limit)
      } else {
        query = query.limit(100) // Default limit
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Get a single GetEducated article by URL
 */
export function useGetEducatedArticle(url) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['geteducated-article', url],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geteducated_articles')
        .select('*')
        .eq('url', url)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!user && !!url,
  })
}

/**
 * Find relevant GetEducated articles for internal linking
 * Uses the find_relevant_ge_articles SQL function for intelligent matching
 *
 * @param {Object} params - Search parameters
 * @param {string[]} params.topics - Topics to match
 * @param {string} params.subjectArea - Subject area to prefer
 * @param {string} params.degreeLevel - Degree level to prefer
 * @param {string[]} params.excludeUrls - URLs to exclude (e.g., current article)
 * @param {number} params.limit - Maximum results (default 10)
 */
export function useFindRelevantArticles(params = {}) {
  const { user } = useAuth()
  const { topics = [], subjectArea, degreeLevel, excludeUrls = [], limit = 10 } = params

  return useQuery({
    queryKey: ['geteducated-relevant', topics, subjectArea, degreeLevel, excludeUrls],
    queryFn: async () => {
      // Use the SQL function for intelligent matching
      const { data, error } = await supabase.rpc('find_relevant_ge_articles', {
        search_topics: topics,
        search_subject: subjectArea || null,
        search_degree_level: degreeLevel || null,
        exclude_urls: excludeUrls,
        result_limit: limit,
      })

      if (error) {
        console.error('Error finding relevant articles:', error)
        // Fallback to simple query if RPC fails
        return fallbackRelevantSearch(topics, subjectArea, degreeLevel, excludeUrls, limit)
      }

      return data || []
    },
    enabled: !!user && topics.length > 0,
    staleTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Fallback search when RPC is not available
 * Only searches article content types (excludes non-article pages)
 */
async function fallbackRelevantSearch(topics, subjectArea, degreeLevel, excludeUrls, limit) {
  let query = supabase
    .from('geteducated_articles')
    .select('id, url, title, excerpt, content_type, degree_level, subject_area, topics, times_linked_to')
    .in('content_type', ARTICLE_CONTENT_TYPES)
    .not('content_text', 'is', null)
    .order('times_linked_to', { ascending: true })
    .limit(limit * 3) // Get more for client-side filtering

  if (subjectArea) {
    query = query.eq('subject_area', subjectArea)
  }

  if (degreeLevel) {
    query = query.eq('degree_level', degreeLevel)
  }

  const { data, error } = await query

  if (error) throw error

  // Client-side relevance scoring
  const scoredArticles = (data || [])
    .filter(a => !excludeUrls.includes(a.url))
    .map(article => {
      let score = 0

      // Score by topic overlap
      if (article.topics && topics.length > 0) {
        const topicMatches = topics.filter(t =>
          article.topics.some(at => at.toLowerCase().includes(t.toLowerCase()))
        )
        score += topicMatches.length * 20
      }

      // Score by title keyword matches
      const titleWords = article.title.toLowerCase().split(' ')
      const keywordMatches = topics.filter(t =>
        titleWords.some(tw => tw.includes(t.toLowerCase()))
      )
      score += keywordMatches.length * 10

      return { ...article, relevance_score: score }
    })
    .filter(a => a.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit)

  return scoredArticles
}

/**
 * Get catalog enrichment statistics
 * Only counts article content types (excludes non-article pages)
 */
export function useGetEducatedCatalogStats() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['geteducated-catalog-stats'],
    queryFn: async () => {
      // Get total count (only article types)
      const { count: totalCount } = await supabase
        .from('geteducated_articles')
        .select('*', { count: 'exact', head: true })
        .in('content_type', ARTICLE_CONTENT_TYPES)

      // Get enriched count (has content, only article types)
      const { count: enrichedCount } = await supabase
        .from('geteducated_articles')
        .select('*', { count: 'exact', head: true })
        .in('content_type', ARTICLE_CONTENT_TYPES)
        .not('content_text', 'is', null)

      // Get revised count (version_count > 1, only article types)
      const { count: revisedCount } = await supabase
        .from('geteducated_articles')
        .select('*', { count: 'exact', head: true })
        .in('content_type', ARTICLE_CONTENT_TYPES)
        .gt('version_count', 1)

      // Get content type breakdown (only article types)
      const { data: contentTypes } = await supabase
        .from('geteducated_articles')
        .select('content_type')
        .in('content_type', ARTICLE_CONTENT_TYPES)

      const contentTypeBreakdown = {}
      ;(contentTypes || []).forEach(a => {
        const type = a.content_type || 'other'
        contentTypeBreakdown[type] = (contentTypeBreakdown[type] || 0) + 1
      })

      // Get degree level breakdown (only article types)
      const { data: degreeLevels } = await supabase
        .from('geteducated_articles')
        .select('degree_level')
        .in('content_type', ARTICLE_CONTENT_TYPES)
        .not('degree_level', 'is', null)

      const degreeLevelBreakdown = {}
      ;(degreeLevels || []).forEach(a => {
        if (a.degree_level) {
          degreeLevelBreakdown[a.degree_level] = (degreeLevelBreakdown[a.degree_level] || 0) + 1
        }
      })

      // Get subject area breakdown (only article types)
      const { data: subjectAreas } = await supabase
        .from('geteducated_articles')
        .select('subject_area')
        .in('content_type', ARTICLE_CONTENT_TYPES)
        .not('subject_area', 'is', null)

      const subjectAreaBreakdown = {}
      ;(subjectAreas || []).forEach(a => {
        if (a.subject_area) {
          subjectAreaBreakdown[a.subject_area] = (subjectAreaBreakdown[a.subject_area] || 0) + 1
        }
      })

      return {
        totalArticles: totalCount || 0,
        enrichedArticles: enrichedCount || 0,
        revisedArticles: revisedCount || 0,
        enrichmentProgress: totalCount > 0 ? Math.round((enrichedCount / totalCount) * 100) : 0,
        needsEnrichment: (totalCount || 0) - (enrichedCount || 0),
        contentTypes: contentTypeBreakdown,
        degreeLevels: degreeLevelBreakdown,
        subjectAreas: subjectAreaBreakdown,
      }
    },
    enabled: !!user,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ========================================
// AUTHOR HOOKS
// ========================================

/**
 * Fetch all GetEducated authors
 */
export function useGetEducatedAuthors() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['geteducated-authors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geteducated_authors')
        .select('*')
        .order('articles_count', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })
}

// ========================================
// SCHOOL HOOKS
// ========================================

/**
 * Fetch GetEducated schools with filtering
 */
export function useGetEducatedSchools(filters = {}) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['geteducated-schools', filters],
    queryFn: async () => {
      let query = supabase
        .from('geteducated_schools')
        .select('*')
        .order('name', { ascending: true })

      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,slug.ilike.%${filters.search}%`)
      }

      if (filters.limit) {
        query = query.limit(filters.limit)
      } else {
        query = query.limit(100)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })
}

// ========================================
// LINK TRACKING HOOKS
// ========================================

/**
 * Increment the times_linked_to counter for an article
 */
export function useIncrementArticleLinkCount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (articleUrl) => {
      // Use the SQL function if available
      const { data, error } = await supabase.rpc('increment_article_link_count', {
        article_url: articleUrl,
      })

      if (error) {
        // Fallback to manual increment
        const { data: article } = await supabase
          .from('geteducated_articles')
          .select('id, times_linked_to')
          .eq('url', articleUrl)
          .single()

        if (article) {
          await supabase
            .from('geteducated_articles')
            .update({ times_linked_to: (article.times_linked_to || 0) + 1 })
            .eq('id', article.id)
        }
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-relevant'] })
    },
  })
}

/**
 * Mark an article as needing rewrite
 */
export function useMarkArticleForRewrite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (articleUrl) => {
      const { data, error } = await supabase
        .from('geteducated_articles')
        .update({ needs_rewrite: true })
        .eq('url', articleUrl)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

/**
 * Mark an article rewrite as complete (after re-scraping)
 */
export function useCompleteArticleRewrite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleUrl, newContent }) => {
      const updates = {
        needs_rewrite: false,
        scraped_at: new Date().toISOString(),
      }

      // If new content is provided, update it
      if (newContent) {
        updates.content_html = newContent.content_html
        updates.content_text = newContent.content_text
        updates.word_count = newContent.word_count
        updates.heading_structure = newContent.heading_structure
        updates.internal_links = newContent.internal_links
        updates.external_links = newContent.external_links
      }

      const { data, error } = await supabase
        .from('geteducated_articles')
        .update(updates)
        .eq('url', articleUrl)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

// ========================================
// SYNC HOOKS
// ========================================

/**
 * Add a new article to the catalog (after publishing)
 */
export function useAddArticleToCatalog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (articleData) => {
      const { url, title, content, contentType, degreeLevel, subjectArea, topics } = articleData

      // Strip HTML for text content
      const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const wordCount = textContent.split(' ').filter(w => w.length > 0).length

      // Generate slug from URL
      const slug = url.replace('https://www.geteducated.com/', '').replace(/\/$/, '')

      const { data, error } = await supabase
        .from('geteducated_articles')
        .upsert({
          url,
          slug,
          title,
          content_html: content,
          content_text: textContent,
          word_count: wordCount,
          content_type: contentType || 'guide',
          degree_level: degreeLevel || null,
          subject_area: subjectArea || null,
          topics: topics || [],
          primary_topic: topics?.[0] || null,
          scraped_at: new Date().toISOString(),
          needs_rewrite: false,
          times_linked_to: 0,
        }, { onConflict: 'url' })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-catalog-stats'] })
    },
  })
}

// ========================================
// FILTER OPTIONS
// ========================================

/**
 * Get available filter options from the catalog
 */
export function useGetEducatedFilterOptions() {
  const { data: stats } = useGetEducatedCatalogStats()

  return {
    contentTypes: stats?.contentTypes ? Object.keys(stats.contentTypes) : [],
    degreeLevels: stats?.degreeLevels ? Object.keys(stats.degreeLevels) : [],
    subjectAreas: stats?.subjectAreas ? Object.keys(stats.subjectAreas) : [],
  }
}

// ========================================
// PAGINATION HOOKS
// ========================================

/**
 * Fetch GetEducated articles with pagination
 * @param {Object} options - Pagination and filter options
 * @param {number} options.page - Current page (1-indexed)
 * @param {number} options.pageSize - Items per page (default 50)
 * @param {string} options.search - Search query
 * @param {string} options.contentType - Filter by content type
 * @param {string} options.degreeLevel - Filter by degree level
 * @param {string} options.subjectArea - Filter by subject area
 * @param {string} options.sortBy - Sort field (default: updated_at)
 * @param {boolean} options.sortAsc - Sort ascending (default: false)
 * @param {boolean} options.revisedOnly - Filter to only show revised articles (version_count > 1)
 * @param {boolean} options.revisedFirst - Sort revised articles to top (default: true for 'all' view)
 */
export function useGetEducatedArticlesPaginated(options = {}) {
  const { user } = useAuth()
  const {
    page = 1,
    pageSize = 50,
    search,
    contentType,
    degreeLevel,
    subjectArea,
    sortBy = 'updated_at',
    sortAsc = false,
    revisedOnly = false,
    revisedFirst = true,
  } = options

  return useQuery({
    queryKey: ['geteducated-articles-paginated', page, pageSize, search, contentType, degreeLevel, subjectArea, sortBy, sortAsc, revisedOnly, revisedFirst],
    queryFn: async () => {
      // Calculate offset
      const offset = (page - 1) * pageSize

      // Build query
      let query = supabase
        .from('geteducated_articles')
        .select('*', { count: 'exact' })

      // Exclude non-article content types
      query = query.in('content_type', ARTICLE_CONTENT_TYPES)

      // Sort revised articles first when not filtering to revised-only
      // version_count DESC puts revised articles (version_count > 1) at top
      if (revisedFirst && !revisedOnly) {
        query = query
          .order('version_count', { ascending: false, nullsFirst: false })
          .order(sortBy, { ascending: sortAsc })
      } else {
        query = query.order(sortBy, { ascending: sortAsc })
      }

      query = query.range(offset, offset + pageSize - 1)

      // Apply filters
      if (contentType && contentType !== 'all') {
        query = query.eq('content_type', contentType)
      }

      if (degreeLevel && degreeLevel !== 'all') {
        query = query.eq('degree_level', degreeLevel)
      }

      if (subjectArea && subjectArea !== 'all') {
        query = query.eq('subject_area', subjectArea)
      }

      if (search) {
        query = query.or(`title.ilike.%${search}%,slug.ilike.%${search}%`)
      }

      // Filter to only revised articles (has been revised at least once)
      if (revisedOnly) {
        query = query.gt('version_count', 1)
      }

      const { data, error, count } = await query

      if (error) throw error

      return {
        articles: data || [],
        totalCount: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
        currentPage: page,
        pageSize,
      }
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000, // 2 minutes
    keepPreviousData: true,
  })
}

// ========================================
// VERSION HOOKS
// ========================================

/**
 * Fetch version history for an article
 */
export function useArticleVersions(articleId) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['article-versions', articleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('geteducated_article_versions')
        .select('*')
        .eq('article_id', articleId)
        .order('version_number', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!user && !!articleId,
  })
}

/**
 * Restore a previous version
 */
export function useRestoreVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleId, versionId }) => {
      // Get the version to restore
      const { data: version, error: versionError } = await supabase
        .from('geteducated_article_versions')
        .select('*')
        .eq('id', versionId)
        .single()

      if (versionError) throw versionError

      // Mark all versions as not current
      await supabase
        .from('geteducated_article_versions')
        .update({ is_current: false })
        .eq('article_id', articleId)

      // Mark this version as current
      await supabase
        .from('geteducated_article_versions')
        .update({ is_current: true })
        .eq('id', versionId)

      // Update the main article
      const { data, error } = await supabase
        .from('geteducated_articles')
        .update({
          current_version_id: versionId,
          title: version.title,
          meta_description: version.meta_description,
          content_html: version.content_html,
          content_text: version.content_text,
          word_count: version.word_count,
          faqs: version.faqs,
          revision_status: 'revised',
        })
        .eq('id', articleId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (_, { articleId }) => {
      queryClient.invalidateQueries({ queryKey: ['catalog-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['article-versions', articleId] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

// ========================================
// REVISION QUEUE HOOKS
// ========================================

/**
 * Fetch revision queue
 */
export function useRevisionQueue(status = null) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['revision-queue', status],
    queryFn: async () => {
      let query = supabase
        .from('geteducated_revision_queue')
        .select(`
          *,
          article:geteducated_articles(id, title, url, word_count, content_type)
        `)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })

      if (status) {
        query = query.eq('status', status)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  })
}

/**
 * Add article to revision queue
 */
export function useQueueRevision() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ articleId, revisionType, instructions, priority = 5, scheduledFor = null }) => {
      const { data, error } = await supabase
        .from('geteducated_revision_queue')
        .insert({
          article_id: articleId,
          revision_type: revisionType,
          instructions,
          priority,
          scheduled_for: scheduledFor,
          status: 'pending',
          requested_by: user?.email || 'system',
        })
        .select()
        .single()

      if (error) throw error

      // Update article status
      await supabase
        .from('geteducated_articles')
        .update({ revision_status: 'queued' })
        .eq('id', articleId)

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-queue'] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

/**
 * Cancel a queued revision
 */
export function useCancelRevision() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (queueId) => {
      const { data: queueItem, error: fetchError } = await supabase
        .from('geteducated_revision_queue')
        .select('article_id')
        .eq('id', queueId)
        .single()

      if (fetchError) throw fetchError

      const { error } = await supabase
        .from('geteducated_revision_queue')
        .update({ status: 'cancelled' })
        .eq('id', queueId)

      if (error) throw error

      // Reset article status
      await supabase
        .from('geteducated_articles')
        .update({ revision_status: 'original' })
        .eq('id', queueItem.article_id)

      return true
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-queue'] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

// ========================================
// SELECTED VERSION HOOKS
// ========================================

/**
 * Select a version for preview/review (separate from live/current version)
 * This allows users to preview and compare versions before publishing
 */
export function useSelectVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleId, versionId }) => {
      // Use the RPC function for safe selection with validation
      const { data, error } = await supabase.rpc('select_article_version', {
        p_article_id: articleId,
        p_version_id: versionId,
      })

      if (error) {
        // Fallback to direct update if RPC not available
        const { error: updateError } = await supabase
          .from('geteducated_articles')
          .update({ selected_version_id: versionId })
          .eq('id', articleId)

        if (updateError) throw updateError
      }

      return { success: true, articleId, versionId }
    },
    onSuccess: (_, { articleId }) => {
      queryClient.invalidateQueries({ queryKey: ['catalog-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions', articleId] })
      queryClient.invalidateQueries({ queryKey: ['article-versions', articleId] })
    },
  })
}

/**
 * Clear the selected version (revert to showing current/live version)
 */
export function useClearSelectedVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (articleId) => {
      // Use the RPC function
      const { data, error } = await supabase.rpc('clear_selected_version', {
        p_article_id: articleId,
      })

      if (error) {
        // Fallback to direct update
        const { error: updateError } = await supabase
          .from('geteducated_articles')
          .update({ selected_version_id: null })
          .eq('id', articleId)

        if (updateError) throw updateError
      }

      return { success: true, articleId }
    },
    onSuccess: (_, articleId) => {
      queryClient.invalidateQueries({ queryKey: ['catalog-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions', articleId] })
      queryClient.invalidateQueries({ queryKey: ['article-versions', articleId] })
    },
  })
}

/**
 * Get the effective version to display (selected or current)
 * Returns the full version data for the version that should be displayed
 */
export function useEffectiveVersion(articleId) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['effective-version', articleId],
    queryFn: async () => {
      // Get article with version IDs
      const { data: article, error: articleError } = await supabase
        .from('geteducated_articles')
        .select('id, current_version_id, selected_version_id')
        .eq('id', articleId)
        .single()

      if (articleError) throw articleError

      // Determine which version to use
      const effectiveVersionId = article.selected_version_id || article.current_version_id

      if (!effectiveVersionId) {
        return {
          versionSource: 'article',
          version: null,
          isSelected: false,
          isLive: false,
        }
      }

      // Fetch the effective version
      const { data: version, error: versionError } = await supabase
        .from('geteducated_article_versions')
        .select('*')
        .eq('id', effectiveVersionId)
        .single()

      if (versionError) throw versionError

      return {
        versionSource: article.selected_version_id ? 'selected' : 'current',
        version,
        isSelected: !!article.selected_version_id,
        isLive: effectiveVersionId === article.current_version_id,
        selectedVersionId: article.selected_version_id,
        currentVersionId: article.current_version_id,
      }
    },
    enabled: !!user && !!articleId,
  })
}

/**
 * Publish the selected version to WordPress
 * This makes the selected version the new "current" version and triggers publishing
 */
export function usePublishSelectedVersion() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ articleId, versionId }) => {
      // Get the version content
      const { data: version, error: versionError } = await supabase
        .from('geteducated_article_versions')
        .select('*')
        .eq('id', versionId)
        .single()

      if (versionError) throw versionError

      // Mark all versions as not current
      await supabase
        .from('geteducated_article_versions')
        .update({ is_current: false })
        .eq('article_id', articleId)

      // Mark this version as current and published
      await supabase
        .from('geteducated_article_versions')
        .update({
          is_current: true,
          is_published: true,
          published_at: new Date().toISOString(),
        })
        .eq('id', versionId)

      // Update the main article with version content and clear selection
      const { data: updatedArticle, error: updateError } = await supabase
        .from('geteducated_articles')
        .update({
          current_version_id: versionId,
          selected_version_id: null, // Clear selection after publishing
          title: version.title,
          meta_description: version.meta_description,
          content_html: version.content_html,
          content_text: version.content_text,
          word_count: version.word_count,
          faqs: version.faqs,
          heading_structure: version.heading_structure,
          internal_links: version.internal_links,
          external_links: version.external_links,
          revision_status: 'published',
          published_at: new Date().toISOString(),
        })
        .eq('id', articleId)
        .select()
        .single()

      if (updateError) throw updateError

      return {
        article: updatedArticle,
        version,
        publishedAt: new Date().toISOString(),
      }
    },
    onSuccess: (_, { articleId }) => {
      queryClient.invalidateQueries({ queryKey: ['catalog-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions', articleId] })
      queryClient.invalidateQueries({ queryKey: ['article-versions', articleId] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

/**
 * Add the selected version to a publishing queue (for batch/scheduled publishing)
 */
export function useQueueSelectedVersionForPublishing() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ articleId, versionId, scheduledFor = null, priority = 5 }) => {
      // Add to publishing queue
      const { data, error } = await supabase
        .from('geteducated_revision_queue')
        .insert({
          article_id: articleId,
          revision_type: 'publish',
          instructions: `Publish version ${versionId}`,
          priority,
          scheduled_for: scheduledFor,
          status: 'pending',
          requested_by: user?.email || 'system',
          result_version_id: versionId, // Track which version to publish
        })
        .select()
        .single()

      if (error) throw error

      // Update article status
      await supabase
        .from('geteducated_articles')
        .update({ revision_status: 'queued_for_publish' })
        .eq('id', articleId)

      return data
    },
    onSuccess: (_, { articleId }) => {
      queryClient.invalidateQueries({ queryKey: ['revision-queue'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article', articleId] })
      queryClient.invalidateQueries({ queryKey: ['geteducated-articles'] })
    },
  })
}

// ========================================
// VERSION NOTES & TAGS HOOKS
// ========================================

/**
 * Update version notes
 */
export function useUpdateVersionNotes() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ versionId, notes }) => {
      const { data, error } = await supabase.rpc('update_version_notes', {
        p_version_id: versionId,
        p_notes: notes,
      })

      if (error) {
        // Fallback to direct update
        const { error: updateError } = await supabase
          .from('geteducated_article_versions')
          .update({ notes })
          .eq('id', versionId)

        if (updateError) throw updateError
      }

      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['article-versions'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions'] })
    },
  })
}

/**
 * Add a tag to a version
 */
export function useAddVersionTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ versionId, tag }) => {
      const { data, error } = await supabase.rpc('add_version_tag', {
        p_version_id: versionId,
        p_tag: tag,
      })

      if (error) {
        // Fallback to direct update
        const { data: version } = await supabase
          .from('geteducated_article_versions')
          .select('tags')
          .eq('id', versionId)
          .single()

        const currentTags = version?.tags || []
        if (!currentTags.includes(tag)) {
          await supabase
            .from('geteducated_article_versions')
            .update({ tags: [...currentTags, tag] })
            .eq('id', versionId)
        }
      }

      return { success: true, tags: data }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['article-versions'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions'] })
    },
  })
}

/**
 * Remove a tag from a version
 */
export function useRemoveVersionTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ versionId, tag }) => {
      const { data, error } = await supabase.rpc('remove_version_tag', {
        p_version_id: versionId,
        p_tag: tag,
      })

      if (error) {
        // Fallback to direct update
        const { data: version } = await supabase
          .from('geteducated_article_versions')
          .select('tags')
          .eq('id', versionId)
          .single()

        const currentTags = version?.tags || []
        await supabase
          .from('geteducated_article_versions')
          .update({ tags: currentTags.filter(t => t !== tag) })
          .eq('id', versionId)
      }

      return { success: true, tags: data }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['article-versions'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions'] })
    },
  })
}

/**
 * Toggle starred status for a version
 */
export function useToggleVersionStarred() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (versionId) => {
      const { data, error } = await supabase.rpc('toggle_version_starred', {
        p_version_id: versionId,
      })

      if (error) {
        // Fallback to direct update
        const { data: version } = await supabase
          .from('geteducated_article_versions')
          .select('is_starred')
          .eq('id', versionId)
          .single()

        const { data: updated } = await supabase
          .from('geteducated_article_versions')
          .update({ is_starred: !version?.is_starred })
          .eq('id', versionId)
          .select('is_starred')
          .single()

        return updated?.is_starred
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['article-versions'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions'] })
    },
  })
}

/**
 * Set a version as the baseline for comparison
 */
export function useSetVersionBaseline() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleId, versionId }) => {
      const { data, error } = await supabase.rpc('set_version_as_baseline', {
        p_article_id: articleId,
        p_version_id: versionId,
      })

      if (error) {
        // Fallback to direct update
        await supabase
          .from('geteducated_article_versions')
          .update({ is_baseline: false })
          .eq('article_id', articleId)

        await supabase
          .from('geteducated_article_versions')
          .update({ is_baseline: true })
          .eq('id', versionId)
      }

      return { success: true }
    },
    onSuccess: (_, { articleId }) => {
      queryClient.invalidateQueries({ queryKey: ['article-versions', articleId] })
      queryClient.invalidateQueries({ queryKey: ['catalog-article-versions', articleId] })
    },
  })
}

/**
 * Predefined version tags
 */
export const VERSION_TAGS = [
  { value: 'approved', label: 'Approved', color: 'green' },
  { value: 'needs-review', label: 'Needs Review', color: 'yellow' },
  { value: 'rejected', label: 'Rejected', color: 'red' },
  { value: 'baseline', label: 'Baseline', color: 'blue' },
  { value: 'best-version', label: 'Best Version', color: 'purple' },
  { value: 'draft', label: 'Draft', color: 'gray' },
  { value: 'seo-optimized', label: 'SEO Optimized', color: 'cyan' },
  { value: 'human-edited', label: 'Human Edited', color: 'orange' },
]
