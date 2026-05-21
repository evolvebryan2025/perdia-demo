/**
 * School-name auto-shortcode wrapping.
 *
 * Tony's May 21 round-3 review flagged the Special Ed article: when the
 * body mentions a specific school by name ("North Carolina A & T State
 * University"), the mention should be wrapped in a
 * [su_ge-cta type="link" school="<wordpress_id>"]Name[/su_ge-cta]
 * shortcode so the live site renders a school CPT link instead of plain
 * text — that drives lead generation.
 *
 * This pass scans article HTML for the first mention of each known
 * school and wraps it. It uses the SAME single-pass alternation mask
 * approach as monetizationEngine.autoLinkDegreeMentions (post the MASK-
 * leak fix) so existing anchors / shortcodes / headings are never
 * disturbed and we don't regress the MASK4 bug.
 */

const MAX_WRAPS_PER_ARTICLE = 5

/**
 * Fetch the active geteducated_schools name → wordpress_id map.
 * Cached for the lifetime of the module so we don't hit the DB per call
 * inside the generation pipeline.
 *
 * Supabase client is imported dynamically so the pure autoWrap function
 * below remains usable in test/Node contexts that don't bundle vite
 * aliases.
 */
let cachedSchoolsMap = null
let cachedAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min

export async function loadSchoolsMap() {
  const now = Date.now()
  if (cachedSchoolsMap && now - cachedAt < CACHE_TTL_MS) return cachedSchoolsMap

  const { supabase } = await import('./supabaseClient.js')
  const { data, error } = await supabase
    .from('geteducated_schools')
    .select('name, wordpress_id')
    .not('wordpress_id', 'is', null)

  if (error || !Array.isArray(data)) return cachedSchoolsMap || []

  cachedSchoolsMap = data
    .filter((row) => row.name && row.wordpress_id)
    .map((row) => ({ name: row.name, wordpressId: row.wordpress_id }))
    // Match longest names first — "North Carolina A & T State University"
    // before "North Carolina" would.
    .sort((a, b) => b.name.length - a.name.length)
  cachedAt = now
  return cachedSchoolsMap
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Auto-wrap the first mention of each known school in [su_ge-cta] tags.
 *
 * @param {string} content       Article HTML
 * @param {Array<{name, wordpressId}>} schools  School map (longest first)
 * @returns {{ content, wrapped }} mutated content + count of wraps applied
 */
export function autoWrapSchoolMentions(content, schools) {
  if (!content || !Array.isArray(schools) || schools.length === 0) {
    return { content: content || '', wrapped: 0 }
  }

  // Single-pass alternation mask — protects anchors, su_ge shortcodes,
  // H1-H3 headings, and monetization-block <p>s. Identical shape to
  // monetizationEngine.autoLinkDegreeMentions so the MASK leak can't
  // regress here.
  const masks = []
  const mask = (s) => {
    const id = masks.length
    masks.push(s)
    return ` MASK${id} `
  }
  const protectedRegions = /<a\b[^>]*>[\s\S]*?<\/a>|\[su_ge-[\w-]+[^\]]*\][\s\S]*?\[\/su_ge-[\w-]+\]|<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>|<p\b[^>]*class="[^"]*monetization-block[^"]*"[^>]*>[\s\S]*?<\/p>/gi

  let masked = content.replace(protectedRegions, mask)

  let wrapped = 0
  for (const { name, wordpressId } of schools) {
    if (wrapped >= MAX_WRAPS_PER_ARTICLE) break
    // Build a case-insensitive word-boundary pattern for this exact name.
    const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i')
    if (!pattern.test(masked)) continue
    masked = masked.replace(pattern, (match) =>
      `[su_ge-cta type="link" cta-copy="${match}" school="${wordpressId}"]${match}[/su_ge-cta]`
    )
    wrapped += 1
  }

  // Defensive restore: loop until stable. Same shape used elsewhere.
  for (let i = 0; i < 5; i++) {
    const next = masked.replace(/ MASK(\d+) /g, (_, id) => masks[Number(id)] ?? '')
    if (next === masked) break
    masked = next
  }
  // Final sanity scrub.
  masked = masked.replace(/\s*MASK\d+\s*/g, ' ')

  return { content: masked, wrapped }
}

/**
 * Convenience: load the schools map and wrap mentions in one call.
 */
export async function autoWrapSchoolMentionsAsync(content) {
  const schools = await loadSchoolsMap()
  return autoWrapSchoolMentions(content, schools)
}
