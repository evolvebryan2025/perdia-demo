/**
 * WordPress REST API Client for GetEducated
 *
 * Direct WordPress publishing using Application Passwords
 * Supports both staging and production environments
 *
 * Authentication: Basic Auth with Application Passwords
 * - Staging: May require site-level basic auth (ge2022) if .htaccess whitelist not active
 * - Production: Uses standard Application Password auth
 *
 * @see https://developer.wordpress.org/rest-api/reference/posts/
 */

import { AUTHOR_DISPLAY_NAMES } from '../hooks/useContributors'

// WordPress API endpoints
const WP_API_ENDPOINTS = {
  staging: 'https://stage.geteducated.com/wp-json/wp/v2',
  production: 'https://www.geteducated.com/wp-json/wp/v2',
}

// Site-level basic auth for staging (if API whitelist not active)
// This is separate from the WordPress Application Password
// NOTE: HTTP Basic Auth only supports ONE credential per request
// When the API whitelist is active, we don't need site auth
// When it's NOT active, we can't use app passwords (they conflict)
const STAGING_SITE_AUTH = {
  username: 'ge2022',
  password: 'get!educated',
}

// WordPress Article Contributor CPT IDs
// Maps our contributor names to their WordPress CPT post IDs
// Source: https://stage.geteducated.com/article_contributor-sitemap.xml
const WORDPRESS_CONTRIBUTOR_IDS = {
  staging: {
    'Tony Huffman': 163621,
    'Kif': 163621,           // Alias for Tony
    'Kayleigh Gilbert': 163923,
    'Alicia': 163923,        // Alias for Kayleigh
    'Sara': 137186,
    'Danny': 137186,         // Alias for Sara
    'Charity': null,         // CPT doesn't exist yet
    'Julia': null,           // Alias for Charity - doesn't exist
  },
  // Production IDs should match staging per Justin
  // Update these if they differ
  production: {
    'Tony Huffman': 163621,
    'Kif': 163621,
    'Kayleigh Gilbert': 163923,
    'Alicia': 163923,
    'Sara': 137186,
    'Danny': 137186,
    'Charity': null,
    'Julia': null,
  },
}

// Article Contributor profile URLs
const CONTRIBUTOR_PROFILE_URLS = {
  'Tony Huffman': 'https://www.geteducated.com/article-contributors/tony-huffman',
  'Kayleigh Gilbert': 'https://www.geteducated.com/article-contributors/kayleigh-gilbert',
  'Sara': 'https://www.geteducated.com/article-contributors/sara',
  'Charity': null, // Pending creation
}

/**
 * WordPress REST API Client
 */
class WordPressClient {
  constructor(options = {}) {
    this.environment = options.environment || 'staging'
    this.baseUrl = WP_API_ENDPOINTS[this.environment]

    // Get credentials from environment
    this.username = options.username || import.meta.env.VITE_WP_USERNAME
    this.appPassword = options.appPassword || import.meta.env.VITE_WP_APP_PASSWORD

    // For staging, we may need site-level auth if the API whitelist isn't active
    this.useSiteAuth = options.useSiteAuth ?? (this.environment === 'staging')
    this.siteAuthUsername = options.siteAuthUsername || import.meta.env.VITE_WP_SITE_AUTH_USERNAME || STAGING_SITE_AUTH.username
    this.siteAuthPassword = options.siteAuthPassword || import.meta.env.VITE_WP_SITE_AUTH_PASSWORD || STAGING_SITE_AUTH.password

    if (!this.username || !this.appPassword) {
      console.warn('[WordPressClient] Missing credentials - publishing will fail')
    }
  }

  /**
   * Get Basic Auth header value for WordPress Application Password
   * @returns {string} Base64 encoded auth string
   */
  getAuthHeader() {
    // Application Password format: username:app-password
    // The app password may contain spaces which is fine for encoding
    const credentials = `${this.username}:${this.appPassword}`
    return `Basic ${btoa(credentials)}`
  }

