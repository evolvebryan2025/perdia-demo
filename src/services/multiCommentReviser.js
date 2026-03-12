/**
 * Multi-Comment Revision Service
 * FIX #5: Handles multiple editorial comments reliably
 * FIX #6: URL context injection - fetches URL content for data-driven revisions
 * FIX #7: Client school awareness - uses CLIENT_SCHOOLS config for "client" references
 * FIX #8: Improved prompt specificity - prevents AI fabrication, surgical edits only
 *
 * The problem: When users add multiple comments, the AI sometimes:
 * - Only addresses some of them
 * - Gets confused with complex/conflicting feedback
 * - Produces inconsistent results
 * - Fabricates school names, degrees, and statistics instead of using real data
 * - Ignores URLs in comments that contain the actual data to use
 *
 * This service:
 * 1. Processes comments in small batches (max 3 at a time)
 * 2. Validates each batch was addressed
 * 3. Retries failed comments with explicit focus
 * 4. Preserves content structure throughout
 * 5. Extracts URLs from comments and fetches page content for context (FIX #6)
 * 6. Injects client school data when comments reference "client" schools (FIX #7)
 * 7. Uses strict anti-fabrication prompting (FIX #8)
 */

import ClaudeClient from './ai/claudeClient.edge'
import { validateRevision } from '../utils/revisionValidator'
import { detectSubjectArea } from './subjectMatcher'
import { CLIENT_SCHOOLS, findClientSchools, formatClientSchoolsForPrompt } from '../config/clientSchools'

const claudeClient = new ClaudeClient()

// Maximum comments to process in one AI call
const MAX_BATCH_SIZE = 3

// Maximum retry attempts for failed comments
const MAX_RETRIES = 2

// URL regex pattern for extracting URLs from comment text
const URL_REGEX = /https?:\/\/[^\s)<>"']+/gi

/**
 * Extract all URLs from a string
 * @param {string} text - Text to search for URLs
 * @returns {string[]} Array of URLs found
 */
function extractUrls(text) {
  if (!text) return []
  const matches = text.match(URL_REGEX)
  return matches ? [...new Set(matches)] : []
}

/**
 * Check if any comment text mentions "client" schools/degrees
 * @param {string} text - Comment feedback text
 * @returns {boolean}
 */
function mentionsClientSchool(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  return (
    lower.includes('client school') ||
    lower.includes('client degree') ||
    lower.includes('client program') ||
    lower.includes('client university') ||
    lower.includes('client college') ||
    /\bclient\b.*\b(school|degree|program|university|college)\b/i.test(text) ||
    /\b(school|degree|program|university|college)\b.*\bclient\b/i.test(text)
  )
}

/**
 * Fetch URL content for context injection
 * Uses a simple fetch with text extraction for providing real data to the AI
 * @param {string} url - URL to fetch
 * @returns {Object} { url, content, error }
 */
async function fetchUrlContent(url) {
  try {
    // Use a CORS proxy or direct fetch depending on environment
    // In production, this should go through an edge function
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GetEducated Content Bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    })

    if (!response.ok) {
      return { url, content: null, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    const html = await response.text()

    // Extract meaningful text content from HTML
    // Strip scripts, styles, nav, footer, and HTML tags
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()

    // Limit to ~4000 chars to avoid overwhelming the prompt
    const truncated = textContent.length > 4000
      ? textContent.substring(0, 4000) + '... [content truncated]'
      : textContent

    return { url, content: truncated, error: null }
  } catch (error) {
    console.warn(`[MultiCommentReviser] Failed to fetch URL: ${url}`, error.message)
    return { url, content: null, error: error.message }
  }
}

/**
 * Fetch all URLs found in comments and return context blocks
 * @param {Array} comments - Array of comment objects
 * @param {Function} onProgress - Progress callback
 * @returns {Object} { urlContexts: Array, failedUrls: Array }
 */
