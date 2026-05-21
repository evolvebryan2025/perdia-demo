#!/usr/bin/env node

/**
 * Backfill: Repair broken cta-url attributes on existing [su_ge-picks] shortcodes.
 *
 * Tony's May 19 review showed articles with shortcodes like:
 *   [su_ge-picks category="11" concentration="354" ... cta-url="/online-degrees/all/"][/su_ge-picks]
 *
 * The cta-url should be the category + concentration slug-form URL, e.g.:
 *   /online-degrees/all/computer-science-it/network-administration/
 *
 * The generation bug that produced these was fixed in monetizationEngine.js
 * (processSlot now passes the category lookup), but existing articles in
 * the database still carry the broken URLs and will publish to WordPress
 * with the wrong "View More Degrees" button.
 *
 * Usage:
 *   node scripts/fix-shortcode-cta-urls.js --dry-run         # Preview
 *   node scripts/fix-shortcode-cta-urls.js --execute         # Apply
 *   node scripts/fix-shortcode-cta-urls.js --limit 10        # First 10 only
 *
 * Env:
 *   Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or
 *   SUPABASE_SERVICE_ROLE_KEY for bypass-RLS bulk updates).
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

console.log('========================================================')
console.log('  Backfill: Fix broken cta-url on existing shortcodes')
console.log('========================================================')
console.log(`Mode: ${isDryRun ? 'DRY RUN (no DB writes)' : 'LIVE (applying changes)'}`)
if (limit) console.log(`Limit: ${limit} articles`)
console.log()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

const LEVEL_SLUGS = {
  1: 'associate',
  2: 'bachelor',
  3: 'bachelor',
  4: 'master',
  5: 'doctorate',
  6: 'certificate',
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

function buildCorrectUrl({ levelCode, categoryName, concentrationName }) {
  const levelSlug = LEVEL_SLUGS[levelCode] || 'all'
  const categorySlug = slugify(categoryName)
  const concentrationSlug = slugify(concentrationName)
  let url = `/online-degrees/${levelSlug}/`
  if (categorySlug) url += `${categorySlug}/`
  if (concentrationSlug) url += `${concentrationSlug}/`
  return url
}

// Match the full [su_ge-picks ...][/su_ge-picks] tag, capturing attribute string.
const SHORTCODE_RE = /\[su_ge-picks\s+([^\]]+)\]\[\/su_ge-picks\]/gi

function parseAttrs(attrString) {
  const attrs = {}
  const re = /([\w-]+)="([^"]*)"/g
  let m
  while ((m = re.exec(attrString)) !== null) {
    attrs[m[1]] = m[2]
  }
  return attrs
}

function renderShortcode(attrs) {
  // Preserve key order roughly so the diff is minimal
  const order = ['category', 'concentration', 'level', 'header', 'cta-button', 'cta-url']
  const known = new Set(order)
  const parts = []
  for (const k of order) {
    if (attrs[k] != null) parts.push(`${k}="${attrs[k]}"`)
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (!known.has(k)) parts.push(`${k}="${v}"`)
  }
  return `[su_ge-picks ${parts.join(' ')}][/su_ge-picks]`
}

async function lookupCategory(categoryId, concentrationId) {
  const { data, error } = await supabase
    .from('monetization_categories')
    .select('category, concentration')
    .eq('category_id', categoryId)
    .eq('concentration_id', concentrationId)
    .maybeSingle()
  if (error) {
    console.warn(`  ! lookup error for cat=${categoryId}/conc=${concentrationId}: ${error.message}`)
    return null
  }
  return data
}

const stats = {
  scanned: 0,
  withShortcodes: 0,
  needingFix: 0,
  fixed: 0,
  errors: 0,
  skipped: 0,
}

async function processArticle(article) {
  stats.scanned++
  if (!article.content || !article.content.includes('[su_ge-picks')) return

  stats.withShortcodes++
  let updated = article.content
  let changed = false
  const replacements = []
  const matches = [...article.content.matchAll(SHORTCODE_RE)]

  for (const match of matches) {
    const attrs = parseAttrs(match[1])
    const currentUrl = attrs['cta-url'] || ''
    // Detect "broken" URLs: /online-degrees/all/ (no category/concentration after)
    // or /online-degrees/ (no level at all). Anything containing a category
    // slug between two slashes is considered already good.
    const isBroken = /^\/online-degrees\/(all\/?)?$/.test(currentUrl) || currentUrl === ''
    if (!isBroken) continue

    const category = await lookupCategory(attrs.category, attrs.concentration)
    if (!category) {
      console.warn(`  ! could not look up category for ${article.id} cat=${attrs.category}/conc=${attrs.concentration}`)
      stats.errors++
      continue
    }

    const newUrl = buildCorrectUrl({
      levelCode: attrs.level ? parseInt(attrs.level) : null,
      categoryName: category.category,
      concentrationName: category.concentration,
    })

    if (newUrl === currentUrl) continue

    attrs['cta-url'] = newUrl
    const newShortcode = renderShortcode(attrs)
    replacements.push({ from: match[0], to: newShortcode, oldUrl: currentUrl, newUrl })
    updated = updated.replace(match[0], newShortcode)
    changed = true
  }

  if (changed) {
    stats.needingFix++
    console.log(`\n📝 ${article.id} — ${article.title || '(untitled)'}`)
    for (const r of replacements) {
      console.log(`   ${r.oldUrl}  →  ${r.newUrl}`)
    }
    if (!isDryRun) {
      const { error } = await supabase
        .from('articles')
        .update({ content: updated })
        .eq('id', article.id)
      if (error) {
        console.error(`   ✗ update failed: ${error.message}`)
        stats.errors++
      } else {
        stats.fixed++
        console.log('   ✓ updated')
      }
    }
  }
}

async function main() {
  let query = supabase
    .from('articles')
    .select('id, title, content')
    .ilike('content', '%[su_ge-picks%')
    .order('created_at', { ascending: false })
  if (limit) query = query.limit(limit)

  const { data: articles, error } = await query
  if (error) {
    console.error('ERROR fetching articles:', error.message)
    process.exit(1)
  }

  console.log(`Found ${articles.length} article(s) containing [su_ge-picks] shortcodes.\n`)

  for (const article of articles) {
    await processArticle(article)
  }

  console.log('\n========================================================')
  console.log('  Summary')
  console.log('========================================================')
  console.log(`  Scanned:           ${stats.scanned}`)
  console.log(`  With shortcodes:   ${stats.withShortcodes}`)
  console.log(`  Need fix:          ${stats.needingFix}`)
  console.log(`  ${isDryRun ? 'Would fix' : 'Fixed'}:           ${isDryRun ? stats.needingFix : stats.fixed}`)
  console.log(`  Errors:            ${stats.errors}`)
  if (isDryRun) {
    console.log('\nThis was a dry run. Re-run with --execute to apply changes.')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
