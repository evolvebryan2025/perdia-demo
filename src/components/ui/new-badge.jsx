import { Sparkles } from 'lucide-react'
import { Badge } from './badge'
import { cn } from '@/lib/utils'
import { isNew, NEW_THRESHOLD_DAYS } from '@/lib/recency'

/**
 * Amber "NEW" pill rendered when the supplied timestamp is within the
 * threshold window (default 7 days). Renders nothing when older — call
 * sites can drop it into a card header unconditionally.
 *
 * Style intentionally matches the existing recency pill in
 * VersionHistoryPanel.jsx:506-510 so the visual language stays consistent.
 */
export function NewBadge({ timestamp, thresholdDays = NEW_THRESHOLD_DAYS, className }) {
  if (!isNew(timestamp, thresholdDays)) return null
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs bg-amber-50 border-amber-300 text-amber-700 gap-1',
        className
      )}
    >
      <Sparkles className="w-3 h-3" />
      NEW
    </Badge>
  )
}

export default NewBadge
