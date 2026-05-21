/**
 * Inline link augmenters that run at the end of the article generation
 * pipeline. Each pass uses the single-pass alternation mask pattern
 * (post-MASK-fix) so existing anchors, shortcodes, and headings are
 * never disturbed and we don't regress the MASK4 leak.
 *
 * Added in response to Tony's May 21 round-3 review of the published
 * articles on stage.geteducated.com.
 */

const PROTECTED_REGIONS_RE = /<a\b[^>]*>[\s\S]*?<\/a>|\[su_ge-[\w-]+[^\]]*\][\s\S]*?\[\/su_ge-[\w-]+\]|<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>|<p\b[^>]*class="[^"]*monetization-block[^"]*"[^>]*>[\s\S]*?<\/p>/gi

function maskProtectedRegions(content) {
  const masks = []
  const mask = (s) => {
    const id = masks.length
    masks.push(s)
    return ` MASK${id} `
  }
  return { masked: content.replace(PROTECTED_REGIONS_RE, mask), masks }
}

function restoreMasks(masked, masks) {
  let out = masked
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/ MASK(\d+) /g, (_, id) => masks[Number(id)] ?? '')
    if (next === out) break
    out = next
  }
  return out.replace(/\s*MASK\d+\s*/g, ' ')
}

/**
 * Fix-4 — inline ranking-report link.
 *
 * Tony's note: "Every ranking list on GetEducated comes with an annual
 * cost-and-pricing guide. If you want to explore any type of online
 * program, please check the annual rank reports for which programs
 * provide (links to homepage, should link to ranks to match the
 * content)."
 *
 * Find the first occurrence of a ranking-related phrase in the body and
 * wrap it in a [su_ge-cta] linking to the best-match rank report.
 *
 * @param {string} content
 * @param {{report_url: string}} topReport
 * @returns {{ content, wrapped }}
 */
export function wrapInlineRankingPhrase(content, topReport) {
  if (!content || !topReport?.report_url) {
    return { content: content || '', wrapped: 0 }
  }

  const { masked, masks } = maskProtectedRegions(content)
  const phrase = /\b(?:annual cost-and-pricing guide|ranking lists?|ranking reports?|rank reports?|annual ranks?)\b/i
  let wrapped = 0
  const out = masked.replace(phrase, (match) => {
    if (wrapped > 0) return match
    wrapped += 1
    return `[su_ge-cta type="link" cta-copy="${match}" url="${topReport.report_url}"]${match}[/su_ge-cta]`
  })

  return { content: restoreMasks(out, masks), wrapped }
}

/**
 * Fix-5 — section-aware topical links.
 *
 * For each H2 in the article, look at its inner text:
 *  - If it mentions "accreditation" and we have a topical article URL
 *    handy, inject one link into the first <p> immediately after the H2.
 *  - If it mentions a degree level (bachelor / master / etc.) and we
 *    have a matched rank report for that level, inject a link into the
 *    first <p> immediately after the H2.
 *
 * Both targets accept a single URL. Caller is responsible for picking
 * the best match (e.g. CEPH article for a public-health accreditation
 * section, online-bachelor-public-health rank for the bachelor's
 * section).
 *
 * @param {string} content
 * @param {{ accreditationUrl?: string, levelRankUrls?: Record<string,string> }} opts
 *   levelRankUrls keys: 'associate'|'bachelor'|'master'|'doctorate'
 * @returns {{ content, wrapped }}
 */
export function insertSectionAwareLinks(content, opts = {}) {
  const { accreditationUrl, levelRankUrls = {} } = opts
  if (!content || (!accreditationUrl && Object.keys(levelRankUrls).length === 0)) {
    return { content: content || '', wrapped: 0 }
  }

  // We DO want to find H2s and inject into the paragraph that follows,
  // so we don't mask H2/p here — we walk the structure directly. We
  // still mask existing anchors and shortcodes inside the candidate
  // paragraph so we don't wrap an already-linked phrase.

  const usedAccreditation = { current: false }
  const usedLevels = new Set()
  let wrapped = 0

  const sectionRe = /(<h2\b[^>]*>([\s\S]*?)<\/h2>)\s*(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi
  const out = content.replace(sectionRe, (match, hOpen, hInner, pOpen, pInner, pClose) => {
    const headingText = hInner.replace(/<[^>]*>/g, ' ').toLowerCase()

    // Accreditation section
    if (accreditationUrl && /accredit/.test(headingText) && !usedAccreditation.current) {
      // Find a sensible 1-3 word phrase in the paragraph to wrap.
      const accPhrase = pInner.match(/\b(accreditation|accredited programs?|accreditation status|regional accreditation|national accreditation)\b/i)
      if (accPhrase) {
        const before = pInner.slice(0, accPhrase.index)
        const after = pInner.slice(accPhrase.index + accPhrase[0].length)
        // Avoid wrapping if the match is inside an existing anchor / shortcode.
        if (!/<a\b[^<]*$/i.test(before) && !/\[su_ge-[\w-]+[^\]]*$/i.test(before)) {
          const wrappedPhrase = `[su_ge-cta type="link" cta-copy="${accPhrase[0]}" url="${accreditationUrl}"]${accPhrase[0]}[/su_ge-cta]`
          usedAccreditation.current = true
          wrapped += 1
          return `${hOpen}${pOpen}${before}${wrappedPhrase}${after}${pClose}`
        }
      }
    }

    // Degree-level section
    const levelMatch = headingText.match(/\b(associate|bachelor|master|doctorate)/)
    if (levelMatch) {
      const level = levelMatch[1]
      const url = levelRankUrls[level]
      if (url && !usedLevels.has(level)) {
        const phraseRe = new RegExp(`\\b(${level}(?:'s)?(?:\\s+degree)?|${level}'s)\\b`, 'i')
        const m = pInner.match(phraseRe)
        if (m) {
          const before = pInner.slice(0, m.index)
          const after = pInner.slice(m.index + m[0].length)
          if (!/<a\b[^<]*$/i.test(before) && !/\[su_ge-[\w-]+[^\]]*$/i.test(before)) {
            const wrappedPhrase = `[su_ge-cta type="link" cta-copy="${m[0]}" url="${url}"]${m[0]}[/su_ge-cta]`
            usedLevels.add(level)
            wrapped += 1
            return `${hOpen}${pOpen}${before}${wrappedPhrase}${after}${pClose}`
          }
        }
      }
    }

    return match
  })

  return { content: out, wrapped }
}
