/**
 * Grok AI Client (Edge Function Version)
 * Calls Supabase Edge Function instead of Grok API directly
 * This keeps API keys secure on the server-side
 */

import { supabase } from '../supabaseClient'

class GrokClient {
  constructor() {
    this.functionName = 'grok-api'
  }

  /**
   * Call the Grok Edge Function
   */
  async callEdgeFunction(action, payload) {
    const { data, error } = await supabase.functions.invoke(this.functionName, {
      body: {
        action,
        payload,
      },
    })

    if (error) {
      throw new Error(`Grok Edge Function error: ${error.message}`)
    }

    if (!data.success) {
      throw new Error(`Grok API error: ${data.error}`)
    }

    return data.data
  }

  /**
   * Generate article draft from content idea
   */
  async generateDraft(idea, options = {}) {
    const {
      contentType = 'guide',
      targetWordCount = 2000,
      costDataContext = null,
      cheapestSchoolsContext = null, // Cheapest client schools for affordability articles
      authorProfile = null,
      authorName = null,
      contentRulesContext = null,
      userSpecifiedContext = null, // Schools/programs from idea title/description
    } = options

    try {
      const result = await this.callEdgeFunction('generateDraft', {
        idea,
        contentType,
        targetWordCount,
        costDataContext,
        cheapestSchoolsContext,
        authorProfile,
        authorName,
        contentRulesContext,
        userSpecifiedContext,
      })

      return result

    } catch (error) {
      console.error('Grok draft generation error:', error)
      throw error
    }
  }

  /**
   * Generate content ideas from seed topics
   */
  async generateIdeas(seedTopics, count = 10) {
    try {
      const result = await this.callEdgeFunction('generateIdeas', {
        seedTopics,
        count,
      })

      return result

    } catch (error) {
      console.error('Grok idea generation error:', error)
      throw error
    }
  }

  /**
   * Generate SEO metadata for an article
   */
  async generateMetadata(articleContent, focusKeyword) {
    try {
      const result = await this.callEdgeFunction('generateMetadata', {
        articleContent,
        focusKeyword,
      })

      return result

    } catch (error) {
      console.error('Grok metadata generation error:', error)
      throw error
    }
  }

  /**
   * Generate content with web context (searches internet for current trends)
   * Grok has built-in web search capabilities through xAI
   */
  async generateWithWebContext(prompt, options = {}) {
    try {
      const result = await this.callEdgeFunction('generateWithWebContext', {
        prompt,
        temperature: options.temperature || 0.8,
        max_tokens: options.max_tokens || 4000,
      })

      return result

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
      const result = await this.callEdgeFunction('generate', {
        prompt,
        temperature: options.temperature || 0.8,
        max_tokens: options.max_tokens || 4000,
      })

      return result

    } catch (error) {
      console.error('Grok generation error:', error)
      throw error
    }
  }
}

export default GrokClient
