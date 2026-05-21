import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

/**
 * Fetch all keywords
 */
export function useKeywords(filters = {}) {
  const { user } = useAuth()
  const sort = filters.sort || { column: 'keyword', direction: 'asc' }

  return useQuery({
    queryKey: ['keywords', filters],
    queryFn: async () => {
      let query = supabase
        .from('keywords')
        .select('*, clusters(name)')
        .order(sort.column, { ascending: sort.direction === 'asc' })

      if (filters.clusterId) {
        query = query.eq('cluster_id', filters.clusterId)
      }

      if (filters.targetFlag) {
        query = query.eq('target_flag', filters.targetFlag)
      }

      if (filters.search) {
        query = query.ilike('keyword', `%${filters.search}%`)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
  })
}

/**
 * Get keyword statistics
 */
export function useKeywordStats() {
  const { data: keywords = [] } = useKeywords()

  return {
    total: keywords.length,
    target: keywords.filter(k => k.target_flag).length,
    ranked: keywords.filter(k => k.current_position && k.current_position <= 100).length,
    avgPosition: keywords.length > 0
      ? Math.round(keywords.reduce((sum, k) => sum + (k.current_position || 0), 0) / keywords.length)
      : 0,
  }
}

/**
 * Create a new keyword
 */
export function useCreateKeyword() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (keywordData) => {
      const { data, error } = await supabase
        .from('keywords')
        .insert({
          ...keywordData,
          user_id: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keywords'] })
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
    },
  })
}

/**
 * Update a keyword
 */
export function useUpdateKeyword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, updates }) => {
      const { data, error } = await supabase
        .from('keywords')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keywords'] })
    },
  })
}

/**
 * Delete a keyword
 */
export function useDeleteKeyword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('keywords')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keywords'] })
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
    },
  })
}

/**
 * Bulk import keywords
 */
export function useBulkImportKeywords() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (keywords) => {
      const keywordsToInsert = keywords.map(kw => ({
        ...kw,
        user_id: user?.id,
      }))

      const { data, error } = await supabase
        .from('keywords')
        .insert(keywordsToInsert)
        .select()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keywords'] })
    },
  })
}
