/**
 * Claude AI Client for Content Humanization
 * Uses Anthropic's Claude API for making content undetectable and auto-fixing quality issues
 */

import Anthropic from '@anthropic-ai/sdk'
import { formatClientSchoolsForPrompt } from '../../config/clientSchools'

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

2. EXTERNAL LINK EMBEDDING (MANDATORY):
   - When mentioning Bureau of Labor Statistics, ALWAYS hyperlink to the relevant BLS.gov page
   - When citing salary data, employment statistics, or job outlook data, ALWAYS include a hyperlink to the specific BLS Occupational Outlook Handbook page
   - Example: <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">Bureau of Labor Statistics</a>
   - When mentioning NCES, ALWAYS hyperlink: <a href="https://nces.ed.gov/">NCES</a>
   - Every article MUST contain at least 1 external link to an authoritative source
   - NEVER mention BLS, NCES, or Department of Education as plain text without a hyperlink
   - Approved external domains: bls.gov, nces.ed.gov, ed.gov, official accreditation bodies

3. COST DATA:
   - Preserve all cost data exactly as written (sourced from GetEducated ranking reports)
   - Keep "in-state" and "out-of-state" cost distinctions
   - Maintain references to GetEducated's ranking methodology
   - NEVER use per-credit-hour costs as total program costs
   - When citing degree costs, ALWAYS specify: per-credit cost vs. total program cost
   - Total program cost = per-credit cost x total credits required
   - If you cannot determine the total program cost with certainty, state "costs vary" and link to the ranking page
   - For degree-completion programs, note that credit requirements are typically 30-60 credits, NOT 120+

4. STRUCTURE:
   - Keep "GetEducated's Picks" callout boxes
   - Preserve article navigation sections
   - Maintain FAQ sections with all questions/answers
   - Keep "How we researched this" attribution

5. TABLE FORMATTING PRESERVATION (CRITICAL):
   - PRESERVE all HTML table structures EXACTLY as they appear. Do NOT remove or alter <table>, <thead>, <tbody>, <tr>, <th>, <td> tags.
   - If the content contains tables, keep their complete HTML markup intact including any inline styles, classes, borders, and attributes.
   - Only modify the text WITHIN table cells (<td>/<th>) if factually necessary. Never restructure, flatten, or reformat tables.
   - NEVER convert HTML tables to plain text, bullet lists, or paragraphs.
   - Tables with borders, styling, or header rows MUST retain all their original formatting attributes.

=== END GETEDUCATED RULES ===

=== CLIENT SCHOOL LIST ===
When mentioning schools, prefer client schools from this list. Use GetEducated page URLs, never .edu URLs.

${formatClientSchoolsForPrompt()}
=== END CLIENT SCHOOL LIST ===

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
   - CRITICAL: Avoid the "X, Y, and Z" triplicate pattern. Maximum 2 triplicates per entire article.
   - This is a DEAD GIVEAWAY of AI authorship. Articles with 10+ triplicates will be rejected.
   - Vary sentence structures: use pairs ("A and B"), lists of 4+ items, single-item focus, or rephrase entirely.
   - After writing, scan for any sentence containing "A, B, and C" patterns and rewrite at least 80% of them.
   - GOOD alternatives: "A and B" | "A, B, C, and D" | "Most notably A; B is also worth considering." | "Several factors matter, including A."

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
9. <table>, <thead>, <tbody>, <tr>, <th>, <td> tags for tables — PRESERVE ALL TABLE HTML EXACTLY

NEVER output plain text without HTML tags. Every paragraph MUST be wrapped in <p> tags.
NEVER strip or flatten HTML tables into plain text or lists. Keep all table markup, borders, and attributes intact.

=== END HTML FORMATTING RULES ===