  /**
   * Build the full URL, optionally with site-level auth embedded
   * For staging with site-level basic auth, we embed it in the URL
   * and use the Authorization header for the WP app password
   * @param {string} endpoint - API endpoint
   * @returns {string} Full URL
   */
  buildUrl(endpoint) {
    const baseUrl = WP_API_ENDPOINTS[this.environment]

    if (this.useSiteAuth && this.siteAuthUsername && this.siteAuthPassword) {
      // Embed site-level auth in URL: https://user:pass@host/path
      const url = new URL(baseUrl + endpoint)
      url.username = this.siteAuthUsername
      url.password = this.siteAuthPassword
      return url.toString()
    }

    return baseUrl + endpoint
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (relative to base URL)
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Response data
   */
  async request(endpoint, options = {}) {
    const url = this.buildUrl(endpoint)

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': this.getAuthHeader(),
      ...options.headers,
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      let errorMessage = `WordPress API error: ${response.status}`

      try {
        const errorJson = JSON.parse(errorBody)
        errorMessage = errorJson.message || errorJson.code || errorMessage
      } catch {
        errorMessage = `${errorMessage} - ${errorBody.substring(0, 200)}`
      }

      throw new Error(errorMessage)
    }

    return response.json()
  }

  /**
   * Get WordPress contributor CPT ID for an author name
   * @param {string} authorName - The author's name or alias
   * @returns {number|null} WordPress CPT post ID
   */
  getContributorId(authorName) {
    const ids = WORDPRESS_CONTRIBUTOR_IDS[this.environment]

    // Try exact match first
    if (ids[authorName]) return ids[authorName]

    // Try display name mapping
    const displayName = AUTHOR_DISPLAY_NAMES[authorName]
    if (displayName && ids[displayName]) return ids[displayName]

    // Try reverse lookup (display name -> alias)
    for (const [alias, display] of Object.entries(AUTHOR_DISPLAY_NAMES)) {
      if (display === authorName && ids[alias]) {
        return ids[alias]
      }
    }

    console.warn(`[WordPressClient] No contributor ID found for: ${authorName}`)
    return null
  }

  /**
   * Get contributor profile URL
   * @param {string} authorName - The author's name
   * @returns {string|null} Profile URL
   */
  getContributorProfileUrl(authorName) {
    // Normalize to display name
    const displayName = AUTHOR_DISPLAY_NAMES[authorName] || authorName
    return CONTRIBUTOR_PROFILE_URLS[displayName] || null
  }

  /**
   * Create a new post in WordPress
   * @param {Object} article - Article data from our system
   * @param {Object} options - Publishing options
   * @returns {Promise<Object>} Created post data
   */
  async createPost(article, options = {}) {
    const {
      status = 'draft',  // 'draft', 'publish', 'pending', 'private'
      categories = [],
      tags = [],
    } = options

    // Get contributor info
    const authorName = article.contributor_name || article.article_contributors?.name
    const displayName = AUTHOR_DISPLAY_NAMES[authorName] || authorName
    const contributorId = this.getContributorId(authorName)
    const contributorProfileUrl = this.getContributorProfileUrl(displayName)

    // Build the post payload
    const postData = {
      // Core fields
      title: article.title,
      content: article.content,
      excerpt: article.excerpt || this.generateExcerpt(article.content),
      slug: article.slug || this.generateSlug(article.title),
      status,

      // Taxonomies (if categories/tags are set up)
      ...(categories.length > 0 && { categories }),
      ...(tags.length > 0 && { tags }),

      // Custom meta fields for GetEducated's Article Contributor system
      // These are stored in wp_postmeta, not in the post table
      meta: {
        // Primary author - maps to Article Contributor CPT
        written_by: contributorId,
        // Optional: editor and expert reviewer
        edited_by: options.editedBy || null,
        expert_review_by: options.expertReviewBy || null,

        // SEO meta (may use Yoast fields)
        _yoast_wpseo_title: article.meta_title || article.title,
        _yoast_wpseo_metadesc: article.meta_description || article.excerpt,
        _yoast_wpseo_focuskw: article.focus_keyword,

        // Source tracking
        _perdia_article_id: article.id,
        _perdia_quality_score: article.quality_score,
        _perdia_generated_at: new Date().toISOString(),
      },
    }

    console.log(`[WordPressClient] Creating post: "${article.title}" (status: ${status})`)
    console.log(`[WordPressClient] Contributor: ${displayName} (CPT ID: ${contributorId})`)

    const response = await this.request('/posts', {
      method: 'POST',
      body: JSON.stringify(postData),
    })

    return {
      success: true,
      post_id: response.id,
      url: response.link,
      edit_url: response._links?.['wp:action-edit']?.[0]?.href,
      status: response.status,
      contributor_id: contributorId,
      contributor_name: displayName,
      contributor_profile_url: contributorProfileUrl,
    }
  }

