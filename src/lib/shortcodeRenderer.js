import { parseShortcode } from '../services/shortcodeService'

function escapeAttr(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function encodeAttrs(params) {
  return encodeURIComponent(JSON.stringify(params))
}

function decodeAttrs(encoded) {
  if (!encoded) return {}
  try { return JSON.parse(decodeURIComponent(encoded)) } catch { return {} }
}

function camelToKebab(s) {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

function buildCardHtml(tagName, params, defaultTitle, icon) {
  const headerText = escapeHtml(params.header || defaultTitle)
  const lines = []

  if (tagName === 'su_ge-picks') {
    lines.push(
      `category=${escapeHtml(params.category ?? '?')} concentration=${escapeHtml(params.concentration ?? '?')}` +
        (params.level ? ` level=${escapeHtml(params.level)}` : '')
    )
    if (params.ctaUrl) lines.push(`→ ${escapeHtml(params.ctaUrl)}`)
  } else if (tagName === 'su_ge-qdf') {
    lines.push(`type=${escapeHtml(params.type || 'simple')}`)
  }

  const linesHtml = lines.map((l) => `<div class="shortcode-card-line">${l}</div>`).join('')
  const ctaHtml = params.ctaButton
    ? params.ctaUrl
      ? `<a class="shortcode-card-cta" href="${escapeAttr(params.ctaUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(params.ctaButton)} →</a>`
      : `<div class="shortcode-card-cta">${escapeHtml(params.ctaButton)} →</div>`
    : ''

  const attrsEnc = encodeAttrs(params)

  return (
    `<div data-shortcode="${tagName}" data-attrs="${attrsEnc}" class="shortcode-card" contenteditable="false">` +
    `<div class="shortcode-card-header"><span class="shortcode-card-icon">${escapeHtml(icon)}</span><span class="shortcode-card-title">${headerText}</span></div>` +
    linesHtml +
    ctaHtml +
    `</div>`
  )
}

function unwrapMonetizationBlocks(html) {
  return html.replace(
    /<p\s+class="monetization-block"[^>]*>\s*(\[su_ge-[\w-]+[^\]]*\][^\[]*\[\/su_ge-[\w-]+\])\s*<\/p>/gi,
    '$1'
  )
}

export function shortcodesToHtml(input) {
  if (!input) return ''
  let out = unwrapMonetizationBlocks(input)

  out = out.replace(/\[su_ge-picks\s+[^\]]+\]\[\/su_ge-picks\]/gi, (m) => {
    const parsed = parseShortcode(m)
    if (!parsed.isValid) return m
    return buildCardHtml('su_ge-picks', parsed.params, "GetEducated's Picks", '🎓')
  })

  out = out.replace(/\[su_ge-cta\s+[^\]]+\][^\[]*\[\/su_ge-cta\]/gi, (m) => {
    const parsed = parseShortcode(m)
    if (!parsed.isValid) return m
    const params = parsed.params
    const inner = params.innerText || params.ctaCopy || 'link'
    const href = params.url || '#'
    const target = params.target === 'blank' ? ' target="_blank" rel="noopener noreferrer"' : ''
    const attrsEnc = encodeAttrs(params)
    return `<a href="${escapeAttr(href)}" data-shortcode="su_ge-cta" data-attrs="${attrsEnc}" class="shortcode-inline-link"${target}>${escapeHtml(inner)}</a>`
  })

  out = out.replace(/\[su_ge-qdf\s+[^\]]+\]\[\/su_ge-qdf\]/gi, (m) => {
    const parsed = parseShortcode(m)
    const params = parsed.isValid ? parsed.params : {}
    return buildCardHtml('su_ge-qdf', params, 'Quick Degree Find', '🔍')
  })

  return out
}

function rebuildShortcode(tagName, params) {
  const attrPairs = Object.entries(params)
    .filter(([k, v]) => k !== 'innerText' && v != null && v !== '')
    .map(([k, v]) => `${camelToKebab(k)}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ')

  if (tagName === 'su_ge-picks') {
    return `[su_ge-picks ${attrPairs}][/su_ge-picks]`
  }
  if (tagName === 'su_ge-qdf') {
    return `[su_ge-qdf ${attrPairs}][/su_ge-qdf]`
  }
  if (tagName === 'su_ge-cta') {
    const inner = params.innerText || params.ctaCopy || ''
    return `[su_ge-cta ${attrPairs}]${inner}[/su_ge-cta]`
  }
  return ''
}

export function htmlToShortcodes(html) {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') return html

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div id="__sc_root__">${html}</div>`, 'text/html')
  const root = doc.getElementById('__sc_root__')
  if (!root) return html

  const elements = Array.from(root.querySelectorAll('[data-shortcode]'))
  elements.forEach((el) => {
    const tagName = el.getAttribute('data-shortcode')
    const params = decodeAttrs(el.getAttribute('data-attrs'))

    if (tagName === 'su_ge-cta') {
      const txt = (el.textContent || '').trim()
      if (txt) params.innerText = txt
    }

    el.replaceWith(doc.createTextNode(rebuildShortcode(tagName, params)))
  })

  return root.innerHTML
}

export function stripShortcodesForCount(html) {
  if (!html) return ''
  return html
    .replace(/\[su_ge-picks\s+[^\]]+\]\[\/su_ge-picks\]/gi, '')
    .replace(/\[su_ge-cta\s+[^\]]+\]([^\[]*)\[\/su_ge-cta\]/gi, '$1')
    .replace(/\[su_ge-qdf\s+[^\]]+\]\[\/su_ge-qdf\]/gi, '')
}
