/**
 * Generation Service
 * Orchestrates the complete two-pass AI generation pipeline with quality checks
 * Pipeline: Grok Draft → StealthGPT Humanize → Quality Check → Auto-Fix Loop → Save
 */

// Use Edge Function clients for secure server-side API calls
// API keys are stored in Supabase secrets, not exposed to browser
import GrokClient from './ai/grokClient.edge'
import ClaudeClient from './ai/claudeClient.edge'
import StealthGptClient from './ai/stealthGptClient'
import { supabase } from './supabaseClient'
import IdeaDiscoveryService from './ideaDiscoveryService'
import { getCostDataContext } from './costDataService'
import { insertShortcodeInContent } from './shortcodeService'
import { MonetizationEngine, monetizationValidator } from './monetizationEngine'
import {
  getAuthorSystemPrompt,
  APPROVED_AUTHORS,
  BLOCKED_BYLINES,
  validateByline,
  recommendAuthor,
} from '../hooks/useContributors'
import { contentValidator, validateDraft, validateForPublish, validateIdeaAlignment } from './validation/contentValidator'
import { calculateQualityScore, getQualityThresholds, calculateQualityScoreAsync } from './qualityScoreService'
import { detectSubjectArea, scoreArticlesForLinking } from './subjectMatcher'

class GenerationService {
  constructor() {
    this.grok = new GrokClient()
    this.claude = new ClaudeClient()
    this.stealthGpt = new StealthGptClient()
    this.ideaDiscovery = new IdeaDiscoveryService()
    this.monetizationEngine = new MonetizationEngine()
    this.isProcessing = false
    this.processingQueue = []
    this.currentTask = null

    // Content rules configuration (loaded from database)
    this.contentRules = null
    this.contentRulesLoadedAt = null

    // AI Reasoning tracking (per Dec 18, 2025 meeting - Tony requested transparency)
    // Stores reasoning for each generation to help debug issues
    this.reasoning = null

    // Humanization settings - optimized for maximum AI detection bypass
    this.humanizationProvider = 'stealthgpt' // 'stealthgpt' or 'claude'
    this.stealthGptSettings = {
      tone: 'College',      // Recommended for professional content
      mode: 'High',         // Maximum bypass potential
      detector: 'gptzero',  // Most common AI detector
      business: true,       // Use 10x more powerful engine
      doublePassing: false, // Two-pass humanization for extra safety
    }
  }

  // ========================================
  // AI REASONING TRACKING
  // Per Dec 18, 2025 meeting with Tony - provides transparency into AI decisions
  // ========================================

  /**
   * Initialize reasoning log for a new generation
   */
  initReasoning() {
    this.reasoning = {
      generated_at: new Date().toISOString(),
      model_used: 'grok-beta',
      temperature: 0.7,
      decisions: {},
      warnings: [],
      data_sources: [],
    }
  }

  /**
   * Log a reasoning decision
   * @param {string} category - Decision category (e.g., 'contributor_selection', 'monetization')
   * @param {Object} data - Decision data and reasoning
   */
  logReasoning(category, data) {
    if (!this.reasoning) this.initReasoning()
    this.reasoning.decisions[category] = {
      ...data,
      logged_at: new Date().toISOString(),
    }
  }

  /**
   * Log a warning in reasoning
   * @param {string} type - Warning type
   * @param {string} message - Warning message
   * @param {string} severity - 'low', 'medium', 'high'
   */
  logReasoningWarning(type, message, severity = 'medium') {
    if (!this.reasoning) this.initReasoning()
    this.reasoning.warnings.push({
      type,
      message,
      severity,
      logged_at: new Date().toISOString(),
    })
  }

  /**
   * Log a data source used
   * @param {string} source - Data source description
   * @param {Object} metadata - Additional metadata
   */
  logDataSource(source, metadata = {}) {
    if (!this.reasoning) this.initReasoning()
    this.reasoning.data_sources.push({
      source,
      ...metadata,
      logged_at: new Date().toISOString(),
    })
  }

  /**
   * Get final reasoning output with all decisions
   * @returns {Object} Complete reasoning log
   */
  getReasoningOutput() {
    if (!this.reasoning) return null
    return {
      ...this.reasoning,
      finalized_at: new Date().toISOString(),
    }
  }

  // ========================================
  // CONTENT RULES CONFIGURATION
  // ========================================

  /**
   * Load content rules from database
   * Caches for 5 minutes to avoid repeated queries
   */
  async loadContentRules() {
    // Return cached rules if still fresh (5 minutes)
    if (this.contentRules && this.contentRulesLoadedAt &&
        (Date.now() - this.contentRulesLoadedAt) < 5 * 60 * 1000) {
      return this.contentRules
    }

    try {
      // Try RPC function first
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_active_content_rules')

      if (!rpcError && rpcData) {
        this.contentRules = rpcData
        this.contentRulesLoadedAt = Date.now()
        console.log('[Generation] Loaded content rules from RPC, version:', rpcData.version)
        return this.contentRules
      }

      // Fallback to direct query
      const { data, error } = await supabase
        .from('content_rules_config')
        .select('*')
        .eq('is_active', true)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          console.warn('[Generation] No content rules config found, using defaults')
          this.contentRules = this.getDefaultContentRules()
        } else {
          throw error
        }
      } else {
        this.contentRules = data
        console.log('[Generation] Loaded content rules, version:', data.version)
      }

