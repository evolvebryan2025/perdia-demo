import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

/**
 * Fetch all site articles (internal linking catalog)
 */
export function useSiteArticles(filters = {}) {
  const { user } = useAuth()
  const sort = filters.sort || { column: 'title', direction: 'asc' }

  return useQuery({
    queryKey: ['site-articles', filters],
    queryFn: async () => {
      let query = supabase
        .from('site_articles')
        .select('*')
        .order(sort.column, { ascending: sort.direction === 'asc' })

      // Apply filters
      if (filters.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive)
      }

      if (filters.category) {
        query = query.eq('category', filters.category)
      }

      if (filters.search) {
        query = query.or(`title.ilike.%${filters.search}%,url.ilike.%${filters.search}%`)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
  })
}

/**
 * Fetch only active site articles (for internal linking)
 */
export function useActiveSiteArticles() {
  return useSiteArticles({ isActive: true })
}

/**
 * Get site article statistics
 */
export function useSiteArticleStats() {
  const { data: articles = [] } = useSiteArticles()

  const stats = {
    total: articles.length,
    active: articles.filter(a => a.is_active).length,
    inactive: articles.filter(a => !a.is_active).length,
    categories: [...new Set(articles.map(a => a.category).filter(Boolean))],
  }

  return stats
}

/**
 * Create a new site article
 */
export function useCreateSiteArticle() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (articleData) => {
      const { data, error } = await supabase
        .from('site_articles')
        .insert({
          ...articleData,
          user_id: user?.id,
          is_active: true,
          times_linked_to: 0,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-articles'] })
    },
  })
}

/**
 * Update a site article
 */
export function useUpdateSiteArticle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, updates }) => {
      const { data, error } = await supabase
        .from('site_articles')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-articles'] })
    },
  })
}

/**
 * Toggle site article active status
 */
export function useToggleSiteArticleStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, isActive }) => {
      const { data, error } = await supabase
        .from('site_articles')
        .update({ is_active: isActive })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-articles'] })
    },
  })
}

/**
 * Delete a site article
 */
export function useDeleteSiteArticle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('site_articles')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-articles'] })
    },
  })
}

/**
 * Bulk import site articles
 */
export function useBulkImportSiteArticles() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (articles) => {
      const articlesToInsert = articles.map(article => ({
        ...article,
        user_id: user?.id,
        is_active: true,
        times_linked_to: 0,
      }))

      const { data, error } = await supabase
        .from('site_articles')
        .insert(articlesToInsert)
        .select()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-articles'] })
    },
  })
}

/**
 * Increment times_linked_to counter
 */
export function useIncrementLinkCount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { data: current, error: fetchError } = await supabase
        .from('site_articles')
        .select('times_linked_to')
        .eq('id', id)
        .single()

      if (fetchError) throw fetchError

      const { data, error } = await supabase
        .from('site_articles')
        .update({ times_linked_to: (current.times_linked_to || 0) + 1 })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-articles'] })
    },
  })
}