OUTPUT ONLY THE REWRITTEN HTML CONTENT. DO NOT include explanations, meta-commentary, or anything other than the pure HTML article content.`
  }

  /**
   * Count triplicate patterns ("X, Y, and Z") in content
   * @param {string} content - HTML or plain text content
   * @returns {{ count: number, examples: string[] }}
   */
  countTriplicates(content) {
    if (!content) return { count: 0, examples: [] }
    const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    // Pattern: "word/phrase, word/phrase, and word/phrase"
    const triplicatePattern = /\b([A-Za-z][A-Za-z\s]{1,30}),\s+([A-Za-z][A-Za-z\s]{1,30}),?\s+and\s+([A-Za-z][A-Za-z\s]{1,30})\b/gi
    const matches = []
    let match
    while ((match = triplicatePattern.exec(plainText)) !== null) {
      matches.push(match[0].trim())
    }
    const unique = [...new Set(matches)]
    return { count: unique.length, examples: unique.slice(0, 8) }
  }

  /**
   * Auto-fix quality issues in content
   * OVERHAULED: Provides explicit, actionable instructions for each issue type
   * so Claude actually fixes them instead of returning content unchanged.
   */
  async autoFixQualityIssues(content, issues, siteArticles = []) {
    // Build extremely specific, actionable fix instructions per issue
    const fixInstructions = issues.map(issue => {
      switch (issue.type) {
        case 'word_count_low': {
          const currentWords = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length
          const wordsNeeded = Math.max(1200 - currentWords, 300)
          return `=== FIX: WORD COUNT TOO LOW ===
Current word count: ~${currentWords}. Target: 1200-2000 words. You need to ADD at least ${wordsNeeded} more words.
ACTION REQUIRED:
- Expand the introduction with 1-2 more sentences providing context
- Add a new paragraph to at least 2 existing sections with deeper analysis or practical advice
- If any section has only 1-2 sentences, expand it to 3-5 sentences
- Add transitional sentences between sections
- Expand the conclusion with actionable next steps for the reader
DO NOT add filler. Every added sentence must provide genuine value to prospective online students.`
        }
        case 'word_count_high': {
          const currentWords2 = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length
          return `=== FIX: WORD COUNT TOO HIGH ===
Current word count: ~${currentWords2}. Target: 1200-2000 words.
ACTION REQUIRED:
- Remove redundant sentences that repeat the same point
- Condense wordy phrases (e.g., "in order to" -> "to")
- Merge overlapping paragraphs
- Remove any filler content that doesn't serve the reader
DO NOT remove factual data, cost information, or key recommendations.`
        }
        case 'missing_internal_links': {
          if (siteArticles.length > 0) {
            const linkInsertions = siteArticles.slice(0, 5).map((article, i) => {
              return `  ${i + 1}. Insert <a href="${article.url}">${article.title}</a> - find a sentence that discusses "${article.topics?.[0] || article.title.split(' ').slice(0, 3).join(' ')}" and wrap relevant text in this link`
            }).join('\n')
            return `=== FIX: MISSING INTERNAL LINKS ===
You MUST add at least 3 internal links. Here are the exact URLs to insert:
${linkInsertions}

HOW TO INSERT:
- Find a relevant sentence in the article body (NOT in headings)
- Wrap 2-5 words of natural anchor text with the <a> tag
- Example: <p>Students looking for affordable options can explore <a href="https://www.geteducated.com/online-degrees/bachelors-in-business/">online business degrees</a> from accredited universities.</p>
- Distribute links throughout the article, not clustered together
- NEVER insert links inside <h2> or <h3> tags`
          }
          return `=== FIX: MISSING INTERNAL LINKS ===
Add 3-5 internal links to GetEducated.com pages. Use URLs in this format:
- https://www.geteducated.com/online-degrees/[degree-type]/
- https://www.geteducated.com/online-schools/[school-name]/
Embed as <a href="URL">natural anchor text</a> within paragraph text.`
        }
        case 'missing_external_links':
          return `=== FIX: MISSING EXTERNAL CITATIONS ===
