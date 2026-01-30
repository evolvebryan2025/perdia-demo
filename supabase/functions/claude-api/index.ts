/**
 * Supabase Edge Function: claude-api
 * Modular Claude API client for individual operations
 * Keeps Claude API key secure on server-side
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk@0.32.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

function buildHumanizationPrompt(content: string, contributorProfile: any, perplexity: string, burstiness: string): string {
  let styleInstructions = ''

  if (contributorProfile) {
    const style = contributorProfile.writing_style_profile || {}
    styleInstructions = `
WRITER PERSONA:
Name: ${contributorProfile.name}
Tone: ${style.tone || 'professional'}
Complexity: ${style.complexity_level || 'intermediate'}
Sentence Length: ${style.sentence_length_preference || 'medium'}
`
  }

  return `You are a highly skilled human writer. Your task is to rewrite the following AI-generated content to make it completely undetectable as AI-written. The content must read as if it was written by a real human with personality, expertise, and natural writing patterns.

${styleInstructions}

ORIGINAL CONTENT:
${content}

CRITICAL HUMANIZATION TECHNIQUES:

1. **Perplexity (Unpredictability)**: ${perplexity}
   - Use unexpected word choices and phrasings
   - Avoid predictable transitions
   - Include occasional colloquialisms or industry-specific terms
   - Vary vocabulary richly

2. **Burstiness (Sentence Variation)**: ${burstiness}
   - Mix very short sentences with longer, complex ones
   - Create natural rhythm: short → long → medium → very short
   - Use fragments occasionally for emphasis
   - Vary sentence structures significantly

3. **Voice & Personality**:
   - Add subtle personal touches ("I've found that...", "In my experience...")
   - Include minor imperfections (starting sentences with "And" or "But")
   - Use rhetorical questions sparingly
   - Show emotion where appropriate

4. **Natural Writing Patterns**:
   - Avoid overly perfect grammar (humans make small stylistic choices)
   - Use contractions naturally (don't, won't, I've)
   - Include em-dashes for emphasis—like this
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

6. **Content Quality**:
   - Keep all factual information accurate
   - Maintain the same structure and headings
   - Preserve HTML formatting
   - Keep the same SEO focus
   - Ensure the content remains valuable and informative

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

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')

    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY not configured in Edge Function secrets')
    }

    const client = new Anthropic({ apiKey: claudeApiKey })

    let result: any

    switch (action) {
      case 'humanize': {
        const {
          content,
          contributorProfile = null,
          targetPerplexity = 'high',
          targetBurstiness = 'high'
        } = payload

        if (!content) {
          throw new Error('Missing required parameter: content')
        }

        console.log('Humanizing content...')

        const prompt = buildHumanizationPrompt(content, contributorProfile, targetPerplexity, targetBurstiness)

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4500,
          temperature: 0.9,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })

        result = response.content[0].text
        break
      }

      case 'autoFixQualityIssues': {
        const { content, issues, siteArticles = [] } = payload

        if (!content || !issues) {
          throw new Error('Missing required parameters: content and issues')
        }

        console.log('Auto-fixing quality issues...')

        const issueDescriptions = issues.map((issue: any) => {
          const descriptions: Record<string, string> = {
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
${siteArticles.map((article: any) => `- [${article.title}](${article.url}) - Topics: ${article.topics?.join(', ') || 'N/A'}`).join('\n')}
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

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4500,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })

        result = response.content[0].text
        break
      }

      case 'reviseWithFeedback': {
        const { content, feedbackItems, availableInternalLinks = [] } = payload

        if (!content || !feedbackItems || !Array.isArray(feedbackItems)) {
          throw new Error('Missing required parameters: content and feedbackItems (array)')
        }

        console.log('Revising content with feedback...')

        const feedbackText = feedbackItems.map((item: any, index: number) => {
          return `${index + 1}. [${item.category.toUpperCase()}] ${item.severity}: "${item.selected_text}"
   Issue: ${item.comment}`
        }).join('\n\n')

        // FIX #2: Include linking rules so AI doesn't suggest bad links
        const linkingRules = `
=== CRITICAL LINKING RULES (MUST FOLLOW) ===

1. NEVER link directly to school websites (.edu domains)
   - Instead, use GetEducated school profile pages: geteducated.com/online-schools/[school-name]/

2. NEVER link to these COMPETITOR sites:
   - onlineu.com, usnews.com, bestcolleges.com, niche.com
   - collegeraptor.com, affordablecollegesonline.com
   - collegeconfidential.com, petersons.com, princetonreview.com
   - gradschools.com, collegexpress.com

3. External links should ONLY go to:
   - Bureau of Labor Statistics (bls.gov)
   - Government sites (.gov)
   - Nonprofit educational organizations
   - Accreditation body sites (aacsb.edu, cacrep.org, etc.)

4. For internal links, use GetEducated pages:
   - geteducated.com/online-degrees/
   - geteducated.com/online-schools/
   - geteducated.com/online-college-ratings-and-rankings/

5. If asked to add a link and you cannot find a valid source:
   - Rewrite the sentence to remove the need for a citation
   - Do NOT invent URLs or use blocked sources

=== END LINKING RULES ===
`

        // If internal link suggestions were provided, include them
        const internalLinkContext = availableInternalLinks.length > 0
          ? `\nAVAILABLE INTERNAL LINKS (use these for internal linking requests):\n${availableInternalLinks.map((a: any) => `- [${a.title}](${a.url})`).join('\n')}\n`
          : ''

        const prompt = `You are a content editor revising this article based on editorial feedback.

CURRENT CONTENT:
${content}

EDITORIAL FEEDBACK:
${feedbackText}
${linkingRules}${internalLinkContext}
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
1. Address each piece of feedback carefully
2. Make necessary revisions to the content
3. Maintain the overall structure and tone
4. Keep all other content unchanged
5. Preserve HTML formatting and ensure ALL new content is properly HTML formatted
6. STRICTLY follow the linking rules above - never link to competitors or .edu sites

OUTPUT ONLY THE REVISED HTML CONTENT.`

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4500,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })

        result = response.content[0].text
        break
      }

      case 'extractLearningPatterns': {
        const { originalContent, revisedContent, feedbackItems } = payload

        if (!originalContent || !revisedContent || !feedbackItems) {
          throw new Error('Missing required parameters: originalContent, revisedContent, and feedbackItems')
        }

        console.log('Extracting learning patterns...')

        const prompt = `Analyze the differences between original and revised content to extract learning patterns for future content generation.

ORIGINAL CONTENT:
${originalContent.substring(0, 1000)}...

REVISED CONTENT:
${revisedContent.substring(0, 1000)}...

FEEDBACK THAT WAS ADDRESSED:
${feedbackItems.map((f: any) => `- ${f.category}: ${f.comment}`).join('\n')}

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

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
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
        result = parsed.patterns
        break
      }

      case 'analyzeIdeaFeedback': {
        const { approvedIdeas, rejectedIdeas, customNotes } = payload

        console.log('Analyzing idea feedback patterns...')

        const approvedContext = approvedIdeas.length > 0
          ? `APPROVED IDEAS (what works well):
${approvedIdeas.map((idea: any, i: number) => `${i + 1}. Title: "${idea.title}"
   Description: ${idea.description || 'N/A'}
   Source: ${idea.source || 'N/A'}
   Content Type: ${idea.contentType || 'N/A'}
   Keywords: ${idea.keywords?.join(', ') || 'N/A'}
   Notes: ${idea.notes || 'N/A'}`).join('\n\n')}`
          : ''

        const rejectedContext = rejectedIdeas.length > 0
          ? `REJECTED IDEAS (what to avoid):
${rejectedIdeas.map((idea: any, i: number) => `${i + 1}. Title: "${idea.title}"
   Description: ${idea.description || 'N/A'}
   Source: ${idea.source || 'N/A'}
   Content Type: ${idea.contentType || 'N/A'}
   Keywords: ${idea.keywords?.join(', ') || 'N/A'}
   Rejection Category: ${idea.category || 'N/A'}
   Rejection Reason: ${idea.reason || 'N/A'}
   Notes: ${idea.notes || 'N/A'}`).join('\n\n')}`
          : ''

        const customContext = customNotes
          ? `USER NOTES: ${customNotes}`
          : ''

        const prompt = `You are an AI content strategist analyzing user feedback on content ideas to improve future idea generation.

${approvedContext}

${rejectedContext}

${customContext}

TASK:
Analyze the patterns in the approved and rejected ideas to extract learnings that can improve future idea generation. Focus on:
1. What types of topics/titles get approved vs rejected
2. Common characteristics of good vs bad ideas
3. Content types that work better
4. Keywords and sources that are preferred
5. Specific patterns in rejection reasons

OUTPUT AS JSON:
{
  "patterns": {
    "goodPatterns": ["Pattern 1 from approved ideas", "Pattern 2"],
    "badPatterns": ["Pattern to avoid from rejected ideas", "Another pattern to avoid"],
    "preferredTopics": ["Topic area 1", "Topic area 2"],
    "avoidTopics": ["Topic to avoid 1", "Topic to avoid 2"],
    "titlePatterns": {
      "good": ["Good title pattern example", "Another good pattern"],
      "bad": ["Bad title pattern to avoid", "Another bad pattern"]
    },
    "preferredContentTypes": ["guide", "career_guide"],
    "preferredSources": ["reddit", "trends"],
    "recommendations": [
      "Actionable recommendation 1",
      "Actionable recommendation 2",
      "Actionable recommendation 3"
    ]
  },
  "improvedPromptAdditions": "A paragraph of additional prompt instructions to add to the idea generator to incorporate these learnings"
}

Analyze now and provide the JSON:`

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 3000,
          temperature: 0.6,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })

        try {
          // Clean up the response - remove markdown code blocks if present
          let responseText = response.content[0].text.trim()
          if (responseText.startsWith('```json')) {
            responseText = responseText.slice(7)
          } else if (responseText.startsWith('```')) {
            responseText = responseText.slice(3)
          }
          if (responseText.endsWith('```')) {
            responseText = responseText.slice(0, -3)
          }
          responseText = responseText.trim()

          result = JSON.parse(responseText)
        } catch {
          // If JSON parsing fails, return a structured error response
          result = {
            patterns: {
              goodPatterns: [],
              badPatterns: [],
              preferredTopics: [],
              avoidTopics: [],
              titlePatterns: { good: [], bad: [] },
              recommendations: ['Analysis completed but could not parse patterns. Raw response available.']
            },
            rawResponse: response.content[0].text
          }
        }
        break
      }

      case 'addInternalLinks': {
        const { content, siteArticles } = payload

        if (!content || !siteArticles || !Array.isArray(siteArticles)) {
          throw new Error('Missing required parameters: content and siteArticles (array)')
        }

        console.log('Adding internal links...')

        const prompt = `Add 3-5 contextual internal links to this article content.

ARTICLE CONTENT:
${content}

AVAILABLE ARTICLES TO LINK TO:
${siteArticles.map((a: any) => `- [${a.title}](${a.url})`).join('\n')}

INSTRUCTIONS:
1. Add links where they are genuinely relevant and helpful to the reader
2. Use natural anchor text (not "click here" or URLs)
3. Distribute links throughout the article, not all in one section
4. Use HTML <a> tags: <a href="URL">anchor text</a>
5. Aim for 3-5 links total
6. Do not force links where they don't fit naturally

OUTPUT ONLY THE UPDATED HTML CONTENT with links added.`

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4500,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })

        result = response.content[0].text
        break
      }

      case 'chat': {
        const { messages, temperature = 0.7, max_tokens = 4000 } = payload

        if (!messages || !Array.isArray(messages)) {
          throw new Error('Missing required parameter: messages (array)')
        }

        console.log('Processing chat request...')

        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: max_tokens,
          temperature: temperature,
          messages: messages.map((m: any) => ({
            role: m.role,
            content: m.content
          }))
        })

        result = response.content[0].text
        break
      }

      default:
        throw new Error(`Unknown action: ${action}. Valid actions: humanize, autoFixQualityIssues, reviseWithFeedback, extractLearningPatterns, analyzeIdeaFeedback, addInternalLinks, chat`)
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
    console.error('Claude API Edge Function error:', error)
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
