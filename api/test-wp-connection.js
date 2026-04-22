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
    const { connectionId, supabaseAuthToken } = req.body || {}

    if (!connectionId) {
      return res.status(200).json({
        success: false,
        error: 'Missing required parameter: connectionId',
      })
    }

    if (!supabaseAuthToken) {
      return res.status(200).json({
        success: false,
        error: 'Missing supabaseAuthToken — user must be authenticated',
      })
    }

    // Use service role key for DB access (user is authenticated; bypass RLS)
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

    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wordpress_connections?id=eq.${connectionId}&select=*`,
      { headers: supabaseHeaders }
    )
    const connections = await connRes.json()
    const connection = Array.isArray(connections) ? connections[0] : null

    if (!connection) {
      return res.status(200).json({
        success: false,
        error: `Connection not found: ${connectionId}`,
      })
    }

    if (!connection.username || !connection.password) {
      return res.status(200).json({
        success: false,
        error: 'Connection is missing username or Application Password',
      })
    }

    const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
    const authHeader = `Basic ${credentials}`

    const wpResponse = await fetch(
      `${connection.site_url}/wp-json/wp/v2/pages?per_page=1`,
      {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'User-Agent': 'DisruptorsMedia/1.0',
        },
      }
    )

    if (!wpResponse.ok) {
      const errorText = await wpResponse.text()
      const wwwAuth = wpResponse.headers.get('www-authenticate') || ''
      return res.status(200).json({
        success: false,
        error: `WordPress API returned ${wpResponse.status}: ${errorText.slice(0, 300)}`,
        wwwAuthenticate: wwwAuth,
        diagnostic: wwwAuth.includes('Private Area')
          ? 'Site-level Apache Basic Auth blocking request. Vercel iad1 IPs need to be whitelisted at stage.geteducated.com .htaccess — contact Justin/J Day.'
          : 'WordPress Application Password auth failed. Verify username/password are correct.',
      })
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/wordpress_connections?id=eq.${connectionId}`,
      {
        method: 'PATCH',
        headers: {
          ...supabaseHeaders,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          last_test_at: new Date().toISOString(),
          last_test_success: true,
        }),
      }
    )

    return res.status(200).json({
      success: true,
      message: 'Connection successful!',
    })
  } catch (error) {
    return res.status(200).json({
      success: false,
      error: error.message || 'Unexpected error testing WordPress connection',
    })
  }
}
