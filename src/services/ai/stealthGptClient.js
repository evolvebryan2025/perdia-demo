/**
 * StealthGPT Client for Content Humanization
 * Uses StealthGPT API to make AI-generated content undetectable
 * API Documentation: https://docs.stealthgpt.ai/
 *
 * OPTIMIZATION NOTES (from StealthGPT docs):
 * - Split text into 150-200 word chunks for best results
 * - Use iterative rephrasing (2-3 passes) for maximum bypass
 * - business: true uses 10x more powerful model
 * - Don't manually edit output - regenerate instead
 * - Check howLikelyToBeDetected score, retry if > 25
 *
 * CORS NOTE:
 * In production, requests are proxied through a Supabase Edge Function
 * to avoid CORS issues. Set VITE_SUPABASE_URL in your environment.
 */

class StealthGptClient {
  constructor(apiKey) {
    this.apiKey = apiKey || import.meta.env.VITE_STEALTHGPT_API_KEY
    this.baseUrl = 'https://stealthgpt.ai/api'

    // Edge Function URL for production (bypasses CORS)
    this.supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    this.edgeFunctionUrl = this.supabaseUrl
      ? `${this.supabaseUrl}/functions/v1/stealthgpt-humanize`
      : null

    // ALWAYS use Edge Function for security - API keys are stored in Supabase secrets
    // This keeps API keys secure on the server-side, never exposed to browser
    this.useEdgeFunction = true

    // Track CORS failures to auto-switch to Edge Function
    this.corsFailureDetected = false

    // Optimized default settings for maximum undetectability
    this.defaultOptions = {
      tone: 'College',      // College is recommended for professional content
      mode: 'High',         // High = strongest bypass potential
      business: true,       // 10x more powerful engine
      isMultilingual: false,
      detector: 'gptzero',  // GPTZero is most common detector
    }

    // Optimal chunk size per StealthGPT docs: 150-200 words
    // ~6-7 chars per word average, so ~1000-1400 chars
    this.optimalChunkSize = 1200
    this.maxChunkSize = 1500

    // Detection threshold - howLikelyToBeDetected score from API
    // LOWER scores = BETTER (less likely to be detected as AI)
    // Per StealthGPT docs: "retry if > 25" means scores under 25 are acceptable
    // We stop iterating once score drops BELOW this threshold
    this.detectionThreshold = 25

    // Max retry attempts for iterative rephrasing
    // IMPORTANT: We exit early as soon as threshold is met to save credits
    this.maxIterations = 3
  }

  /**
   * Check if Edge Function is configured
   * We ALWAYS use Edge Function - API key is stored securely in Supabase secrets
   */
  isConfigured() {
    // We only need Supabase URL since API key is in Supabase secrets
    return !!this.edgeFunctionUrl
  }

  /**
   * Check if we should use the Edge Function for this request
   */
  shouldUseEdgeFunction() {
    return (this.useEdgeFunction || this.corsFailureDetected) && this.edgeFunctionUrl
  }

  /**
   * Make API request to StealthGPT
   * Automatically routes through Edge Function in production or on CORS failure
   */
  async makeRequest(endpoint, payload) {
    if (!this.isConfigured()) {
      console.warn('StealthGPT not configured - missing API key or Edge Function URL')
      throw new Error('StealthGPT not configured')
    }

    // Determine which method to use
    if (this.shouldUseEdgeFunction()) {
      return this.makeEdgeFunctionRequest(payload)
    }

    // Try direct API first (development mode)
    try {
      return await this.makeDirectApiRequest(endpoint, payload)
    } catch (error) {
      // Check if this is a CORS error and fallback to Edge Function
      if (this.isCorsError(error) && this.edgeFunctionUrl) {
        console.warn('[StealthGPT] CORS error detected, switching to Edge Function')
        this.corsFailureDetected = true
        return this.makeEdgeFunctionRequest(payload)
      }
      throw error
    }
  }

