/**
 * Recency helpers. Used by NewBadge and any caller that needs a
 * consistent "is this item recent?" rule.
 */

export const NEW_THRESHOLD_DAYS = 7

export function daysSince(timestamp) {
  if (!timestamp) return Infinity
  const t = new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return Infinity
  return (Date.now() - t) / (1000 * 60 * 60 * 24)
}

export function isNew(timestamp, days = NEW_THRESHOLD_DAYS) {
  return daysSince(timestamp) <= days
}