You MUST embed at least 2 external hyperlinks as <a> tags in the article body.
REQUIRED ACTIONS:
1. Find any mention of salary data, job outlook, or employment statistics and ADD a hyperlink:
   <a href="https://www.bls.gov/ooh/">Bureau of Labor Statistics</a>
   For specific careers, use the specific BLS page, e.g.:
   <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">BLS Occupational Outlook</a>
   <a href="https://www.bls.gov/ooh/business-and-financial/accountants-and-auditors.htm">BLS</a>
2. Find any mention of education statistics and ADD:
   <a href="https://nces.ed.gov/">National Center for Education Statistics</a>
3. If no salary/stats mentions exist, ADD a sentence citing BLS data relevant to the article topic and embed the link.

EXAMPLE OF CORRECT FIX:
BEFORE: <p>Registered nurses earn a median salary of $81,220.</p>
AFTER: <p>According to the <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">Bureau of Labor Statistics</a>, registered nurses earn a median annual salary of $81,220.</p>

NEVER just mention "Bureau of Labor Statistics" as plain text. It MUST be a clickable <a> tag.`
        case 'missing_faqs':
          return `=== FIX: MISSING FAQ SECTION ===
Add a FAQ section at the end of the article (before any conclusion) with this EXACT structure:

<h2>Frequently Asked Questions</h2>

<h3>Question 1 relevant to the article topic?</h3>
<p>Complete answer with 2-4 sentences.</p>

<h3>Question 2 relevant to the article topic?</h3>
<p>Complete answer with 2-4 sentences.</p>

<h3>Question 3 relevant to the article topic?</h3>
<p>Complete answer with 2-4 sentences.</p>

Questions must be genuinely useful for prospective online students researching this topic.`
        case 'poor_readability':
          return `=== FIX: POOR READABILITY ===
ACTION REQUIRED:
- Find sentences longer than 25 words and split them into two shorter sentences
- Replace jargon with simpler words (e.g., "utilize" -> "use", "facilitate" -> "help")
- Break paragraphs longer than 5 sentences into two paragraphs
- Add a transitional sentence between dense sections
- Use active voice instead of passive voice where possible`
        case 'weak_headings':
          return `=== FIX: WEAK HEADING STRUCTURE ===
ACTION REQUIRED:
- The article must have a clear H2/H3 hierarchy
- Every major section needs an <h2> heading (aim for 4-6 H2 headings)
- Sub-sections within a major section use <h3> headings
- Headings should be descriptive and keyword-rich, not generic
- BAD: <h2>Overview</h2> or <h2>Details</h2>
- GOOD: <h2>Best Online MBA Programs for Working Professionals</h2>
- GOOD: <h3>Tuition Costs and Financial Aid Options</h3>
- NEVER skip heading levels (no H3 without a parent H2)`
        case 'triplicates':
          return `=== FIX: TOO MANY TRIPLICATE PATTERNS ===
This article has too many "X, Y, and Z" patterns (listing exactly 3 items), which is a dead giveaway of AI authorship.
ACTION REQUIRED:
- Find sentences with the pattern "A, B, and C" and rewrite at least 80% of them
- Convert some to PAIRS: "A and B" (drop the least important item)
- Convert some to LONGER lists: "A, B, C, and D" or "A, B, C, D, and E"
- Convert some to single-item focus: "Most notably, A. B is also worth considering."
- Rephrase some entirely: "Several factors matter here, including A. Additionally, B plays a role."
- Maximum 2 triplicate patterns allowed in the final article`
        case 'bannedLinks':
          return `=== FIX: BANNED LINKS DETECTED ===
ACTION REQUIRED:
- Remove ALL links to .edu domains. Replace with GetEducated school pages: https://www.geteducated.com/online-schools/[school-name]/
- Remove ALL links to competitor sites (onlineu.com, usnews.com, bestcolleges.com, niche.com)
- Replace removed competitor links with either GetEducated internal links or approved external sources (bls.gov, nces.ed.gov, ed.gov)
- Keep the anchor text but change the href to an approved URL`
        default:
          return `=== FIX: ${issue.type} ===\n${issue.description || issue.severity + ' issue - fix as appropriate'}`
      }
    }).join('\n\n')

    // Build site articles context for internal linking
    let internalLinksContext = ''
    if (siteArticles.length > 0) {
      internalLinksContext = `

