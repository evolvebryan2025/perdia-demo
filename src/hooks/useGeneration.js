import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabaseClient'
import GenerationService from '../services/generationService'
import { stripImagesFromHtml } from '../utils/contentUtils'

const generationService = new GenerationService()

/**
 * Load humanization settings from database and apply to GenerationService
 */
async function loadHumanizationSettings() {
  try {
    const { data: settings, error } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', [
        'humanization_provider',
        'stealthgpt_tone',
        'stealthgpt_mode',
        'stealthgpt_detector',
        'stealthgpt_business',
        'stealthgpt_double_passing',
      ])

    if (error) {
      console.warn('[Generation] Could not load humanization settings:', error.message)
      return
    }

    // Convert array to object
    const settingsMap = {}
    settings?.forEach(s => {
      settingsMap[s.key] = s.value
    })

    // Apply provider setting
    if (settingsMap.humanization_provider) {
      generationService.setHumanizationProvider(settingsMap.humanization_provider)
    }

    // Apply StealthGPT settings
    generationService.setStealthGptSettings({
      tone: settingsMap.stealthgpt_tone || 'College',
      mode: settingsMap.stealthgpt_mode || 'High',
      detector: settingsMap.stealthgpt_detector || 'gptzero',
      business: settingsMap.stealthgpt_business === 'true',
      doublePassing: settingsMap.stealthgpt_double_passing === 'true',
    })

    console.log('[Generation] Humanization settings loaded from database')
  } catch (err) {
    console.warn('[Generation] Error loading humanization settings:', err)
  }
}

/**
 * Generate complete article from content idea with full pipeline
 * Includes: Grok draft → StealthGPT humanize → Internal linking → Quality QA → Auto-fix loop → Save
 */
export function useGenerateArticle() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ idea, options, onProgress }) => {
      // Load latest humanization settings before generation
      await loadHumanizationSettings()

      // Generate complete article with full pipeline
      const articleData = await generationService.generateArticleComplete(
        idea,
        {
          contentType: options?.contentType || 'guide',
          targetWordCount: options?.targetWordCount || 2000,
          autoAssignContributor: options?.autoAssignContributor !== false,
          addInternalLinks: options?.addInternalLinks !== false,
          autoFix: options?.autoFix !== false,
          maxFixAttempts: options?.maxFixAttempts || 3,
        },
        onProgress
      )

      // Save to database
      const savedArticle = await generationService.saveArticle(
        articleData,
        idea.id,
        user.id
      )

      return savedArticle
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Auto-fix quality issues in an article
 */
export function useAutoFixQuality() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleId, content, issues }) => {
      // Use generationService to fix issues
      const fixedContent = await generationService.autoFixQualityIssues(
        content,
        issues,
        []
      )

      // Recalculate quality metrics
      const metrics = generationService.calculateQualityMetrics(fixedContent, [])

      // Update article in database
      const { data, error } = await supabase
        .from('articles')
        .update({
          content: fixedContent,
          quality_score: metrics.score,
          word_count: metrics.word_count,
          risk_flags: metrics.issues.map(i => i.type),
        })
        .eq('id', articleId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
      queryClient.invalidateQueries({ queryKey: ['article', data.id] })
    },
  })
}

/**
 * Revise article with editorial feedback
 * Enhanced with validation to ensure AI actually addressed feedback items
 * Per GetEducated issue report - addresses Issues 5 & 6 (edits not sticking, missing links)
 */
