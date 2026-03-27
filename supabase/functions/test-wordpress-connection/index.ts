/**
 * Supabase Edge Function: test-wordpress-connection
 * Tests WordPress connection by making a server-side request (avoids CORS)
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
    const { connectionId } = await req.json()

    if (!connectionId) {
      throw new Error('Missing required parameter: connectionId')
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

    // Fetch the connection
    const { data: connection, error: connError } = await supabaseClient
      .from('wordpress_connections')
      .select('*')
      .eq('id', connectionId)
      .single()

    if (connError || !connection) {
      throw new Error(`Connection not found: ${connError?.message}`)
    }

    // Build auth header
    let authHeader = ''
    if (connection.auth_type === 'basic_auth' || connection.auth_type === 'application_password') {
      const credentials = btoa(`${connection.username}:${connection.password}`)
      authHeader = `Basic ${credentials}`
    }

    // Build the test URL
    let testUrl = `${connection.site_url}/wp-json/wp/v2/posts?per_page=1`

    // For staging sites, embed site-level basic auth in URL if needed
    // (staging may require separate site-level auth from WP app password)
    if (connection.site_url?.includes('stage.geteducated.com')) {
      const url = new URL(testUrl)
      url.username = 'ge2022'
      url.password = 'get!educated'
      testUrl = url.toString()
    }

    // Test by fetching posts endpoint (GET request, read-only)
    const wpResponse = await fetch(testUrl, {
      method: 'GET',
      headers: {
        ...(authHeader ? { 'Authorization': authHeader } : {}),
        'User-Agent': 'Perdia/1.0',
      },
    })

    if (!wpResponse.ok) {
      const errorText = await wpResponse.text()
      throw new Error(`WordPress API error: ${wpResponse.status} - ${errorText}`)
    }

    // Update test status in database
    const { error: updateError } = await supabaseClient
      .from('wordpress_connections')
      .update({
        last_test_at: new Date().toISOString(),
        last_test_success: true,
      })
      .eq('id', connectionId)

    if (updateError) {
      console.error('Error updating test status:', updateError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Connection successful!',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('WordPress connection test error:', error)
    // Return 200 with success:false so Supabase JS client doesn't throw
    // "Edge Function returned a non-2xx status code" and swallow the real error
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  }
})
