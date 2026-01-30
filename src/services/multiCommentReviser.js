/**
 * Multi-Comment Revision Service
 * FIX #5: Handles multiple editorial comments reliably
 * 
 * The problem: When users add multiple comments, the AI sometimes:
 * - Only addresses some of them
 * - Gets confused with complex/conflicting feedback
 * - Produces inconsistent results
 * 
 * This service:
 * 1. Processes comments in small batches (max 3 at a time)
 * 2. Validates each batch was addressed
 * 3. Retries failed comments with explicit focus
 * 4. Preserves content structure throughout
 */

import ClaudeClient from './ai/claudeClient.edge'
import { validateRevision } from '../utils/revisionValidator'
import { detectSubjectArea } from './subjectMatcher'

const claudeClient = new ClaudeClient()

// Maximum comments to process in one AI call
const MAX_BATCH_SIZE = 3

// Maximum retry attempts for failed comments
const MAX_RETRIES = 2

/**
 * Process multiple comments in batches with validation
 * @param {Object} params - Processing parameters
 * @returns {Object} Result with revised content and processing details
 */
export async function processCommentsInBatches({
  content,
  comments,
  title,
  focusKeyword,
  contentType,
  contributorName,
  onProgress,
}) {
  const result = {
    success: true,
    revisedContent: content,
    processedComments: [],
    failedComments: [],
    totalBatches: 0,
    retryCount: 0,
    details: [],
  }

  if (!comments || comments.length === 0) {
    return result
  }

  // Prioritize comments by severity
  const sortedComments = [...comments].sort((a, b) => {
    const severityOrder = { critical: 0, major: 1, minor: 2, suggestion: 3 }
    return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3)
  })

  // Split into batches
  const batches = []
  for (let i = 0; i < sortedComments.length; i += MAX_BATCH_SIZE) {
    batches.push(sortedComments.slice(i, i + MAX_BATCH_SIZE))
  }

  result.totalBatches = batches.length
  let currentContent = content

  // Process each batch
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]
    const batchNum = batchIndex + 1

    onProgress?.(`Processing batch ${batchNum}/${batches.length} (${batch.length} comments)...`)

    const batchResult = await processSingleBatch({
      content: currentContent,
      comments: batch,
      title,
      focusKeyword,
      contentType,
      contributorName,
      batchNumber: batchNum,
    })

    result.details.push({
      batchNumber: batchNum,
      commentsInBatch: batch.length,
      addressedCount: batchResult.addressedComments.length,
      failedCount: batchResult.failedComments.length,
    })

    // Update content for next batch
    currentContent = batchResult.revisedContent

    // Track results
    result.processedComments.push(...batchResult.addressedComments)

    // Handle failed comments - retry with explicit focus
    if (batchResult.failedComments.length > 0) {
      onProgress?.(`Retrying ${batchResult.failedComments.length} unaddressed comments...`)

      for (const failedComment of batchResult.failedComments) {
        let retrySuccess = false

        for (let retry = 0; retry < MAX_RETRIES && !retrySuccess; retry++) {
          result.retryCount++

          const retryResult = await retrySingleComment({
            content: currentContent,
            comment: failedComment,
            title,
            attempt: retry + 1,
          })

          if (retryResult.success) {
            currentContent = retryResult.revisedContent
            result.processedComments.push(failedComment)
            retrySuccess = true
          }
        }

        if (!retrySuccess) {
          result.failedComments.push({
            ...failedComment,
            failureReason: 'AI could not address this feedback after multiple attempts',
          })
        }
      }
    }
  }

  result.revisedContent = currentContent
  result.success = result.failedComments.length === 0

  return result
}

/**
 * Process a single batch of comments
 */