=== AVAILABLE GETEDUCATED ARTICLES FOR INTERNAL LINKING ===
You MUST use 3-5 of these URLs when fixing internal link issues:
${siteArticles.map((a, i) => `${i + 1}. URL: ${a.url}\n   Title: ${a.title}\n   Topics: ${a.topics?.join(', ') || 'general'}`).join('\n')}

Insert these as: <a href="URL">natural anchor text</a>
Distribute throughout article body, NOT in headings.
=== END AVAILABLE ARTICLES ===
`
    }

    const prompt = `You are a content editor. Your ONLY job is to fix the specific quality issues listed below. You MUST make the actual changes described, not just acknowledge them.

=== QUALITY ISSUES TO FIX (READ EACH ONE CAREFULLY) ===

${fixInstructions}

=== END ISSUES ===
${internalLinksContext}

=== APPROVED EXTERNAL SOURCE DOMAINS ===
When adding external links, ONLY use these domains:
- Bureau of Labor Statistics: https://www.bls.gov/ooh/ (salary data, job outlook, career info)
- NCES: https://nces.ed.gov/ (education statistics)
- Department of Education: https://www.ed.gov/
- Official accreditation bodies (aacsb.edu, abet.org, etc.)
NEVER link to: .edu school websites, onlineu.com, usnews.com, bestcolleges.com, niche.com
=== END APPROVED SOURCES ===

=== COST DATA ACCURACY RULES ===
- NEVER use per-credit-hour costs as total program costs
- When citing degree costs, ALWAYS specify: per-credit cost vs. total program cost
- Total program cost = per-credit cost x total credits required
- If you cannot determine the total program cost with certainty, state "costs vary" and link to the ranking page
- For degree-completion programs, note that credit requirements are typically 30-60 credits, NOT 120+
=== END COST DATA RULES ===

=== TRIPLICATE PATTERN RULES ===
- AVOID the "X, Y, and Z" pattern. Maximum 2 triplicates in the entire article.
- Vary sentence structures: use pairs, lists of 4+, single items, or rephrase entirely
- After making all fixes, scan for "A, B, and C" patterns and rewrite at least 80% of them
=== END TRIPLICATE RULES ===

=== CLIENT SCHOOL LIST ===
When mentioning schools, prefer client schools from this list. Use GetEducated page URLs, never .edu URLs.

${formatClientSchoolsForPrompt()}
=== END CLIENT SCHOOL LIST ===

=== CURRENT ARTICLE CONTENT ===

${content}

=== END CURRENT ARTICLE ===

=== HTML FORMATTING RULES (MANDATORY) ===
Your output MUST be properly formatted HTML:
- <h2> tags for major section headings
- <h3> tags for subsections
- <p> tags wrapping EVERY paragraph
- <ul>/<li> for bulleted lists, <ol>/<li> for numbered lists
- <strong> for bold, <em> for italic
- <a href="..."> for ALL links (internal AND external)
- <table>, <thead>, <tbody>, <tr>, <th>, <td> tags for tables — PRESERVE ALL TABLE HTML EXACTLY
NEVER output plain text without HTML tags.
NEVER strip, flatten, or convert HTML tables into plain text or lists. Keep all table markup, borders, and attributes intact.
=== END FORMATTING RULES ===

=== TABLE PRESERVATION (CRITICAL) ===
If the article contains HTML tables (<table>...</table>), you MUST preserve their COMPLETE structure:
- Keep all <table>, <thead>, <tbody>, <tr>, <th>, <td> tags exactly as they appear
- Keep all table attributes (border, style, class, cellpadding, cellspacing, etc.)
- Only modify text WITHIN cells if a specific fix requires it
- NEVER convert tables to bullet lists, paragraphs, or plain text
- NEVER remove table borders, headers, or styling
=== END TABLE PRESERVATION ===

