import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'

/**
 * Get WordPress connections
 */
export function useWordPressConnections() {
  return useQuery({
    queryKey: ['wordpress_connections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wordpress_connections')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
  })
}

/**
 * Create WordPress connection
 */
export function useCreateWordPressConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (connectionData) => {
      const { data, error } = await supabase
        .from('wordpress_connections')
        .insert(connectionData)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress_connections'] })
    },
  })
}

/**
 * Update WordPress connection
 */
export function useUpdateWordPressConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...updates }) => {
      const { data, error } = await supabase
        .from('wordpress_connections')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress_connections'] })
    },
  })
}

/**
 * Delete WordPress connection
 */
export function useDeleteWordPressConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('wordpress_connections')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress_connections'] })
    },
  })
}

/**
 * Publish article to WordPress
 * Uses Edge Function for secure API calls
 */
export function usePublishToWordPress() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleId, connectionId }) => {
      const { data, error } = await supabase.functions.invoke('publish-to-wordpress', {
        body: { articleId, connectionId },
      })

      if (error) {
        throw new Error(error.message || 'WordPress publishing failed')
      }

      if (!data.success) {
        throw new Error(data.error || 'WordPress publishing failed')
      }

      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
      queryClient.invalidateQueries({ queryKey: ['article', data.articleId] })
    },
  })
}

/**
 * Test WordPress connection
 * Uses Edge Function for server-side request (avoids CORS)
 */
export function useTestWordPressConnection() {
  return useMutation({
    mutationFn: async (connection) => {
      const { data, error } = await supabase.functions.invoke('test-wordpress-connection', {
        body: { connectionId: connection.id },
      })

      if (error) {
        throw new Error(error.message || 'Connection test failed')
      }

      if (!data.success) {
        throw new Error(data.error || 'Connection test failed. Check your credentials and site URL.')
      }

      return data
    },
  })
}
