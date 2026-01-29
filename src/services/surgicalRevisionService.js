/**
 * Surgical Revision Service
 *
 * Handles precise, targeted edits to article content based on editorial feedback.
 * Designed for reliability over creativity - simple changes should work 100% of the time.
 *
 * Strategy:
 * 1. Try programmatic replacement first (for simple "change X to Y" requests)
 * 2. Fall back to minimal AI prompt with very low temperature
 * 3. Process one feedback item at a time
 * 4. Validate each change was actually made
 */

// Use Edge Function client for secure server-side API calls
// API keys are stored in Supabase secrets, not exposed to browser
import ClaudeClient from './ai/claudeClient.edge'
import { validateContent, BLOCKED_COMPETITORS, ALLOWED_EXTERNAL_DOMAINS } from './validation/linkValidator'
import { supabase } from './supabaseClient'
import {
  extractSubjectArea,
  extractDegreeLevel,
  extractTopics,
  filterRelevantArticles,
} from './topicRelevanceService'

class SurgicalRevisionService {
  constructor() {
    this.claudeClient = new ClaudeClient()
    // Track rejected links so AI knows what to avoid
    this.rejectedLinks = new Set()
  }

  /**
   * Check if feedback is asking for an internal link to be added
   */
  isInternalLinkRequest(feedback) {
    const patterns = [
      /add\s+(?:an?\s+)?internal\s+link/i,
      /hyperlink\s+to\s+(?:a\s+)?(?:page|article)\s+on\s+geteducated/i,
      /link\s+to\s+(?:a\s+)?geteducated/i,
      /add\s+(?:a\s+)?link\s+(?:to\s+)?(?:from\s+)?geteducated/i,
      /internal\s+link\s+(?:from\s+)?geteducated/i,
    ]
    return patterns.some(p => p.test(feedback))
  }

  /**
   * Fetch relevant GetEducated articles for internal linking
   * Used when editorial feedback asks for an internal link
   */
  async fetchRelevantInternalLinks(articleTitle, content) {
    try {
      // Extract subject and topics from the article
      const subject = extractSubjectArea(articleTitle) || extractSubjectArea(content.substring(0, 500))
      const topics = extractTopics(articleTitle)

      console.log(`[SurgicalRevision] Fetching internal links for subject: ${subject}`)

      // Query the GetEducated catalog
      const { data: geArticles, error } = await supabase
        .from('geteducated_articles')
        .select('id, url, title, excerpt, topics, subject_area, degree_level')
        .not('content_text', 'is', null)
        .order('times_linked_to', { ascending: true })
        .limit(50)

      if (error || !geArticles || geArticles.length === 0) {
        console.warn('[SurgicalRevision] Could not fetch GetEducated articles:', error?.message)
        return []
      }

      // Filter for relevance
      const sourceArticle = {
        title: articleTitle,
        subject_area: subject,
        topics: topics,
      }

      const relevantArticles = filterRelevantArticles(
        sourceArticle,
        geArticles,
        { limit: 10, minScore: 20, requireSubjectMatch: !!subject }
      )

      console.log(`[SurgicalRevision] Found ${relevantArticles.length} relevant internal links`)
      return relevantArticles.map(item => item.article)

    } catch (error) {
      console.error('[SurgicalRevision] Error fetching internal links:', error)
      return []
    }
  }

  /**
   * Add a link to the rejected list (called when validation fails)
   */
  addRejectedLink(url) {
    this.rejectedLinks.add(url)
  }

  /**
   * Clear rejected links (call at start of new revision session)
   */
  clearRejectedLinks() {
    this.rejectedLinks.clear()
  }

  /**
   * Get linking rules for AI prompts
   */
  getLinkingRules() {
    let rules = `
CRITICAL LINKING RULES:
- NEVER use competitor domains: ${BLOCKED_COMPETITORS.slice(0, 5).join(', ')}, etc.
- NEVER link directly to .edu domains
- For external links, ONLY use: bls.gov, ed.gov, nces.ed.gov, or other government/nonprofit sources
- For internal links, ONLY use geteducated.com URLs`

    if (this.rejectedLinks.size > 0) {
      rules += `

PREVIOUSLY REJECTED LINKS (DO NOT USE THESE):
${Array.from(this.rejectedLinks).slice(0, 10).join('\n')}`
    }

    return rules
  }

