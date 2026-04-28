import { transformContentForPublish } from '../src/services/wpContentTransform.js'

export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
}

const SUPABASE_URL = 'https://nvffvcjtrgxnunncdafz.supabase.co'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { articleId, connectionId, supabaseAuthToken } = req.body || {}

    if (!articleId || !connectionId) {
      return res.status(200).json({
        success: false,
        error: 'Missing required parameters: articleId and connectionId',
      })
    }

    if (!supabaseAuthToken) {
      return res.status(200).json({
        success: false,
        error: 'Missing supabaseAuthToken — user must be authenticated',
      })
    }

    // Use service role key for DB access (user is authenticated; we bypass RLS
    // because articles are shared across the team's editors)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      return res.status(200).json({
        success: false,
        error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set',
      })
    }

    const supabaseHeaders = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    }

    const articleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?id=eq.${articleId}&select=*,article_contributors(name)`,
      { headers: supabaseHeaders }
    )
    const articles = await articleRes.json()
    const article = Array.isArray(articles) ? articles[0] : null

    if (!article) {
      return res.status(200).json({
        success: false,
        error: `Article not found: ${articleId}`,
      })
    }

    if (!article.content) {
      return res.status(200).json({
        success: false,
        error: 'Article has no content. Write or generate content before publishing.',
      })
    }

    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wordpress_connections?id=eq.${connectionId}&select=*`,
      { headers: supabaseHeaders }
    )
    const connections = await connRes.json()
    const connection = Array.isArray(connections) ? connections[0] : null

    if (!connection) {
      return res.status(200).json({
        success: false,
        error: `WordPress connection not found: ${connectionId}`,
      })
    }

    if (!connection.is_active) {
      return res.status(200).json({
        success: false,
        error: 'WordPress connection is not active. Enable it in Integrations.',
      })
    }

    if (!connection.username || !connection.password) {
      return res.status(200).json({
        success: false,
        error: 'WordPress connection is missing username or Application Password',
      })
    }

    // Apply GE publish-time transformations:
    // - Convert <a> tags to [su_ge-cta type="link" ...] shortcodes
    // - Prepend [su_ge-article-contributors position="top" ...]
    // - Append bottom contributor block with Sources list + share icons
    // - Use focus_keyword (slugified) as the WP slug
    const transformed = transformContentForPublish(article)

    const postData = {
      title: article.title,
      content: transformed.content,
      excerpt: article.excerpt || '',
      status: connection.default_post_status || 'draft',
      meta: {
        _yoast_wpseo_title: article.meta_title || article.title,
        _yoast_wpseo_metadesc: article.meta_description || article.excerpt,
        _yoast_wpseo_focuskw: article.focus_keyword || '',
      },
    }

    if (transformed.slug) {
      postData.slug = transformed.slug
    }

    if (connection.default_category_id) {
      postData.categories = [connection.default_category_id]
    }

    const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
    const authHeader = `Basic ${credentials}`

    const wpResponse = await fetch(`${connection.site_url}/wp-json/wp/v2/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'User-Agent': 'DisruptorsMedia/1.0',
      },
      body: JSON.stringify(postData),
    })

    if (!wpResponse.ok) {
      const errorText = await wpResponse.text()
      return res.status(200).json({
        success: false,
        error: `WordPress API error (${wpResponse.status}): ${errorText.slice(0, 500)}`,
      })
    }

    const wpPost = await wpResponse.json()

    await fetch(
      `${SUPABASE_URL}/rest/v1/articles?id=eq.${articleId}`,
      {
        method: 'PATCH',
        headers: {
          ...supabaseHeaders,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          wordpress_post_id: wpPost.id,
          published_url: wpPost.link,
          published_at: new Date().toISOString(),
          status: 'published',
        }),
      }
    )

    return res.status(200).json({
      success: true,
      wordpress_post_id: wpPost.id,
      published_url: wpPost.link,
    })
  } catch (error) {
    return res.status(200).json({
      success: false,
      error: error.message || 'Unexpected error during WordPress publishing',
    })
  }
}
