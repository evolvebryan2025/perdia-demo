/**
 * Shared sort-option presets used by every list page. Each option is a
 * record the SortDropdown can render directly and the data hooks can pass
 * straight to Supabase `.order(column, { ascending })`.
 */

export const CONTENT_SORT_OPTIONS = [
  { key: 'newest',     label: 'Newest first',  column: 'created_at', direction: 'desc' },
  { key: 'oldest',     label: 'Oldest first',  column: 'created_at', direction: 'asc'  },
  { key: 'title-asc',  label: 'Title A → Z',   column: 'title',      direction: 'asc'  },
  { key: 'title-desc', label: 'Title Z → A',   column: 'title',      direction: 'desc' },
]

export const PERSON_SORT_OPTIONS = [
  { key: 'name-asc',  label: 'Name A → Z',   column: 'name',       direction: 'asc'  },
  { key: 'name-desc', label: 'Name Z → A',   column: 'name',       direction: 'desc' },
  { key: 'newest',    label: 'Newest first', column: 'created_at', direction: 'desc' },
  { key: 'oldest',    label: 'Oldest first', column: 'created_at', direction: 'asc'  },
]

export const KEYWORD_SORT_OPTIONS = [
  { key: 'keyword-asc',  label: 'Keyword A → Z', column: 'keyword',    direction: 'asc'  },
  { key: 'keyword-desc', label: 'Keyword Z → A', column: 'keyword',    direction: 'desc' },
  { key: 'newest',       label: 'Newest first',  column: 'created_at', direction: 'desc' },
  { key: 'oldest',       label: 'Oldest first',  column: 'created_at', direction: 'asc'  },
]

export const REVIEW_SORT_OPTIONS = [
  { key: 'deadline-asc', label: 'Deadline soonest', column: 'autopublish_deadline', direction: 'asc'  },
  { key: 'newest',       label: 'Newest first',     column: 'created_at',           direction: 'desc' },
  { key: 'oldest',       label: 'Oldest first',     column: 'created_at',           direction: 'asc'  },
]

export const CATALOG_SORT_OPTIONS = [
  { key: 'title-asc',  label: 'Title A → Z',   column: 'title',      direction: 'asc'  },
  { key: 'title-desc', label: 'Title Z → A',   column: 'title',      direction: 'desc' },
  { key: 'newest',     label: 'Newest first',  column: 'created_at', direction: 'desc' },
  { key: 'oldest',     label: 'Oldest first',  column: 'created_at', direction: 'asc'  },
]

/**
 * Resolve a sort key (e.g. 'newest') to its full option record. Falls
 * back to the first option if the key is unknown — safe default for
 * callers that pull the key from localStorage.
 */
export function resolveSort(options, key) {
  if (!Array.isArray(options) || options.length === 0) return null
  return options.find((o) => o.key === key) || options[0]
}
