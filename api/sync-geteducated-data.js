/**
 * Daily sync from GetEducated's /disruptors/v1/data endpoint into our Supabase
 * geteducated_schools table.
 *
 * Per J Day (2026-05-14): "I don't think they're updating every second, probably
 * a daily snapshot would work just to be safe." The endpoint is cached
 * server-side at TTL=3600s so we don't hit WP harder than once an hour.
 *
 * Trigger paths:
 *   - Vercel cron (scheduled in vercel.json) sends the request with an
 *     Authorization: Bearer <CRON_SECRET> header — verified here so the
 *     endpoint can't be invoked by arbitrary callers.
 *   - Manual invocation: same header check (set CRON_SECRET locally to
 *     fire it from a terminal).
 *
 * What it does:
 *   - GETs /disruptors/v1/data using the first active wordpress_connections row
 *     for credentials (same pattern as api/publish-wp.js).
 *   - Upserts geteducated_schools by slug, refreshing wordpress_id, name, url.
 *   - Reports counts (synced / new / unchanged / endpoint_total).
 *
 * Out of scope here (intentional):
 *   - Contributor sync — IDs are stable per environment and already hardcoded
 *     in src/services/wordpressClient.js. Refactor when prod access lands.
 *   - Degree-level upsert — we don't currently use degree IDs in the publish
 *     path. Add when school+degree shortcode variant gets wired into the
 *     generation prompt.
 */

export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
}

const SUPABASE_URL = 'https://nvffvcjtrgxnunncdafz.supabase.co'

function makeSlug(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(200).end()
  }

  // Cron auth: Vercel sends Authorization: Bearer <CRON_SECRET>. Require it
  // so this endpoint isn't a publicly-callable WP scraper.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfigured: CRON_SECRET not set',
    })
  }
  const authHeader = req.headers.authorization || ''
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set',
    })
  }

  const supabaseHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  }

  try {
    // Pick the first active WordPress connection. When prod access lands and
    // both stage and prod connections exist, this returns the most-recently-
    // created one — adjust if we need to sync from a specific environment.
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wordpress_connections?is_active=eq.true&select=site_url,username,password&order=created_at.desc&limit=1`,
      { headers: supabaseHeaders }
    )
    const conns = await connRes.json()
    const connection = Array.isArray(conns) ? conns[0] : null

    if (!connection) {
      return res.status(200).json({
        success: false,
        error: 'No active wordpress_connections row found',
      })
    }

    if (!connection.username || !connection.password) {
      return res.status(200).json({
        success: false,
        error: 'WordPress connection missing username or app password',
      })
    }

    // Hit J Day's unified endpoint
    const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString('base64')
    const dataUrl = `${connection.site_url}/wp-json/disruptors/v1/data`
    const dataRes = await fetch(dataUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'DisruptorsMedia/1.0',
      },
    })

    if (!dataRes.ok) {
      const errorText = await dataRes.text()
      return res.status(200).json({
        success: false,
        error: `GE /data endpoint returned ${dataRes.status}: ${errorText.slice(0, 300)}`,
      })
    }

    const data = await dataRes.json()
    const schools = Array.isArray(data.schools) ? data.schools : []

    if (schools.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'GE /data response had no schools array',
      })
    }

    // The /data response mixes top-level school pages (which is what we want)
    // with per-school degree pages and BERP browse pages. Only top-level pages
    // — those whose URL is exactly /online-schools/<slug>/ with no further
    // segments — have unique slugs and represent actual schools. Filter the
    // rest out so the Supabase upsert doesn't fail on duplicate ON CONFLICT
    // keys (e.g. 11 different schools each have a degree page with
    // post_name="mba", which would collide if we tried to upsert them all).
    const TOP_LEVEL_SCHOOL_URL = /^\/online-schools\/([a-z0-9-]+)\/?$/i
    const seen = new Set()
    const rows = []
    for (const s of schools) {
      const url = (s.url || '').toString()
      const match = url.match(TOP_LEVEL_SCHOOL_URL)
      if (!match) continue

      const slug = (s.post_name || match[1] || '').toLowerCase()
      if (!slug || seen.has(slug)) continue
      seen.add(slug)

      rows.push({
        name: s.post_title || slug,
        slug,
        url: `https://www.geteducated.com${url}`,
        wordpress_id: typeof s.id === 'number' ? s.id : null,
      })
    }

    if (rows.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'No top-level school pages found in /data response',
        endpoint_total_entries: schools.length,
      })
    }

    // Upsert in batches so we stay well under Supabase's request size limit.
    // Postgres can handle thousands of rows in one INSERT but the REST API
    // request body has practical limits.
    const BATCH_SIZE = 200
    let synced = 0
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/geteducated_schools?on_conflict=slug`,
        {
          method: 'POST',
          headers: {
            ...supabaseHeaders,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(batch),
        }
      )
      if (!upsertRes.ok) {
        const errorText = await upsertRes.text()
        return res.status(200).json({
          success: false,
          error: `Supabase upsert failed at batch ${i}: ${upsertRes.status} ${errorText.slice(0, 300)}`,
          partial_synced: synced,
        })
      }
      synced += batch.length
    }

    return res.status(200).json({
      success: true,
      synced_schools: synced,
      endpoint_total_schools: data.school_count || schools.length,
      endpoint_total_degrees: data.degree_count || 0,
      generated_at: data.generated_at || null,
      source: dataUrl,
    })
  } catch (error) {
    return res.status(200).json({
      success: false,
      error: error.message || 'Unexpected error during GE data sync',
    })
  }
}
