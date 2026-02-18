import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

/**
 * Log a deletion to the deletion_log table
 */
export function useLogDeletion() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      entityType, // 'content_idea' or 'article'
      entityId,
      entityTitle,
      deletionCategory,
      deletionReason,
      additionalNotes,
      entityMetadata = {},
    }) => {
      const { data, error } = await supabase
        .from('deletion_log')
        .insert({
          entity_type: entityType,
          entity_id: entityId,
          entity_title: entityTitle,
          deleted_by: user?.id,
          deletion_category: deletionCategory,
          deletion_reason: deletionReason,
          additional_notes: additionalNotes,
          entity_metadata: entityMetadata,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deletion_log'] })
    },
  })
}

/**
 * Delete a content idea with reason tracking
 */
export function useDeleteContentIdeaWithReason() {
  const queryClient = useQueryClient()
  const logDeletion = useLogDeletion()

  return useMutation({
    mutationFn: async ({
      idea,
      deletionCategory,
      deletionReason,
      additionalNotes,
    }) => {
      // Log the deletion (non-blocking - don't let logging failures prevent deletion)
      try {
        await logDeletion.mutateAsync({
          entityType: 'content_idea',
          entityId: idea.id,
          entityTitle: idea.title,
          deletionCategory,
          deletionReason,
          additionalNotes,
          entityMetadata: {
            description: idea.description,
            seed_topics: idea.seed_topics,
            status: idea.status,
            monetization_score: idea.monetization_score,
            monetization_confidence: idea.monetization_confidence,
            rejection_category: idea.rejection_category,
            rejection_reason: idea.rejection_reason,
          },
        })
      } catch (logError) {
        console.warn('Failed to log deletion, proceeding with delete:', logError)
      }

      // Always proceed with the actual deletion
      const { error } = await supabase
        .from('content_ideas')
        .delete()
        .eq('id', idea.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Delete an article with reason tracking
 */
export function useDeleteArticleWithReason() {
  const queryClient = useQueryClient()
  const logDeletion = useLogDeletion()

  return useMutation({
    mutationFn: async ({
      article,
      deletionCategory,
      deletionReason,
      additionalNotes,
    }) => {
      // First log the deletion
      await logDeletion.mutateAsync({
        entityType: 'article',
        entityId: article.id,
        entityTitle: article.title,
        deletionCategory,
        deletionReason,
        additionalNotes,
        entityMetadata: {
          excerpt: article.excerpt,
          status: article.status,
          word_count: article.word_count,
          quality_score: article.quality_score,
          risk_level: article.risk_level,
          content_type: article.content_type,
          contributor_id: article.contributor_id,
          contributor_name: article.contributor_name,
        },
      })

      // Then delete the article
      const { error } = await supabase
        .from('articles')
        .delete()
        .eq('id', article.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
      queryClient.invalidateQueries({ queryKey: ['review-articles'] })
    },
  })
}

/**
 * Fetch deletion log entries
 */
export function useDeletionLog(filters = {}) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['deletion_log', filters],
    queryFn: async () => {
      let query = supabase
        .from('deletion_log')
        .select('*')
        .order('deleted_at', { ascending: false })

      if (filters.entityType) {
        query = query.eq('entity_type', filters.entityType)
      }

      if (filters.category) {
        query = query.eq('deletion_category', filters.category)
      }

      if (filters.limit) {
        query = query.limit(filters.limit)
      }

      const { data, error } = await query

      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}

/**
 * Get deletion statistics for AI training insights
 */
export function useDeletionStats() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['deletion_stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deletion_log')
        .select('entity_type, deletion_category')

      if (error) throw error

      // Calculate stats
      const stats = {
        total: data.length,
        byEntityType: {},
        byCategory: {},
      }

      data.forEach((entry) => {
        // By entity type
        stats.byEntityType[entry.entity_type] =
          (stats.byEntityType[entry.entity_type] || 0) + 1

        // By category
        stats.byCategory[entry.deletion_category] =
          (stats.byCategory[entry.deletion_category] || 0) + 1
      })

      return stats
    },
    enabled: !!user,
  })
}