async function processSingleBatch({
  content,
  comments,
  title,
  focusKeyword,
  contentType,
  contributorName,
  batchNumber,
}) {
  const feedbackItems = comments.map((comment, index) => {
    return `${index + 1}. [${(comment.category || 'general').toUpperCase()}]
   Text: "${comment.selected_text?.substring(0, 100) || 'N/A'}"
   Request: ${comment.feedback || comment.comment}`
  })

  // Build focused prompt
  const prompt = buildBatchPrompt({
    content,
    feedbackItems,
    title,
    focusKeyword,
    contentType,
    contributorName,
  })

  try {
    const revisedContent = await claudeClient.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.5, // Lower temperature for more consistent results
      max_tokens: 16000,
    })

    // Clean the response
    const cleanedContent = cleanAIResponse(revisedContent)

    // Validate which comments were addressed
    const validationResult = validateRevision(
      content,
      cleanedContent,
      comments.map(c => ({
        id: c.id,
        comment: c.feedback || c.comment,
        selected_text: c.selected_text,
        category: c.category,
        severity: c.severity,
      }))
    )

    // Separate addressed and failed
    const addressedComments = []
    const failedComments = []

    for (let i = 0; i < comments.length; i++) {
      const validationItem = validationResult.items[i]
      if (validationItem?.status === 'addressed' || validationItem?.status === 'partial') {
        addressedComments.push(comments[i])
      } else {
        failedComments.push(comments[i])
      }
    }

    return {
      revisedContent: cleanedContent,
      addressedComments,
      failedComments,
      validationResult,
    }

  } catch (error) {
    console.error(`[MultiCommentReviser] Batch ${batchNumber} failed:`, error)
    return {
      revisedContent: content,
      addressedComments: [],
      failedComments: comments,
      error: error.message,
    }
  }
}

/**
 * Retry a single failed comment with explicit focus
 */
async function retrySingleComment({
  content,
  comment,
  title,
  attempt,
}) {
  const prompt = `You are an editor making a SINGLE, SPECIFIC change to an article.

ARTICLE TITLE: ${title}

THE CHANGE YOU MUST MAKE:
Text to change: "${comment.selected_text?.substring(0, 200) || 'See request below'}"
What to do: ${comment.feedback || comment.comment}

THIS IS ATTEMPT ${attempt}. Previous attempts failed to make this change. Please:
1. Make ONLY this one specific change
2. Keep everything else exactly the same
3. Output the complete HTML content

CURRENT HTML CONTENT:
${content}

=== OUTPUT ONLY THE REVISED HTML (no explanation) ===`

  try {
    const revisedContent = await claudeClient.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.3, // Very low temperature for focused change
      max_tokens: 16000,
    })

    const cleanedContent = cleanAIResponse(revisedContent)

    // Validate this single comment was addressed
    const validation = validateRevision(
      content,
      cleanedContent,
      [{
        id: comment.id,
        comment: comment.feedback || comment.comment,
        selected_text: comment.selected_text,
        category: comment.category,
      }]
    )

    return {
      success: validation.items[0]?.status === 'addressed',
      revisedContent: cleanedContent,
      validation,
    }

  } catch (error) {
    console.error(`[MultiCommentReviser] Retry failed:`, error)
    return { success: false, revisedContent: content, error: error.message }
  }
}

/**
 * Build the prompt for a batch of comments
 */
function buildBatchPrompt({
  content,
  feedbackItems,
  title,
  focusKeyword,
  contentType,
  contributorName,
}) {
  return `You are an editor revising an article. Make ALL the following changes.

ARTICLE: ${title}
${focusKeyword ? `Keyword: ${focusKeyword}` : ''}
${contributorName ? `Author: ${contributorName}` : ''}

CHANGES TO MAKE (address ALL of these):
${feedbackItems.join('\n\n')}

CRITICAL RULES:
1. Output ONLY valid HTML - no markdown, no code blocks
2. Preserve ALL existing HTML structure (<h2>, <h3>, <p>, <ul>, <a>, etc.)
3. Preserve ALL links with their href attributes
4. Preserve ALL shortcodes: [su_ge-picks], [su_ge-cta], etc.
5. Make EACH requested change - do not skip any

LINKING RULES (if adding links):
- NEVER use .edu links
- NEVER use competitor sites (bestcolleges.com, usnews.com, onlineu.com)
- Use GetEducated pages: geteducated.com/online-schools/, geteducated.com/online-degrees/
- External links only to: bls.gov, .gov sites, accreditation bodies

CURRENT HTML:
${content}

=== OUTPUT ONLY THE REVISED HTML ===`
}

/**
 * Clean AI response to extract just HTML
 */
function cleanAIResponse(response) {
  if (!response) return ''
  
  return response
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^Here is the revised.*?:\s*/i, '')
    .replace(/^Revised HTML:\s*/i, '')
    .trim()
}

/**
 * Quick single-comment revision (for simple changes)
 */
export async function processSingleComment({
  content,
  comment,
  title,
}) {
  return await retrySingleComment({
    content,
    comment,
    title,
    attempt: 1,
  })
}

export default {
  processCommentsInBatches,
  processSingleComment,
  MAX_BATCH_SIZE,
  MAX_RETRIES,
}