  /**
   * Process all feedback items one at a time
   * Returns the revised content and a report of what was changed
   * @param {string} content - The article content
   * @param {Array} feedbackItems - Array of feedback items to process
   * @param {Object} options - { onProgress, articleTitle }
   */
  async processAllFeedback(content, feedbackItems, options = {}) {
    const { onProgress = () => {}, articleTitle = '' } = options

    let currentContent = content
    const results = []

    // Extract title from content if not provided
    const title = articleTitle || this.extractTitleFromContent(content)

    for (let i = 0; i < feedbackItems.length; i++) {
      const item = feedbackItems[i]
      onProgress({
        current: i + 1,
        total: feedbackItems.length,
        message: `Processing feedback ${i + 1} of ${feedbackItems.length}...`,
      })

      try {
        const result = await this.processSingleFeedback(currentContent, item, title)
        currentContent = result.content
        results.push({
          id: item.id,
          success: result.success,
          method: result.method,
          changeDescription: result.changeDescription,
          error: null,
        })
      } catch (error) {
        console.error(`[SurgicalRevision] Failed to process feedback ${item.id}:`, error)
        results.push({
          id: item.id,
          success: false,
          method: 'error',
          changeDescription: null,
          error: error.message,
        })
      }
    }

    return {
      content: currentContent,
      results,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length,
    }
  }

  /**
   * Process a single feedback item
   * Tries programmatic replacement first, falls back to AI
   * @param {string} content - The article content
   * @param {Object} feedbackItem - The feedback item to process
   * @param {string} articleTitle - Optional article title for context
   */
  async processSingleFeedback(content, feedbackItem, articleTitle = '') {
    const { selected_text, comment, feedback } = feedbackItem
    const feedbackText = comment || feedback // Handle both field names

    // Step 1: Try to detect if this is a simple replacement
    const simpleReplacement = this.detectSimpleReplacement(feedbackText, selected_text)

    if (simpleReplacement) {
      console.log(`[SurgicalRevision] Detected simple replacement: "${simpleReplacement.find}" → "${simpleReplacement.replace}"`)
      const result = this.performSimpleReplacement(content, simpleReplacement, selected_text)
      if (result.success) {
        return result
      }
      // If simple replacement failed, fall through to AI
      console.log(`[SurgicalRevision] Simple replacement failed, falling back to AI`)
    }

    // Step 2: Use AI for more complex changes
    return await this.performAIRevision(content, selected_text, feedbackText, articleTitle)
  }

  /**
   * Extract article title from HTML content
   * Looks for h1 or first h2 tag
   */
  extractTitleFromContent(content) {
    if (!content) return ''

    // Try to find h1 first
    const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    if (h1Match) return h1Match[1].trim()

    // Fallback to first h2
    const h2Match = content.match(/<h2[^>]*>([^<]+)<\/h2>/i)
    if (h2Match) return h2Match[1].trim()

    // Last resort: first 100 chars of text content
    const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return textContent.substring(0, 100)
  }