export function useReviseArticle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleId, content, feedbackItems }) => {
      // Strip images from content before sending to AI
      // Per Bug #3: Prevents logos/images from appearing in AI-revised content
      const contentWithoutImages = stripImagesFromHtml(content)

      // Use Claude to revise based on feedback
      const revisedContent = await generationService.claude.reviseWithFeedback(
        contentWithoutImages,
        feedbackItems
      )

      // Import validation dynamically to avoid circular dependencies
      const { validateRevision, generateValidationSummary } = await import('../utils/revisionValidator')

      // Validate that the AI actually made the requested changes
      const validation = validateRevision(content, revisedContent, feedbackItems)

      console.log('[useReviseArticle] Validation result:', validation)

      // Update article with revised content and mark as revision
      const { data, error } = await supabase
        .from('articles')
        .update({
          content: revisedContent,
          is_revision: true  // Mark as revised so it shows in Revised tab
        })
        .eq('id', articleId)
        .select()
        .single()

      if (error) throw error

      // Update feedback items based on validation results
      for (const item of validation.items) {
        const updateData = {
          ai_revised: true,
          ai_validation_status: item.status,
          ai_validation_evidence: item.evidence.join('; '),
          ai_validation_warnings: item.warnings.join('; ') || null,
        }

        // Only mark as 'addressed' if validation passed
        if (item.status === 'addressed') {
          updateData.status = 'addressed'
        } else if (item.status === 'failed') {
          // Keep status as 'pending' but mark that AI attempted revision
          updateData.status = 'pending_review'
          updateData.ai_revision_failed = true
        } else {
          // Partial - mark for manual review
          updateData.status = 'pending_review'
        }

        await supabase
          .from('article_revisions')
          .update(updateData)
          .eq('id', item.id)
      }

      // Return extended result with validation info
      return {
        ...data,
        validationResult: validation,
        validationSummary: generateValidationSummary(validation),
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
      queryClient.invalidateQueries({ queryKey: ['article', data.id] })
      queryClient.invalidateQueries({ queryKey: ['revisions'] })
      queryClient.invalidateQueries({ queryKey: ['article-revisions'] })
      queryClient.invalidateQueries({ queryKey: ['all-revisions'] })
      queryClient.invalidateQueries({ queryKey: ['review-articles'] })  // Refresh review queue
    },
  })
}

/**
 * Humanize content using StealthGPT (primary) or Claude (fallback)
 */
export function useHumanizeContent() {
  return useMutation({
    mutationFn: async ({ content, contributorStyle, contributorName }) => {
      // Load latest humanization settings before processing
      await loadHumanizationSettings()

      const humanizedContent = await generationService.humanizeContent(
        content,
        {
          writingStyle: contributorStyle,
          contributorName: contributorName
        }
      )

      return { content: humanizedContent }
    },
  })
}

/**
 * Revise content based on feedback comments
 * Per GetEducated spec section 8.3.3 - Article Review UI Requirements
 * Bundles article text + comments as context and sends to AI for revision
 */
export function useReviseWithFeedback() {
  return useMutation({
    mutationFn: async ({ content, title, feedbackItems, contentType, focusKeyword, topics = [] }) => {
      // Strip images from content before sending to AI
      // Per Bug #3: Prevents logos/images from appearing in AI-revised content
      const contentWithoutImages = stripImagesFromHtml(content)

      // Format feedback items for the prompt
      const feedbackText = feedbackItems
        .map((item, i) => `${i + 1}. ${item.comment}`)
        .join('\n')

      // FIX #2: Check if any feedback is about links
      const feedbackLower = feedbackText.toLowerCase()
      const isLinkRelated = feedbackLower.includes('link') || 
                           feedbackLower.includes('source') || 
                           feedbackLower.includes('cite') ||
                           feedbackLower.includes('reference')

      // If link-related, fetch relevant internal links
      let internalLinkContext = ''
      if (isLinkRelated) {
        try {
          const relevantArticles = await generationService.getRelevantSiteArticles(title, 10, { topics })
          if (relevantArticles.length > 0) {
            internalLinkContext = `\nAVAILABLE INTERNAL LINKS (use these for internal linking):\n${relevantArticles.map(a => `- [${a.title}](${a.url})`).join('\n')}\n`
          }
        } catch (e) {
          console.warn('[useReviseWithFeedback] Could not fetch internal links:', e)
        }
      }

      // FIX #2: Always include linking rules to prevent AI suggesting bad links
      const linkingRules = `
=== CRITICAL LINKING RULES (MUST FOLLOW) ===

1. NEVER link directly to school websites (.edu domains)
   - Instead, link to GetEducated school pages: geteducated.com/online-schools/

2. NEVER link to COMPETITOR sites:
   - onlineu.com, usnews.com, bestcolleges.com, niche.com
   - collegeraptor.com, affordablecollegesonline.com
   - collegeconfidential.com, petersons.com, princetonreview.com

3. External links should ONLY go to:
   - Bureau of Labor Statistics (bls.gov)
   - Government sites (.gov)
   - Nonprofit educational organizations

4. If you cannot find a valid source, rewrite the sentence to not need a citation
   - Do NOT invent URLs or use blocked sources

=== END LINKING RULES ===
`

      const prompt = `You are revising an article based on editorial feedback.

ARTICLE TITLE: ${title}
CONTENT TYPE: ${contentType || 'guide'}
FOCUS KEYWORD: ${focusKeyword || 'N/A'}

EDITORIAL FEEDBACK TO ADDRESS:
${feedbackText}
${linkingRules}${internalLinkContext}
CURRENT ARTICLE CONTENT:
${contentWithoutImages}

INSTRUCTIONS:
1. Carefully address ALL the feedback items listed above
2. Maintain the article's overall structure and tone
3. Keep all existing HTML formatting intact
4. Do not remove existing content unless specifically requested
5. Make changes that directly respond to the feedback
6. Ensure the article remains coherent and well-organized
7. Keep the content length similar unless asked to expand/reduce
8. STRICTLY follow the linking rules - never link to competitors or .edu sites

OUTPUT ONLY THE COMPLETE REVISED HTML CONTENT (no explanations, no commentary).`

      // Use Claude to revise with feedback
      const revisedContent = await generationService.claude.chat([
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.7,
        max_tokens: 4500,
      })

      return { content: revisedContent }
    },
  })
}

