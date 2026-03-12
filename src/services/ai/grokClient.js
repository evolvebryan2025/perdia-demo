/**
 * Grok AI Client for Article Drafting
 * Uses xAI's Grok API for initial content generation
 */

import { formatClientSchoolsForPrompt } from '../../config/clientSchools'

// Anti-hallucination rules to inject into all generation prompts
const ANTI_HALLUCINATION_RULES = `
=== CRITICAL: ANTI-HALLUCINATION RULES ===

You MUST follow these rules to avoid generating fabricated content:

1. NEVER FABRICATE STATISTICS:
   - NEVER cite percentages, survey results, or specific numbers unless provided in the source data below
   - BAD: "73% of students prefer online learning" or "According to a 2024 survey..."
   - GOOD: "Many students prefer online learning" or "Research suggests..."

2. NEVER FABRICATE STUDIES OR SURVEYS:
   - NEVER reference specific studies, surveys, reports, or research unless explicitly provided
   - BAD: "According to a 2024 survey by the Online Learning Consortium, 68% reported..."
   - GOOD: "Industry research indicates that..." or "Experts in the field note..."

3. NEVER FABRICATE SCHOOL NAMES:
   - NEVER invent school names or use placeholder names like "University A, B, C"
   - NEVER use template markers like "[School Name]" or "[University]"
   - GOOD: Only mention schools if specific data is provided in the prompt, or use "many accredited online programs"

4. NEVER FABRICATE LEGISLATION:
   - NEVER cite specific bills (SB-1001, HB-123), acts, or legal codes unless provided
   - BAD: "California's SB-1001 requires..." or "The Higher Education Act of 2024..."
   - GOOD: "State regulations may require..." or "Check with your state licensing board"

5. NEVER FABRICATE ORGANIZATIONS:
   - NEVER invent organization names or acronyms
   - ONLY cite real, well-known organizations: BLS, NCES, Department of Education, etc.

ALTERNATIVE PHRASING TO USE:
- Instead of "73% of students..." → "Many students find that..."
- Instead of "A 2024 study found..." → "Research suggests that..."
- Instead of "$45,000 average salary" → "competitive salaries" (unless BLS data is provided)
- Instead of "University A offers..." → "Many accredited programs offer..."
- Instead of "SB-1001 requires..." → "State requirements vary, so check with your licensing board"

=== END ANTI-HALLUCINATION RULES ===
`

class GrokClient {
  constructor(apiKey) {
    this.apiKey = apiKey || import.meta.env.VITE_GROK_API_KEY
    this.baseUrl = 'https://api.x.ai/v1'
    // Use Grok 3 - grok-beta was deprecated on 2025-09-15
    this.model = 'grok-3'
    // Increased token limit to prevent truncation
    // Long-form articles need ~2000 words = ~2500 tokens for content alone
    // Plus JSON wrapper, FAQs, metadata = ~10000 tokens total needed
    this.defaultMaxTokens = 12000
  }

  /**
   * Strip markdown code blocks from response
   * Handles ```json ... ``` and ``` ... ``` wrappers
   */
  stripMarkdownCodeBlocks(text) {
    if (!text) return text

    // Remove ```json or ```JSON or just ``` at the start
    let cleaned = text.trim()

    // Match opening code fence with optional language specifier
    const openFenceMatch = cleaned.match(/^```(?:json|JSON)?\s*\n?/)
    if (openFenceMatch) {
      cleaned = cleaned.slice(openFenceMatch[0].length)
    }

    // Match closing code fence
    const closeFenceMatch = cleaned.match(/\n?```\s*$/)
    if (closeFenceMatch) {
      cleaned = cleaned.slice(0, -closeFenceMatch[0].length)
    }

    return cleaned.trim()
  }

  /**
   * Safely parse JSON from AI response, handling markdown wrappers
   */
  parseJsonResponse(response) {
    const cleaned = this.stripMarkdownCodeBlocks(response)
    return JSON.parse(cleaned)
  }

