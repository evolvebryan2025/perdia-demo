/**
 * Supabase Edge Function: grok-api
 * Modular Grok API client for individual operations
 * Keeps Grok API key secure on server-side
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GROK_BASE_URL = 'https://api.x.ai/v1'
// Use grok-3 - grok-beta was deprecated on 2025-09-15
const GROK_MODEL = 'grok-3'

interface GrokMessage {
  role: string
  content: string
}

interface GrokOptions {
  temperature?: number
  max_tokens?: number
}

// Model fallback variants - try these in order if primary fails with 404
const MODEL_VARIANTS = [GROK_MODEL, 'grok-2-latest', 'grok-2', 'grok-beta', 'grok-2-1212']

async function makeGrokRequest(messages: GrokMessage[], options: GrokOptions = {}) {
  const grokApiKey = Deno.env.get('GROK_API_KEY')

  if (!grokApiKey) {
    throw new Error('GROK_API_KEY not configured in Edge Function secrets')
  }

  const { temperature = 0.8, max_tokens = 8000 } = options

  let lastError: Error | null = null

  for (const modelName of MODEL_VARIANTS) {
    try {
      console.log(`[Grok Edge] Trying model: ${modelName}`)

      const response = await fetch(`${GROK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${grokApiKey}`,
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
        console.log(`[Grok Edge] Successfully used model: ${modelName}`)
        return data.choices[0].message.content
      }

      // If not 404, don't try other models - it's a real error
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

      // 404 means model not found, try next
      console.warn(`[Grok Edge] Model ${modelName} returned 404, trying next...`)
      lastError = new Error(`Model '${modelName}' not found`)

    } catch (error) {
      if (error instanceof Error && !error.message.includes('404') && !error.message.includes('not found')) {
        throw error
      }
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  console.error('[Grok Edge] All model variants failed:', MODEL_VARIANTS)
  throw lastError || new Error('Failed to connect to Grok API with any known model name')
}

function getStructureForContentType(contentType: string): string {
  const structures: Record<string, string> = {
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

interface DraftOptions {
  idea: any
  contentType: string
  targetWordCount: number
  costDataContext?: string | null
  authorProfile?: string | null
  authorName?: string | null
  contentRulesContext?: string | null
}

function buildDraftPrompt(options: DraftOptions): string {
  const { idea, contentType, targetWordCount, costDataContext, authorProfile, authorName, contentRulesContext } = options

  let costDataSection = ''
  if (costDataContext) {
    costDataSection = `\n\n${costDataContext}\n`
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

  // FIX: Ideas → Article Mismatch - Pass ALL relevant idea context
  // The preview might show specific schools/info that must carry over to generation
  const ideaContext = []
  ideaContext.push(`Title: ${idea.title}`)
  ideaContext.push(`Description: ${idea.description || 'Not provided'}`)
  
  // Add school/program specific context if available
  if (idea.source_url) {
    ideaContext.push(`Source: ${idea.source_url}`)
  }
  if (idea.monetization_category) {
    ideaContext.push(`Category: ${idea.monetization_category}`)
  }
  if (idea.degree_level) {
    ideaContext.push(`Degree Level: ${idea.degree_level}`)
  }
  if (idea.keyword_research_data?.primary_keyword) {
    ideaContext.push(`Primary Keyword: ${idea.keyword_research_data.primary_keyword}`)
  }
  if (idea.seed_topics?.length) {
    ideaContext.push(`Topics to cover: ${idea.seed_topics.join(', ')}`)
  }
  if (idea.target_keywords?.length) {
    ideaContext.push(`Target Keywords: ${idea.target_keywords.join(', ')}`)
  }
  if (idea.trending_reason) {
    ideaContext.push(`Trending Reason: ${idea.trending_reason}`)
  }
  if (idea.search_intent) {
    ideaContext.push(`Search Intent: ${idea.search_intent}`)
  }
  // CRITICAL: If the idea mentions specific schools, they MUST appear in the article
  if (idea.school_names?.length) {
    ideaContext.push(`FEATURED SCHOOLS (must be mentioned): ${idea.school_names.join(', ')}`)
  }
  if (idea.sponsored_school_count) {
    ideaContext.push(`Sponsored Schools: ${idea.sponsored_school_count} schools have listings for this topic`)
  }

  return `Generate a comprehensive ${contentType} article based on this content idea for GetEducated.com, an online education resource.

${ANTI_HALLUCINATION_RULES}
${costDataSection}${authorSection}

CONTENT IDEA:
${ideaContext.join('\n')}

REQUIREMENTS:
- Target word count: ${targetWordCount} words
- Content type: ${contentType}
- Include an engaging introduction that hooks prospective online students
- Use clear headings and subheadings (H2, H3) wrapped in proper HTML tags
- Write in a conversational, natural tone that empathizes with readers' education goals
- Provide actionable guidance and practical insights (but DO NOT fabricate statistics or specific data)
- Vary sentence length (short punchy sentences mixed with longer explanatory ones)
- Make it valuable and informative for people considering online education
- IMPORTANT: Complete the entire article including a proper conclusion - do not cut off mid-sentence

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
7. <em> or <i> tags for italic text
8. <a href="..."> tags for any links

=== CORRECT FORMAT EXAMPLE ===

<h2>Why Online Social Work Degrees Matter</h2>

<p>Social workers have the potential to change lives at every level of society. If you want to take the next step with a career in social work, you can do that with an online degree program.</p>

<p>The demand for social workers continues to grow, with the Bureau of Labor Statistics projecting steady job growth through 2030. This makes it an excellent career choice for those passionate about helping others.</p>

<h3>Benefits of Online Programs</h3>

<p>Online social work programs offer several advantages over traditional on-campus options:</p>

<ul>
<li><strong>Flexibility:</strong> Study on your own schedule while working full-time</li>
<li><strong>Accessibility:</strong> Access accredited programs from anywhere in the country</li>
<li><strong>Affordability:</strong> Often lower total costs than on-campus options</li>
<li><strong>Technology skills:</strong> Develop digital competencies valued in modern practice</li>
</ul>

<p>These benefits make online degrees particularly attractive for working adults and career changers.</p>

=== WRONG FORMAT (DO NOT DO THIS) ===

Social workers have the potential to change lives at every level of society. If you want to take the next step with a career in social work, you can do that with an online degree program. The demand for social workers continues to grow, with the Bureau of Labor Statistics projecting steady job growth through 2030. This makes it an excellent career choice for those passionate about helping others. Benefits of Online Programs Online social work programs offer several advantages over traditional on-campus options: Flexibility: Study on your own schedule while working full-time Accessibility: Access accredited programs from anywhere in the country...

^^^ THIS IS WRONG - No paragraph breaks, no headings, just a wall of text. NEVER do this.

=== KEY FORMATTING RULES ===

1. EVERY paragraph MUST be wrapped in <p></p> tags
2. Paragraphs should be SHORT: 3-5 sentences maximum
3. Break up long blocks of text with subheadings (<h3>)
4. Use lists for any series of 3+ related items
5. Add blank lines between HTML elements for readability in the source

=== END HTML FORMATTING RULES ===

=== CRITICAL GETEDUCATED CONTENT RULES ===

1. COST DATA:
   - ALL cost/tuition information MUST reference GetEducated ranking reports
   - Format cost mentions as "According to GetEducated's ranking reports, [school] costs $X including all fees"
   - Include BOTH in-state and out-of-state costs when available
   - NEVER invent or estimate costs - only use data from ranking reports

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
${dynamicRulesSection}
STRUCTURE:
${getStructureForContentType(contentType)}

BANNED PHRASES (never use these):
- "In today's digital age"
- "In conclusion"
- "It's important to note that"
- "Delve into"
- "Dive deep"
- "At the end of the day"
- "Game changer"
- "Revolutionary"
- "Cutting-edge"

FORMAT YOUR RESPONSE AS JSON:
{
  "title": "Compelling article title (60-70 characters)",
  "excerpt": "Brief 1-2 sentence summary (150-160 characters)",
  "content": "Full article with PROPER HTML: every paragraph in <p> tags, headings in <h2>/<h3>, lists in <ul>/<li>. SHORT paragraphs (3-5 sentences each). NO walls of text.",
  "meta_title": "SEO-optimized title (50-60 characters)",
  "meta_description": "SEO description (150-160 characters)",
  "focus_keyword": "Primary keyword for SEO",
  "faqs": [
    {"question": "Question 1", "answer": "Complete answer wrapped in <p> tags"},
    {"question": "Question 2", "answer": "Complete answer wrapped in <p> tags"},
    {"question": "Question 3", "answer": "Complete answer wrapped in <p> tags"}
  ]
}

REMEMBER: The "content" field MUST contain properly formatted HTML with <p> tags around every paragraph. Articles without proper HTML formatting will be rejected.

Generate the article now:`
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, payload } = await req.json()

    if (!action) {
      throw new Error('Missing required parameter: action')
    }

    let result: any

    switch (action) {
      case 'generateDraft': {
        const {
          idea,
          contentType = 'guide',
          targetWordCount = 2000,
          costDataContext = null,
          authorProfile = null,
          authorName = null,
          contentRulesContext = null,
        } = payload

        if (!idea) {
          throw new Error('Missing required parameter: idea')
        }

        console.log('Generating draft for:', idea.title)

        const prompt = buildDraftPrompt({
          idea,
          contentType,
          targetWordCount,
          costDataContext,
          authorProfile,
          authorName,
          contentRulesContext,
        })

        // Build system prompt with optional author profile
        let systemPrompt = 'You are an expert content writer who creates high-quality, engaging articles. You write in a natural, conversational style with varied sentence structure. You ALWAYS format content as proper HTML with <h2>, <h3>, <p>, <ul>, <li> tags.'

        if (authorProfile) {
          systemPrompt = `You are an expert content writer creating content for GetEducated.com. You are writing as ${authorName || 'a professional author'}.

=== AUTHOR PROFILE & WRITING STYLE ===
${authorProfile}
=== END AUTHOR PROFILE ===

Follow the author's voice, style, and guidelines precisely. This will ensure consistency across all articles by this author.
You ALWAYS format content as proper HTML with <h2>, <h3>, <p>, <ul>, <li> tags.`
        }

        const response = await makeGrokRequest([
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
          max_tokens: 12000, // Increased to prevent truncation
        })

        // Strip markdown code blocks if present
        let cleanedResponse = response.trim()
        const openFenceMatch = cleanedResponse.match(/^```(?:json|JSON)?\s*\n?/)
        if (openFenceMatch) {
          cleanedResponse = cleanedResponse.slice(openFenceMatch[0].length)
        }
        const closeFenceMatch = cleanedResponse.match(/\n?```\s*$/)
        if (closeFenceMatch) {
          cleanedResponse = cleanedResponse.slice(0, -closeFenceMatch[0].length)
        }

        result = JSON.parse(cleanedResponse.trim())
        break
      }

      case 'generateIdeas': {
        const { seedTopics, count = 10 } = payload

        if (!seedTopics || !Array.isArray(seedTopics)) {
          throw new Error('Missing required parameter: seedTopics (array)')
        }

        console.log('Generating ideas from:', seedTopics)

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

        const response = await makeGrokRequest([
          {
            role: 'system',
            content: 'You are a content strategist who generates creative, specific article ideas.'
          },
          {
            role: 'user',
            content: prompt
          }
        ])

        const parsed = JSON.parse(response)
        result = parsed.ideas
        break
      }

      case 'generateMetadata': {
        const { articleContent, focusKeyword } = payload

        if (!articleContent || !focusKeyword) {
          throw new Error('Missing required parameters: articleContent and focusKeyword')
        }

        console.log('Generating metadata for keyword:', focusKeyword)

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

        const response = await makeGrokRequest([
          {
            role: 'system',
            content: 'You are an SEO expert who writes compelling metadata that ranks well and gets clicks.'
          },
          {
            role: 'user',
            content: prompt
          }
        ])

        result = JSON.parse(response)
        break
      }

      case 'generateWithWebContext': {
        const { prompt, temperature = 0.8, max_tokens = 4000 } = payload

        if (!prompt) {
          throw new Error('Missing required parameter: prompt')
        }

        console.log('Generating with web context, prompt length:', prompt.length)

        // Enhance the prompt to encourage the model to use current knowledge
        const enhancedPrompt = `${prompt}

IMPORTANT: Use your knowledge of CURRENT events, trends, and discussions.
Include timely, relevant information from recent news, social media trends, and search data.
Focus on what people are ACTIVELY searching for and discussing RIGHT NOW.`

        const response = await makeGrokRequest([
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

        result = response
        break
      }

      case 'generate': {
        const { prompt, temperature = 0.8, max_tokens = 4000 } = payload

        if (!prompt) {
          throw new Error('Missing required parameter: prompt')
        }

        console.log('Simple generation, prompt length:', prompt.length)

        const response = await makeGrokRequest([
          {
            role: 'user',
            content: prompt
          }
        ], {
          temperature,
          max_tokens,
        })

        result = response
        break
      }

      default:
        throw new Error(`Unknown action: ${action}. Valid actions: generateDraft, generateIdeas, generateMetadata, generateWithWebContext, generate`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: result
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Grok API Edge Function error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
