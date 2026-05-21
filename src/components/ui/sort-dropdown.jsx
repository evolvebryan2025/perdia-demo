import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Reusable sort selector used by every list page. Renders as a compact
 * pill that sits beside the existing search/filter controls in the page
 * toolbar. Pass it the option set from `src/lib/sortOptions.js`.
 *
 * Props:
 *   value      — the active option key (e.g. 'newest')
 *   onChange   — (key: string) => void
 *   options    — Array<{ key, label, column, direction }>
 *   className  — optional extra classes on the trigger
 *   label      — optional dropdown header label (default: 'Sort by')
 */
export function SortDropdown({ value, onChange, options = [], className, label = 'Sort by' }) {
  const active = options.find((o) => o.key === value) || options[0]
  if (!active) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900',
          className
        )}
      >
        <ArrowUpDown className="w-4 h-4 text-gray-400" />
        <span className="hidden sm:inline text-xs text-gray-500">{label}:</span>
        <span className="font-medium">{active.label}</span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wide">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const isActive = option.key === active.key
          return (
            <DropdownMenuItem
              key={option.key}
              onClick={() => onChange?.(option.key)}
              className={cn(
                'flex items-center justify-between gap-2',
                isActive && 'font-medium text-gray-900'
              )}
            >
              <span>{option.label}</span>
              {isActive && <Check className="w-4 h-4 text-blue-600" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default SortDropdown
