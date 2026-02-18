import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import GrokClient from '../services/ai/grokClient'

// Initialize Grok client for title suggestions
const grokClient = new GrokClient()

/**
 * Fetch all content ideas (shared workspace - all users see all ideas)
 */
export function useContentIdeas(filters = {}) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['content_ideas', filters],
    queryFn: async () => {
      let query = supabase
        .from('content_ideas')
        .select('*, clusters(*)')
        .order('created_at', { ascending: false })

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status)
      }

      if (filters.source) {
        query = query.eq('source', filters.source)
      }

      const { data, error } = await query

      if (error) throw error
      return data
    },
    enabled: !!user,
    refetchOnMount: 'always', // Always refetch when navigating back to ensure fresh data
    staleTime: 0, // Consider data immediately stale for navigation
  })
}

/**
 * Create a new content idea
 */
export function useCreateContentIdea() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ideaData) => {
      const { data, error } = await supabase
        .from('content_ideas')
        .insert({
          ...ideaData,
          user_id: user.id,
        })
        .select()
        .single()

      // Fallback: if source constraint fails, retry with 'manual' source
      if (error && error.message?.includes('check constraint') && ideaData.source) {
        console.warn(`Source '${ideaData.source}' rejected by DB constraint, falling back to 'manual'`)
        const { data: retryData, error: retryError } = await supabase
          .from('content_ideas')
          .insert({
            ...ideaData,
            source: 'manual',
            user_id: user.id,
          })
          .select()
          .single()

        if (retryError) throw retryError
        return retryData
      }

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Update content idea
 */
export function useUpdateContentIdea() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ideaId, updates }) => {
      const { data, error } = await supabase
        .from('content_ideas')
        .update(updates)
        .eq('id', ideaId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Delete content idea
 */
export function useDeleteContentIdea() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ideaId) => {
      const { error } = await supabase
        .from('content_ideas')
        .delete()
        .eq('id', ideaId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Generate ideas from seed topics
 */
export function useGenerateIdeas() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ seedTopics, count = 10 }) => {
      // Call Supabase Edge Function for idea generation
      const { data, error } = await supabase.functions.invoke('generate-ideas', {
        body: { seedTopics, count, userId: user.id }
      })

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Generate ideas from DataForSEO keywords
 */
export function useGenerateIdeasFromKeywords() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ seedKeywords, options }) => {
      // Call Edge Function that uses DataForSEO + AI
      const { data, error } = await supabase.functions.invoke('generate-ideas-from-keywords', {
        body: { seedKeywords, options, userId: user.id }
      })

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Quick feedback on idea (thumbs up/down)
 * Updates feedback_score: +1 for thumbs up, -1 for thumbs down
 */
export function useIdeaFeedback() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ideaId, isPositive }) => {
      // First get current score
      const { data: current, error: fetchError } = await supabase
        .from('content_ideas')
        .select('feedback_score')
        .eq('id', ideaId)
        .single()

      if (fetchError) throw fetchError

      const newScore = (current.feedback_score || 0) + (isPositive ? 1 : -1)

      const { data, error } = await supabase
        .from('content_ideas')
        .update({
          feedback_score: newScore,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', ideaId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Reject idea with detailed reason (for AI training)
 */
export function useRejectIdeaWithReason() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ideaId, rejectionCategory, rejectionReason, feedbackNotes }) => {
      const { data, error } = await supabase
        .from('content_ideas')
        .update({
          status: 'rejected',
          rejection_category: rejectionCategory,
          rejection_reason: rejectionReason,
          feedback_notes: feedbackNotes,
          feedback_score: -1, // Rejection counts as negative feedback
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', ideaId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Approve idea with optional positive notes
 */
export function useApproveIdeaWithFeedback() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ideaId, feedbackNotes }) => {
      const { data, error } = await supabase
        .from('content_ideas')
        .update({
          status: 'approved',
          feedback_notes: feedbackNotes,
          feedback_score: 1, // Approval counts as positive feedback
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', ideaId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Generate title suggestions using Grok AI
 * Returns 3 title suggestions with reasoning for each
 */
export function useGenerateTitleSuggestions() {
  return useMutation({
    mutationFn: async ({ description, topics, count = 3 }) => {
      const suggestions = await grokClient.generateTitleSuggestions(
        description,
        topics,
        count
      )
      return suggestions
    },
  })
}
