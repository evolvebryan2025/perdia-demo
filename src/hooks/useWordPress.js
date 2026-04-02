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
 * Tests directly via Vercel proxy (avoids CORS) or falls back to Edge Function
 */
export function useTestWordPressConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (connection) => {
      const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')

      if (isVercel) {
        // Use Vercel proxy to test WordPress connection directly
        let testUrl = ''
        if (connection.site_url?.includes('stage.geteducated.com')) {
          testUrl = '/api/wp-stage/wp-json/wp/v2/posts?per_page=1'
        } else if (connection.site_url?.includes('geteducated.com')) {
          testUrl = '/api/wp-prod/wp-json/wp/v2/posts?per_page=1'
        } else {
          // For non-GetEducated sites, try direct (may fail with CORS)
          testUrl = `${connection.site_url}/wp-json/wp/v2/posts?per_page=1`
        }

        const headers = {}
        if (connection.username && connection.password) {
          headers['Authorization'] = `Basic ${btoa(`${connection.username}:${connection.password}`)}`
        }

        const response = await fetch(testUrl, { headers })

        if (!response.ok) {
          throw new Error(`WordPress API returned ${response.status}: ${response.statusText}`)
        }

        // Update test status in database
        await supabase
          .from('wordpress_connections')
          .update({
            last_test_at: new Date().toISOString(),
            last_test_success: true,
          })
          .eq('id', connection.id)

        return { success: true, message: 'Connection successful!' }
      }

      // Fallback: use Edge Function for local development
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress_connections'] })
    },
  })
}
