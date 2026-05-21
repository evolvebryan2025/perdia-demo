#!/usr/bin/env node

/**
 * Backfill: scrub leaked MASK\d+ sentinels from articles.content.
 *
 * Background (Tony's 21 May review): the live MPA-for-Government-Leadership
 * article was shipped with the literal text "MASK3" visible above an H2.
 * Root cause was a broken regex in autoLinkDegreeMentions — sequential
 * masking passes plus a NULL-byte-corrupted restore regex meant several
 * mask sentinels never got reversed before the article was saved to the
 * DB and pushed to WordPress.
 *
 * The code path is now fixed (see monetizationEngine.js — single-pass
 * alternation mask + looped restore + final scrub). This script cleans up
 * the articles that were already corrupted before the fix.
 *
 * Usage:
 *   node scripts/fix-mask-sentinel-leak.js --dry-run                 # default
 *   node scripts/fix-mask-sentinel-leak.js --execute                 # write back
 *   node scripts/fix-mask-sentinel-leak.js --limit 10
 *   node scripts/fix-mask-sentinel-leak.js --inspect <id|slug>       # one article
 *
 * Env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run') || !args.includes('--execute')
const limitArg = args.find((a) => a.startsWith('--limit'))
const limit = limitArg
  ? parseInt(limitArg.split('=')[1] || args[args.indexOf('--limit') + 1])
  : null
const inspectIdx = args.indexOf('--inspect')
const inspectTarget = inspectIdx >= 0 ? args[inspectIdx + 1] : null

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

const MASK_PATTERN = /\bMASK\d+\b/g
const SCRUB_PATTERN = /\s*MASK\d+\s*/g

function scrubMasks(content) {
  return content.replace(SCRUB_PATTERN, ' ')
}

function firstMaskContext(content, span = 80) {
  const m = MASK_PATTERN.exec(content)
  MASK_PATTERN.lastIndex = 0
  if (!m) return null
  const start = Math.max(0, m.index - span)
  const end = Math.min(content.length, m.index + m[0].length + span)
  return {
    sentinel: m[0],
    snippet: content.substring(start, end).replace(/\s+/g, ' '),
  }
}

async function inspectArticle(target) {
  console.log('========================================================')
  console.log(`  Inspecting: ${target}`)
  console.log('========================================================')

  let query = supabase.from('articles').select('id, title, slug, content')
  // Match by id (uuid) or slug or title substring
  if (/^[0-9a-f-]{36}$/i.test(target)) {
    query = query.eq('id', target)
  } else {
    query = query.or(`slug.eq.${target},title.ilike.%${target}%`)
  }
  const { data, error } = await query.limit(1)

  if (error) {
    console.error('  query error:', error.message)
    return
  }
  if (!data || data.length === 0) {
    console.log('  not found.')
    return
  }
  const article = data[0]
  const content = article.content || ''

  console.log(`  id:    ${article.id}`)
  console.log(`  title: ${article.title}`)
  console.log(`  slug:  ${article.slug || '(none)'}`)
  console.log(`  length: ${content.length} chars`)
  console.log()

  const hasGePicks = /\[su_ge-picks/i.test(content)
  console.log(`  [su_ge-picks] present: ${hasGePicks ? 'YES' : 'NO'}`)

  if (hasGePicks) {
    const urlMatches = [...content.matchAll(/\[su_ge-picks[^\]]*\bcta-url="([^"]+)"/gi)]
    if (urlMatches.length === 0) {
      console.log('  cta-url: (no cta-url attribute found on any picks shortcode)')
    } else {
      urlMatches.forEach((m, i) => console.log(`  cta-url[${i}]: ${m[1]}`))
    }
  }

  const ctx = firstMaskContext(content)
  if (ctx) {
    console.log(`  MASK leak:    YES — sentinel "${ctx.sentinel}"`)
    console.log(`  context:      …${ctx.snippet}…`)
  } else {
    console.log('  MASK leak:    NO')
  }

  console.log('\n  Recommended actions:')
  if (!hasGePicks) {
    console.log('   • No GE Picks — regenerate or manually assign a category and re-run monetization.')
  }
  const hasAllUrl = /\[su_ge-picks[^\]]*cta-url="\/online-degrees\/all\/"/i.test(content)
  if (hasAllUrl) {
    console.log('   • cta-url collapsed to /online-degrees/all/ — run scripts/fix-shortcode-cta-urls.js --execute')
  }
  if (ctx) {
    console.log('   • MASK leak — run scripts/fix-mask-sentinel-leak.js --execute')
  }
}

async function scrubAll() {
  console.log('========================================================')
  console.log('  Backfill: scrub leaked MASK\\d+ sentinels')
  console.log('========================================================')
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no DB writes)' : 'LIVE (applying changes)'}`)
  if (limit) console.log(`Limit: ${limit} articles`)
  console.log()

  // PostgREST doesn't expose regex on text columns over PostgREST API
  // directly, but we can use ilike against a substring guard ('MASK') and
  // then filter precisely client-side with our pattern. This keeps the
  // query simple and portable.
  let query = supabase
    .from('articles')
    .select('id, title, content')
    .ilike('content', '%MASK%')
    .order('created_at', { ascending: false })
  if (limit) query = query.limit(limit)

  const { data: articles, error } = await query
  if (error) {
    console.error('ERROR fetching articles:', error.message)
    process.exit(1)
  }

  console.log(`Pre-filtered ${articles.length} article(s) containing literal "MASK".`)
  const affected = articles.filter((a) => MASK_PATTERN.test(a.content || ''))
  MASK_PATTERN.lastIndex = 0
  console.log(`Confirmed ${affected.length} article(s) with MASK\\d+ sentinels.\n`)

  let cleaned = 0
  let errors = 0
  for (const article of affected) {
    const before = article.content || ''
    const after = scrubMasks(before)
    const beforeMasks = (before.match(MASK_PATTERN) || []).length
    MASK_PATTERN.lastIndex = 0
    const ctx = firstMaskContext(before)

    console.log(`📝 ${article.id} — ${article.title || '(untitled)'}`)
    console.log(`   sentinels found: ${beforeMasks}`)
    if (ctx) console.log(`   first occurrence: …${ctx.snippet}…`)
    console.log(`   length: ${before.length} → ${after.length} chars`)

    if (!isDryRun) {
      const { error: updateErr } = await supabase
        .from('articles')
        .update({ content: after })
        .eq('id', article.id)
      if (updateErr) {
        console.error(`   ✗ update failed: ${updateErr.message}`)
        errors++
      } else {
        cleaned++
        console.log('   ✓ updated')
      }
    }
    console.log()
  }

  console.log('========================================================')
  console.log('  Summary')
  console.log('========================================================')
  console.log(`  Pre-filter hits:   ${articles.length}`)
  console.log(`  Confirmed affected: ${affected.length}`)
  console.log(`  ${isDryRun ? 'Would clean' : 'Cleaned'}:        ${isDryRun ? affected.length : cleaned}`)
  console.log(`  Errors:            ${errors}`)
  if (isDryRun) {
    console.log('\nThis was a dry run. Re-run with --execute to apply changes.')
  }
}

async function main() {
  if (inspectTarget) {
    await inspectArticle(inspectTarget)
  } else {
    await scrubAll()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