  /**
   * Make a request to the Grok API
   */
  async request(messages, options = {}) {
    // Check if API key is set
    if (!this.apiKey || this.apiKey === 'undefined') {
      console.warn('⚠️ Grok API key not set. Using mock data for testing.')
      return this.getMockResponse(messages)
    }

    const {
      temperature = 0.8,
      max_tokens = this.defaultMaxTokens, // Use class default (8000) instead of 4000
    } = options

    // Try multiple model names if the primary fails
    const modelVariants = [
      this.model,           // grok-2-latest
      'grok-2',             // Alternative name
      'grok-beta',          // Legacy name
      'grok-2-1212',        // Versioned name
    ]

    let lastError = null

    for (const modelName of modelVariants) {
      try {
        console.log(`Trying Grok model: ${modelName}`)

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages,
            temperature,
            max_tokens,
            stream: false,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          console.log(`✓ Successfully used model: ${modelName}`)
          // Update the model name for future requests
          this.model = modelName
          return data.choices[0].message.content
        }

        // If not 404, don't try other models
        if (response.status !== 404) {
          const errorText = await response.text()
          let errorMessage = 'Unknown error'

          try {
            const error = JSON.parse(errorText)
            errorMessage = error.error?.message || error.message || errorText
          } catch {
            errorMessage = errorText || `HTTP ${response.status}`
          }

          throw new Error(`Grok API error (${response.status}): ${errorMessage}`)
        }

        // Store 404 error but continue trying other models
        lastError = new Error(`Model '${modelName}' not found (404)`)
        console.warn(`Model ${modelName} returned 404, trying next variant...`)

      } catch (error) {
        // If it's not a 404, stop trying and throw
        if (!error.message.includes('404')) {
          throw error
        }
        lastError = error
      }
    }

