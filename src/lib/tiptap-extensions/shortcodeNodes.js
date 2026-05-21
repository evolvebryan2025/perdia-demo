import { Node, mergeAttributes } from '@tiptap/core'

function decodeAttrs(encoded) {
  if (!encoded || encoded === '%7B%7D') return {}
  try { return JSON.parse(decodeURIComponent(encoded)) } catch { return {} }
}

function buildCardChildren(tagName, params) {
  let defaultTitle = "GetEducated's Picks"
  let icon = '🎓'
  if (tagName === 'su_ge-qdf') { defaultTitle = 'Quick Degree Find'; icon = '🔍' }
  if (tagName === 'su_ge-cta') { defaultTitle = 'Call to Action'; icon = '🔗' }

  const headerText = params.header || defaultTitle
  const lines = []

  if (tagName === 'su_ge-picks') {
    lines.push(
      `category=${params.category ?? '?'} concentration=${params.concentration ?? '?'}` +
        (params.level ? ` level=${params.level}` : '')
    )
    if (params.ctaUrl) lines.push(`→ ${params.ctaUrl}`)
  } else if (tagName === 'su_ge-qdf') {
    lines.push(`type=${params.type || 'simple'}`)
  }

  const children = [
    ['div', { class: 'shortcode-card-header' },
      ['span', { class: 'shortcode-card-icon' }, icon],
      ['span', { class: 'shortcode-card-title' }, headerText],
    ],
  ]
  lines.forEach((l) => children.push(['div', { class: 'shortcode-card-line' }, l]))
  if (params.ctaButton) {
    children.push(['div', { class: 'shortcode-card-cta' }, `${params.ctaButton} →`])
  }
  return children
}

function createShortcodeNode(name, tagName) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        dataShortcode: {
          default: tagName,
          parseHTML: (el) => el.getAttribute('data-shortcode') || tagName,
          renderHTML: (attrs) => ({ 'data-shortcode': attrs.dataShortcode || tagName }),
        },
        dataAttrs: {
          default: '%7B%7D',
          parseHTML: (el) => el.getAttribute('data-attrs') || '%7B%7D',
          renderHTML: (attrs) => ({ 'data-attrs': attrs.dataAttrs || '%7B%7D' }),
        },
      }
    },

    parseHTML() {
      return [{ tag: `div[data-shortcode="${tagName}"]` }]
    },

    renderHTML({ HTMLAttributes, node }) {
      const params = decodeAttrs(node.attrs.dataAttrs)
      return [
        'div',
        mergeAttributes(HTMLAttributes, { class: 'shortcode-card', contenteditable: 'false' }),
        ...buildCardChildren(tagName, params),
      ]
    },
  })
}

export const SuGePicks = createShortcodeNode('suGePicks', 'su_ge-picks')
export const SuGeCta = createShortcodeNode('suGeCta', 'su_ge-cta')
export const SuGeQdf = createShortcodeNode('suGeQdf', 'su_ge-qdf')
