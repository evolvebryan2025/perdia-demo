/**
 * Claude AI Client for Content Humanization
 * Uses Anthropic's Claude API for making content undetectable and auto-fixing quality issues
 */

import Anthropic from '@anthropic-ai/sdk'

class ClaudeClient {
  constructor(apiKey) {
    this.apiKey = apiKey || import.meta.env.VITE_CLAUDE_API_KEY
    this.client = new Anthropic({
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true, // Note: In production, use Edge Functions
    })
    this.model = 'claude-sonnet-4-20250514'
  }

  /**
   * Generic chat method for custom prompts
   */
  async chat(messages, options = {}) {
    // Check if API key is set
    if (!this.apiKey || this.apiKey === 'undefined') {
      console.warn('⚠️ Claude API key not set. Using mock response for testing.')
      return this.getMockHumanizedContent(messages)
    }

    const {
      temperature = 0.7,
      max_tokens = 4000,
    } = options

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens,
        temperature,
        messages,
      })

      return response.content[0].text

    } catch (error) {
      console.error('Claude chat error:', error)
      throw error
    }
  }

  /**
   * Mock humanized content for testing
   * CRITICAL: This must return the original content when API key is missing,
   * never a generic template that doesn't match the article!
   */
  getMockHumanizedContent(messages) {
    const userMessage = messages.find(m => m.role === 'user')?.content || ''

    // Check for various content markers used in different prompts
    // AI Revision uses "CURRENT HTML CONTENT:", humanization uses "ORIGINAL CONTENT:"
    const contentMarkers = [
      /CURRENT HTML CONTENT:\s*([\s\S]*?)(?=\n\nEDITORIAL FEEDBACK|CRITICAL|$)/i,
      /ORIGINAL CONTENT:\s*([\s\S]*?)(?=CRITICAL|===|$)/i,
      /CURRENT CONTENT:\s*([\s\S]*?)(?=QUALITY ISSUES|EDITORIAL FEEDBACK|===|$)/i,
    ]

    for (const marker of contentMarkers) {
      const contentMatch = userMessage.match(marker)
      if (contentMatch && contentMatch[1]) {
        const extractedContent = contentMatch[1].trim()
        // Only return if we got actual content, not empty string
        if (extractedContent.length > 100) {
          console.warn('⚠️ Claude API key not set - returning original content unchanged for safety')
          return extractedContent
        }
      }
    }

    // If we couldn't extract content, throw an error instead of returning wrong content
    // This prevents the client from seeing "a snippet that doesn't look like the original"
    console.error('❌ Claude API key not set and could not extract original content from prompt')
    throw new Error('CLAUDE_API_KEY_NOT_SET: Cannot perform AI revision without Claude API key. Please configure VITE_CLAUDE_API_KEY in your environment.')
  }

  /**
   * Humanize AI-generated content to make it undetectable
   */
  async humanize(content, options = {}) {
    // Check if API key is set
    if (!this.apiKey || this.apiKey === 'undefined') {
      console.warn('⚠️ Claude API key not set. Returning original content for testing.')
      return content // Just return the original content for testing
    }

    const {
      contributorProfile = null,
      targetPerplexity = 'high',
      targetBurstiness = 'high',
    } = options

    const prompt = this.buildHumanizationPrompt(content, contributorProfile, targetPerplexity, targetBurstiness)

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4500,
        temperature: 0.9,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      return response.content[0].text

    } catch (error) {
      console.error('Claude humanization error:', error)
      throw error
    }
  }

  /**
   * Build prompt for humanization
   * IMPORTANT: Includes GetEducated-specific content rules
   * CRITICAL: display_name is the PUBLIC byline (real name), style_proxy is INTERNAL only
   */
  buildHumanizationPrompt(content, contributorProfile, perplexity, burstiness) {
    let styleInstructions = ''

    if (contributorProfile) {
      const style = contributorProfile.writing_style_profile || {}
      // CRITICAL: Use display_name (real name) for public byline, NEVER use style_proxy
      const publicByline = contributorProfile.display_name || contributorProfile.name
      const styleProxy = contributorProfile.style_proxy || ''

      // Build comprehensive style instructions from enhanced profile fields
      styleInstructions = `
=== GETEDUCATED AUTHOR PROFILE ===
Public Byline (REAL NAME): ${publicByline}
Internal Style Proxy: ${styleProxy} (for voice matching only - NEVER publish this name)

VOICE & TONE:
${contributorProfile.voice_description || style.style_notes || 'Professional education content writer'}

WRITING GUIDELINES:
${contributorProfile.writing_guidelines || `
- Tone: ${style.tone || 'professional'}
- Complexity: ${style.complexity_level || 'intermediate'}
- Sentence Length: ${style.sentence_length_preference || 'medium'}`}

SIGNATURE PHRASES TO USE:
${contributorProfile.signature_phrases?.map(p => `- "${p}"`).join('\n') || '- N/A'}

PHRASES TO AVOID:
${contributorProfile.phrases_to_avoid?.map(p => `- "${p}"`).join('\n') || '- N/A'}

INTRO STYLE: ${contributorProfile.intro_style || 'Professional opening'}
CONCLUSION STYLE: ${contributorProfile.conclusion_style || 'Clear summary with next steps'}
=== END AUTHOR PROFILE ===
`
    }

    return `You are a highly skilled human writer working for GetEducated.com, an online education resource. Your task is to rewrite the following AI-generated content to make it completely undetectable as AI-written while maintaining GetEducated's content standards.

${styleInstructions}

ORIGINAL CONTENT:
${content}

=== GETEDUCATED CONTENT RULES (MUST PRESERVE) ===

1. LINKING RULES:
   - All school mentions should link to GetEducated school pages (geteducated.com/online-schools/...)
   - All degree mentions should link to GetEducated degree database (geteducated.com/online-degrees/...)
   - NEVER create links to .edu school websites
   - External links ONLY to BLS, government sites, nonprofit education orgs
   - NEVER link to competitors (onlineu.com, usnews.com, etc.)

2. COST DATA:
   - Preserve all cost data exactly as written (sourced from GetEducated ranking reports)
   - Keep "in-state" and "out-of-state" cost distinctions
   - Maintain references to GetEducated's ranking methodology

3. STRUCTURE:
   - Keep "GetEducated's Picks" callout boxes
   - Preserve article navigation sections
   - Maintain FAQ sections with all questions/answers
   - Keep "How we researched this" attribution

=== END GETEDUCATED RULES ===

CRITICAL HUMANIZATION TECHNIQUES:

1. **Perplexity (Unpredictability)**: ${perplexity}
   - Use unexpected word choices and phrasings
   - Avoid predictable transitions
   - Include occasional education industry terms
   - Vary vocabulary richly

2. **Burstiness (Sentence Variation)**: ${burstiness}
   - Mix very short sentences with longer, complex ones
   - Create natural rhythm: short → long → medium → very short
   - Use fragments occasionally for emphasis
   - Vary sentence structures significantly

3. **Voice & Personality**:
   - Write as an education expert helping prospective students
   - Add empathy for readers' education and career goals
   - Include minor stylistic imperfections (starting sentences with "And" or "But")
   - Use rhetorical questions sparingly

4. **Natural Writing Patterns**:
   - Avoid overly perfect grammar (humans make small stylistic choices)
   - Use contractions naturally (don't, won't, I've)
   - NEVER use em-dashes (—) as they are a well-known AI writing indicator
   - Use commas, colons, or semicolons for natural pauses instead
   - Vary paragraph lengths significantly

5. **BANNED AI PHRASES** (Never use these):
   - "It's important to note that"
   - "In today's digital age"
   - "In conclusion"
   - "Delve into"
   - "Dive deep"
   - "At the end of the day"
   - "Game changer"
   - "Revolutionary"
   - "Cutting-edge"
   - "Leverage"
   - "Robust"
   - "Seamless"
   - "Navigate the landscape"
   - "Embark on a journey"

6. **Content Quality**:
   - Keep all factual information accurate (especially costs and accreditation)
   - Maintain the same structure and headings
   - Preserve HTML formatting and all links
   - Keep the same SEO focus
   - Ensure the content remains valuable for online education seekers

=== CRITICAL HTML FORMATTING RULES ===

Your output MUST be properly formatted HTML with:
1. <h2> tags for major section headings
2. <h3> tags for subsections
3. <p> tags wrapping EVERY paragraph of text
4. <ul> and <li> tags for bulleted lists
5. <ol> and <li> tags for numbered lists
6. <strong> or <b> tags for bold text
7. <em> or <i> tags for italic text
8. <a href="..."> tags for any links

NEVER output plain text without HTML tags. Every paragraph MUST be wrapped in <p> tags.

=== END HTML FORMATTING RULES ===

OUTPUT ONLY THE REWRITTEN HTML CONTENT. DO NOT include explanations, meta-commentary, or anything other than the pure HTML article content.`
  }

  /**
   * Auto-fix quality issues in content
   */
  async autoFixQualityIssues(content, issues, siteArticles = []) {
    const issueDescriptions = issues.map(issue => {
      const descriptions = {
        word_count_low: `Article is too short (needs to be 1500-2500 words)`,
        word_count_high: `Article is too long (needs to be 1500-2500 words)`,
        missing_internal_links: `Missing internal links (needs 3-5 links to related articles)`,
        missing_external_links: `Missing external citations (needs 2-4 authoritative sources)`,
        missing_faqs: `Missing FAQ section (needs at least 3 FAQ items)`,
        poor_readability: `Readability score is too low (needs simpler language and shorter sentences)`,
        weak_headings: `Heading structure needs improvement (missing H2/H3 hierarchy)`,
      }
      return descriptions[issue.type] || issue.type
    }).join('\n- ')

    let internalLinksContext = ''
    if (siteArticles.length > 0) {
      internalLinksContext = `

AVAILABLE ARTICLES FOR INTERNAL LINKING (use 3-5 of these where relevant):
${siteArticles.map(article => `- [${article.title}](${article.url}) - Topics: ${article.topics?.join(', ') || 'N/A'}`).join('\n')}
`
    }

    const prompt = `You are a content editor fixing quality issues in this article.

CURRENT CONTENT:
${content}

QUALITY ISSUES TO FIX:
- ${issueDescriptions}
${internalLinksContext}

=== CRITICAL HTML FORMATTING RULES ===

Your output MUST be properly formatted HTML with:
1. <h2> tags for major section headings
2. <h3> tags for subsections
3. <p> tags wrapping EVERY paragraph of text
4. <ul> and <li> tags for bulleted lists
5. <ol> and <li> tags for numbered lists
6. <strong> or <b> tags for bold text
7. <em> or <i> tags for italic text
8. <a href="..."> tags for any links

NEVER output plain text without HTML tags. Every paragraph MUST be wrapped in <p> tags.

=== END HTML FORMATTING RULES ===

INSTRUCTIONS:
1. Fix each issue listed above
2. For word count: Add or remove content naturally, maintaining quality
3. For internal links: Add 3-5 contextual links to the provided articles where genuinely relevant (use HTML <a> tags)
4. For external links: Add 2-4 citations to authoritative sources like research papers, official documentation, or reputable publications
5. For FAQs: Add a "Frequently Asked Questions" section with at least 3 relevant Q&A pairs at the end using proper HTML (<h2>Frequently Asked Questions</h2> followed by <h3> for questions and <p> for answers)
6. For readability: Simplify complex sentences, break up long paragraphs, use clearer language
7. For headings: Ensure proper H2/H3 hierarchy, make headings descriptive and keyword-rich
8. Maintain the article's tone, style, and factual accuracy
9. Keep all existing HTML formatting and ensure ALL new content is properly HTML formatted

OUTPUT ONLY THE CORRECTED HTML CONTENT. DO NOT include explanations or notes.`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4500,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      return response.content[0].text

    } catch (error) {
      console.error('Claude auto-fix error:', error)
      throw error
    }
  }

  /**
   * Revise content based on editorial feedback
   * CRITICAL: This method MUST preserve the original article and only make targeted edits
   */
  async reviseWithFeedback(content, feedbackItems) {
    // Calculate original word count to validate later
    const originalWordCount = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length

    const feedbackText = feedbackItems.map((item, index) => {
      return `${index + 1}. [${item.category.toUpperCase()}] ${item.severity}
   Selected text: "${item.selected_text}"
   Requested change: ${item.comment}`
    }).join('\n\n')

    const prompt = `You are a SURGICAL content editor. Your task is to make ONLY the specific changes requested in the editorial feedback below.

=== CRITICAL RULES - READ CAREFULLY ===

1. **PRESERVE THE ENTIRE ARTICLE**: You MUST return the COMPLETE article with ONLY the specific requested changes. Do NOT summarize, condense, rewrite, or replace the article.

2. **TARGETED EDITS ONLY**: Make ONLY the exact changes described in each feedback item. If feedback says "change 2025 to 2026", change ONLY that text. If feedback says "fix typo", fix ONLY that typo.

3. **WORD COUNT REQUIREMENT**: The original article is approximately ${originalWordCount} words. Your output MUST be approximately the same length (within 10%). If your output is significantly shorter, you have made a critical error.

4. **DO NOT**:
   - Summarize or condense the article
   - Replace sections with new content unless specifically requested
   - Remove content unless specifically requested
   - Rewrite sentences that weren't mentioned in feedback
   - Add new sections unless specifically requested

=== CURRENT HTML CONTENT (${originalWordCount} words) ===

${content}

=== END CURRENT CONTENT ===

=== EDITORIAL FEEDBACK (${feedbackItems.length} items) ===

${feedbackText}

=== END FEEDBACK ===

=== OUTPUT REQUIREMENTS ===

1. Return the COMPLETE article HTML with ONLY the targeted edits made
2. Preserve ALL HTML formatting exactly as it appears
3. Maintain the same structure, headings, paragraphs, and sections
4. Your output should be approximately ${originalWordCount} words (the same as input)
5. Do NOT add explanations or commentary - output ONLY the revised HTML

=== HTML FORMATTING (preserve existing format) ===

Your output MUST maintain proper HTML:
- <h2> and <h3> tags for headings
- <p> tags for paragraphs
- <ul>/<ol> and <li> tags for lists
- <a href="..."> tags for links
- <strong>/<em> tags for formatting

OUTPUT THE COMPLETE REVISED HTML NOW:`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,  // Increased to ensure full article can be returned
        temperature: 0.3,  // Lower temperature for more precise, deterministic edits
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      const revisedContent = response.content[0].text

      // Validate that content wasn't accidentally truncated or replaced
      const revisedWordCount = revisedContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length

      // If revised content is less than 50% of original, something went wrong
      if (revisedWordCount < originalWordCount * 0.5) {
        console.error(`[ClaudeClient] CRITICAL: Revision reduced content from ${originalWordCount} to ${revisedWordCount} words (${Math.round(revisedWordCount/originalWordCount*100)}%)`)
        throw new Error(`AI revision failed: Content was reduced from ${originalWordCount} to ${revisedWordCount} words. This indicates the AI replaced instead of edited the content. Original content preserved.`)
      }

      // Log warning if content changed significantly
      if (revisedWordCount < originalWordCount * 0.8 || revisedWordCount > originalWordCount * 1.2) {
        console.warn(`[ClaudeClient] Warning: Word count changed from ${originalWordCount} to ${revisedWordCount} (${Math.round(revisedWordCount/originalWordCount*100)}%)`)
      }

      return revisedContent

    } catch (error) {
      console.error('Claude revision error:', error)
      throw error
    }
  }

  /**
   * Extract learning patterns from feedback for AI training
   */
  async extractLearningPatterns(originalContent, revisedContent, feedbackItems) {
    const prompt = `Analyze the differences between original and revised content to extract learning patterns for future content generation.

ORIGINAL CONTENT:
${originalContent.substring(0, 1000)}...

REVISED CONTENT:
${revisedContent.substring(0, 1000)}...

FEEDBACK THAT WAS ADDRESSED:
${feedbackItems.map(f => `- ${f.category}: ${f.comment}`).join('\n')}

TASK:
Extract 3-5 specific, actionable patterns or rules that should be applied to future content generation to avoid these issues.

FORMAT AS JSON:
{
  "patterns": [
    {
      "category": "style|structure|accuracy|seo|other",
      "pattern": "Specific pattern or rule learned",
      "example": "Example of how to apply this",
      "impact_score": 0-100
    }
  ]
}

Generate the patterns now:`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        temperature: 0.6,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      const parsed = JSON.parse(response.content[0].text)
      return parsed.patterns

    } catch (error) {
      console.error('Claude pattern extraction error:', error)
      throw error
    }
  }
}

export default ClaudeClient