=== EXTERNAL LINK EMBEDDING (MANDATORY) ===
When mentioning Bureau of Labor Statistics, ALWAYS embed as: <a href="https://www.bls.gov/ooh/">Bureau of Labor Statistics</a>
When mentioning NCES, ALWAYS embed as: <a href="https://nces.ed.gov/">NCES</a>
NEVER mention BLS, NCES, or Department of Education as plain text — they MUST be clickable <a> tags.
=== END EXTERNAL LINK RULES ===

CRITICAL: You must actually make the changes. Do NOT return the content unchanged. Apply EVERY fix listed above. OUTPUT ONLY THE COMPLETE FIXED HTML CONTENT. No explanations, no commentary, no markdown code fences.`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
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
  async reviseWithFeedback(content, feedbackItems, options = {}) {
    const { siteArticles = [] } = options
    // Calculate original word count to validate later
    const originalWordCount = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length

    const feedbackText = feedbackItems.map((item, index) => {
      return `${index + 1}. [${item.category.toUpperCase()}] ${item.severity}
   Selected text: "${item.selected_text}"
   Requested change: ${item.comment}`
    }).join('\n\n')

    let catalogContext = ''
    if (siteArticles.length > 0) {
      catalogContext = `
=== AVAILABLE GETEDUCATED PAGES (use these for any link requests) ===

${siteArticles.map(a => {
  const typeLabel = a.content_type === 'degree_category' ? '[BERP]' :
                    a.content_type === 'ranking' ? '[RANKING]' :
                    '[ARTICLE]'
  return `- ${typeLabel} ${a.title}: ${a.url}`
}).join('\n')}

IMPORTANT: When feedback asks to "link to GetEducated's X page" or "add a link to Y", search this list for the best match. NEVER invent URLs — only use URLs from this list or from approved external domains (bls.gov, nces.ed.gov, .gov sites).