  /**
   * Update an existing post
   * @param {number} postId - WordPress post ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated post data
   */
  async updatePost(postId, updates) {
    const response = await this.request(`/posts/${postId}`, {
      method: 'POST',  // WordPress uses POST for updates too
      body: JSON.stringify(updates),
    })

    return {
      success: true,
      post_id: response.id,
      url: response.link,
      status: response.status,
    }
  }

  /**
   * Get a post by ID
   * @param {number} postId - WordPress post ID
   * @returns {Promise<Object>} Post data
   */
  async getPost(postId) {
    return this.request(`/posts/${postId}`)
  }

  /**
   * Delete a post (move to trash)
   * @param {number} postId - WordPress post ID
   * @param {boolean} force - Permanently delete if true
   * @returns {Promise<Object>} Deleted post data
   */
  async deletePost(postId, force = false) {
    return this.request(`/posts/${postId}?force=${force}`, {
      method: 'DELETE',
    })
  }

  /**
   * Test the API connection
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    try {
      // Try to get current user info
      const user = await this.request('/users/me')

      return {
        success: true,
        environment: this.environment,
        baseUrl: this.baseUrl,
        user: {
          id: user.id,
          name: user.name,
          slug: user.slug,
          roles: user.roles,
        },
        message: `Connected as ${user.name}`,
      }
    } catch (error) {
      return {
        success: false,
        environment: this.environment,
        baseUrl: this.baseUrl,
        error: error.message,
      }
    }
  }

  /**
   * Fetch Article Contributor sitemap for validation
   * @returns {Promise<Array>} List of contributor slugs
   */
  async fetchContributorSitemap() {
    const sitemapUrl = this.environment === 'production'
      ? 'https://www.geteducated.com/article_contributor-sitemap.xml'
      : 'https://stage.geteducated.com/article_contributor-sitemap.xml'

    const response = await fetch(sitemapUrl)
    const xml = await response.text()

    // Parse contributor URLs from sitemap
    const urlMatches = xml.matchAll(/<loc>([^<]+)<\/loc>/g)
    const contributors = []

    for (const match of urlMatches) {
      const url = match[1]
      if (url.includes('article-contributors/')) {
        const slug = url.split('article-contributors/')[1].replace(/\/$/, '')
        contributors.push({ url, slug })
      }
    }

    return contributors
  }

  /**
   * Generate excerpt from HTML content
   * @param {string} content - HTML content
   * @param {number} maxLength - Max length
   * @returns {string} Plain text excerpt
   */
  generateExcerpt(content, maxLength = 160) {
    if (!content) return ''

    const plainText = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (plainText.length <= maxLength) return plainText

    const truncated = plainText.substring(0, maxLength)
    const lastSpace = truncated.lastIndexOf(' ')
    return truncated.substring(0, lastSpace) + '...'
  }

  /**
   * Generate URL slug from title
   * @param {string} title - Article title
   * @returns {string} URL-safe slug
   */
  generateSlug(title) {
    if (!title) return ''

    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 100)
  }
}

// Factory functions for common use cases
export function createStagingClient() {
  return new WordPressClient({ environment: 'staging' })
}

export function createProductionClient() {
  return new WordPressClient({ environment: 'production' })
}

// Export contributor mappings for use elsewhere
export { WORDPRESS_CONTRIBUTOR_IDS, CONTRIBUTOR_PROFILE_URLS }

export default WordPressClient