  /**
   * Check if an error is likely a CORS error
   */
  isCorsError(error) {
    if (!error) return false
    const message = error.message?.toLowerCase() || ''
    return (
      message.includes('cors') ||
      message.includes('network error') ||
      message.includes('failed to fetch') ||
      message.includes('load failed') ||
      error.name === 'TypeError' // fetch CORS errors often show as TypeError
    )
  }

  /**
   * Make direct API request to StealthGPT (development mode)
   */
  async makeDirectApiRequest(endpoint, payload) {
    console.log('[StealthGPT] Making direct API request')

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'api-token': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('StealthGPT API error:', response.status, errorText)
      throw new Error(`StealthGPT API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return data
  }

  /**
   * Make request through Supabase Edge Function (production mode)
   * Bypasses CORS by proxying through server
   */
  async makeEdgeFunctionRequest(payload) {
    console.log('[StealthGPT] Making request via Edge Function')

    if (!this.edgeFunctionUrl) {
      throw new Error('Edge Function URL not configured - set VITE_SUPABASE_URL')
    }

    // Get Supabase anon key for auth
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    const response = await fetch(this.edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      console.error('StealthGPT Edge Function error:', response.status, errorData)
      throw new Error(`StealthGPT Edge Function error: ${response.status} - ${errorData.error || 'Unknown error'}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Edge Function returned unsuccessful response')
    }

    // Map Edge Function response to direct API format
    return {
      result: data.result,
      howLikelyToBeDetected: data.howLikelyToBeDetected,
    }
  }

  /**
   * Humanize a single chunk of content with retry logic
   * COST OPTIMIZATION: Stops immediately when threshold is met to save API credits
   * Also tracks best result across iterations in case we don't meet threshold
   *
   * @param {string} content - Content chunk to humanize
   * @param {Object} options - Humanization options
   * @returns {Promise<Object>} - { result, detectionScore, iterations }
   */
  async humanizeChunk(content, options = {}) {
    const {
      tone = this.defaultOptions.tone,
      mode = this.defaultOptions.mode,
      business = this.defaultOptions.business,
      isMultilingual = this.defaultOptions.isMultilingual,
      detector = this.defaultOptions.detector,
      maxIterations = this.maxIterations,
      detectionThreshold = this.detectionThreshold,
    } = options

    let currentContent = content
    let iterations = 0

    // Track the best result across all iterations
    // LOWER score = better (less likely to be detected as AI)
    let bestResult = {
      content: content,
      score: 100,
    }

    // Iterative rephrasing until score meets threshold
    // IMPORTANT: We exit early as soon as threshold is met to minimize API costs
    while (iterations < maxIterations) {
      iterations++

      const payload = {
        prompt: currentContent,
        rephrase: true,
        tone,
        mode,
        business,
        isMultilingual,
        detector,
      }

      const response = await this.makeRequest('/stealthify', payload)

      if (!response.result) {
        throw new Error('StealthGPT returned empty result')
      }

      currentContent = response.result
      const score = response.howLikelyToBeDetected || 0

      console.log(`[StealthGPT] Iteration ${iterations}: Detection score = ${score}`)

      // Track best result (LOWER score = better = less likely to be detected)
      if (score < bestResult.score) {
        bestResult = { content: currentContent, score }
      }

      // EXIT EARLY: If we achieved target score (below threshold), stop to save credits
      if (score <= detectionThreshold) {
        console.log(`[StealthGPT] ✓ Score ${score} is below threshold (${detectionThreshold}) after ${iterations} iteration(s) - stopping early`)
        return {
          result: currentContent,
          detectionScore: score,
          iterations,
        }
      }

      // Small delay between iterations (only if we're continuing)
      if (iterations < maxIterations) {
        await this.delay(300)
      }
    }

    // If we exhausted all iterations without meeting threshold,
    // return the best result we got
    console.log(`[StealthGPT] Max iterations reached. Best score: ${bestResult.score} (target: ${detectionThreshold})`)
    return {
      result: bestResult.content,
      detectionScore: bestResult.score,
      iterations,
    }
  }