If no matching page exists in this list, leave a comment like <!-- NO MATCHING PAGE FOUND FOR: [requested topic] --> rather than inventing a URL.
=== END AVAILABLE PAGES ===
`
    }

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

5. **LINK PRESERVATION (CRITICAL)**:
   - You MUST keep ALL existing <a href="...">...</a> links exactly as they are
   - If you modify text near or inside a link, keep the <a> tag and its href attribute intact
   - Removing an existing link is NEVER acceptable unless the feedback explicitly asks to remove it
   - Count links before and after your edit - the count must stay the same or increase

6. **ADDING LINKS**: If feedback requests adding a hyperlink, link, or URL:
   - Wrap the relevant text in an <a href="URL">text</a> tag
   - Use the EXACT URL provided in the feedback
   - Example: If feedback says "add link to https://example.com/page", change the relevant text to <a href="https://example.com/page">relevant text</a>
   - If the feedback mentions a "ranking report" link, use the exact GetEducated URL provided

=== ANTI-FABRICATION RULES (CRITICAL) ===

- NEVER invent or fabricate school names, degree program names, tuition costs, salary/wage figures, enrollment numbers, or any statistics
- If you cannot find the specific data needed to fulfill a comment, insert a visible HTML comment marker: <!-- NEEDS MANUAL DATA: [describe what data is needed] -->
- It is ALWAYS better to flag missing data with a marker than to fabricate data
- When asked to update specific numbers (wages, costs, etc.), only use numbers explicitly provided in the feedback text or existing in the article content
- When asked to use "client" schools or degrees, only use schools explicitly provided in context. If none are provided, insert: <!-- CLIENT SCHOOL DATA NEEDED -->
- NEVER make up school names, even plausible-sounding ones. If the feedback says "use a client school" but no client school list is provided, flag it with the marker above.

=== END ANTI-FABRICATION RULES ===

=== CURRENT HTML CONTENT (${originalWordCount} words) ===

${content}

=== END CURRENT CONTENT ===

=== EDITORIAL FEEDBACK (${feedbackItems.length} items) ===

${feedbackText}

=== END FEEDBACK ===
${catalogContext}
=== EXTERNAL LINK RULES ===
- When mentioning Bureau of Labor Statistics, ALWAYS embed a hyperlink to the relevant BLS.gov page
- When citing salary data or job outlook, ALWAYS include an <a href="https://www.bls.gov/ooh/...">BLS</a> link
- NEVER mention BLS, NCES, or Department of Education as plain text without a clickable hyperlink
- Approved external domains: bls.gov, nces.ed.gov, ed.gov, official accreditation bodies
=== END EXTERNAL LINK RULES ===

=== COST DATA ACCURACY ===
- NEVER use per-credit-hour costs as total program costs
- When citing degree costs, ALWAYS specify: per-credit cost vs. total program cost
- If uncertain about total program cost, write "costs vary" and link to the ranking page
=== END COST DATA ACCURACY ===

=== TRIPLICATE PATTERN RULES ===
- Avoid "X, Y, and Z" patterns. Maximum 2 triplicates in the entire article.
- If you add new text, vary structures: pairs, 4+ item lists, or single-item focus.
=== END TRIPLICATE RULES ===

=== CLIENT SCHOOL LIST ===
When mentioning schools, prefer client schools from this list. Use GetEducated page URLs, never .edu URLs.

${formatClientSchoolsForPrompt()}
=== END CLIENT SCHOOL LIST ===

=== TABLE PRESERVATION (CRITICAL) ===
If the article contains HTML tables (<table>...</table>), you MUST preserve their COMPLETE structure:
- Keep all <table>, <thead>, <tbody>, <tr>, <th>, <td> tags exactly as they appear
- Keep all table attributes (border, style, class, cellpadding, cellspacing, etc.)
- Only modify text WITHIN cells if a specific feedback item requests it
- NEVER convert tables to bullet lists, paragraphs, or plain text
- NEVER remove table borders, headers, or styling
- Tables are structured data — their formatting is essential and must not be altered
=== END TABLE PRESERVATION ===

=== OUTPUT REQUIREMENTS ===

1. Return the COMPLETE article HTML with ONLY the targeted edits made
2. Preserve ALL HTML formatting exactly as it appears, INCLUDING all table markup
3. Maintain the same structure, headings, paragraphs, sections, and tables
4. Your output should be approximately ${originalWordCount} words (the same as input)
5. Do NOT add explanations or commentary - output ONLY the revised HTML

=== HTML FORMATTING (preserve existing format) ===

Your output MUST maintain proper HTML:
- <h2> and <h3> tags for headings
- <p> tags for paragraphs
- <ul>/<ol> and <li> tags for lists
- <a href="..."> tags for links
- <strong>/<em> tags for formatting
- <table>, <thead>, <tbody>, <tr>, <th>, <td> tags for tables — PRESERVE EXACTLY

NEVER strip or flatten HTML tables into plain text or lists.

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

/**
 * Standalone utility: Count triplicate patterns ("X, Y, and Z") in content.
 * Can be imported independently: import { countTriplicates } from './claudeClient'
 * @param {string} content - HTML or plain text content
 * @returns {{ count: number, examples: string[] }}
 */
export function countTriplicates(content) {
  if (!content) return { count: 0, examples: [] }
  const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const triplicatePattern = /\b([A-Za-z][A-Za-z\s]{1,30}),\s+([A-Za-z][A-Za-z\s]{1,30}),?\s+and\s+([A-Za-z][A-Za-z\s]{1,30})\b/gi
  const matches = []
  let match
  while ((match = triplicatePattern.exec(plainText)) !== null) {
    matches.push(match[0].trim())
  }
  const unique = [...new Set(matches)]
  return { count: unique.length, examples: unique.slice(0, 8) }
}

export default ClaudeClient