  /**
   * Detect if feedback is a simple find/replace request
   * Patterns like:
   * - "change 2025 to 2026"
   * - "replace 'old' with 'new'"
   * - "should be 2026 not 2025"
   * - "2025 → 2026"
   * - "update to 2026"
   */
  detectSimpleReplacement(feedback, selectedText) {
    const feedbackLower = feedback.toLowerCase().trim()

    // Pattern 1: "change X to Y" or "change X into Y"
    let match = feedbackLower.match(/change\s+['""]?(.+?)['""]?\s+(?:to|into)\s+['""]?(.+?)['""]?$/i)
    if (match) {
      return { find: match[1].trim(), replace: match[2].trim() }
    }

    // Pattern 2: "replace X with Y"
    match = feedbackLower.match(/replace\s+['""]?(.+?)['""]?\s+with\s+['""]?(.+?)['""]?$/i)
    if (match) {
      return { find: match[1].trim(), replace: match[2].trim() }
    }

    // Pattern 3: "should be Y not X" or "should be Y instead of X"
    match = feedbackLower.match(/should\s+(?:be|say)\s+['""]?(.+?)['""]?\s+(?:not|instead\s+of)\s+['""]?(.+?)['""]?$/i)
    if (match) {
      return { find: match[2].trim(), replace: match[1].trim() }
    }

    // Pattern 4: "X → Y" or "X -> Y" or "X => Y"
    match = feedback.match(/['""]?(.+?)['""]?\s*(?:→|->|=>)\s*['""]?(.+?)['""]?$/i)
    if (match) {
      return { find: match[1].trim(), replace: match[2].trim() }
    }

    // Pattern 5: "update to Y" or "change to Y" (use selected text as find)
    match = feedbackLower.match(/(?:update|change|switch)\s+(?:this\s+)?to\s+['""]?(.+?)['""]?$/i)
    if (match && selectedText) {
      return { find: selectedText.trim(), replace: match[1].trim() }
    }

    // Pattern 6: "say Y instead" or "use Y instead"
    match = feedbackLower.match(/(?:say|use|write)\s+['""]?(.+?)['""]?\s+instead$/i)
    if (match && selectedText) {
      return { find: selectedText.trim(), replace: match[1].trim() }
    }

    // Pattern 7: Just a replacement value with selected text (e.g., feedback is just "2026")
    // If feedback is very short and looks like a simple value, assume it's a replacement
    if (selectedText && feedback.trim().length < 50 && !feedback.includes(' ') && /^[\w\d\-\.]+$/.test(feedback.trim())) {
      return { find: selectedText.trim(), replace: feedback.trim() }
    }

    // Pattern 8: "make it Y" or "this should be Y"
    match = feedbackLower.match(/(?:make\s+(?:it|this)|this\s+should\s+be)\s+['""]?(.+?)['""]?$/i)
    if (match && selectedText) {
      return { find: selectedText.trim(), replace: match[1].trim() }
    }

    return null
  }

  /**
   * Perform a simple programmatic replacement
   */
  performSimpleReplacement(content, replacement, selectedText) {
    const { find, replace } = replacement

    // Strategy 1: Direct replacement of the find text
    if (content.includes(find)) {
      const newContent = content.replace(find, replace)
      if (newContent !== content) {
        return {
          success: true,
          content: newContent,
          method: 'direct_replacement',
          changeDescription: `Replaced "${find}" with "${replace}"`,
        }
      }
    }

    // Strategy 2: If find text not found, try replacing the selected text
    if (selectedText && content.includes(selectedText)) {
      // Check if the selected text contains the find text
      if (selectedText.includes(find)) {
        const modifiedSelection = selectedText.replace(find, replace)
        const newContent = content.replace(selectedText, modifiedSelection)
        if (newContent !== content) {
          return {
            success: true,
            content: newContent,
            method: 'selection_replacement',
            changeDescription: `Replaced "${find}" with "${replace}" in selected text`,
          }
        }
      }

      // If find text is the same as selected text, replace selected with replace
      if (find.toLowerCase() === selectedText.toLowerCase().trim()) {
        const newContent = content.replace(selectedText, replace)
        if (newContent !== content) {
          return {
            success: true,
            content: newContent,
            method: 'selection_replacement',
            changeDescription: `Replaced selected text with "${replace}"`,
          }
        }
      }
    }

    // Strategy 3: Case-insensitive replacement
    const findRegex = new RegExp(this.escapeRegex(find), 'gi')
    if (findRegex.test(content)) {
      const newContent = content.replace(findRegex, replace)
      if (newContent !== content) {
        return {
          success: true,
          content: newContent,
          method: 'case_insensitive_replacement',
          changeDescription: `Replaced "${find}" with "${replace}" (case-insensitive)`,
        }
      }
    }

    return { success: false, content, method: 'failed', changeDescription: null }
  }