      this.contentRulesLoadedAt = Date.now()
      return this.contentRules

    } catch (error) {
      console.error('[Generation] Error loading content rules:', error)
      // Return defaults on error
      this.contentRules = this.getDefaultContentRules()
      return this.contentRules
    }
  }

  /**
   * Default content rules (fallback if database has no config)
   */
  getDefaultContentRules() {
    return {
      version: 0,
      hard_rules: {
        authors: { approved_authors: ['Tony Huffman', 'Kayleigh Gilbert', 'Sara', 'Charity'], require_author_assignment: true, enforce_approved_only: true },
        links: { blocked_domains: ['onlineu.com', 'usnews.com', 'niche.com'], blocked_patterns: [], block_edu_links: true, block_competitor_links: true },
        external_sources: { allowed_domains: ['bls.gov', 'ed.gov', 'nces.ed.gov'], require_whitelist: true },
        monetization: { require_monetization_shortcode: true, block_unknown_shortcodes: true, block_legacy_shortcodes: true },
        publishing: { require_human_review: true, block_high_risk: true, block_critical_risk: true },
      },
      guidelines: {
        word_count: { minimum: 1500, target: 2000, maximum: 2500 },
        structure: { min_h2_headings: 3, max_h2_headings: 8 },
        faqs: { minimum: 3, target: 5 },
        links: { internal_links_min: 3, internal_links_target: 5, external_citations_min: 2 },
        quality: { minimum_score_to_publish: 70, minimum_score_auto_publish: 80, target_score: 85 },
        readability: { target_flesch_score: 60, max_avg_sentence_length: 25 },
      },
      tone_voice: {
        overall_style: { tone: 'conversational', formality: 'professional but approachable' },
        banned_phrases: ['utilize', 'in order to', 'at the end of the day', 'synergy', 'leverage'],
        preferred_phrases: ['use', 'to', 'ultimately', 'work together', 'apply'],
        sentence_variety: { vary_length: true, avoid_starting_with_same_word: true },
        anti_hallucination: { require_citations_for_statistics: true, no_invented_data: true },
      },
      pipeline_steps: [
        { id: 'draft', name: 'Draft Generation', enabled: true, provider: 'grok' },
        { id: 'humanize', name: 'Humanization', enabled: true, provider: 'stealthgpt' },
        { id: 'internal_links', name: 'Internal Linking', enabled: true },
        { id: 'monetization', name: 'Monetization', enabled: true },
        { id: 'quality_check', name: 'Quality Check', enabled: true },
      ],
      author_content_mapping: {},
      shortcode_rules: { allowed_shortcodes: [], legacy_shortcodes_blocked: [] },
    }
  }

  /**
   * Build content rules context for AI prompts
   * This injects hard rules and guidelines into the AI prompt
   */
  buildContentRulesPromptSection(rules) {
    if (!rules) return ''

    let section = '\n\n=== CONTENT RULES (MUST FOLLOW) ===\n'

    // Hard Rules
    const hr = rules.hard_rules || {}

    // Authors
    if (hr.authors?.approved_authors?.length > 0) {
      section += `\nAPPROVED AUTHORS ONLY: ${hr.authors.approved_authors.join(', ')}\n`
    }

    // Link rules
    if (hr.links) {
      section += '\nLINK RULES:\n'
      if (hr.links.block_edu_links) {
        section += '- NEVER link directly to .edu domains (use GetEducated school pages instead)\n'
      }
      if (hr.links.block_competitor_links && hr.links.blocked_domains?.length > 0) {
        section += `- NEVER link to competitors: ${hr.links.blocked_domains.join(', ')}\n`
      }
    }

    // External sources
    if (hr.external_sources?.allowed_domains?.length > 0) {
      section += `\nALLOWED EXTERNAL SOURCES: ${hr.external_sources.allowed_domains.join(', ')}\n`
      section += '- Only cite these domains for external data\n'
    }

    // Guidelines (soft rules)
    const gl = rules.guidelines || {}

    section += '\n\nCONTENT GUIDELINES:\n'

    if (gl.word_count) {
      section += `- Word count: ${gl.word_count.minimum}-${gl.word_count.maximum} words (target: ${gl.word_count.target})\n`
    }

    if (gl.structure) {
      section += `- Use ${gl.structure.min_h2_headings}-${gl.structure.max_h2_headings} H2 headings\n`
    }

    if (gl.faqs) {
      section += `- Include ${gl.faqs.minimum}-${gl.faqs.target} FAQs\n`
    }

    if (gl.links) {
      section += `- Include ${gl.links.internal_links_min}-${gl.links.internal_links_target} internal links\n`
      section += `- Include at least ${gl.links.external_citations_min} external citations\n`
    }

    // Tone and voice
    const tv = rules.tone_voice || {}

    if (tv.overall_style) {
      section += `\nWRITING STYLE: ${tv.overall_style.tone}, ${tv.overall_style.formality}\n`
    }

    if (tv.banned_phrases?.length > 0) {
      section += `\nBANNED PHRASES (never use): ${tv.banned_phrases.slice(0, 10).join(', ')}\n`
    }

    if (tv.preferred_phrases?.length > 0) {
      section += `\nPREFERRED PHRASES: ${tv.preferred_phrases.slice(0, 10).join(', ')}\n`
    }

    if (tv.anti_hallucination?.require_citations_for_statistics) {
      section += '\n- Cite sources for all statistics and data\n'
      section += '- Do NOT invent or estimate data points\n'
    }

    section += '\n=== END CONTENT RULES ===\n'

    return section
  }

  /**
   * Build tone/voice context for humanization
   */
  buildToneVoiceContext(rules) {
    if (!rules?.tone_voice) return null

    const tv = rules.tone_voice
    return {
      tone: tv.overall_style?.tone || 'conversational',
      formality: tv.overall_style?.formality || 'professional',
      bannedPhrases: tv.banned_phrases || [],
      preferredPhrases: tv.preferred_phrases || [],
      sentenceVariety: tv.sentence_variety || {},
    }
  }

  /**
   * Get quality thresholds from content rules
   */
  getQualityThresholds(rules) {
    const defaults = {
      minWordCount: 1500,
      maxWordCount: 2500,
      targetWordCount: 2000,
      minInternalLinks: 3,
      minExternalLinks: 2,
      minFaqs: 3,
      minH2Headings: 3,
      maxAvgSentenceLength: 25,
      minScoreToPublish: 70,
      minScoreAutoPublish: 80,
      targetScore: 85,
    }

    if (!rules?.guidelines) return defaults

    const gl = rules.guidelines
    return {
      minWordCount: gl.word_count?.minimum || defaults.minWordCount,
      maxWordCount: gl.word_count?.maximum || defaults.maxWordCount,
      targetWordCount: gl.word_count?.target || defaults.targetWordCount,
      minInternalLinks: gl.links?.internal_links_min || defaults.minInternalLinks,
      minExternalLinks: gl.links?.external_citations_min || defaults.minExternalLinks,
      minFaqs: gl.faqs?.minimum || defaults.minFaqs,
      minH2Headings: gl.structure?.min_h2_headings || defaults.minH2Headings,
      maxAvgSentenceLength: gl.readability?.max_avg_sentence_length || defaults.maxAvgSentenceLength,
      minScoreToPublish: gl.quality?.minimum_score_to_publish || defaults.minScoreToPublish,
      minScoreAutoPublish: gl.quality?.minimum_score_auto_publish || defaults.minScoreAutoPublish,
      targetScore: gl.quality?.target_score || defaults.targetScore,
    }
  }

  /**
   * Check if a pipeline step is enabled
   */
  isPipelineStepEnabled(rules, stepId) {
    if (!rules?.pipeline_steps) return true // Default to enabled
    const step = rules.pipeline_steps.find(s => s.id === stepId)
    return step ? step.enabled !== false : true
  }

  /**
   * Get pipeline step config
   */
  getPipelineStepConfig(rules, stepId) {
    if (!rules?.pipeline_steps) return {}
    const step = rules.pipeline_steps.find(s => s.id === stepId)
    return step?.config || {}
  }

  /**
   * Generate complete article from content idea with full quality assurance
   * Includes auto-fix loop with up to 3 retry attempts
   * Now integrates Content Rules from database for dynamic configuration
   */
  async generateArticleComplete(idea, options = {}, onProgress) {
    const {
      contentType = 'guide',
      targetWordCount = 2000,
      autoAssignContributor = true,
      addInternalLinks = true,
      autoFix = true,
      maxFixAttempts = 3,
      qualityThreshold = 85,
    } = options

    try {
      // Initialize AI reasoning tracking for this generation
      // Per Dec 18, 2025 meeting - Tony requested transparency into AI decisions
      this.initReasoning()
      this.logReasoning('topic_interpretation', {
        input_idea: idea.title,
        description: idea.description,
        content_type: contentType,
        target_word_count: targetWordCount,
        reasoning: `Processing idea "${idea.title}" as ${contentType} with ${targetWordCount} word target.`,
      })

      // STAGE -1: Load content rules configuration
      this.updateProgress(onProgress, 'Loading content rules configuration...', 2)
      const contentRules = await this.loadContentRules()
      const qualityThresholds = this.getQualityThresholds(contentRules)
      const contentRulesPrompt = this.buildContentRulesPromptSection(contentRules)

      console.log(`[Generation] Content rules loaded (version ${contentRules?.version || 0})`)

      // Use target word count from content rules if available
      const effectiveTargetWordCount = targetWordCount || qualityThresholds.targetWordCount

      // Update progress
      this.updateProgress(onProgress, 'Fetching cost data from ranking reports...', 5)

      // STAGE 0: Get cost data context for RAG
      const costContext = await getCostDataContext(idea)
      console.log(`[Generation] Cost data found: ${costContext.hasData ? costContext.costData.length + ' entries' : 'none'}`)

      // Log cost data source in reasoning
      if (costContext.hasData) {
        this.logDataSource('ranking_reports', {
          entries_found: costContext.costData.length,
          reports_used: costContext.reportsUsed || [],
          freshness: costContext.dataDate || 'unknown',
        })
        this.logReasoning('cost_data', {
          has_data: true,
          entry_count: costContext.costData.length,
          reasoning: `Found ${costContext.costData.length} cost data entries from ranking reports.`,
        })
      } else {
        this.logReasoningWarning('no_cost_data', 'No cost data found for this topic. Article may lack specific pricing information.', 'medium')
      }

      this.updateProgress(onProgress, 'Auto-assigning contributor...', 10)

      // STAGE 1: Auto-assign contributor FIRST so we can use their profile in generation
      let contributor = null
      let contributorReasoning = null
      if (autoAssignContributor) {
        const assignmentResult = await this.assignContributorWithReasoning(idea, contentType)
        contributor = assignmentResult.contributor
        contributorReasoning = assignmentResult.reasoning

        // Log contributor selection reasoning
        this.logReasoning('contributor_selection', {
          selected: contributor?.name || 'None',
          score: assignmentResult.score || 0,
          reasoning: contributorReasoning || 'No reasoning available',
          alternatives_considered: assignmentResult.alternatives || [],
          expertise_match: assignmentResult.expertiseMatch || [],
          content_type_match: assignmentResult.contentTypeMatch || false,
        })
      }

      // Build author system prompt from comprehensive profile
      const authorPrompt = contributor ? getAuthorSystemPrompt(contributor) : ''
      if (authorPrompt) {
        console.log(`[Generation] Using author profile for ${contributor.name} (${authorPrompt.length} chars)`)
      }

      this.updateProgress(onProgress, 'Generating draft with Grok AI...', 20)

      // Check if draft generation is enabled in pipeline
      if (!this.isPipelineStepEnabled(contentRules, 'draft')) {
        throw new Error('Draft generation step is disabled in pipeline configuration')
      }

      // STAGE 2: Generate draft with Grok (includes cost data, author profile, AND content rules)
      const draftData = await this.grok.generateDraft(idea, {
        contentType,
        targetWordCount: effectiveTargetWordCount,
        costDataContext: costContext.promptText, // Pass cost data to prompt
        authorProfile: authorPrompt, // Pass comprehensive author profile
        authorName: contributor?.name,
        contentRulesContext: contentRulesPrompt, // NEW: Pass content rules to AI
      })

      // CRITICAL: Ensure HTML formatting is proper after draft generation
      // This catches cases where AI ignores formatting instructions
      if (draftData.content) {
        draftData.content = this.ensureProperHtmlFormatting(draftData.content)
      }

      this.updateProgress(onProgress, 'Validating draft content...', 30)

      // VALIDATION CHECKPOINT 1: Check draft for truncation and placeholders
      const draftValidation = await validateDraft(draftData.content, {
        targetWordCount,
        faqs: draftData.faqs,
        checkTruncation: true,
        checkPlaceholders: true,
        checkStatistics: false, // Defer to final validation
        checkLegislation: false, // Defer to final validation
      })

      if (draftValidation.isBlocked) {
        console.error('[Generation] Draft validation BLOCKED:', draftValidation.blockingIssues)
        // Attempt to regenerate once if draft is truncated or has placeholders
        console.log('[Generation] Attempting to regenerate draft...')
        const retryDraftData = await this.grok.generateDraft(idea, {
          contentType,
          targetWordCount: targetWordCount + 200, // Request slightly longer to ensure completion
          costDataContext: costContext.promptText,
          authorProfile: authorPrompt,
          authorName: contributor?.name,
        })

        // Re-validate
        const retryValidation = await validateDraft(retryDraftData.content, {
          targetWordCount,
          faqs: retryDraftData.faqs,
        })

        if (retryValidation.isBlocked) {
          // Still blocked - throw error with details
          const issues = retryValidation.blockingIssues.map(i => i.message).join('; ')
          throw new Error(`Draft generation failed validation: ${issues}`)
        }

        // Use retry data
        Object.assign(draftData, retryDraftData)
        console.log('[Generation] Retry draft passed validation')
        // Log successful draft generation
        this.logReasoning('draft_generation', {
          model: 'grok-beta',
          title_generated: draftData.title,
          word_count_estimate: draftData.content?.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length || 0,
          faqs_generated: draftData.faqs?.length || 0,
          reasoning: 'Draft generated on retry after initial validation failure.',
          retry_attempted: true,
        })
      } else {
        console.log('[Generation] Draft validation passed:', contentValidator.getSummary(draftValidation))

        // Log successful draft generation
        this.logReasoning('draft_generation', {
          model: 'grok-beta',
          title_generated: draftData.title,
          word_count_estimate: draftData.content?.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length || 0,
          faqs_generated: draftData.faqs?.length || 0,
          reasoning: `Draft generated successfully with Grok AI. Title: "${draftData.title}". Contains ${draftData.faqs?.length || 0} FAQs.`,
          retry_attempted: false,
        })
      }

      // FIX: Ideas → Article Mismatch - Validate content matches idea intent
      this.updateProgress(onProgress, 'Validating idea alignment...', 35)
      const ideaAlignment = validateIdeaAlignment(draftData.content, idea)
      
      if (ideaAlignment.mismatches.length > 0) {
        console.warn('[Generation] Idea alignment issues:', ideaAlignment.mismatches)
        this.logReasoningWarning(
          'idea_alignment',
          `Generated content may not match idea intent: ${ideaAlignment.mismatches.map(m => m.message).join('; ')}`,
          ideaAlignment.score < 50 ? 'high' : 'medium'
        )
      }
      
      this.logReasoning('idea_alignment', {
        is_aligned: ideaAlignment.isAligned,
        score: ideaAlignment.score,
        matches: ideaAlignment.matches,
        mismatches: ideaAlignment.mismatches.map(m => m.message),
        warnings: ideaAlignment.warnings,
      })

      this.updateProgress(onProgress, 'Humanizing content with StealthGPT...', 40)

      // Check if humanization is enabled in pipeline
      const humanizeEnabled = this.isPipelineStepEnabled(contentRules, 'humanize')

      // Get tone/voice settings from content rules
      const toneVoiceContext = this.buildToneVoiceContext(contentRules)

      // STAGE 3: Humanize with StealthGPT (primary) or Claude (fallback)
      // Uses optimized settings: 150-200 word chunks, iterative rephrasing, business mode
      let humanizedContent
      if (!humanizeEnabled) {
        console.log('[Generation] Humanization step disabled in pipeline config - skipping')
        humanizedContent = draftData.content
      } else {
        try {
          if (this.humanizationProvider === 'stealthgpt' && this.stealthGpt.isConfigured()) {
            const stealthOptions = {
              tone: this.stealthGptSettings.tone,
              mode: this.stealthGptSettings.mode,
              detector: this.stealthGptSettings.detector,
              business: this.stealthGptSettings.business, // 10x more powerful engine
            }

            // Use double-passing for maximum undetectability if enabled
            if (this.stealthGptSettings.doublePassing) {
              console.log('[Generation] Using double-pass humanization for maximum bypass')
              humanizedContent = await this.stealthGpt.humanizeWithDoublePassing(draftData.content, stealthOptions)
            } else {
              humanizedContent = await this.stealthGpt.humanizeLongContent(draftData.content, stealthOptions)
            }
            console.log('[Generation] Content humanized with StealthGPT (optimized)')
          } else {
            // Fallback to Claude with comprehensive author profile AND tone/voice context
            humanizedContent = await this.claude.humanize(draftData.content, {
              contributorProfile: contributor,
              authorSystemPrompt: authorPrompt,
              targetPerplexity: 'high',
              targetBurstiness: 'high',
              toneVoice: toneVoiceContext, // NEW: Pass tone/voice from content rules
            })
            console.log('[Generation] Content humanized with Claude (fallback)')
          }
        } catch (humanizeError) {
          console.warn('[Generation] StealthGPT humanization failed, falling back to Claude:', humanizeError.message)
          humanizedContent = await this.claude.humanize(draftData.content, {
            contributorProfile: contributor,
            authorSystemPrompt: authorPrompt,
            targetPerplexity: 'high',
            targetBurstiness: 'high',
            toneVoice: toneVoiceContext, // NEW: Pass tone/voice from content rules
          })
        }

        // CRITICAL: Re-validate HTML formatting after humanization
        // StealthGPT and Claude humanization can sometimes strip HTML tags
        humanizedContent = this.ensureProperHtmlFormatting(humanizedContent)

        // Log humanization decision for reasoning
        this.logReasoning('humanization', {
          provider: this.humanizationProvider === 'stealthgpt' && this.stealthGpt.isConfigured() ? 'stealthgpt' : 'claude',
          mode: this.stealthGptSettings?.mode || 'default',
          tone: this.stealthGptSettings?.tone || 'default',
          changes_made: 'Content processed for natural language patterns and AI detection bypass',
        })
      }

      this.updateProgress(onProgress, 'Adding internal links...', 55)

      // STAGE 4: Add internal links (respects pipeline config)
      let finalContent = humanizedContent
      const internalLinksEnabled = this.isPipelineStepEnabled(contentRules, 'internal_links')
      let internalLinksAdded = 0
      let selectedSiteArticles = []

      if (addInternalLinks && internalLinksEnabled) {
        // FIX #1: Pass topics for subject-aware matching
        const siteArticles = await this.getRelevantSiteArticles(draftData.title, 30, {
          topics: idea.seed_topics || [],
        })
        if (siteArticles.length >= 3) {
          finalContent = await this.addInternalLinksToContent(humanizedContent, siteArticles)
          internalLinksAdded = Math.min(5, siteArticles.length) // Estimate based on our target
          selectedSiteArticles = siteArticles.slice(0, 5)
        }

        // Log internal linking decision for reasoning
        this.logReasoning('internal_links', {
          link_count: internalLinksAdded,
          candidates_found: siteArticles.length,
          reasoning: siteArticles.length >= 3
            ? `Selected ${internalLinksAdded} relevant articles from ${siteArticles.length} candidates for contextual internal linking.`
            : `Insufficient relevant articles found (${siteArticles.length}). Need at least 3 for internal linking.`,
          selection_reasoning: selectedSiteArticles.map(a => ({
            url: a.url,
            title: a.title,
            reason: `Matched based on topic relevance to "${draftData.title}"`,
          })),
        })
      } else if (!internalLinksEnabled) {
        console.log('[Generation] Internal linking step disabled in pipeline config - skipping')
        this.logReasoning('internal_links', {
          link_count: 0,
          reasoning: 'Internal linking step was disabled in pipeline configuration.',
        })
      }

      this.updateProgress(onProgress, 'Adding monetization shortcodes...', 62)

      // STAGE 4.5: Add monetization shortcodes using new MonetizationEngine (respects pipeline config)
      const monetizationEnabled = this.isPipelineStepEnabled(contentRules, 'monetization')
      let monetizationResult = null

      if (!monetizationEnabled) {
        console.log('[Generation] Monetization step disabled in pipeline config - skipping')
      } else {
        try {
          // First, match the topic to a monetization category
          const monetizationMatch = await this.monetizationEngine.matchTopicToCategory(
            idea.title || draftData.title,
            costContext.degreeLevel
          )

          if (monetizationMatch.matched) {
            console.log(`[Generation] Matched monetization: category=${monetizationMatch.categoryId}, concentration=${monetizationMatch.concentrationId}, confidence=${monetizationMatch.confidence}`)

            // Determine article type for slot configuration
            const articleType = options.contentType || 'default'

            // Generate full monetization with program selection
            monetizationResult = await this.monetizationEngine.generateMonetization({
              articleId: idea.id,
              categoryId: monetizationMatch.categoryId,
              concentrationId: monetizationMatch.concentrationId,
              degreeLevelCode: monetizationMatch.degreeLevelCode,
              articleType,
            })

            if (monetizationResult.success && monetizationResult.slots.length > 0) {
              console.log(`[Generation] Generated ${monetizationResult.slots.length} monetization slots with ${monetizationResult.totalProgramsSelected} programs`)

              // Insert shortcodes at their designated positions
              for (const slot of monetizationResult.slots) {
                // Map slot names to insertion positions
                const positionMap = {
                  'after_intro': 'after_intro',
                  'mid_article': 'mid_content',
                  'near_conclusion': 'pre_conclusion',
                }
                const insertPosition = positionMap[slot.name] || 'after_intro'

                finalContent = insertShortcodeInContent(finalContent, slot.shortcode, insertPosition)
                console.log(`[Generation] Inserted ${slot.type} shortcode at ${slot.name} (${slot.programCount} programs, sponsored: ${slot.hasSponsored})`)
              }
            } else {
              console.warn('[Generation] Monetization generation returned no slots')
            }
          } else {
            console.warn('[Generation] Could not match monetization category:', monetizationMatch.error)
          }

          // Validate monetization compliance (business rules)
          const validation = await monetizationValidator.validate(monetizationResult, finalContent)
          if (validation.blockingIssues.length > 0) {
            console.error('[Generation] Monetization validation blocking issues:', validation.blockingIssues)
          } else if (validation.warnings.length > 0) {
            console.warn('[Generation] Monetization validation warnings:', validation.warnings.map(w => w.message))
          }

          // Log monetization decision for reasoning
          if (monetizationMatch.matched && monetizationResult?.success) {
            this.logReasoning('monetization_category', {
              selected: {
                category: monetizationMatch.categoryId,
                concentration: monetizationMatch.concentrationId,
                level: monetizationMatch.degreeLevelCode,
              },
              confidence: monetizationMatch.confidence,
              reasoning: `Matched topic "${idea.title || draftData.title}" to monetization category "${monetizationMatch.categoryId}" with concentration "${monetizationMatch.concentrationId}" (confidence: ${monetizationMatch.confidence}).`,
              sponsored_count: monetizationResult.sponsoredCount || 0,
              slots_generated: monetizationResult.slots?.length || 0,
              total_programs: monetizationResult.totalProgramsSelected || 0,
            })
          } else {
            this.logReasoningWarning(
              'monetization_match_failed',
              monetizationMatch.error || 'Could not match topic to any monetization category.',
              'medium'
            )
          }

        } catch (monetizationError) {
          console.warn('[Generation] Monetization shortcode insertion failed:', monetizationError.message)
          this.logReasoningWarning('monetization_error', monetizationError.message, 'medium')
          // Non-blocking - continue without shortcodes
        }
      }

      this.updateProgress(onProgress, 'Running content validation...', 68)

      // VALIDATION CHECKPOINT 2: Full validation before quality scoring
      const preQAValidation = await validateForPublish(finalContent, {
        targetWordCount,
        faqs: draftData.faqs,
        checkTruncation: true,
        checkPlaceholders: true,
        checkStatistics: true,
        checkLegislation: true,
        checkSchoolNames: true,
        checkInternalLinks: true,
      })

      // Log validation results
      console.log('[Generation] Pre-QA Validation:', contentValidator.getSummary(preQAValidation))

      // Extract validation flags for storage
      const validationFlags = preQAValidation.issues.map(issue => ({
        type: issue.type,
        severity: issue.severity,
        message: issue.message,
      }))

      const requiresHumanReview = preQAValidation.requiresReview
      const reviewReasons = preQAValidation.warnings.map(w => w.type)

      // If blocked, throw error (shouldn't happen if draft validation passed, but safety check)
      if (preQAValidation.isBlocked) {
        const issues = preQAValidation.blockingIssues.map(i => i.message).join('; ')
        throw new Error(`Content validation failed: ${issues}`)
      }

      this.updateProgress(onProgress, 'Running quality assurance...', 70)

      // STAGE 5: Quality Assurance Loop (with auto-fix)
      let articleData = {
        title: draftData.title,
        content: finalContent,
        excerpt: draftData.excerpt,
        meta_title: draftData.meta_title,
        meta_description: draftData.meta_description,
        focus_keyword: draftData.focus_keyword,
        slug: this.generateSlug(draftData.title),
        faqs: draftData.faqs,
        contributor_id: contributor?.id || null,
        contributor_name: contributor?.name || null,
        status: 'qa_review', // Changed from 'drafting' - articles go to Review Queue after generation
        // NEW: Validation tracking fields
        validation_flags: validationFlags,
        requires_human_review: requiresHumanReview,
        review_reasons: reviewReasons,
        validation_risk_level: preQAValidation.riskLevel,
      }

      if (autoFix) {
        const qaResult = await this.qualityAssuranceLoop(
          articleData,
          maxFixAttempts,
          (attempt, total) => {
            this.updateProgress(
              onProgress,
              `Auto-fixing quality issues (attempt ${attempt}/${total})...`,
              70 + (attempt * 10)
            )
          },
          qualityThresholds // Pass content rules thresholds to QA loop
        )

        articleData = qaResult.article
      } else {
        // Just calculate metrics without fixing (using content rules thresholds)
        const metrics = this.calculateQualityMetrics(articleData.content, articleData.faqs, qualityThresholds)
        articleData.word_count = metrics.word_count
        articleData.quality_score = metrics.score
        articleData.risk_flags = metrics.issues.map(i => i.type)
      }

      this.updateProgress(onProgress, 'Finalizing article...', 95)

      // Log final quality score for reasoning
      this.logReasoning('quality_assessment', {
        final_score: articleData.quality_score,
        word_count: articleData.word_count,
        issues_remaining: articleData.risk_flags?.length || 0,
        requires_human_review: requiresHumanReview,
        reasoning: articleData.quality_score >= 80
          ? `Article passed quality checks with a score of ${articleData.quality_score}. Ready for review.`
          : `Article has quality score of ${articleData.quality_score}. Issues: ${(articleData.risk_flags || []).join(', ') || 'none'}. May need manual review.`,
      })

      // Attach AI reasoning output to article for transparency
      // Per Dec 18, 2025 meeting - Tony requested this for debugging
      articleData.ai_reasoning = this.getReasoningOutput()
      console.log(`[Generation] AI reasoning attached (${Object.keys(this.reasoning?.decisions || {}).length} decisions logged)`)

      return articleData

    } catch (error) {
      console.error('Article generation error:', error)
      throw error
    }
  }

  /**
   * Quality Assurance Loop with Auto-Fix
   * Attempts to fix quality issues up to maxAttempts times
   * Now accepts optional quality thresholds from content rules
   */
  async qualityAssuranceLoop(articleData, maxAttempts = 3, onAttempt, qualityThresholds = null) {
    let currentArticle = { ...articleData }
    let attempt = 0

    while (attempt < maxAttempts) {
      attempt++

      if (onAttempt) onAttempt(attempt, maxAttempts)

      // Calculate quality metrics using configurable thresholds
      const metrics = this.calculateQualityMetrics(currentArticle.content, currentArticle.faqs, qualityThresholds)
      const issues = metrics.issues

      // Update article with metrics
      currentArticle.word_count = metrics.word_count
      currentArticle.quality_score = metrics.score

      console.log(`QA Attempt ${attempt}/${maxAttempts}: Score = ${metrics.score}, Issues = ${issues.length}`)

      // If no issues or max attempts reached, stop
      if (issues.length === 0) {
        console.log('✓ All quality checks passed!')
        currentArticle.risk_flags = []
        break
      }

      if (attempt === maxAttempts) {
        console.log(`⚠ Max attempts reached. Flagging ${issues.length} remaining issues.`)
        currentArticle.risk_flags = issues.map(i => i.type)
        break
      }

      // Auto-fix issues
      console.log(`Fixing issues: ${issues.map(i => i.type).join(', ')}`)

      try {
        const fixedContent = await this.autoFixQualityIssues(
          currentArticle.content,
          issues,
          currentArticle.faqs
        )

        currentArticle.content = fixedContent

        // Re-calculate metrics to check improvement (using same thresholds)
        const newMetrics = this.calculateQualityMetrics(fixedContent, currentArticle.faqs, qualityThresholds)

        console.log(`Improvement: ${metrics.score} → ${newMetrics.score}`)

        // If no improvement, stop trying
        if (newMetrics.score <= metrics.score) {
          console.log('⚠ No improvement detected. Stopping auto-fix.')
          currentArticle.risk_flags = issues.map(i => i.type)
          break
        }

      } catch (error) {
        console.error('Auto-fix failed:', error)
        currentArticle.risk_flags = issues.map(i => i.type)
        break
      }
    }

    return {
      article: currentArticle,
      attempts: attempt,
      finalScore: currentArticle.quality_score,
    }
  }

  /**
   * Auto-fix quality issues using Claude
   */
  async autoFixQualityIssues(content, issues, currentFaqs = []) {
    const issueDescriptions = issues.map(issue => {
      switch (issue.type) {
        case 'word_count_low':
          return '- Article is too short. Add 200-300 more words with valuable information.'
        case 'word_count_high':
          return '- Article is too long. Condense and remove unnecessary repetition.'
        case 'missing_internal_links':
          return '- Missing internal links. Add 2-3 more relevant internal links if possible.'
        case 'missing_external_links':
          return '- Missing external citations. Add 1-2 authoritative external sources with links.'
        case 'missing_faqs':
          return `- Missing FAQ section. Add ${3 - currentFaqs.length} more relevant questions and answers.`
        case 'weak_headings':
          return '- Weak heading structure. Add 2-3 more H2 subheadings to break up content.'
        case 'poor_readability':
          return '- Poor readability. Shorten some long sentences and use simpler language.'
        default:
          return `- ${issue.type}: ${issue.severity} issue`
      }
    }).join('\n')

    const prompt = `You are reviewing an article and need to fix the following quality issues:

QUALITY ISSUES TO FIX:
${issueDescriptions}

CURRENT ARTICLE CONTENT:
${content}

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
1. Fix ALL the issues listed above
2. Maintain the article's overall tone and message
3. Keep the existing heading structure unless adding new headings
4. For external citations, use real, authoritative sources when possible
5. For FAQs, make them relevant and helpful to readers using proper HTML (<h2>Frequently Asked Questions</h2> followed by <h3> for questions and <p> for answers)
6. Do NOT remove existing content unless consolidating
7. Ensure all HTML tags are properly closed and all new content is properly HTML formatted

OUTPUT ONLY THE COMPLETE FIXED HTML CONTENT (no explanations or commentary).`

    try {
      const fixedContent = await this.claude.chat([
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.7,
        max_tokens: 4500,
      })

      return fixedContent

    } catch (error) {
      console.error('Error in auto-fix:', error)
      throw error
    }
  }

  /**
   * Calculate quality metrics for an article
   * UNIFIED: Uses the shared qualityScoreService for consistent scoring
   * This ensures the score shown in lists matches the score in the editor
   *
   * @param {string} content - Article HTML content
   * @param {Array} faqs - FAQ array
   * @param {Object} thresholds - Optional quality thresholds (will use system_settings if not provided)
   */
  calculateQualityMetrics(content, faqs = [], thresholds = null) {
    // Convert old-style thresholds to new format if provided
    const unifiedThresholds = thresholds ? {
      minWordCount: thresholds.minWordCount || 800,
      maxWordCount: thresholds.maxWordCount || 2500,
      minInternalLinks: thresholds.minInternalLinks || 3,
      minExternalLinks: thresholds.minExternalLinks || 1,
      requireBLS: false,
      requireFAQ: (thresholds.minFaqs || 0) > 0,
      requireHeadings: true,
      minHeadingCount: thresholds.minH2Headings || 3,
      minImages: 0, // Don't require images during generation
      requireImageAlt: false, // Don't check image alt during generation
      keywordDensityMin: 0.5,
      keywordDensityMax: 2.5,
      minReadability: 60,
      maxReadability: 80,
    } : null

    // Build article object for the unified service
    const article = { faqs: faqs || [] }

    // Use the unified quality score service
    // If no thresholds provided, it will use defaults (matching system_settings)
    const result = calculateQualityScore(
      content,
      article,
      unifiedThresholds || {
        minWordCount: 800,
        maxWordCount: 2500,
        minInternalLinks: 3,
        minExternalLinks: 1,
        requireBLS: false,
        requireFAQ: false,
        requireHeadings: true,
        minHeadingCount: 3,
        minImages: 0,
        requireImageAlt: false,
        keywordDensityMin: 0.5,
        keywordDensityMax: 2.5,
        minReadability: 60,
        maxReadability: 80,
      }
    )

    // Return in the expected format for backward compatibility
    return {
      score: result.score,
      word_count: result.word_count,
      issues: result.issues,
      thresholds_used: result.thresholds_used,
      checks: result.checks, // Include checks for transparency
    }
  }

  /**
   * Auto-assign contributor based on topic and content type
   * CRITICAL: Only assigns from the 4 approved GetEducated authors
   * Per spec section 8.2.2: Uses default_author_by_article_type table first
   *
   * PUBLIC BYLINE uses REAL NAME (Tony Huffman, Kayleigh Gilbert, Sara, Charity)
   * NEVER use style proxy names (Kif, Alicia, Danny, Julia) as public bylines
   */
  async assignContributor(idea, contentType) {
    // APPROVED_AUTHORS is imported from useContributors hook
    // Contains: ['Tony Huffman', 'Kayleigh Gilbert', 'Sara', 'Charity']

    try {
      // First, check if there's a default author for this content type (per spec 8.2.2)
      // Note: This table may not exist yet - it's an optional feature
      let defaultConfig = null
      try {
        const { data, error: configError } = await supabase
          .from('default_author_by_article_type')
          .select('default_author_name')
          .eq('article_type', contentType)
          .eq('is_active', true)
          .single()

        if (!configError) {
          defaultConfig = data
        }
      } catch (e) {
        // Table doesn't exist - ignore silently, this is an optional feature
      }

      const { data: contributors, error } = await supabase
        .from('article_contributors')
        .select('*')
        .eq('is_active', true)

      if (error) throw error

      // Filter to only approved authors
      const approvedContributors = contributors.filter(c =>
        APPROVED_AUTHORS.includes(c.name)
      )

      if (approvedContributors.length === 0) {
        console.error('No approved contributors found in database!')
        throw new Error('No approved GetEducated authors available')
      }

      // If we found a default author config, give that author a huge score boost
      const defaultAuthorName = defaultConfig?.default_author_name || null
      if (defaultAuthorName) {
        console.log(`[Generation] Default author for ${contentType}: ${defaultAuthorName}`)
      }

      // Score each contributor based on topic/content type match
      const scoredContributors = approvedContributors.map(contributor => {
        let score = 0

        // FIRST PRIORITY: Default author from config gets massive boost (per spec 8.2.2)
        if (defaultAuthorName && contributor.name === defaultAuthorName) {
          score += 100 // This ensures default author wins unless there's a very strong topic match
        }

        // Check expertise areas match with idea topics
        const ideaTopics = idea.seed_topics || []
        const expertiseMatch = contributor.expertise_areas?.some(area =>
          ideaTopics.some(topic => topic.toLowerCase().includes(area.toLowerCase()))
        )
        if (expertiseMatch) score += 50

        // Check content type match
        if (contributor.content_types && contributor.content_types.includes(contentType)) {
          score += 30
        }

        // Check title for keyword matches
        const titleWords = idea.title.toLowerCase().split(' ')
        const titleMatch = contributor.expertise_areas?.some(area =>
          titleWords.some(word => word.includes(area.toLowerCase()))
        )
        if (titleMatch) score += 20

        // Topic-specific author matching for GetEducated
        const title = idea.title.toLowerCase()

        // Tony Huffman - Rankings, cost analysis, affordability
        if (contributor.name === 'Tony Huffman') {
          if (title.includes('ranking') || title.includes('best') || title.includes('top') ||
              title.includes('affordable') || title.includes('cheapest') || title.includes('cost')) {
            score += 40
          }
        }

        // Kayleigh Gilbert - Healthcare, professional licensure, social work
        if (contributor.name === 'Kayleigh Gilbert') {
          if (title.includes('lcsw') || title.includes('nursing') || title.includes('healthcare') ||
              title.includes('social work') || title.includes('hospitality') || title.includes('licensure')) {
            score += 40
          }
        }

        // Sara - Technical education, general guides, online learning basics
        if (contributor.name === 'Sara') {
          if (title.includes('technical') || title.includes('online college') || title.includes('what degree') ||
              title.includes('how to') || title.includes('guide to') || title.includes('beginner')) {
            score += 40
          }
        }

        // Charity - Teaching, education degrees, certification, career change
        if (contributor.name === 'Charity') {
          if (title.includes('teaching') || title.includes('teacher') || title.includes('education degree') ||
              title.includes('mat ') || title.includes('med ') || title.includes('certification') ||
              title.includes('career change')) {
            score += 40
          }
        }

        return { contributor, score }
      })

      scoredContributors.sort((a, b) => b.score - a.score)

      const selectedContributor = scoredContributors[0].contributor
      console.log(`[Generation] Assigned contributor: ${selectedContributor.name} (${selectedContributor.display_name})`)

      return selectedContributor

    } catch (error) {
      console.error('Contributor assignment error:', error)
      // Return first approved author as fallback (Tony Huffman)
      // CRITICAL: display_name is the PUBLIC BYLINE (real name), style_proxy is INTERNAL only
      return {
        name: 'Tony Huffman',
        display_name: 'Tony Huffman',  // PUBLIC BYLINE = Real name
        style_proxy: 'Kif',            // INTERNAL only - for AI voice matching
        expertise_areas: ['rankings', 'cost-analysis', 'online-degrees'],
        content_types: ['ranking', 'analysis', 'comparison'],
        writing_style_profile: { tone: 'authoritative', complexity_level: 'intermediate' }
      }
    }
  }

  /**
   * Assign contributor with detailed reasoning for AI transparency
   * Per Dec 18, 2025 meeting - Tony requested visibility into why authors are selected
   * @param {Object} idea - The content idea
   * @param {string} contentType - The content type
   * @returns {Object} Result with contributor and detailed reasoning
   */
  async assignContributorWithReasoning(idea, contentType) {
    try {
      const { data: contributors, error } = await supabase
        .from('article_contributors')
        .select('*')
        .eq('is_active', true)

      if (error) throw error

      // Filter to only approved authors
      const approvedContributors = contributors.filter(c =>
        APPROVED_AUTHORS.includes(c.name)
      )

      if (approvedContributors.length === 0) {
        return {
          contributor: null,
          reasoning: 'No approved contributors found in database.',
          score: 0,
          alternatives: [],
        }
      }

      const title = idea.title?.toLowerCase() || ''
      const scoredContributors = []

      for (const contributor of approvedContributors) {
        let score = 0
        const reasons = []

        // Check expertise areas match
        const ideaTopics = idea.seed_topics || []
        const expertiseMatch = contributor.expertise_areas?.filter(area =>
          ideaTopics.some(topic => topic.toLowerCase().includes(area.toLowerCase())) ||
          title.includes(area.toLowerCase())
        ) || []

        if (expertiseMatch.length > 0) {
          score += 50
          reasons.push(`Expertise match: ${expertiseMatch.join(', ')}`)
        }

        // Check content type match
        const contentTypeMatch = contributor.content_types?.includes(contentType)
        if (contentTypeMatch) {
          score += 30
          reasons.push(`Content type match: ${contentType}`)
        }

        // Topic-specific author matching for GetEducated
        // Tony Huffman - Rankings, cost analysis, affordability
        if (contributor.name === 'Tony Huffman') {
          if (title.includes('ranking') || title.includes('best') || title.includes('top') ||
              title.includes('affordable') || title.includes('cheapest') || title.includes('cost')) {
            score += 40
            reasons.push('Title contains ranking/cost keywords (Tony specialty)')
          }
        }

        // Kayleigh Gilbert - Healthcare, professional licensure, social work
        if (contributor.name === 'Kayleigh Gilbert') {
          if (title.includes('lcsw') || title.includes('nursing') || title.includes('healthcare') ||
              title.includes('social work') || title.includes('hospitality') || title.includes('licensure')) {
            score += 40
            reasons.push('Title contains healthcare/social work keywords (Kayleigh specialty)')
          }
        }

        // Sara - Technical education, general guides
        if (contributor.name === 'Sara') {
          if (title.includes('technical') || title.includes('online college') || title.includes('what degree') ||
              title.includes('how to') || title.includes('guide to') || title.includes('beginner')) {
            score += 40
            reasons.push('Title contains technical/guide keywords (Sara specialty)')
          }
        }

        // Charity - Teaching, education degrees
        if (contributor.name === 'Charity') {
          if (title.includes('teaching') || title.includes('teacher') || title.includes('education degree') ||
              title.includes('mat ') || title.includes('med ') || title.includes('certification')) {
            score += 40
            reasons.push('Title contains teaching/education keywords (Charity specialty)')
          }
        }

        scoredContributors.push({
          contributor,
          score,
          reasons,
          expertiseMatch,
          contentTypeMatch,
        })
      }

      // Sort by score descending
      scoredContributors.sort((a, b) => b.score - a.score)

      const selected = scoredContributors[0]
      const alternatives = scoredContributors.slice(1).map(c => ({
        name: c.contributor.name,
        score: c.score,
        reason: c.reasons.join('; ') || 'No specific matches',
      }))

      console.log(`[Generation] Assigned contributor: ${selected.contributor.name} (score: ${selected.score})`)

      return {
        contributor: selected.contributor,
        reasoning: selected.reasons.length > 0
          ? selected.reasons.join('. ')
          : 'Selected as default - no strong topic matches found.',
        score: selected.score,
        alternatives,
        expertiseMatch: selected.expertiseMatch,
        contentTypeMatch: selected.contentTypeMatch,
      }

    } catch (error) {
      console.error('Contributor assignment with reasoning error:', error)
      return {
        contributor: {
          name: 'Tony Huffman',
          display_name: 'Tony Huffman',
          style_proxy: 'Kif',
          expertise_areas: ['rankings', 'cost-analysis', 'online-degrees'],
        },
        reasoning: 'Error during assignment - using default (Tony Huffman).',
        score: 0,
        alternatives: [],
      }
    }
  }

  /**
   * Get relevant site articles for internal linking
   * Now uses the GetEducated catalog (geteducated_articles) for richer data
   * Falls back to legacy site_articles if GetEducated catalog is empty
   */
  async getRelevantSiteArticles(articleTitle, limit = 30, options = {}) {
    const { subjectArea, degreeLevel, excludeUrls = [], topics = [] } = options

    try {
      // FIX #1: Use subject-aware matching to prevent irrelevant links
      // (e.g., Digital Ministry linking to MBA articles)
      
      // Step 1: Detect the subject area of the article being written
      const detectedSubject = detectSubjectArea(articleTitle, topics)
      const effectiveSubject = subjectArea || detectedSubject.subject
      
      console.log(`[Generation] Subject detection: "${detectedSubject.label}" (${detectedSubject.confidence}% confidence)`)
      
      // Step 2: Fetch candidates from database (broader set for scoring)
      const { data: geArticles, error: geError } = await supabase
        .from('geteducated_articles')
        .select('id, url, title, excerpt, topics, content_type, degree_level, subject_area, times_linked_to')
        .not('content_text', 'is', null) // Only enriched articles
        .eq('is_active', true)
        .limit(limit * 3) // Fetch more to allow for filtering

      if (geError) {
        console.error('[Generation] Error fetching articles:', geError)
        throw geError
      }

      if (!geArticles || geArticles.length === 0) {
        console.log('[Generation] No articles found in GetEducated catalog')
        return []
      }

      // Step 3: Filter out excluded URLs
      const candidates = geArticles.filter(a => !excludeUrls.includes(a.url))

      // Step 4: Score using subject-aware algorithm
      // This HEAVILY penalizes unrelated subjects (e.g., Religion vs Business = -200)
      const scoredArticles = scoreArticlesForLinking(candidates, articleTitle, topics)

      // Step 5: Take top results (already filtered to remove negative scores)
      const results = scoredArticles.slice(0, 5)

      if (results.length > 0) {
        console.log(`[Generation] Selected ${results.length} relevant articles:`)
        results.forEach((a, i) => {
          console.log(`  ${i + 1}. "${a.title}" (score: ${a.relevanceScore}, subject: ${a.articleSubject || 'unknown'})`)
          if (a.scoringReasons?.length > 0) {
            console.log(`     Reasons: ${a.scoringReasons.slice(0, 3).join('; ')}`)
          }
        })

        // Log reasoning for debugging
        this.logReasoning('internal_link_selection', {
          detected_subject: detectedSubject.label,
          subject_confidence: detectedSubject.confidence,
          candidates_fetched: geArticles.length,
          candidates_after_filter: candidates.length,
          results_selected: results.length,
          top_results: results.map(a => ({
            title: a.title,
            url: a.url,
            score: a.relevanceScore,
            subject: a.articleSubject,
            match_type: a.subjectMatch,
            reasons: a.scoringReasons?.slice(0, 3),
          })),
        })

        return results.map(a => ({
          id: a.id,
          url: a.url,
          title: a.title,
          excerpt: a.excerpt,
          topics: a.topics,
          subject_area: a.subject_area,
          relevanceScore: a.relevanceScore,
        }))
      }

      // Fallback if no good matches found
      console.warn('[Generation] No subject-relevant articles found, falling back to basic matching')
      
      // Final fallback: Legacy site_articles table with basic scoring
      const { data: legacyArticles, error: legacyError } = await supabase
        .from('site_articles')
        .select('*')
        .order('times_linked_to', { ascending: true })
        .limit(limit)

      if (legacyError) throw legacyError

      const titleWords = articleTitle.toLowerCase().split(' ').filter(w => w.length > 3)
      
      const scoredLegacy = (legacyArticles || []).map(article => {
        let score = 0
        const articleTitleWords = article.title.toLowerCase().split(' ')
        const commonWords = titleWords.filter(word =>
          articleTitleWords.some(aw => aw.includes(word))
        )
        score += commonWords.length * 10

        if (article.topics && article.topics.length > 0) {
          const topicMatches = article.topics.filter(topic =>
            titleWords.some(word => topic.toLowerCase().includes(word))
          )
          score += topicMatches.length * 15
        }

        return { article, score }
      })

      scoredLegacy.sort((a, b) => b.score - a.score)

      return scoredLegacy
        .filter(a => a.score > 0)
        .slice(0, 5)
        .map(a => a.article)

    } catch (error) {
      console.error('Error fetching site articles:', error)
      return []
    }
  }

  /**
   * Increment link count for articles that were linked to
   * Updates the GetEducated catalog tracking
   */
  async incrementArticleLinkCounts(articleUrls) {
    for (const url of articleUrls) {
      try {
        // Try the SQL function first
        await supabase.rpc('increment_article_link_count', { article_url: url })
      } catch (error) {
        // Fallback to manual increment
        const { data } = await supabase
          .from('geteducated_articles')
          .select('id, times_linked_to')
          .eq('url', url)
          .single()

        if (data) {
          await supabase
            .from('geteducated_articles')
            .update({ times_linked_to: (data.times_linked_to || 0) + 1 })
            .eq('id', data.id)
        }
      }
    }
  }

  /**
   * Add internal links to content using Claude
   */
  async addInternalLinksToContent(content, siteArticles) {
    const prompt = `Add 3-5 contextual internal links to this article content.

ARTICLE CONTENT:
${content}

AVAILABLE ARTICLES TO LINK TO:
${siteArticles.map(a => `- [${a.title}](${a.url})`).join('\n')}

=== CRITICAL HTML FORMATTING RULES ===

Your output MUST be properly formatted HTML with:
1. <h2> tags for major section headings
2. <h3> tags for subsections
3. <p> tags wrapping EVERY paragraph of text
4. <ul> and <li> tags for bulleted lists
5. <ol> and <li> tags for numbered lists
6. <strong> or <b> tags for bold text
7. <a href="..."> tags for any links

NEVER output plain text without HTML tags. Every paragraph MUST be wrapped in <p> tags.

=== END HTML FORMATTING RULES ===

INSTRUCTIONS:
1. Add links where genuinely relevant
2. Use natural anchor text
3. Distribute throughout article
4. Use HTML format: <a href="URL">anchor text</a>
5. Aim for 3-5 links total
6. Preserve all existing HTML formatting

OUTPUT ONLY THE UPDATED HTML CONTENT with links added.`

    try {
      const linkedContent = await this.claude.chat([
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.7,
        max_tokens: 4500,
      })

      return linkedContent

    } catch (error) {
      console.error('Error adding internal links:', error)
      return content
    }
  }

  /**
   * Validate and fix HTML formatting issues
   * Ensures content has proper <p> tags around paragraphs
   * This catches cases where AI generates plain text despite instructions
   * @param {string} content - HTML content to validate/fix
   * @returns {string} - Fixed HTML content
   */
  ensureProperHtmlFormatting(content) {
    if (!content) return content

    // Check if content already has proper HTML structure
    const hasParagraphTags = /<p[^>]*>/i.test(content)
    const hasHeadingTags = /<h[23][^>]*>/i.test(content)

    // If content has HTML structure, just do minor cleanup
    if (hasParagraphTags && hasHeadingTags) {
      // Ensure there's proper spacing between elements
      return content
        .replace(/(<\/h[23]>)(?!\s*<)/gi, '$1\n\n')  // Add newlines after headings
        .replace(/(<\/p>)(?!\s*<)/gi, '$1\n\n')      // Add newlines after paragraphs
        .replace(/(<\/ul>)(?!\s*<)/gi, '$1\n\n')     // Add newlines after lists
        .replace(/(<\/ol>)(?!\s*<)/gi, '$1\n\n')     // Add newlines after lists
    }

    // Content is missing proper HTML - attempt to fix it
    console.warn('[Generation] Content missing proper HTML formatting - attempting to fix')

    let fixed = content

    // Split by obvious paragraph breaks (multiple newlines or <br><br>)
    const paragraphSplitters = /\n\s*\n|<br\s*\/?>\s*<br\s*\/?>/gi

    // Split content into segments
    let segments = fixed.split(paragraphSplitters)

    // Process each segment
    const processedSegments = segments.map(segment => {
      segment = segment.trim()
      if (!segment) return ''

      // If segment starts with heading-like text, wrap appropriately
      // Check if it looks like a heading (short, no ending punctuation, potentially bold)
      const isLikelyHeading = segment.length < 100 &&
        !segment.endsWith('.') &&
        !segment.endsWith('?') &&
        !segment.endsWith('!')

      // If already wrapped in tags, leave as is
      if (/^<(h[123456]|p|ul|ol|div)/i.test(segment)) {
        return segment
      }

      // If it looks like a list (starts with bullets or numbers)
      if (/^[\-\*•]\s/.test(segment)) {
        const listItems = segment.split(/[\n\r]+/).filter(item => item.trim())
        const lis = listItems.map(item =>
          `<li>${item.replace(/^[\-\*•]\s*/, '').trim()}</li>`
        ).join('\n')
        return `<ul>\n${lis}\n</ul>`
      }

      // If it looks like a numbered list
      if (/^\d+[\.\)]\s/.test(segment)) {
        const listItems = segment.split(/[\n\r]+/).filter(item => item.trim())
        const lis = listItems.map(item =>
          `<li>${item.replace(/^\d+[\.\)]\s*/, '').trim()}</li>`
        ).join('\n')
        return `<ol>\n${lis}\n</ol>`
      }

      // If it's short and looks like a heading
      if (isLikelyHeading) {
        // Remove any bold markers and wrap in h2 or h3
        const cleanText = segment.replace(/\*\*/g, '').trim()
        return `<h3>${cleanText}</h3>`
      }

      // Default: wrap in paragraph tags
      return `<p>${segment}</p>`
    })

    // Join with proper spacing
    fixed = processedSegments.filter(s => s).join('\n\n')

    console.log('[Generation] HTML formatting fixed')
    return fixed
  }

  /**
   * Generate URL slug from title
   */
  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 60)
  }

  /**
   * Generate a unique slug by checking for existing slugs and appending suffix if needed
   */
  async generateUniqueSlug(baseSlug) {
    // Check if the base slug exists
    const { data: existing } = await supabase
      .from('articles')
      .select('slug')
      .like('slug', `${baseSlug}%`)

    if (!existing || existing.length === 0) {
      return baseSlug
    }

    // Find existing slugs that match our pattern
    const existingSlugs = new Set(existing.map(a => a.slug))

    // If base slug doesn't exist, use it
    if (!existingSlugs.has(baseSlug)) {
      return baseSlug
    }

    // Find the next available suffix
    let suffix = 2
    while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
      suffix++
    }

    return `${baseSlug}-${suffix}`
  }

  /**
   * Save generated article to database
   */
  async saveArticle(articleData, ideaId, userId) {
    try {
      // Ensure unique slug before saving
      if (articleData.slug) {
        articleData.slug = await this.generateUniqueSlug(articleData.slug)
      }

      const { data, error } = await supabase
        .from('articles')
        .insert({
          ...articleData,
          user_id: userId,
        })
        .select()
        .single()

      if (error) throw error

      // Update the idea
      await supabase
        .from('content_ideas')
        .update({ article_id: data.id, status: 'completed' })
        .eq('id', ideaId)

      return data

    } catch (error) {
      console.error('Error saving article:', error)
      throw error
    }
  }

  /**
   * Humanize existing content using StealthGPT (primary) or Claude (fallback)
   * @param {string} content - The content to humanize
   * @param {Object} options - Options including writingStyle, contributorName, useStealthGpt
   * @returns {string} - Humanized content
   */
  async humanizeContent(content, options = {}) {
    const { writingStyle, contributorName, useStealthGpt = true } = options

    // Try StealthGPT first if enabled and configured
    if (useStealthGpt && this.humanizationProvider === 'stealthgpt' && this.stealthGpt.isConfigured()) {
      try {
        console.log('[Generation] Humanizing with StealthGPT...')
        const humanizedContent = await this.stealthGpt.humanizeLongContent(content, {
          tone: this.stealthGptSettings.tone,
          mode: this.stealthGptSettings.mode,
          detector: this.stealthGptSettings.detector,
        })
        return humanizedContent
      } catch (error) {
        console.warn('[Generation] StealthGPT failed, falling back to Claude:', error.message)
      }
    }

    // Fallback to Claude
    const prompt = `Humanize this content to sound more natural and engaging.

${writingStyle ? `WRITING STYLE: ${writingStyle}` : ''}
${contributorName ? `AUTHOR PERSONA: ${contributorName}` : ''}

CURRENT CONTENT:
${content}

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
1. Maintain the core information and structure
2. Make the language more conversational and engaging
3. Vary sentence length and structure for better flow
4. Remove any robotic or formulaic phrases
5. Add personality while keeping professionalism
6. Keep all HTML formatting intact
7. Do NOT add new sections or significantly expand content

OUTPUT ONLY THE HUMANIZED HTML CONTENT.`

    try {
      const humanizedContent = await this.claude.chat([
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.9,
        max_tokens: 4500,
      })

      return humanizedContent
    } catch (error) {
      console.error('Error humanizing content:', error)
      throw error
    }
  }

  /**
   * Generate content ideas from a topic
   * @param {string} topic - The topic to generate ideas for
   * @param {number} count - Number of ideas to generate
   * @returns {Array} - Array of idea objects
   */
  async generateIdeas(topic, count = 5) {
    try {
      const ideas = await this.grok.generateIdeas(topic, count)
      return ideas
    } catch (error) {
      console.error('Error generating ideas:', error)
      throw error
    }
  }

  /**
   * Helper to update progress
   */
  updateProgress(callback, message, percentage) {
    if (callback) {
      callback({ message, percentage })
    }
    console.log(`[${percentage}%] ${message}`)
  }

  // ========================================
  // AUTOMATIC PIPELINE METHODS
  // ========================================

  /**
   * Run the full automatic pipeline:
   * 1. Discover new ideas from sources
   * 2. Filter duplicates and validate
   * 3. Generate articles for each idea
   * 4. Quality check and auto-fix
   * 5. Save to database
   */
  async runAutoPipeline(options = {}, onProgress, onComplete) {
    const {
      sources = ['reddit', 'news', 'trends', 'general'],
      customTopic = '',
      maxIdeas = 10,
      generateImmediately = true,
      userId,
      niche = 'higher education, online degrees, career development',
    } = options

    if (this.isProcessing) {
      throw new Error('Pipeline already running')
    }

    this.isProcessing = true
    const results = {
      discoveredIdeas: [],
      generatedArticles: [],
      failedIdeas: [],
      skippedIdeas: [],
    }

    try {
      // STAGE 1: Discover Ideas
      this.updateProgress(onProgress, 'Discovering new content ideas...', 5)

      const existingIdeas = await this.getExistingIdeas(userId)
      const existingTitles = existingIdeas.map(i => i.title)

      // Use monetization-first discovery (returns { ideas, rejected, stats })
      const discoveryResult = await this.ideaDiscovery.discoverIdeas({
        sources,
        customTopic,
        existingTopics: existingTitles,
        strictMonetization: true, // Filter out non-monetizable ideas
        minMonetizationScore: 25,
      })

      const discoveredIdeas = discoveryResult.ideas || []

      // Filter out duplicates using similarity check
      const uniqueIdeas = this.ideaDiscovery.filterDuplicates(
        discoveredIdeas,
        existingTitles,
        0.7 // 70% similarity threshold
      )

      results.discoveredIdeas = uniqueIdeas.slice(0, maxIdeas)
      results.skippedIdeas = [
        ...discoveredIdeas.filter(i => !uniqueIdeas.includes(i)),
        ...(discoveryResult.rejected || []) // Include rejected low-monetization ideas
      ]

      this.updateProgress(
        onProgress,
        `Found ${results.discoveredIdeas.length} unique ideas`,
        15
      )

      // STAGE 2: Save Ideas to Database
      const savedIdeas = []
      for (const idea of results.discoveredIdeas) {
        try {
          const savedIdea = await this.saveIdea(idea, userId)
          savedIdeas.push(savedIdea)
        } catch (error) {
          console.error('Failed to save idea:', error)
        }
      }

      this.updateProgress(onProgress, `Saved ${savedIdeas.length} ideas`, 20)

      // STAGE 3: Generate Articles (if immediate mode)
      if (generateImmediately && savedIdeas.length > 0) {
        const progressPerIdea = 75 / savedIdeas.length

        for (let i = 0; i < savedIdeas.length; i++) {
          const idea = savedIdeas[i]
          const baseProgress = 20 + (i * progressPerIdea)

          try {
            this.updateProgress(
              onProgress,
              `Generating article ${i + 1}/${savedIdeas.length}: ${idea.title.substring(0, 40)}...`,
              baseProgress
            )

            // Generate the article
            const articleData = await this.generateArticleComplete(
              idea,
              {
                contentType: idea.content_type || 'guide',
                targetWordCount: 2000,
                autoAssignContributor: true,
                addInternalLinks: true,
                autoFix: true,
                maxFixAttempts: 3,
                qualityThreshold: 85,
              },
              (progress) => {
                const scaledProgress = baseProgress + (progress.percentage / 100 * progressPerIdea)
                this.updateProgress(onProgress, progress.message, scaledProgress)
              }
            )

            // Save article
            const savedArticle = await this.saveArticle(articleData, idea.id, userId)
            results.generatedArticles.push(savedArticle)

            this.updateProgress(
              onProgress,
              `✓ Completed article ${i + 1}/${savedIdeas.length}`,
              baseProgress + progressPerIdea
            )

          } catch (error) {
            console.error(`Failed to generate article for idea: ${idea.title}`, error)
            results.failedIdeas.push({ idea, error: error.message })
          }
        }
      }

      // STAGE 4: Finalize
      this.updateProgress(onProgress, 'Pipeline complete!', 100)

      if (onComplete) {
        onComplete(results)
      }

      return results

    } catch (error) {
      console.error('Auto pipeline error:', error)
      throw error
    } finally {
      this.isProcessing = false
      this.currentTask = null
    }
  }

  /**
   * Process a batch of ideas in sequence
   */
  async processBatch(ideaIds, userId, onProgress) {
    if (this.isProcessing) {
      throw new Error('Already processing')
    }

    this.isProcessing = true
    const results = {
      successful: [],
      failed: [],
    }

    try {
      // Fetch the ideas
      const { data: ideas, error } = await supabase
        .from('content_ideas')
        .select('*')
        .in('id', ideaIds)
        .eq('status', 'approved')

      if (error) throw error

      const progressPerIdea = 100 / ideas.length

      for (let i = 0; i < ideas.length; i++) {
        const idea = ideas[i]
        const baseProgress = i * progressPerIdea

        try {
          this.updateProgress(
            onProgress,
            `Processing ${i + 1}/${ideas.length}: ${idea.title.substring(0, 40)}...`,
            baseProgress
          )

          const articleData = await this.generateArticleComplete(
            idea,
            {
              contentType: idea.content_type || 'guide',
              targetWordCount: 2000,
              autoAssignContributor: true,
              addInternalLinks: true,
              autoFix: true,
            },
            (progress) => {
              const scaled = baseProgress + (progress.percentage / 100 * progressPerIdea)
              this.updateProgress(onProgress, progress.message, scaled)
            }
          )

          const savedArticle = await this.saveArticle(articleData, idea.id, userId)
          results.successful.push(savedArticle)

        } catch (error) {
          console.error(`Batch processing failed for: ${idea.title}`, error)
          results.failed.push({ idea, error: error.message })
        }
      }

      return results

    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Add ideas to the processing queue
   */
  async queueIdeas(ideaIds, userId) {
    for (const ideaId of ideaIds) {
      // Add to generation_queue table
      await supabase
        .from('generation_queue')
        .insert({
          idea_id: ideaId,
          user_id: userId,
          status: 'pending',
          priority: 5,
        })
    }
  }

  /**
   * Process the next item in the queue
   */
  async processNextInQueue(userId, onProgress) {
    // Get next pending item
    const { data: queueItem, error } = await supabase
      .from('generation_queue')
      .select('*, content_ideas(*)')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (error || !queueItem) {
      return null
    }

    // Mark as processing
    await supabase
      .from('generation_queue')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', queueItem.id)

    try {
      const idea = queueItem.content_ideas
      const articleData = await this.generateArticleComplete(idea, {
        contentType: idea.content_type || 'guide',
        autoFix: true,
      }, onProgress)

      const savedArticle = await this.saveArticle(articleData, idea.id, userId)

      // Mark as completed
      await supabase
        .from('generation_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          article_id: savedArticle.id,
        })
        .eq('id', queueItem.id)

      return savedArticle

    } catch (error) {
      // Mark as failed
      await supabase
        .from('generation_queue')
        .update({
          status: 'failed',
          error_message: error.message,
        })
        .eq('id', queueItem.id)

      throw error
    }
  }

  /**
   * Get existing ideas for duplicate checking
   */
  async getExistingIdeas(userId) {
    const { data, error } = await supabase
      .from('content_ideas')
      .select('title, description')
      .eq('user_id', userId)

    if (error) {
      console.error('Error fetching existing ideas:', error)
      return []
    }

    return data || []
  }

  /**
   * Save a discovered idea to the database
   */
  async saveIdea(idea, userId) {
    const { data, error } = await supabase
      .from('content_ideas')
      .insert({
        title: idea.title,
        description: idea.description,
        content_type: idea.content_type,
        target_keywords: idea.target_keywords,
        search_intent: idea.search_intent,
        source: idea.source,
        trending_reason: idea.trending_reason,
        status: 'approved', // Auto-approve discovered ideas
        user_id: userId,
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get pipeline status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      currentTask: this.currentTask,
      queueLength: this.processingQueue.length,
    }
  }

  // ========================================
  // COMPLIANCE UPDATE (Article Update Button)
  // Per Dec 22, 2025 meeting - automatic compliance pass
  // Updates shortcodes, monetization, internal links, formatting
  // WITHOUT rewriting prose content
  // ========================================

  /**
   * Run a compliance update on existing article content
   * Fixes shortcodes, monetization, internal links, and formatting
   * Does NOT rewrite or humanize the prose content
   *
   * @param {Object} article - The article to update
   * @param {Object} options - Update options
   * @returns {Object} - Updated article data
   */
  async runComplianceUpdate(article, options = {}) {
    const {
      fixShortcodes = true,
      fixMonetization = true,
      fixInternalLinks = true,
      fixFormatting = true,
      onProgress = null,
    } = options

    try {
      // Initialize reasoning for this update
      this.initReasoning()
      this.logReasoning('compliance_update', {
        article_id: article.id,
        article_title: article.title,
        options: { fixShortcodes, fixMonetization, fixInternalLinks, fixFormatting },
        reasoning: 'Running compliance update to align article with current rules.',
      })

      let content = article.content
      const updates = {
        shortcodes_fixed: 0,
        monetization_updated: false,
        internal_links_added: 0,
        formatting_fixed: false,
      }

      // Load current content rules
      const contentRules = await this.loadContentRules()
      this.updateProgress(onProgress, 'Loading current content rules...', 10)

      // STEP 1: Fix HTML formatting issues
      if (fixFormatting) {
        this.updateProgress(onProgress, 'Fixing HTML formatting...', 20)
        const originalContent = content
        content = this.ensureProperHtmlFormatting(content)
        updates.formatting_fixed = content !== originalContent

        if (updates.formatting_fixed) {
          this.logReasoning('formatting_fix', {
            action: 'Fixed HTML formatting',
            reasoning: 'Ensured proper <p>, <h2>, <h3> tags and list formatting.',
          })
        }
      }

      // STEP 2: Fix/update shortcodes
      if (fixShortcodes) {
        this.updateProgress(onProgress, 'Validating and fixing shortcodes...', 35)
        const shortcodeResult = await this.validateAndFixShortcodes(content, contentRules)
        content = shortcodeResult.content
        updates.shortcodes_fixed = shortcodeResult.fixCount

        if (shortcodeResult.fixCount > 0) {
          this.logReasoning('shortcode_fix', {
            fixes_applied: shortcodeResult.fixCount,
            issues_found: shortcodeResult.issues,
            reasoning: `Fixed ${shortcodeResult.fixCount} shortcode issues.`,
          })
        }
      }

      // STEP 3: Update monetization if category info available
      if (fixMonetization && article.category_id) {
        this.updateProgress(onProgress, 'Updating monetization shortcodes...', 50)
        try {
          const monetizationResult = await this.monetizationEngine.generateMonetization({
            articleId: article.id,
            categoryId: article.category_id,
            concentrationId: article.concentration_id,
            degreeLevelCode: article.degree_level_code,
            articleType: article.content_type || 'default',
          })

          if (monetizationResult.success && monetizationResult.slots.length > 0) {
            // Remove old monetization shortcodes and insert new ones
            content = this.replaceMonetizationShortcodes(content, monetizationResult.slots)
            updates.monetization_updated = true

            this.logReasoning('monetization_update', {
              slots_generated: monetizationResult.slots.length,
              total_programs: monetizationResult.totalProgramsSelected,
              reasoning: `Updated monetization with ${monetizationResult.slots.length} slots.`,
            })
          }
        } catch (monetizationError) {
          console.warn('[Compliance] Monetization update failed:', monetizationError.message)
          this.logReasoningWarning('monetization_error', monetizationError.message, 'low')
        }
      }

      // STEP 4: Add missing internal links
      if (fixInternalLinks) {
        this.updateProgress(onProgress, 'Checking internal links...', 65)

        // Count existing internal links
        const existingLinks = (content.match(/<a href="[^"]*geteducated\.com/gi) || []).length
        const minLinks = contentRules?.guidelines?.links?.internal_links_min || 3

        if (existingLinks < minLinks) {
          // FIX #1: Pass topics for subject-aware matching
          const siteArticles = await this.getRelevantSiteArticles(article.title, 30, {
            topics: article.topics || article.seed_topics || [],
          })
          if (siteArticles.length >= 2) {
            const linksToAdd = minLinks - existingLinks
            content = await this.addInternalLinksToContentPreserving(content, siteArticles, linksToAdd)
            updates.internal_links_added = linksToAdd

            this.logReasoning('internal_links_update', {
              existing_links: existingLinks,
              links_added: linksToAdd,
              reasoning: `Added ${linksToAdd} internal links to meet minimum requirement.`,
            })
          }
        }
      }

      this.updateProgress(onProgress, 'Calculating updated quality score...', 85)

      // Recalculate quality metrics
      const qualityThresholds = this.getQualityThresholds(contentRules)
      const metrics = this.calculateQualityMetrics(content, article.faqs, qualityThresholds)

      this.updateProgress(onProgress, 'Compliance update complete!', 100)

      // Attach reasoning to result
      const reasoning = this.getReasoningOutput()

      return {
        success: true,
        content,
        updates,
        quality_score: metrics.score,
        word_count: metrics.word_count,
        quality_issues: metrics.issues,
        ai_reasoning: reasoning,
      }

    } catch (error) {
      console.error('[Compliance] Update failed:', error)
      throw error
    }
  }

  /**
   * Validate and fix shortcodes in content
   * @param {string} content - Article content
   * @param {Object} contentRules - Content rules config
   * @returns {Object} - { content, fixCount, issues }
   */
  async validateAndFixShortcodes(content, contentRules) {
    const issues = []
    let fixCount = 0
    let fixedContent = content

    // Get blocked/legacy shortcodes from rules
    const blockedShortcodes = contentRules?.shortcode_rules?.legacy_shortcodes_blocked || []
    const allowedShortcodes = contentRules?.shortcode_rules?.allowed_shortcodes || [
      'ge_cta', 'ge_internal_link', 'ge_external_cited', 'degree_table', 'degree_offer'
    ]

    // Find all shortcodes in content
    const shortcodeRegex = /\[([a-z_]+)([^\]]*)\]/gi
    let match

    while ((match = shortcodeRegex.exec(content)) !== null) {
      const shortcodeName = match[1].toLowerCase()

      // Check for blocked/legacy shortcodes
      if (blockedShortcodes.includes(shortcodeName)) {
        issues.push({
          type: 'legacy_shortcode',
          shortcode: match[0],
          message: `Legacy shortcode [${shortcodeName}] should be replaced`
        })
        // Remove legacy shortcode
        fixedContent = fixedContent.replace(match[0], '')
        fixCount++
      }

      // Check for malformed shortcodes (missing required attributes)
      if (shortcodeName === 'ge_cta') {
        const hasCategory = /category=/.test(match[0])
        const hasLevel = /level=/.test(match[0])

        if (!hasCategory || !hasLevel) {
          issues.push({
            type: 'incomplete_shortcode',
            shortcode: match[0],
            message: 'ge_cta shortcode missing required attributes'
          })
        }
      }
    }

    // Check for raw affiliate URLs that should be shortcodes
    const affiliateUrlPattern = /href="https?:\/\/[^"]*(?:commission|affiliate|tracking|click)[^"]*"/gi
    const affiliateMatches = content.match(affiliateUrlPattern) || []

    if (affiliateMatches.length > 0) {
      issues.push({
        type: 'raw_affiliate_url',
        count: affiliateMatches.length,
        message: `Found ${affiliateMatches.length} raw affiliate URLs that should use shortcodes`
      })
    }

    return {
      content: fixedContent,
      fixCount,
      issues,
    }
  }

  /**
   * Replace monetization shortcodes with updated versions
   * @param {string} content - Article content
   * @param {Array} slots - New monetization slots
   * @returns {string} - Updated content
   */
  replaceMonetizationShortcodes(content, slots) {
    let updatedContent = content

    // Remove existing monetization shortcodes
    const monetizationShortcodes = /\[(?:ge_cta|degree_table|degree_offer)[^\]]*\]/gi
    updatedContent = updatedContent.replace(monetizationShortcodes, '')

    // Clean up any double newlines left behind
    updatedContent = updatedContent.replace(/\n{3,}/g, '\n\n')

    // Insert new shortcodes at designated positions
    for (const slot of slots) {
      const positionMap = {
        'after_intro': 'after_intro',
        'mid_article': 'mid_content',
        'near_conclusion': 'pre_conclusion',
      }
      const insertPosition = positionMap[slot.name] || 'after_intro'
      updatedContent = insertShortcodeInContent(updatedContent, slot.shortcode, insertPosition)
    }

    return updatedContent
  }

  /**
   * Add internal links to content while preserving existing structure
   * More conservative than full rewrite - only adds links where natural
   * @param {string} content - Article content
   * @param {Array} siteArticles - Available articles to link to
   * @param {number} linksToAdd - Target number of links to add
   * @returns {string} - Updated content
   */
  async addInternalLinksToContentPreserving(content, siteArticles, linksToAdd = 3) {
    const prompt = `Add ${linksToAdd} contextual internal links to this article.

IMPORTANT: Only add links where they naturally fit. Do NOT rewrite any prose.

ARTICLE CONTENT:
${content}

AVAILABLE ARTICLES TO LINK TO (pick ${linksToAdd} most relevant):
${siteArticles.slice(0, 10).map(a => `- [${a.title}](${a.url})`).join('\n')}

RULES:
1. Add EXACTLY ${linksToAdd} links, no more, no fewer
2. Use natural anchor text (1-5 words from existing text)
3. Do NOT change any other text or structure
4. Use HTML format: <a href="URL">existing text</a>
5. Choose link placements that make sense contextually
6. Distribute links throughout the article

OUTPUT ONLY THE UPDATED CONTENT with the ${linksToAdd} new links added.
Do not include any explanation or commentary.`

    try {
      const linkedContent = await this.claude.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3, // Lower temperature for more conservative changes
        max_tokens: 4500,
      })

      return linkedContent

    } catch (error) {
      console.error('[Compliance] Error adding internal links:', error)
      return content // Return original on error
    }
  }

  /**
   * Stop the pipeline
   */
  stop() {
    this.isProcessing = false
    this.currentTask = null
  }

  // ========================================
  // HUMANIZATION CONFIGURATION
  // ========================================

  /**
   * Set the humanization provider
   * @param {string} provider - 'stealthgpt' or 'claude'
   */
  setHumanizationProvider(provider) {
    if (!['stealthgpt', 'claude'].includes(provider)) {
      throw new Error('Invalid humanization provider. Use "stealthgpt" or "claude"')
    }
    this.humanizationProvider = provider
    console.log(`[Generation] Humanization provider set to: ${provider}`)
  }

  /**
   * Get current humanization provider
   */
  getHumanizationProvider() {
    return this.humanizationProvider
  }

  /**
   * Configure StealthGPT settings
   * @param {Object} settings - StealthGPT configuration
   */
  setStealthGptSettings(settings = {}) {
    const { tone, mode, detector, business, doublePassing } = settings

    if (tone && ['Standard', 'HighSchool', 'College', 'PhD'].includes(tone)) {
      this.stealthGptSettings.tone = tone
    }

    if (mode && ['Low', 'Medium', 'High'].includes(mode)) {
      this.stealthGptSettings.mode = mode
    }

    if (detector && ['gptzero', 'turnitin'].includes(detector)) {
      this.stealthGptSettings.detector = detector
    }

    if (typeof business === 'boolean') {
      this.stealthGptSettings.business = business
    }

    if (typeof doublePassing === 'boolean') {
      this.stealthGptSettings.doublePassing = doublePassing
    }

    console.log('[Generation] StealthGPT settings updated:', this.stealthGptSettings)
  }

  /**
   * Get current StealthGPT settings
   */
  getStealthGptSettings() {
    return { ...this.stealthGptSettings }
  }

  /**
   * Check if StealthGPT is available
   */
  isStealthGptAvailable() {
    return this.stealthGpt.isConfigured()
  }

  /**
   * Get available humanization options for UI
   */
  static getHumanizationOptions() {
    return {
      providers: [
        { value: 'stealthgpt', label: 'StealthGPT', description: 'Specialized AI detection bypass' },
        { value: 'claude', label: 'Claude', description: 'Natural humanization with contributor voice' },
      ],
      tones: StealthGptClient.getToneOptions(),
      modes: StealthGptClient.getModeOptions(),
      detectors: StealthGptClient.getDetectorOptions(),
    }
  }

  // ========================================
  // AI REVISION FEEDBACK INTEGRATION
  // ========================================

  /**
   * Fetch past successful AI revisions to learn from
   * Per spec section 8.4: AI Training & Revision Log
   * @param {Object} options - Filter options
   * @returns {Array} Array of revision patterns
   */
  async getTrainingPatterns(options = {}) {
    const {
      limit = 20,
      contentType = null,
      minQualityScore = 80,
    } = options

    try {
      // Query revisions that are marked for training inclusion
      let query = supabase
        .from('ai_revisions')
        .select(`
          id,
          previous_version,
          revised_version,
          comments_snapshot,
          revision_type,
          created_at,
          articles(
            title,
            content_type,
            quality_score,
            contributor_name
          )
        `)
        .eq('include_in_training', true)
        .order('created_at', { ascending: false })
        .limit(limit)

      // Filter by content type if specified
      if (contentType) {
        query = query.eq('articles.content_type', contentType)
      }

      const { data, error } = await query

      if (error) {
        console.error('[Generation] Error fetching training patterns:', error)
        return []
      }

      // Filter by quality score and extract useful patterns
      const validRevisions = (data || []).filter(r =>
        r.articles && r.articles.quality_score >= minQualityScore
      )

      // Extract learning patterns from revisions
      const patterns = validRevisions.map(r => ({
        type: r.revision_type,
        contentType: r.articles.content_type,
        beforeSnippet: this.extractSnippet(r.previous_version, 200),
        afterSnippet: this.extractSnippet(r.revised_version, 200),
        feedback: r.comments_snapshot,
        contributor: r.articles.contributor_name,
      }))

      console.log(`[Generation] Loaded ${patterns.length} training patterns`)
      return patterns

    } catch (error) {
      console.error('[Generation] Error getting training patterns:', error)
      return []
    }
  }

  /**
   * Extract a representative snippet from content
   */
  extractSnippet(content, maxLength = 200) {
    if (!content) return ''
    // Strip HTML and get first N characters
    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '')
  }

  /**
   * Format training patterns for inclusion in AI prompts
   * @param {Array} patterns - Array of training patterns
   * @returns {string} Formatted string for prompt injection
   */
  formatPatternsForPrompt(patterns) {
    if (!patterns || patterns.length === 0) {
      return ''
    }

    let formatted = '\n\n=== LEARNED PATTERNS FROM PAST REVISIONS ===\n'
    formatted += 'The following patterns represent successful revisions. Apply similar improvements:\n\n'

    // Group by revision type for clarity
    const byType = {}
    patterns.forEach(p => {
      const type = p.type || 'general'
      if (!byType[type]) byType[type] = []
      byType[type].push(p)
    })

    for (const [type, typePatterns] of Object.entries(byType)) {
      formatted += `\n--- ${type.toUpperCase()} IMPROVEMENTS ---\n`

      typePatterns.slice(0, 3).forEach((p, i) => {
        formatted += `\nExample ${i + 1}:\n`
        if (p.beforeSnippet) {
          formatted += `BEFORE: "${p.beforeSnippet}"\n`
        }
        if (p.afterSnippet) {
          formatted += `AFTER: "${p.afterSnippet}"\n`
        }
        if (p.feedback && p.feedback.length > 0) {
          formatted += `FEEDBACK: ${JSON.stringify(p.feedback)}\n`
        }
      })
    }

    formatted += '\n=== END LEARNED PATTERNS ===\n'
    formatted += '\nApply these improvement patterns where appropriate.\n'

    return formatted
  }

  /**
   * Save a revision to the training data
   * @param {string} articleId - Article ID
   * @param {string} previousContent - Content before revision
   * @param {string} revisedContent - Content after revision
   * @param {Object} options - Additional options
   */
  async saveRevisionForTraining(articleId, previousContent, revisedContent, options = {}) {
    const {
      commentsSnapshot = [],
      revisionType = 'quality_fix',
      modelUsed = 'claude-sonnet-4',
      includeInTraining = true,
      userId = null,
    } = options

    try {
      const { data, error } = await supabase
        .from('ai_revisions')
        .insert({
          article_id: articleId,
          previous_version: previousContent,
          revised_version: revisedContent,
          comments_snapshot: commentsSnapshot,
          revision_type: revisionType,
          model_used: modelUsed,
          include_in_training: includeInTraining,
          triggered_by_user: userId,
        })
        .select()
        .single()

      if (error) throw error

      console.log(`[Generation] Saved revision for training: ${data.id}`)
      return data

    } catch (error) {
      console.error('[Generation] Error saving revision:', error)
      return null
    }
  }

  /**
   * Enhanced auto-fix with training pattern injection
   * This version uses past revisions to improve fix quality
   */
  async autoFixWithLearning(content, issues, options = {}) {
    const { articleId, contentType, contributor } = options

    // Fetch relevant training patterns
    const patterns = await this.getTrainingPatterns({
      contentType,
      limit: 10,
      minQualityScore: 80,
    })

    const patternContext = this.formatPatternsForPrompt(patterns)

    // Build enhanced prompt with training patterns
    const issueDescriptions = issues.map(i => `- ${i.type}: ${i.severity}`).join('\n')

    const prompt = `Fix the following quality issues in this article content.

QUALITY ISSUES TO FIX:
${issueDescriptions}

${patternContext}

CURRENT CONTENT:
${content}

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
1. Fix all listed quality issues
2. Apply learned patterns from successful revisions
3. Maintain the article structure and voice
4. Keep all HTML formatting intact and ensure all new content is properly HTML formatted
5. Do not add unrelated content

OUTPUT ONLY THE FIXED HTML CONTENT.`

    try {
      const fixedContent = await this.claude.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.7,
        max_tokens: 4500,
      })

      // Save this revision for future training
      if (articleId) {
        await this.saveRevisionForTraining(articleId, content, fixedContent, {
          commentsSnapshot: issues,
          revisionType: 'auto_fix',
          includeInTraining: true,
        })
      }

      return fixedContent

    } catch (error) {
      console.error('[Generation] Error in autoFixWithLearning:', error)
      return content // Return original on error
    }
  }

  // ========================================
  // REFRESH WITH RULES
  // Per Dec 22, 2025 meeting: "Update" button to re-apply current rules
  // ========================================

  /**
   * Refresh an article with current content rules
   * Re-applies shortcodes, internal links, and content rules without regenerating
   * @param {Object} article - The article to refresh
   * @returns {Object} Updated article with refreshed content
   */
  async refreshWithRules(article) {
    console.log('[Generation] Refreshing article with current rules:', article.id)

    // Load fresh content rules
    await this.loadContentRules()

    let updatedContent = article.content

    // Re-apply shortcodes based on current rules
    try {
      const { data: shortcodes, error: shortcodeError } = await supabase
        .from('shortcodes')
        .select('*')
        .eq('is_active', true)

      if (!shortcodeError && shortcodes?.length > 0) {
        for (const sc of shortcodes) {
          // Check if shortcode applies to this content type
          const appliesToContentType = !sc.content_types ||
            sc.content_types.length === 0 ||
            sc.content_types.includes(article.content_type)

          if (appliesToContentType && !updatedContent.includes(sc.shortcode)) {
            if (sc.placement === 'after_intro') {
              // Insert after first paragraph
              const firstPEnd = updatedContent.indexOf('</p>')
              if (firstPEnd > -1) {
                updatedContent =
                  updatedContent.slice(0, firstPEnd + 4) +
                  '\n\n' + sc.shortcode + '\n\n' +
                  updatedContent.slice(firstPEnd + 4)
                console.log(`[Generation] Inserted shortcode ${sc.name} after intro`)
              }
            } else if (sc.placement === 'before_conclusion') {
              // Insert before last H2 heading
              const lastH2 = updatedContent.lastIndexOf('<h2')
              if (lastH2 > -1) {
                updatedContent =
                  updatedContent.slice(0, lastH2) +
                  '\n\n' + sc.shortcode + '\n\n' +
                  updatedContent.slice(lastH2)
                console.log(`[Generation] Inserted shortcode ${sc.name} before conclusion`)
              }
            } else if (sc.placement === 'end') {
              // Insert at the very end
              updatedContent = updatedContent + '\n\n' + sc.shortcode
              console.log(`[Generation] Inserted shortcode ${sc.name} at end`)
            }
          }
        }
      }
    } catch (error) {
      console.warn('[Generation] Error refreshing shortcodes:', error)
    }

    // Refresh internal links if needed
    try {
      const relevantArticles = await this.getRelevantSiteArticles(
        article.title,
        30,
        { topics: article.topics || [] }
      )

      if (relevantArticles.length > 0) {
        // Count existing internal links
        const currentLinkCount = (updatedContent.match(/href="https?:\/\/www\.geteducated\.com/gi) || []).length

        // Only add more links if we're below the minimum (3)
        if (currentLinkCount < 3) {
          const linksToAdd = 3 - currentLinkCount
          updatedContent = await this.addInternalLinksToContentPreserving(
            updatedContent,
            relevantArticles,
            linksToAdd
          )
          console.log(`[Generation] Added ${linksToAdd} internal links`)
        }
      }
    } catch (error) {
      console.warn('[Generation] Error refreshing internal links:', error)
    }

    // Recalculate quality score with current thresholds
    const qualityThresholds = this.contentRules?.guidelines?.quality_thresholds || null
    const qualityMetrics = this.calculateQualityMetrics(
      updatedContent,
      article.faqs || [],
      qualityThresholds
    )

    console.log(`[Generation] Refresh complete. Quality score: ${qualityMetrics.score}`)

    return {
      ...article,
      content: updatedContent,
      quality_score: qualityMetrics.score,
      quality_issues: qualityMetrics.issues,
      rules_applied_at: new Date().toISOString(),
      rules_version: this.contentRules?.version || 0,
    }
  }
}

export default GenerationService
