function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build an HTML block from a FAQ array using the canonical GetEducated
 * schema markup (xlsx spec rows 10–12):
 *   <h2>Frequently Asked Questions</h2>
 *   <h3>Question</h3>
 *   <p>Answer</p>
 *
 * @param {Array<{question: string, answer: string}>} faqs
 * @returns {string} HTML block — empty string when no faqs
 */
export function buildFaqHtml(faqs) {
  if (!Array.isArray(faqs) || faqs.length === 0) return ''
  const items = faqs
    .filter((f) => f && f.question && f.answer)
    .map((f) => `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`)
    .join('\n')
  if (!items) return ''
  return `\n<h2>Frequently Asked Questions</h2>\n${items}\n`
}

/**
 * Check whether the content already contains an FAQ section so we don't
 * append a duplicate when the AI happened to emit one inline.
 */
export function hasFaqSection(content) {
  if (!content) return false
  return /<h2[^>]*>\s*Frequently Asked Questions\s*<\/h2>/i.test(content)
}