  /**
   * Escape special regex characters
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Perform AI-assisted revision for complex changes
   * Uses a MINIMAL prompt with very low temperature
   * IMPROVED: Handles internal link requests by fetching relevant GetEducated articles
   */
  async performAIRevision(content, selectedText, feedback, articleTitle = '') {
    // Extract just the relevant section to minimize context
    const contextWindow = this.extractRelevantContext(content, selectedText)

    // Check if feedback is about links
    const isLinkFeedback = /link|url|source|cite|citation|href|competitor/i.test(feedback)
    const isInternalLinkRequest = this.isInternalLinkRequest(feedback)
    const linkingRules = isLinkFeedback ? this.getLinkingRules() : ''

    // If this is an internal link request, fetch relevant articles
    let internalLinkSection = ''
    if (isInternalLinkRequest) {
      console.log('[SurgicalRevision] Detected internal link request, fetching relevant articles...')
      const title = articleTitle || this.extractTitleFromContent(content)
      const relevantArticles = await this.fetchRelevantInternalLinks(title, content)

      if (relevantArticles.length > 0) {
        internalLinkSection = `

=== AVAILABLE GETEDUCATED INTERNAL LINKS ===
These articles have been pre-filtered for relevance to this content.
ONLY use links from this list - do not invent or guess URLs.

${relevantArticles.map(a => {
  const subject = a.subject_area || extractSubjectArea(a.title)
  const subjectInfo = subject ? ` [${subject}]` : ''
  return `- [${a.title}](${a.url})${subjectInfo}`
}).join('\n')}

IMPORTANT: Choose a link that is contextually relevant to the selected text.
The link topic must make sense in the context of the sentence.
=== END AVAILABLE LINKS ===
`
      } else {
        console.warn('[SurgicalRevision] No relevant internal links found')
        internalLinkSection = `

NOTE: No relevant GetEducated articles were found for internal linking.
If the feedback asks for an internal link, acknowledge this limitation.
`
      }
    }

    const prompt = `You are making a single, precise edit to article content.

SELECTED TEXT TO MODIFY:
"${selectedText}"

EDITORIAL FEEDBACK:
${feedback}
${linkingRules}${internalLinkSection}

SURROUNDING CONTEXT:
${contextWindow.context}

TASK:
Replace or modify the SELECTED TEXT based on the editorial feedback.
- Find "${selectedText}" in the context and apply the requested change
- If feedback says to change/replace something, do exactly that replacement
- If feedback suggests a correction, make that specific correction
- If feedback asks for an internal link, use ONLY URLs from the AVAILABLE LINKS list above
- If feedback asks for a credible source, use BLS.gov, ED.gov, or similar government sources
- If you cannot find a credible source, rewrite the text to not require a citation
- Keep everything else in the context EXACTLY the same
- Return the complete surrounding context with ONLY the targeted change applied
- Return raw HTML only, no markdown code blocks, no explanations

OUTPUT:`

    try {
      const response = await this.claudeClient.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.1,  // Very low for precision
        max_tokens: 2000,  // Small output for focused changes
      })