    // If we get here, all models failed
    console.error('All Grok model variants failed:', modelVariants)
    console.error('Please check https://docs.x.ai/api for the current model name')
    throw lastError || new Error('Failed to connect to Grok API with any known model name')
  }

  /**
   * Mock response for testing without API key
   */
  getMockResponse(messages) {
    const userMessage = messages.find(m => m.role === 'user')?.content || ''

    // Check if this is a title suggestion request
    if (userMessage.includes('title suggestions') || userMessage.includes('article title')) {
      return JSON.stringify([
        {
          title: "Best Online Programs for Working Professionals in 2025",
          reasoning: "Uses power words 'Best' and specific year for SEO, targets working professionals directly"
        },
        {
          title: "How to Choose the Right Online Degree Program",
          reasoning: "How-to format is highly searchable, addresses decision-making need"
        },
        {
          title: "Online vs On-Campus: Which Degree Fits Your Life?",
          reasoning: "Comparison format attracts searchers comparing options, personal touch with 'Your Life'"
        }
      ])
    }

    // Return mock article data as JSON
    return JSON.stringify({
      title: "Understanding Modern Web Development: A Comprehensive Guide",
      content: `<h2>Introduction to Modern Web Development</h2>
<p>Web development has evolved dramatically over the past decade. Today's developers face an ever-expanding ecosystem of tools, frameworks, and best practices that can seem overwhelming at first.</p>

<h2>Core Technologies</h2>
<p>At the heart of web development lie three fundamental technologies: HTML, CSS, and JavaScript. These form the building blocks that power every website you visit.</p>

<h3>HTML: The Structure</h3>
<p>HTML provides the semantic structure for web pages. Modern HTML5 introduces powerful features like canvas, video, and audio elements that enable rich interactive experiences.</p>

<h3>CSS: The Styling</h3>
<p>CSS has grown from simple styling rules to a sophisticated design system. Flexbox and Grid layouts have revolutionized how we approach responsive design.</p>

<h3>JavaScript: The Functionality</h3>
<p>JavaScript continues to dominate as the language of the web. With ES6+ features, the language has become more powerful and expressive than ever.</p>

<h2>Modern Frameworks and Tools</h2>
<p>Today's web developers rely on powerful frameworks like React, Vue, and Angular. These tools help manage complexity and improve development speed.</p>

<h2>Best Practices</h2>
<p>Following industry best practices ensures your applications are maintainable, performant, and accessible to all users.</p>

<h2>Conclusion</h2>
<p>Web development is a constantly evolving field that rewards continuous learning and adaptation. By mastering the fundamentals and staying current with modern tools, you'll be well-equipped to build amazing web experiences.</p>`,
      excerpt: "An in-depth exploration of modern web development practices, covering core technologies, frameworks, and best practices for building robust web applications.",
      meta_title: "Modern Web Development Guide 2025 | Best Practices & Tools",
      meta_description: "Learn modern web development with our comprehensive guide covering HTML, CSS, JavaScript, frameworks, and industry best practices.",
      focus_keyword: "web development",
      faqs: [
        {
          question: "What are the essential skills for web development?",
          answer: "The essential skills include HTML, CSS, JavaScript, responsive design, version control (Git), and familiarity with at least one modern framework."
        },
        {
          question: "How long does it take to become a web developer?",
          answer: "With consistent practice, you can learn the basics in 3-6 months, but becoming proficient typically takes 1-2 years of hands-on experience."
        },
        {
          question: "What's the difference between frontend and backend development?",
          answer: "Frontend development focuses on what users see and interact with (HTML, CSS, JavaScript), while backend handles server-side logic, databases, and APIs."
        },
        {
          question: "Which JavaScript framework should I learn first?",
          answer: "React is currently the most popular choice and has the largest job market, making it a solid first framework to learn."
        }
      ]
    })
  }

  /**
   * Generate article draft from content idea
   */
  async generateDraft(idea, options = {}) {
    const {
      contentType = 'guide',
      targetWordCount = 2000,
      includeOutline = true,
      costDataContext = null, // Cost data from ranking reports for RAG
      cheapestSchoolsContext = null, // Cheapest client schools for affordability articles
      authorProfile = null, // Comprehensive author profile from useContributors
      authorName = null,
      contentRulesContext = null, // Dynamic content rules from database
    } = options

    const prompt = this.buildDraftPrompt(idea, contentType, targetWordCount, costDataContext, authorProfile, authorName, contentRulesContext, cheapestSchoolsContext)

    // Build system prompt with optional author profile
    let systemPrompt = 'You are an expert content writer who creates high-quality, engaging articles. You write in a natural, conversational style with varied sentence structure.'

    if (authorProfile) {
      systemPrompt = `You are an expert content writer creating content for GetEducated.com. You are writing as ${authorName || 'a professional author'}.

=== AUTHOR PROFILE & WRITING STYLE ===
${authorProfile}
=== END AUTHOR PROFILE ===

Follow the author's voice, style, and guidelines precisely. This will ensure consistency across all articles by this author.`
    }

    try {
      const response = await this.request([
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.8,
        max_tokens: this.defaultMaxTokens, // Use 8000 to prevent truncation
      })

      // Parse JSON response (handles markdown code blocks)
      const parsedResponse = this.parseJsonResponse(response)
      return parsedResponse

    } catch (error) {
      console.error('Grok draft generation error:', error)
      throw error
    }
  }

  /**
   * Build prompt for article draft generation
   * IMPORTANT: Includes GetEducated-specific content rules (now configurable from database)
   */
  buildDraftPrompt(idea, contentType, targetWordCount, costDataContext = null, authorProfile = null, authorName = null, contentRulesContext = null, cheapestSchoolsContext = null) {
    let costDataSection = ''
    if (costDataContext) {
      costDataSection = `\n\n${costDataContext}\n`
    }

    // Cheapest client schools section -- injected for affordability/cost articles
    let cheapestSchoolsSection = ''
    if (cheapestSchoolsContext) {
      cheapestSchoolsSection = `\n\n${cheapestSchoolsContext}\n`
    }

    let authorSection = ''
    if (authorName) {
      authorSection = `\nAUTHOR: This article is being written by ${authorName}. Follow the author profile in the system prompt precisely.\n`
    }

    // Dynamic content rules from database (if available)
    let dynamicRulesSection = ''
    if (contentRulesContext) {
      dynamicRulesSection = `\n${contentRulesContext}\n`
    }

    return `Generate a comprehensive ${contentType} article based on this content idea for GetEducated.com, an online education resource.

${ANTI_HALLUCINATION_RULES}
${costDataSection}${cheapestSchoolsSection}${authorSection}

CONTENT IDEA:
Title: ${idea.title}
Description: ${idea.description || 'Not provided'}
${idea.keyword_research_data ? `Primary Keyword: ${idea.keyword_research_data.primary_keyword}` : ''}
${idea.seed_topics ? `Topics to cover: ${idea.seed_topics.join(', ')}` : ''}

REQUIREMENTS:
- Target word count: ${targetWordCount} words
- Content type: ${contentType}
- Include an engaging introduction that hooks prospective online students
- Use clear headings and subheadings (H2, H3)
- Write in a conversational, natural tone that empathizes with readers' education goals
- Provide actionable guidance and practical insights (but DO NOT fabricate statistics or specific data)
- Vary sentence length (short punchy sentences mixed with longer explanatory ones)
- Make it valuable and informative for people considering online education
- IMPORTANT: Complete the entire article including a proper conclusion - do not cut off mid-sentence

=== CRITICAL GETEDUCATED CONTENT RULES ===

1. COST DATA:
   - ALL cost/tuition information MUST reference GetEducated ranking reports
   - Format cost mentions as "According to GetEducated's ranking reports, [school] costs $X including all fees"
   - Include BOTH in-state and out-of-state costs when available
   - NEVER invent or estimate costs - only use data from ranking reports

=== COST DATA RULES (CRITICAL - READ CAREFULLY) ===
1. When citing costs from ranking reports, use TOTAL PROGRAM COST, not per-credit cost
2. If the data source shows per-credit cost, you MUST say "starting at $X per credit hour" — NEVER present per-credit costs as total program costs
3. NEVER use per-credit-hour costs from degree-completion rankings as total program costs
   - WRONG: "Program X costs $250" (when $250 is the per-credit price)
   - RIGHT: "Program X costs $250 per credit hour, with total program costs varying by credits required"
   - RIGHT: "Program X has a total program cost of $15,000 including all fees"
4. Total program cost = per-credit cost x total credits required. If you do this math, show it.
5. For degree-completion programs, credit requirements are typically 30-60 credits, NOT 120+
   - A degree-completion student has ALREADY earned credits, so do not multiply per-credit cost by 120
6. If you CANNOT determine the total program cost with certainty, write "costs vary; see GetEducated's ranking report for current pricing" instead of guessing
7. Always specify what the cost number represents: "total program cost" or "per credit hour"
8. When listing affordable programs, cite the CHEAPEST client school options first
9. If no client schools are available for a topic, use the cheapest non-client options
=== END COST DATA RULES ===

2. SCHOOL/DEGREE REFERENCES:
   - NEVER invent or fabricate school names (e.g., "University A", "College B", "[School Name]")
   - Only mention specific schools if they appear in the cost data provided above
   - When mentioning degree types generically, use phrases like "many accredited programs" or "leading online universities"
   - NEVER suggest linking directly to school .edu websites
   - If no specific school data is provided, discuss programs in general terms without naming institutions

3. EXTERNAL SOURCES:
   - For salary/job outlook data, reference Bureau of Labor Statistics (BLS)
   - For education statistics, reference NCES, Department of Education
   - Accreditation info should reference official accreditation bodies (AACSB, ABET, etc.)
   - NEVER reference competitor sites (onlineu.com, usnews.com, affordablecollegesonline.com)

=== EXTERNAL LINKS (MANDATORY - MOST COMMON FAILURE POINT) ===
You MUST embed at least 2 external hyperlinks in the article as HTML <a> tags.
This is the #1 quality issue in generated articles. Do NOT skip this.

APPROVED EXTERNAL SOURCES (with example URLs):
- Bureau of Labor Statistics (BLS):
  - General: <a href="https://www.bls.gov/ooh/">BLS Occupational Outlook Handbook</a>
  - Nurses: <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">BLS</a>
  - Teachers: <a href="https://www.bls.gov/ooh/education-training-and-library/high-school-teachers.htm">BLS</a>
  - Social Workers: <a href="https://www.bls.gov/ooh/community-and-social-service/social-workers.htm">BLS</a>
  - Business: <a href="https://www.bls.gov/ooh/management/">BLS</a>
  - Computer Science: <a href="https://www.bls.gov/ooh/computer-and-information-technology/">BLS</a>
- NCES: <a href="https://nces.ed.gov/">National Center for Education Statistics</a>
- Department of Education: <a href="https://www.ed.gov/">U.S. Department of Education</a>
- Official accreditation bodies (aacsb.edu, abet.org, caep.org, ccne-accreditation.org)

RULES FOR EXTERNAL LINKS:
1. When mentioning Bureau of Labor Statistics, ALWAYS hyperlink to the relevant BLS.gov OOH page
2. When citing salary data, employment statistics, or job outlook data, ALWAYS include a hyperlink to the specific BLS Occupational Outlook Handbook page for that career
3. When mentioning NCES or education statistics, ALWAYS embed a hyperlink to nces.ed.gov
4. NEVER mention BLS, NCES, or Department of Education as PLAIN TEXT. They MUST be clickable links.
5. Every article MUST contain at least 1 external link to an authoritative source

CORRECT EXAMPLES:
<p>According to the <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">Bureau of Labor Statistics</a>, registered nurses earn a median salary of $81,220.</p>
<p>Data from the <a href="https://nces.ed.gov/">National Center for Education Statistics</a> shows enrollment in online programs continues to grow.</p>

WRONG EXAMPLES (NEVER DO THIS):
<p>According to the Bureau of Labor Statistics, registered nurses earn a median salary of $81,220.</p>
<p>NCES data shows enrollment growing.</p>
^^^ These mention sources without hyperlinks. This is ALWAYS wrong.
=== END EXTERNAL LINKS ===

4. CONTENT FOCUS:
   - All content must be relevant to ONLINE students
   - Emphasize affordability, flexibility, and career outcomes
   - Discuss accreditation requirements where relevant
   - Help readers make informed decisions about their education

5. STRUCTURE REQUIREMENTS:
   - DO NOT include school recommendation sections (these will be added via shortcodes later)
   - Include article navigation suggestions (anchor links to major sections)
   - Minimum 3 FAQ items relevant to the topic with COMPLETE answers (no truncation)
   - Include a "How we researched this" note mentioning GetEducated's methodology
   - ALWAYS include a proper conclusion section - never end the article abruptly

6. SHORTCODES - CRITICAL:
   - DO NOT generate any shortcodes in the content - they will be added programmatically later
   - DO NOT use these fake shortcode formats: [degree_table], [degree_offer], [ge_monetization], [ge_internal_link], [ge_external_cited]
   - The REAL GetEducated shortcodes are: [su_ge-picks], [su_ge-cta], [su_ge-qdf]
   - If you need to indicate where a degree list should go, just write: <!-- MONETIZATION BLOCK: degree picks for [topic] -->
   - Links to ranking reports, schools, and degrees will be added via shortcodes AFTER generation

=== END GETEDUCATED RULES ===

=== CLIENT SCHOOL LIST (MUST USE) ===
The following schools are GetEducated partner/client schools. You MUST actively reference these schools in the article content when they are relevant to the topic.

MANDATORY RULES FOR CLIENT SCHOOLS:
1. When discussing schools, universities, or programs relevant to this article's topic, ALWAYS include at least 2-3 client schools from this list as specific examples
2. Link to their GetEducated page URL (e.g., https://www.geteducated.com/online-schools/school-name/), NEVER to .edu sites
3. Weave client school references naturally into the content - mention them as examples of schools offering relevant programs, as affordable options, or as noteworthy institutions in the field
4. If the article discusses a specific degree type or subject area, prioritize client schools that are known for that area
5. Do NOT just list schools in a block - integrate them into paragraphs where they add value to the reader
6. Each client school mention MUST include a hyperlink to its GetEducated page

${formatClientSchoolsForPrompt()}
=== END CLIENT SCHOOL LIST ===
${dynamicRulesSection}
STRUCTURE:
${this.getStructureForContentType(contentType)}

BANNED PHRASES AND PATTERNS (never use these):
- "In today's digital age"
- "In conclusion"
- "It's important to note that"
- "Delve into"
- "Dive deep"
- "At the end of the day"
- "Game changer"
- "Revolutionary"
- "Cutting-edge"
- Em-dashes (—) — NEVER use these, use commas or semicolons instead
- "Leverage"
- "Robust"
- "Seamless"
- "Navigate the landscape"
- CRITICAL TRIPLICATE RULE: Do NOT use the "X, Y, and Z" pattern more than 2 times in the ENTIRE article. This is a DEAD GIVEAWAY of AI authorship and articles with 10+ triplicates are rejected.
- Instead of "X, Y, and Z", use these alternatives:
  - Pairs: "X and Y" (drop the least important item)
  - Longer lists: "X, Y, Z, and W"
  - Single focus: "Most notably X. Y is also worth considering."
  - Rephrased: "Several factors matter, including X."
- After writing the full article, scan every sentence for the "A, B, and C" pattern and rewrite at least 80% of them using the alternatives above.

=== CRITICAL HTML FORMATTING RULES (MANDATORY) ===

**THIS IS THE MOST IMPORTANT RULE:** Your content MUST be properly formatted HTML.
WITHOUT proper HTML formatting, articles display as unreadable text walls.

REQUIRED HTML STRUCTURE:
1. <h2> tags for major section headings
2. <h3> tags for subsections
3. <p> tags wrapping EVERY paragraph of text (3-5 sentences max per paragraph)
4. <ul> and <li> tags for bulleted lists
5. <ol> and <li> tags for numbered lists
6. <strong> or <b> tags for bold text

=== CORRECT FORMAT EXAMPLE ===

<h2>Why Online Degrees Matter</h2>

<p>Online degrees have transformed higher education accessibility. More students than ever can pursue their educational goals while maintaining work and family responsibilities.</p>

<p>The flexibility of online learning makes it possible to study from anywhere, at any time.</p>

<h3>Key Benefits</h3>

<p>Here are the main advantages:</p>

<ul>
<li><strong>Flexibility:</strong> Study on your own schedule</li>
<li><strong>Affordability:</strong> Often lower total costs</li>
</ul>

=== WRONG FORMAT (NEVER DO THIS) ===

Online degrees have transformed higher education accessibility. More students than ever can pursue their educational goals while maintaining work and family responsibilities. The flexibility of online learning makes it possible to study from anywhere...

^^^ THIS IS WRONG - No paragraph breaks, just a wall of text.

=== END HTML FORMATTING RULES ===

FORMAT YOUR RESPONSE AS JSON:
{
  "title": "Compelling article title (60-70 characters)",
  "excerpt": "Brief 1-2 sentence summary (150-160 characters)",
  "content": "Full article with PROPER HTML: every paragraph in <p> tags, headings in <h2>/<h3>, lists in <ul>/<li>. SHORT paragraphs (3-5 sentences each). NO walls of text.",
  "meta_title": "SEO-optimized title (50-60 characters)",
  "meta_description": "SEO description (150-160 characters)",
  "focus_keyword": "Primary keyword for SEO",
  "faqs": [
    {"question": "Question 1", "answer": "Complete answer"},
    {"question": "Question 2", "answer": "Complete answer"},
    {"question": "Question 3", "answer": "Complete answer"}
  ]
}

REMEMBER: The "content" field MUST contain properly formatted HTML with <p> tags around every paragraph.

Generate the article now:`
  }

  /**
   * Get structure template based on content type
   */
  getStructureForContentType(contentType) {
    const structures = {
      guide: `
- Introduction (why this matters)
- Main sections with H2 headings
- Step-by-step instructions or explanations
- Examples and use cases
- Best practices
- Common mistakes to avoid
- Conclusion with key takeaways`,

      listicle: `
- Engaging introduction
- Clear list items with H2 headings
- Each item should have 2-3 paragraphs of explanation
- Use numbers or bullets
- Conclusion that ties it together`,

      ranking: `
- Introduction explaining ranking criteria
- Ranked list items (e.g., #1, #2, #3)
- Each item with pros/cons
- Clear explanation of why it's ranked that way
- Conclusion with winner summary`,

      explainer: `
- Introduction (what is this?)
- Background/context
- How it works
- Why it matters
- Real-world examples
- Conclusion`,

      review: `
- Introduction
- Overview of product/service
- Features breakdown
- Pros and cons
- Who it's for
- Final verdict`,
    }

    return structures[contentType] || structures.guide
  }

  /**
   * Generate content ideas from seed topics
   */
  async generateIdeas(seedTopics, count = 10) {
    const prompt = `Generate ${count} unique, specific content ideas for articles about: ${seedTopics.join(', ')}

REQUIREMENTS:
- Each idea should be specific and actionable
- Include a variety of content types (guides, listicles, how-tos, explanations)
- Focus on long-tail, specific angles rather than broad topics
- Make them valuable and interesting to readers
- Avoid generic or overused ideas

FORMAT YOUR RESPONSE AS JSON:
{
  "ideas": [
    {
      "title": "Specific article title",
      "description": "Brief description of what the article covers",
      "content_type": "guide|listicle|explainer|review|ranking",
      "target_keywords": ["keyword1", "keyword2"],
      "estimated_word_count": 2000
    }
  ]
}

Generate the ideas now:`

    try {
      const response = await this.request([
        {
          role: 'system',
          content: 'You are a content strategist who generates creative, specific article ideas.'
        },
        {
          role: 'user',
          content: prompt
        }
      ])

      const parsedResponse = this.parseJsonResponse(response)
      return parsedResponse.ideas

    } catch (error) {
      console.error('Grok idea generation error:', error)
      throw error
    }
  }

  /**
   * Generate content with web context (searches internet for current trends)
   * Grok has built-in web search capabilities through xAI
   */
  async generateWithWebContext(prompt, options = {}) {
    const {
      temperature = 0.8,
      max_tokens = 4000,
    } = options

    // Grok natively supports web search through its training and real-time capabilities
    // We enhance the prompt to encourage the model to use current knowledge
    const enhancedPrompt = `${prompt}

IMPORTANT: Use your knowledge of CURRENT events, trends, and discussions.
Include timely, relevant information from recent news, social media trends, and search data.
Focus on what people are ACTIVELY searching for and discussing RIGHT NOW.`

    try {
      const response = await this.request([
        {
          role: 'system',
          content: `You are a content strategist with access to real-time information about current trends, news, and social media discussions.
You stay updated on the latest developments and can identify trending topics and emerging search queries.
When generating ideas, prioritize topics that are currently being discussed and searched for.`
        },
        {
          role: 'user',
          content: enhancedPrompt
        }
      ], {
        temperature,
        max_tokens,
      })

      return response
    } catch (error) {
      console.error('Grok web context generation error:', error)
      throw error
    }
  }

  /**
   * Simple text generation (no JSON parsing)
   */
  async generate(prompt, options = {}) {
    try {
      const response = await this.request([
        {
          role: 'user',
          content: prompt
        }
      ], options)

      return response
    } catch (error) {
      console.error('Grok generation error:', error)
      throw error
    }
  }

  /**
   * Generate title suggestions for a content idea
   * Used by TitleSuggestions component for AI-powered title generation
   */
  async generateTitleSuggestions(description, topics = [], count = 3) {
    const topicsList = topics.length > 0 ? topics.join(', ') : 'general'

    const prompt = `Generate ${count} compelling article title suggestions based on:

Description: ${description}
Topics: ${topicsList}

Requirements:
- Each title should be SEO-friendly (50-60 characters ideal)
- Use power words and emotional triggers
- Make titles specific and actionable
- Vary the approaches (how-to, list, question, statement)
- Titles should be appropriate for GetEducated.com (online education focus)

Return a JSON array with exactly ${count} objects:
[
  {
    "title": "The article title",
    "reasoning": "Brief explanation of why this title works"
  }
]

Return ONLY the JSON array, no other text.`

    try {
      const response = await this.request([
        {
          role: 'system',
          content: 'You are an SEO expert who creates compelling, click-worthy article titles for online education content.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.8,
        max_tokens: 1000,
      })

      const parsed = this.parseJsonResponse(response)
      return Array.isArray(parsed) ? parsed : []

    } catch (error) {
      console.error('Title suggestion generation error:', error)
      return []
    }
  }

  /**
   * Generate SEO metadata for an article
   */
  async generateMetadata(articleContent, focusKeyword) {
    const prompt = `Given this article content and focus keyword, generate optimized SEO metadata.

FOCUS KEYWORD: ${focusKeyword}

ARTICLE EXCERPT:
${articleContent.substring(0, 500)}...

Generate:
1. SEO-optimized meta title (50-60 characters, include focus keyword)
2. Compelling meta description (150-160 characters, include focus keyword)
3. URL slug (lowercase, hyphens, keyword-rich)

FORMAT AS JSON:
{
  "meta_title": "title here",
  "meta_description": "description here",
  "slug": "url-slug-here"
}`

    try {
      const response = await this.request([
        {
          role: 'system',
          content: 'You are an SEO expert who writes compelling metadata that ranks well and gets clicks.'
        },
        {
          role: 'user',
          content: prompt
        }
      ])

      return this.parseJsonResponse(response)

    } catch (error) {
      console.error('Grok metadata generation error:', error)
      throw error
    }
  }
}

export default GrokClient
