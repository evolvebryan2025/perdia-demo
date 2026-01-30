/**
 * Claude AI Client (Edge Function Version)
 * Calls Supabase Edge Function instead of Claude API directly
 * This keeps API keys secure on the server-side
 */

import { supabase } from '../supabaseClient'

class ClaudeClient {
  constructor() {
    this.functionName = 'claude-api'
  }

  /**
   * Call the Claude Edge Function
   */
  async callEdgeFunction(action, payload) {
    const { data, error } = await supabase.functions.invoke(this.functionName, {
      body: {
        action,
        payload,
      },
    })

    if (error) {
      throw new Error(`Claude Edge Function error: ${error.message}`)
    }

    if (!data.success) {
      throw new Error(`Claude API error: ${data.error}`)
    }

    return data.data
  }

  /**
   * Generic chat method for custom prompts
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Options like temperature, max_tokens
   */
  async chat(messages, options = {}) {
    try {
      const result = await this.callEdgeFunction('chat', {
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 4000,
      })

      return result

    } catch (error) {
      console.error('Claude chat error:', error)
      throw error
    }
  }

  /**
   * Humanize AI-generated content to make it undetectable
   * Now accepts tone/voice settings from content rules configuration
   */
  async humanize(content, options = {}) {
    const {
      contributorProfile = null,
      targetPerplexity = 'high',
      targetBurstiness = 'high',
      authorSystemPrompt = null,
      toneVoice = null, // Tone/voice settings from content rules
    } = options

    try {
      const result = await this.callEdgeFunction('humanize', {
        content,
        contributorProfile,
        targetPerplexity,
        targetBurstiness,
        authorSystemPrompt,
        toneVoice, // Pass tone/voice to edge function for dynamic style application
      })

      return result

    } catch (error) {
      console.error('Claude humanization error:', error)
      throw error
    }
  }

  /**
   * Auto-fix quality issues in content
   */
  async autoFixQualityIssues(content, issues, siteArticles = []) {
    try {
      const result = await this.callEdgeFunction('autoFixQualityIssues', {
        content,
        issues,
        siteArticles,
      })

      return result

    } catch (error) {
      console.error('Claude auto-fix error:', error)
      throw error
    }
  }

  /**
   * Revise content based on editorial feedback
   * FIX #2: Now accepts availableInternalLinks to prevent AI suggesting bad links
   */
  async reviseWithFeedback(content, feedbackItems, options = {}) {
    const { availableInternalLinks = [] } = options
    
    try {
      const result = await this.callEdgeFunction('reviseWithFeedback', {
        content,
        feedbackItems,
        availableInternalLinks,
      })

      return result

    } catch (error) {
      console.error('Claude revision error:', error)
      throw error
    }
  }

  /**
   * Extract learning patterns from feedback for AI training
   * Supports both content revision and idea feedback analysis
   */
  async extractLearningPatterns(params) {
    try {
      // Determine the type of analysis based on parameters
      const isIdeaFeedback = params.approvedIdeas || params.rejectedIdeas

      if (isIdeaFeedback) {
        // Analyze idea feedback patterns for idea generator training
        const result = await this.callEdgeFunction('analyzeIdeaFeedback', {
          approvedIdeas: params.approvedIdeas || [],
          rejectedIdeas: params.rejectedIdeas || [],
          customNotes: params.customNotes || '',
        })
        return result
      } else {
        // Original content revision pattern extraction
        const result = await this.callEdgeFunction('extractLearningPatterns', {
          originalContent: params.originalContent || params,
          revisedContent: params.revisedContent,
          feedbackItems: params.feedbackItems,
        })
        return result
      }

    } catch (error) {
      console.error('Claude pattern extraction error:', error)
      throw error
    }
  }

  /**
   * Add internal links to content
   */
  async addInternalLinks(content, siteArticles) {
    try {
      const result = await this.callEdgeFunction('addInternalLinks', {
        content,
        siteArticles,
      })

      return result

    } catch (error) {
      console.error('Claude add internal links error:', error)
      throw error
    }
  }
}

export default ClaudeClient