async function fetchUrlContextsFromComments(comments, onProgress) {
  const allUrls = []

  for (const comment of comments) {
    const feedbackText = comment.feedback || comment.comment || ''
    const urls = extractUrls(feedbackText)
    for (const url of urls) {
      allUrls.push({ url, commentId: comment.id, feedbackText })
    }
  }

  if (allUrls.length === 0) {
    return { urlContexts: [], failedUrls: [] }
  }

  onProgress?.(`Fetching ${allUrls.length} referenced URL(s) for context...`)

  // Deduplicate URLs
  const uniqueUrls = [...new Set(allUrls.map(u => u.url))]

  const urlContexts = []
  const failedUrls = []

  // Fetch URLs in parallel (max 3 concurrent)
  const batchSize = 3
  for (let i = 0; i < uniqueUrls.length; i += batchSize) {
    const batch = uniqueUrls.slice(i, i + batchSize)
    const results = await Promise.all(batch.map(url => fetchUrlContent(url)))

    for (const result of results) {
      if (result.content) {
        urlContexts.push(result)
      } else {
        failedUrls.push(result)
      }
    }
  }

  return { urlContexts, failedUrls }
}

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

  // FIX #6: Pre-fetch all URLs referenced in comments BEFORE processing batches
  // This ensures the AI has real data to work with instead of fabricating
  const { urlContexts, failedUrls } = await fetchUrlContextsFromComments(comments, onProgress)

  if (failedUrls.length > 0) {
    console.warn(`[MultiCommentReviser] Could not fetch ${failedUrls.length} URL(s):`, failedUrls.map(u => u.url))
  }

  // FIX #7: Check if any comments reference "client" schools/degrees
  const needsClientSchools = comments.some(c =>
    mentionsClientSchool(c.feedback || c.comment || '')
  )
  const clientSchoolContext = needsClientSchools ? formatClientSchoolsForPrompt() : ''

  // Detect subject area for better client school matching
  let subjectSchools = null
  if (needsClientSchools) {
    try {
      const subject = detectSubjectArea(title, focusKeyword, content)
      if (subject) {
        subjectSchools = findClientSchools({ subject, limit: 5 })
      }
    } catch (e) {
      // Non-critical - continue without subject matching
    }
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
      urlContexts,        // FIX #6: Pass fetched URL contexts
      clientSchoolContext, // FIX #7: Pass client school context
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
            urlContexts,        // FIX #6: Pass URL contexts to retries too
            clientSchoolContext, // FIX #7: Pass client school context to retries
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
  urlContexts = [],
  clientSchoolContext = '',
}) {
  const feedbackItems = comments.map((comment, index) => {
    return `${index + 1}. [${(comment.category || 'general').toUpperCase()}]
   Text: "${comment.selected_text?.substring(0, 100) || 'N/A'}"
   Request: ${comment.feedback || comment.comment}`
  })

  // FIX #6: Build URL context for this batch's comments
  const batchUrlContext = buildUrlContextForComments(comments, urlContexts)

  // Build focused prompt
  const prompt = buildBatchPrompt({
    content,
    feedbackItems,
    title,
    focusKeyword,
    contentType,
    contributorName,
    urlContext: batchUrlContext,        // FIX #6
    clientSchoolContext,                // FIX #7
  })

  try {
    const revisedContent = await claudeClient.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.3, // FIX #8: Lowered from 0.5 for more precise, deterministic edits
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
 * Build URL context block for a specific set of comments
 * Maps each comment's URLs to their fetched content
 * @param {Array} comments - Comments in this batch
 * @param {Array} urlContexts - All fetched URL contexts
 * @returns {string} Formatted URL context for prompt injection
 */
function buildUrlContextForComments(comments, urlContexts) {
  if (!urlContexts || urlContexts.length === 0) return ''

  const relevantContexts = []

  for (const comment of comments) {
    const feedbackText = comment.feedback || comment.comment || ''
    const urls = extractUrls(feedbackText)

    for (const url of urls) {
      const context = urlContexts.find(uc => uc.url === url)
      if (context && context.content) {
        relevantContexts.push({
          url: context.url,
          content: context.content,
          commentFeedback: feedbackText,
        })
      }
    }
  }

  if (relevantContexts.length === 0) return ''

  const blocks = relevantContexts.map(ctx =>
    `--- PAGE: ${ctx.url} ---
${ctx.content}
--- END PAGE ---`
  ).join('\n\n')

  return `
=== REFERENCE PAGE CONTENT (fetched from URLs in comments) ===

The following page content was fetched from URLs referenced in the editorial comments.
You MUST use ONLY the real data from these pages. Do NOT invent or fabricate any numbers,
school names, degree names, wages, costs, or statistics. If the data you need is not
in the page content below, say: "DATA NOT FOUND IN SOURCE - please verify manually."

${blocks}

=== END REFERENCE PAGE CONTENT ===
`
}

/**
 * Retry a single failed comment with explicit focus
 */
async function retrySingleComment({
  content,
  comment,
  title,
  attempt,
  urlContexts = [],
  clientSchoolContext = '',
}) {
  // FIX #6: Build URL context for this specific comment
  const urlContext = buildUrlContextForComments([comment], urlContexts)

  // FIX #7: Build client school context if needed
  const commentText = comment.feedback || comment.comment || ''
  const needsClientSchools = mentionsClientSchool(commentText)
  const clientContext = needsClientSchools ? (clientSchoolContext || formatClientSchoolsForPrompt()) : ''

  const prompt = `You are an editor making a SINGLE, SPECIFIC change to an article.

ARTICLE TITLE: ${title}

THE CHANGE YOU MUST MAKE:
Text to change: "${comment.selected_text?.substring(0, 200) || 'See request below'}"
What to do: ${commentText}

THIS IS ATTEMPT ${attempt}. Previous attempts failed to make this change. Please:
1. Make ONLY this one specific change - do not rewrite or modify anything else
2. Keep everything else EXACTLY the same - every word, every tag, every link
3. NEVER remove existing <a href="..."> links - keep ALL existing links intact
4. If the change asks to ADD a hyperlink/link, wrap text in <a href="URL">text</a> using the exact URL from the feedback
5. Output the COMPLETE HTML content with only the targeted change applied
${urlContext ? '\n6. Use ONLY data from the REFERENCE PAGE CONTENT below. Do NOT fabricate any data.' : ''}
${clientContext ? '\n7. Use ONLY schools from the CLIENT SCHOOLS list. Do NOT make up school names.' : ''}

=== ANTI-FABRICATION RULES ===
- NEVER invent school names, degree names, tuition costs, salary figures, or statistics
- If the comment references a URL, use ONLY data found in the REFERENCE PAGE CONTENT section
- If the comment asks for "client" school data, use ONLY schools from the CLIENT SCHOOLS section
- If you cannot find the specific data requested, output a visible marker: <!-- NEEDS MANUAL DATA: [describe what's needed] -->
- It is ALWAYS better to flag missing data than to fabricate it
=== END ANTI-FABRICATION RULES ===
${urlContext}${clientContext}
CURRENT HTML CONTENT:
${content}

=== OUTPUT ONLY THE REVISED HTML (no explanation) ===`

  try {
    const revisedContent = await claudeClient.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.2, // FIX #8: Very low temperature for focused, precise change
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
 * FIX #6: Now includes URL-fetched context
 * FIX #7: Now includes client school context
 * FIX #8: Improved prompt specificity and anti-fabrication rules
 */
function buildBatchPrompt({
  content,
  feedbackItems,
  title,
  focusKeyword,
  contentType,
  contributorName,
  urlContext = '',
  clientSchoolContext = '',
}) {
  // Calculate original word count for validation guardrail
  const originalWordCount = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length

  return `You are a SURGICAL content editor. Your task is to make ONLY the specific changes requested below. Do NOT rewrite, rephrase, or modify anything that is not explicitly mentioned in the feedback.

ARTICLE: ${title}
${focusKeyword ? `Keyword: ${focusKeyword}` : ''}
${contributorName ? `Author: ${contributorName}` : ''}
Original word count: ~${originalWordCount} words

CHANGES TO MAKE (address ALL of these - do not skip any):
${feedbackItems.join('\n\n')}

=== CRITICAL RULES ===

1. **SURGICAL EDITS ONLY**: Make ONLY the exact changes described in each feedback item. If feedback says "change X to Y", change ONLY that text. Do NOT rewrite surrounding sentences or paragraphs.

2. **PRESERVE EVERYTHING ELSE**: The revised article MUST be the same length (within 5%) as the original. If your output is significantly shorter, you have made a critical error by removing or summarizing content.

3. **WORD COUNT GUARD**: Original is ~${originalWordCount} words. Your output MUST also be ~${originalWordCount} words.

4. Output ONLY valid HTML - no markdown, no code blocks, no explanations
5. Preserve ALL existing HTML structure (<h2>, <h3>, <p>, <ul>, <a>, etc.)
6. Preserve ALL links with their href attributes - NEVER remove an existing <a> tag unless explicitly asked
7. Preserve ALL shortcodes: [su_ge-picks], [su_ge-cta], [ge_cta], etc.
8. If editing text near or inside an existing link, KEEP the <a> tag and href intact

=== ANTI-FABRICATION RULES (CRITICAL) ===

- NEVER invent or fabricate school names, degree program names, tuition costs, salary/wage figures, enrollment numbers, or any statistics
- If a comment references a URL, the actual page content is provided below in REFERENCE PAGE CONTENT. Use ONLY data from that content.
- If a comment mentions "client school" or "client degree", use ONLY schools from the CLIENT SCHOOLS section below
- If you cannot find the specific data needed to fulfill a comment, insert a visible HTML comment marker: <!-- NEEDS MANUAL DATA: [describe what data is needed] -->
- It is ALWAYS better to flag missing data with a marker than to fabricate data
- When asked to "use the wages from" a page, extract the EXACT numbers from the provided page content
- When asked to "use the top programs from" a page, extract the EXACT program names and schools from the provided page content

=== END ANTI-FABRICATION RULES ===

LINK HANDLING:
- NEVER remove existing links. If you modify text around a link, the <a href="..."> tag MUST remain.
- If feedback asks to ADD a hyperlink/link/URL: wrap the relevant text in <a href="URL">text</a> using the EXACT URL from the feedback
- Example: feedback says "add link to https://www.geteducated.com/rankings/page" -> change relevant text to <a href="https://www.geteducated.com/rankings/page">text</a>

LINKING RULES (if adding NEW links):
- NEVER use .edu links
- NEVER use competitor sites (bestcolleges.com, usnews.com, onlineu.com)
- Use GetEducated pages: geteducated.com/online-schools/, geteducated.com/online-degrees/
- External links only to: bls.gov, .gov sites, accreditation bodies
${urlContext}${clientSchoolContext ? '\n' + clientSchoolContext : ''}
CURRENT HTML (${originalWordCount} words - your output must be approximately the same length):
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
  // FIX #6: Fetch URL context even for single comments
  const { urlContexts } = await fetchUrlContextsFromComments([comment], null)

  // FIX #7: Check for client school references
  const commentText = comment.feedback || comment.comment || ''
  const clientSchoolContext = mentionsClientSchool(commentText) ? formatClientSchoolsForPrompt() : ''

  return await retrySingleComment({
    content,
    comment,
    title,
    attempt: 1,
    urlContexts,
    clientSchoolContext,
  })
}

export default {
  processCommentsInBatches,
  processSingleComment,
  MAX_BATCH_SIZE,
  MAX_RETRIES,
}