      const revisedContext = response.trim()
        .replace(/^```html?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()

      // Replace the context section in the original content
      let newContent = content.replace(contextWindow.context, revisedContext)

      // POST-REVISION LINK VALIDATION
      // Check if any blocked links were introduced
      if (newContent !== content) {
        const linkValidation = validateContent(newContent)
        if (!linkValidation.isCompliant) {
          console.warn('[SurgicalRevision] AI added blocked links:', linkValidation.blockingIssues)
          // Track these as rejected so future revisions avoid them
          for (const issue of linkValidation.blockingIssues) {
            this.addRejectedLink(issue.url)
          }
          // Remove the blocked links
          for (const issue of linkValidation.blockingIssues) {
            const linkRegex = new RegExp(`<a[^>]*href=["']${issue.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[^<]*</a>`, 'gi')
            newContent = newContent.replace(linkRegex, issue.anchorText || '')
          }
          // Return with warning
          return {
            success: true,
            content: newContent,
            method: 'ai_contextual_link_fixed',
            changeDescription: `AI applied change but blocked links were removed: ${linkValidation.blockingIssues.map(i => i.url).join(', ')}`,
            linkWarning: 'Blocked links were automatically removed. Please review.',
          }
        }
      }

      // Validate the change was made
      if (newContent === content) {
        // AI returned the same content - try with the full content as last resort
        return await this.performFullAIRevision(content, selectedText, feedback)
      }

      return {
        success: true,
        content: newContent,
        method: 'ai_contextual',
        changeDescription: `AI applied change to: "${selectedText.substring(0, 50)}..."`,
      }

    } catch (error) {
      console.error('[SurgicalRevision] AI revision failed:', error)
      throw error
    }
  }

  /**
   * Last resort: AI revision on full content
   * Still uses minimal prompt but with full article
   */
  async performFullAIRevision(content, selectedText, feedback) {
    // Check if feedback is about links
    const isLinkFeedback = /link|url|source|cite|citation|href|competitor/i.test(feedback)
    const linkingRules = isLinkFeedback ? this.getLinkingRules() : ''

    const prompt = `Make ONE precise edit to this HTML content.

SELECTED TEXT TO MODIFY:
"${selectedText}"

EDITORIAL FEEDBACK:
${feedback}
${linkingRules}

FULL CONTENT:
${content}

RULES:
1. Find the SELECTED TEXT in the content
2. Apply the editorial feedback to modify/replace that specific text
3. If feedback says "change X to Y" or "should be Y", replace X with Y
4. If feedback asks for a credible source, use BLS.gov, ED.gov, or similar government sources
5. If you cannot find a credible source, rewrite the text to not require a citation
6. Keep ALL other content exactly the same - do not rewrite anything else
7. Preserve all HTML tags and structure exactly
8. Return the COMPLETE HTML with only the single targeted change
9. Do NOT summarize or shorten the content

OUTPUT:`

    try {
      const response = await this.claudeClient.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.1,
        max_tokens: 16000,
      })

      let revisedContent = response.trim()
        .replace(/^```html?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()

      // POST-REVISION LINK VALIDATION
      const linkValidation = validateContent(revisedContent)
      if (!linkValidation.isCompliant) {
        console.warn('[SurgicalRevision] Full revision added blocked links:', linkValidation.blockingIssues)
        // Track and remove blocked links
        for (const issue of linkValidation.blockingIssues) {
          this.addRejectedLink(issue.url)
          const linkRegex = new RegExp(`<a[^>]*href=["']${issue.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[^<]*</a>`, 'gi')
          revisedContent = revisedContent.replace(linkRegex, issue.anchorText || '')
        }
      }

      // Validate word count didn't change dramatically
      const originalWords = this.countWords(content)
      const revisedWords = this.countWords(revisedContent)

      if (revisedWords < originalWords * 0.8) {
        throw new Error(`AI truncated content from ${originalWords} to ${revisedWords} words`)
      }

      if (revisedContent === content) {
        return {
          success: false,
          content,
          method: 'ai_full_no_change',
          changeDescription: 'AI could not determine how to make the requested change',
        }
      }

      return {
        success: true,
        content: revisedContent,
        method: 'ai_full',
        changeDescription: `AI applied change to: "${selectedText.substring(0, 50)}..."`,
      }

    } catch (error) {
      console.error('[SurgicalRevision] Full AI revision failed:', error)
      throw error
    }
  }

  /**
   * Extract a relevant context window around the selected text
   * Returns ~500-1000 chars of context to minimize AI confusion
   */
  extractRelevantContext(content, selectedText) {
    const index = content.indexOf(selectedText)

    if (index === -1) {
      // Selected text not found exactly - return a larger section
      return { context: content.substring(0, 2000), startIndex: 0 }
    }

    // Find paragraph or section boundaries
    const contextRadius = 500
    let startIndex = Math.max(0, index - contextRadius)
    let endIndex = Math.min(content.length, index + selectedText.length + contextRadius)

    // Expand to paragraph boundaries
    const paragraphStart = content.lastIndexOf('<p', startIndex)
    if (paragraphStart !== -1 && paragraphStart > startIndex - 200) {
      startIndex = paragraphStart
    }

    const paragraphEnd = content.indexOf('</p>', endIndex)
    if (paragraphEnd !== -1 && paragraphEnd < endIndex + 200) {
      endIndex = paragraphEnd + 4
    }

    // Also try section boundaries (h2, h3)
    const sectionStart = Math.max(
      content.lastIndexOf('<h2', startIndex),
      content.lastIndexOf('<h3', startIndex)
    )
    if (sectionStart !== -1 && sectionStart > startIndex - 300) {
      startIndex = sectionStart
    }

    return {
      context: content.substring(startIndex, endIndex),
      startIndex,
    }
  }

  /**
   * Count words in content (strips HTML)
   */
  countWords(content) {
    if (!content) return 0
    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return text.split(' ').filter(w => w.length > 0).length
  }
}

export default new SurgicalRevisionService()