  /**
   * Humanize content to make it undetectable (single chunk)
   * @param {string} content - The AI-generated content to humanize
   * @param {Object} options - Humanization options
   * @returns {Promise<string>} - Humanized content
   */
  async humanize(content, options = {}) {
    console.log(`[StealthGPT] Humanizing content (${content.length} chars)`)

    const { result } = await this.humanizeChunk(content, options)

    console.log(`[StealthGPT] Humanization complete (${result.length} chars)`)

    return result
  }

  /**
   * Split content into optimal chunks (150-200 words each)
   * Preserves HTML structure and sentence boundaries
   */
  splitIntoOptimalChunks(content) {
    const chunks = []

    // First, try to split by paragraphs/sections
    const sections = this.splitByHeadings(content)

    for (const section of sections) {
      // If section is small enough, keep it as is
      if (section.length <= this.maxChunkSize) {
        chunks.push(section)
        continue
      }

      // Split large sections by paragraphs
      const paragraphs = section.split(/(<\/p>|<br\s*\/?>|\n\n)/gi)
      let currentChunk = ''

      for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i]

        // If adding this paragraph would exceed optimal size, save current chunk
        if (currentChunk.length + para.length > this.optimalChunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim())
          currentChunk = ''
        }

        currentChunk += para

        // If current chunk is at optimal size, save it
        if (currentChunk.length >= this.optimalChunkSize) {
          chunks.push(currentChunk.trim())
          currentChunk = ''
        }
      }

      // Don't forget the last chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim())
      }
    }

    // Filter out empty chunks and very small ones (< 50 chars)
    return chunks.filter(chunk => chunk.trim().length >= 50)
  }

  /**
   * Humanize long content with optimal chunking and iterative processing
   * This is the PRIMARY method for article humanization
   * @param {string} content - Full article content
   * @param {Object} options - Humanization options
   * @returns {Promise<string>} - Fully humanized content
   */
  async humanizeLongContent(content, options = {}) {
    console.log(`[StealthGPT] Processing article (${content.length} chars)`)

    // Split into optimal chunks (150-200 words each)
    const chunks = this.splitIntoOptimalChunks(content)
    console.log(`[StealthGPT] Split into ${chunks.length} optimal chunks`)

    const humanizedChunks = []
    let totalDetectionScore = 0
    let totalIterations = 0

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      console.log(`[StealthGPT] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`)

      try {
        const { result, detectionScore, iterations } = await this.humanizeChunk(chunk, options)
        humanizedChunks.push(result)
        totalDetectionScore += detectionScore
        totalIterations += iterations

        // Rate limiting delay between chunks
        if (i < chunks.length - 1) {
          await this.delay(500)
        }
      } catch (error) {
        console.error(`[StealthGPT] Chunk ${i + 1} failed:`, error.message)
        // Fall back to original chunk on error
        humanizedChunks.push(chunk)
      }
    }

    const avgScore = chunks.length > 0 ? Math.round(totalDetectionScore / chunks.length) : 0
    console.log(`[StealthGPT] Complete! Avg detection score: ${avgScore}, Total iterations: ${totalIterations}`)

    return humanizedChunks.join('\n\n')
  }

  /**
   * Two-pass humanization for maximum undetectability
   * First pass: Standard humanization
   * Second pass: Re-humanize the result for extra safety
   */
  async humanizeWithDoublePassing(content, options = {}) {
    console.log(`[StealthGPT] Starting double-pass humanization`)

    // First pass
    console.log(`[StealthGPT] Pass 1 of 2...`)
    const firstPass = await this.humanizeLongContent(content, options)

    // Small delay between passes
    await this.delay(1000)

    // Second pass with slightly different settings for variation
    console.log(`[StealthGPT] Pass 2 of 2...`)
    const secondPassOptions = {
      ...options,
      maxIterations: 2, // Fewer iterations on second pass
    }
    const finalResult = await this.humanizeLongContent(firstPass, secondPassOptions)

    console.log(`[StealthGPT] Double-pass complete`)
    return finalResult
  }

  /**
   * Generate new content from a prompt (already undetectable)
   * @param {string} prompt - The prompt for content generation
   * @param {Object} options - Generation options
   * @returns {Promise<string>} - Generated content
   */
  async generate(prompt, options = {}) {
    const {
      tone = this.defaultOptions.tone,
      mode = this.defaultOptions.mode,
      business = this.defaultOptions.business,
      isMultilingual = this.defaultOptions.isMultilingual,
      detector = this.defaultOptions.detector,
    } = options

    const payload = {
      prompt,
      rephrase: false, // Generate new content
      tone,
      mode,
      business,
      isMultilingual,
      detector,
    }

    console.log(`[StealthGPT] Generating content with mode: ${mode}, tone: ${tone}, business: ${business}`)

    const response = await this.makeRequest('/stealthify', payload)

    if (!response.result) {
      throw new Error('StealthGPT returned empty result')
    }

    return response.result
  }

  /**
   * Generate a complete SEO-optimized blog article
   * @param {Object} articleParams - Article parameters
   * @returns {Promise<Object>} - Generated article with markdown content and images
   */
  async generateArticle(articleParams) {
    const {
      topic,
      keywords = [],
      targetWordCount = 2000,
      tone = 'College',
    } = articleParams

    const payload = {
      topic,
      keywords: keywords.join(', '),
      word_count: targetWordCount,
      tone,
    }

    console.log(`[StealthGPT] Generating article about: ${topic}`)

    const response = await this.makeRequest('/stealthify/articles', payload)

    return response
  }

  /**
   * Split content by H2 headings for chunked processing
   */
  splitByHeadings(content) {
    // Split on H2 tags while keeping them
    const parts = content.split(/(?=<h2)/gi)

    // If no H2s found or only one part, try H3s
    if (parts.length <= 1) {
      const h3Parts = content.split(/(?=<h3)/gi).filter(p => p.trim())
      if (h3Parts.length > 1) return h3Parts
    }

    // If still no good splits, split by paragraphs
    if (parts.length <= 1) {
      return [content] // Return as single chunk, will be split by paragraph method
    }

    return parts.filter(p => p.trim())
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Update default options
   */
  setDefaults(options) {
    this.defaultOptions = { ...this.defaultOptions, ...options }
  }

  /**
   * Get current default options
   */
  getDefaults() {
    return { ...this.defaultOptions }
  }

  /**
   * Set the detection threshold (score needed to stop iterating)
   * LOWER scores = better (less likely to be detected as AI)
   * Lower threshold = stricter requirements but more API calls
   * Higher threshold = fewer API calls but potentially more detectable content
   * @param {number} threshold - Score threshold (0-100), default 25
   */
  setDetectionThreshold(threshold) {
    this.detectionThreshold = Math.max(0, Math.min(100, threshold))
    console.log(`[StealthGPT] Detection threshold set to ${this.detectionThreshold}`)
  }

  /**
   * Get the current detection threshold
   */
  getDetectionThreshold() {
    return this.detectionThreshold
  }

  /**
   * Get available tone options
   */
  static getToneOptions() {
    return [
      { value: 'Standard', label: 'Standard', description: 'General purpose writing' },
      { value: 'HighSchool', label: 'High School', description: 'Simpler vocabulary and structure' },
      { value: 'College', label: 'College', description: 'Academic but accessible (Recommended)' },
      { value: 'PhD', label: 'PhD', description: 'Advanced academic writing, no errors' },
    ]
  }

  /**
   * Get available mode options
   */
  static getModeOptions() {
    return [
      { value: 'Low', label: 'Low', description: 'Light humanization, best for SEO/web content' },
      { value: 'Medium', label: 'Medium', description: 'Balanced bypass for professional use' },
      { value: 'High', label: 'High', description: 'Maximum undetectability (Recommended)' },
    ]
  }

  /**
   * Get available detector options
   */
  static getDetectorOptions() {
    return [
      { value: 'gptzero', label: 'GPTZero', description: 'Most common AI detector (Recommended)' },
      { value: 'turnitin', label: 'Turnitin', description: 'Academic plagiarism checker' },
    ]
  }
}

export default StealthGptClient
