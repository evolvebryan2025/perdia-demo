/**
 * Supabase Edge Function: publish-to-wordpress
 * Publishes articles to WordPress via REST API
 *
 * IMPORTANT: All error responses return status 200 with success:false
 * so the Supabase JS client passes through the actual error message
 * instead of throwing a generic "non-2xx status code" error.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { articleId, connectionId } = await req.json()

    if (!articleId || !connectionId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required parameters: articleId and connectionId',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Fetch the article
    const { data: article, error: articleError } = await supabaseClient
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single()

    if (articleError || !article) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Article not found: ${articleError?.message || 'Unknown error'}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    if (!article.content) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Article has no content. Write or generate content before publishing.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Fetch WordPress connection
    const { data: connection, error: connError } = await supabaseClient
      .from('wordpress_connections')
      .select('*')
      .eq('id', connectionId)
      .single()

    if (connError || !connection) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `WordPress connection not found: ${connError?.message || 'Unknown error'}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    if (!connection.is_active) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'WordPress connection is not active. Enable it in Integrations.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    console.log('Publishing article to WordPress:', article.title)

    // Prepare WordPress post data
    const postData: Record<string, unknown> = {
      title: article.title,
      content: article.content,
      excerpt: article.excerpt || '',
      status: connection.default_post_status || 'draft',
      meta: {
        _yoast_wpseo_title: article.meta_title || article.title,
        _yoast_wpseo_metadesc: article.meta_description || article.excerpt,
        _yoast_wpseo_focuskw: article.focus_keyword || '',
      },
    }

    if (connection.default_category_id) {
      postData.categories = [connection.default_category_id]
    }

    // Authenticate based on auth type
    let authHeader = ''
    if (connection.auth_type === 'basic_auth' || connection.auth_type === 'application_password') {
      const credentials = btoa(`${connection.username}:${connection.password}`)
      authHeader = `Basic ${credentials}`
    } else if (connection.auth_type === 'jwt') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'JWT authentication is not yet supported. Use Application Password instead.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Build WordPress API URL
    let wpApiUrl = `${connection.site_url}/wp-json/wp/v2/posts`

    // For staging sites, embed site-level basic auth in URL if needed
    if (connection.site_url?.includes('stage.geteducated.com')) {
      const url = new URL(wpApiUrl)
      url.username = 'ge2022'
      url.password = 'get!educated'
      wpApiUrl = url.toString()
    }

    // Publish to WordPress
    const wpResponse = await fetch(wpApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
        'User-Agent': 'Perdia/1.0',
      },
      body: JSON.stringify(postData),
    })

    if (!wpResponse.ok) {
      const errorText = await wpResponse.text()
      return new Response(
        JSON.stringify({
          success: false,
          error: `WordPress API error (${wpResponse.status}): ${errorText}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    const wpPost = await wpResponse.json()

    // Update article in database
    const { error: updateError } = await supabaseClient
      .from('articles')
      .update({
        wordpress_post_id: wpPost.id,
        published_url: wpPost.link,
        published_at: new Date().toISOString(),
        status: 'published',
      })
      .eq('id', articleId)

    if (updateError) {
      console.error('Error updating article:', updateError)
    }

    console.log('Article published successfully:', wpPost.link)

    return new Response(
      JSON.stringify({
        success: true,
        wordpress_post_id: wpPost.id,
        published_url: wpPost.link,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('WordPress publishing error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred during publishing',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  }
})
