import { Clock } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

/**
 * Compact "Mar 21 · 3 days ago" label for list cards.
 *
 * Always visible (no hover required) so editors can see how fresh an
 * item is without clicking in. If both `created` and `updated` are
 * supplied and `updated` is meaningfully newer, the label uses
 * `updated` and prefixes "Updated" so the editor knows the bump was an
 * edit not the original creation.
 *
 * Props:
 *   timestamp           — ISO string. The single value to display when no separate
 *                         updated time is supplied.
 *   createdAt, updatedAt — alternative API: pass both, the component picks the right one.
 *   className           — optional extra classes.
 */
export function DateLabel({ timestamp, createdAt, updatedAt, className }) {
  let stamp = timestamp
  let prefix = ''
  if (!stamp && (createdAt || updatedAt)) {
    if (updatedAt && createdAt) {
      const u = new Date(updatedAt).getTime()
      const c = new Date(createdAt).getTime()
      if (Number.isFinite(u) && Number.isFinite(c) && u - c > 60_000) {
        stamp = updatedAt
        prefix = 'Updated '
      } else {
        stamp = createdAt
      }
    } else {
      stamp = updatedAt || createdAt
    }
  }
  if (!stamp) return null

  const d = new Date(stamp)
  if (!Number.isFinite(d.getTime())) return null

  let relative = ''
  try {
    relative = formatDistanceToNow(d, { addSuffix: true })
  } catch {
    relative = ''
  }
  const short = format(d, 'MMM d')

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap',
        className
      )}
      title={d.toLocaleString()}
    >
      <Clock className="w-3 h-3" />
      <span>
        {prefix}
        {short}
        {relative && (
          <span className="text-gray-400"> · {relative}</span>
        )}
      </span>
    </span>
  )
}

export default DateLabel