/**
 * Generate ideas from a topic
 */
export function useGenerateIdeas() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ topic, count = 5 }) => {
      const ideas = await generationService.generateIdeas(topic, count)
      return ideas
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
    },
  })
}

/**
 * Run compliance update on an article
 * Per Dec 22, 2025 meeting - "Update" button for automatic compliance pass
 * Fixes shortcodes, monetization, internal links, and formatting
 * WITHOUT rewriting prose content
 */
export function useComplianceUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ article, options = {}, onProgress }) => {
      // Run compliance update
      const result = await generationService.runComplianceUpdate(article, {
        ...options,
        onProgress,
      })

      if (!result.success) {
        throw new Error('Compliance update failed')
      }

      // Update article in database
      const { data, error } = await supabase
        .from('articles')
        .update({
          content: result.content,
          quality_score: result.quality_score,
          word_count: result.word_count,
          risk_flags: result.quality_issues.map(i => i.type),
          ai_reasoning: result.ai_reasoning,
          updated_at: new Date().toISOString(),
        })
        .eq('id', article.id)
        .select()
        .single()

      if (error) throw error

      return {
        article: data,
        updates: result.updates,
        reasoning: result.ai_reasoning,
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
      queryClient.invalidateQueries({ queryKey: ['article', data.article.id] })
    },
  })
}

/**
 * Batch compliance update for multiple articles
 * Per Dec 22, 2025 meeting - refresh all existing articles with new rules
 */
export function useBatchComplianceUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ articleIds, options = {}, onProgress }) => {
      const results = {
        successful: [],
        failed: [],
      }

      const total = articleIds.length

      for (let i = 0; i < articleIds.length; i++) {
        const articleId = articleIds[i]

        try {
          // Fetch the article
          const { data: article, error: fetchError } = await supabase
            .from('articles')
            .select('*')
            .eq('id', articleId)
            .single()

          if (fetchError) throw fetchError

          // Run compliance update
          const result = await generationService.runComplianceUpdate(article, {
            ...options,
            onProgress: (progress) => {
              if (onProgress) {
                const overallProgress = ((i + progress.percentage / 100) / total) * 100
                onProgress({
                  message: `[${i + 1}/${total}] ${progress.message}`,
                  percentage: overallProgress,
                  current: i + 1,
                  total,
                })
              }
            },
          })

          // Update article
          const { data: updated, error: updateError } = await supabase
            .from('articles')
            .update({
              content: result.content,
              quality_score: result.quality_score,
              word_count: result.word_count,
              risk_flags: result.quality_issues.map(iss => iss.type),
              ai_reasoning: result.ai_reasoning,
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId)
            .select()
            .single()

          if (updateError) throw updateError

          results.successful.push({
            articleId,
            title: article.title,
            updates: result.updates,
          })

        } catch (error) {
          console.error(`[BatchUpdate] Failed for article ${articleId}:`, error)
          results.failed.push({
            articleId,
            error: error.message,
          })
        }
      }

      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] })
    },
  })
}

/**
 * Get contributors (for display)
 */
export function useContributors() {
  return {
    queryKey: ['contributors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('article_contributors')
        .select('*')
        .order('name')

      if (error) throw error
      return data
    },
  }
}
