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

import ClaudeClient from './ai/claudeClient'

class SurgicalRevisionService {
  constructor() {
    this.claudeClient = new ClaudeClient()
  }

  /**
   * Process all feedback items one at a time
   * Returns the revised content and a report of what was changed
   */
  async processAllFeedback(content, feedbackItems, options = {}) {
    const { onProgress = () => {} } = options

    let currentContent = content
    const results = []

    for (let i = 0; i < feedbackItems.length; i++) {
      const item = feedbackItems[i]
      onProgress({
        current: i + 1,
        total: feedbackItems.length,
        message: `Processing feedback ${i + 1} of ${feedbackItems.length}...`,
      })

      try {
        const result = await this.processSingleFeedback(currentContent, item)
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
   */
  async processSingleFeedback(content, feedbackItem) {
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
    return await this.performAIRevision(content, selected_text, feedbackText)
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
   */
  async performAIRevision(content, selectedText, feedback) {
    // Extract just the relevant section to minimize context
    const contextWindow = this.extractRelevantContext(content, selectedText)

    const prompt = `You are making a single, specific edit to article content.

SELECTED TEXT:
"${selectedText}"

REQUESTED CHANGE:
${feedback}

SURROUNDING CONTEXT:
${contextWindow.context}

TASK:
Return ONLY the corrected version of the surrounding context with the requested change applied.
- Make the minimal change needed to address the feedback
- Keep everything else EXACTLY the same
- Return raw HTML, no markdown, no explanations
- Do NOT rewrite or improve other parts of the text

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
      const newContent = content.replace(contextWindow.context, revisedContext)

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
    const prompt = `Make ONE specific change to this HTML content.

FIND THIS TEXT:
"${selectedText}"

MAKE THIS CHANGE:
${feedback}

CONTENT:
${content}

RULES:
1. Make ONLY the requested change
2. Keep ALL other content exactly the same
3. Preserve all HTML tags and structure
4. Return the complete HTML with the single change applied

OUTPUT:`

    try {
      const response = await this.claudeClient.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.1,
        max_tokens: 16000,
      })

      const revisedContent = response.trim()
        .replace(/^```html?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()

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
