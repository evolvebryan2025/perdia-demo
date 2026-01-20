import { useState, useMemo, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import {
  History,
  Check,
  Circle,
  Radio,
  Eye,
  ChevronDown,
  ChevronUp,
  Star,
  StarOff,
  Tag,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Send,
  GitCompare,
  FileText,
  Zap,
  Edit3,
  Loader2,
  X,
  Plus,
  Bookmark,
  MoreHorizontal,
  AlertCircle,
  Lightbulb,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { QuickDiff } from './VersionDiff'
import VersionComparisonTool from './VersionComparisonTool'
import {
  useUpdateVersionNotes,
  useAddVersionTag,
  useRemoveVersionTag,
  useToggleVersionStarred,
  useSetVersionBaseline,
  VERSION_TAGS,
} from '@/hooks/useGetEducatedCatalog'
import { cn } from '@/lib/utils'

/**
 * Get version type icon and configuration
 * NOTE: Uses explicit Tailwind classes (not dynamic) for build-time compatibility
 */
function getVersionTypeConfig(versionType) {
  switch (versionType) {
    case 'original':
      return { icon: FileText, color: 'gray', bgColor: 'bg-gray-100', textColor: 'text-gray-600', label: 'Original' }
    case 'ai_revision':
      return { icon: Zap, color: 'purple', bgColor: 'bg-purple-100', textColor: 'text-purple-600', label: 'AI Revision' }
    case 'manual_edit':
      return { icon: Edit3, color: 'blue', bgColor: 'bg-blue-100', textColor: 'text-blue-600', label: 'Manual Edit' }
    case 'ai_update':
      return { icon: Zap, color: 'green', bgColor: 'bg-green-100', textColor: 'text-green-600', label: 'AI Update' }
    case 'republished':
      return { icon: Radio, color: 'cyan', bgColor: 'bg-cyan-100', textColor: 'text-cyan-600', label: 'Republished' }
    default:
      return { icon: FileText, color: 'gray', bgColor: 'bg-gray-100', textColor: 'text-gray-600', label: versionType }
  }
}

/**
 * Get tag color classes
 */
function getTagColorClasses(color) {
  const colors = {
    green: 'bg-green-100 text-green-700 border-green-200',
    yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    red: 'bg-red-100 text-red-700 border-red-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    cyan: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
  }
  return colors[color] || colors.gray
}

/**
 * Simple VersionNotes - Notes/comments section for versions
 * Simplified implementation to avoid hoisting issues
 */
function VersionNotes({ versionId, initialNotes, onSave }) {
  const [isEditing, setIsEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes || '')
  const updateNotes = useUpdateVersionNotes()

  const handleSave = async () => {
    await updateNotes.mutateAsync({
      versionId,
      notes: notes.trim()
    })
    setIsEditing(false)
    onSave?.(notes.trim())
  }

  if (isEditing) {
    return (
      <div className="mt-3 space-y-2">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes or feedback about this version..."
          className="min-h-[80px] text-sm"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateNotes.isPending}
            className="gap-1"
          >
            {updateNotes.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotes(initialNotes || '')
              setIsEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (initialNotes) {
    return (
      <div className="mt-3">
        <div
          className="p-2 bg-blue-50 border border-blue-200 rounded-md text-sm flex items-start gap-2 group cursor-pointer hover:bg-blue-100"
          onClick={() => setIsEditing(true)}
        >
          <MessageSquare className="w-4 h-4 mt-0.5 text-blue-600 flex-shrink-0" />
          <p className="text-blue-800 flex-1">{initialNotes}</p>
          <Edit3 className="w-3 h-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsEditing(true)}
        className="gap-1 w-full justify-center bg-white hover:bg-blue-50 border-dashed"
      >
        <MessageSquarePlus className="w-4 h-4 text-blue-600" />
        <span className="text-blue-600">Add Feedback</span>
      </Button>
    </div>
  )
}

/**
 * VersionTags - Tag management for a version
 */
function VersionTags({ versionId, tags = [], onTagAdd, onTagRemove }) {
  const addTag = useAddVersionTag()
  const removeTag = useRemoveVersionTag()
  const [isOpen, setIsOpen] = useState(false)

  const handleAddTag = async (tagValue) => {
    await addTag.mutateAsync({ versionId, tag: tagValue })
    onTagAdd?.(tagValue)
    setIsOpen(false)
  }

  const handleRemoveTag = async (tagValue) => {
    await removeTag.mutateAsync({ versionId, tag: tagValue })
    onTagRemove?.(tagValue)
  }

  const availableTags = VERSION_TAGS.filter(t => !tags.includes(t.value))

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2">
      {tags.map(tagValue => {
        const tagConfig = VERSION_TAGS.find(t => t.value === tagValue)
        return (
          <Badge
            key={tagValue}
            variant="outline"
            className={cn(
              'text-xs gap-1 pr-1',
              tagConfig ? getTagColorClasses(tagConfig.color) : ''
            )}
          >
            {tagConfig?.label || tagValue}
            <button
              onClick={() => handleRemoveTag(tagValue)}
              className="ml-1 hover:bg-black/10 rounded-full p-0.5"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </Badge>
        )
      })}

      {availableTags.length > 0 && (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-gray-500">
              <Plus className="w-3 h-3" />
              <Tag className="w-3 h-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              {availableTags.map(tag => {
                const dotColorClasses = {
                  green: 'bg-green-500',
                  yellow: 'bg-yellow-500',
                  red: 'bg-red-500',
                  blue: 'bg-blue-500',
                  purple: 'bg-purple-500',
                  gray: 'bg-gray-500',
                  cyan: 'bg-cyan-500',
                  orange: 'bg-orange-500',
                }
                return (
                  <button
                    key={tag.value}
                    onClick={() => handleAddTag(tag.value)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-sm hover:bg-gray-100 flex items-center gap-2',
                      addTag.isPending && 'opacity-50'
                    )}
                    disabled={addTag.isPending}
                  >
                    <span className={cn('w-2 h-2 rounded-full', dotColorClasses[tag.color] || 'bg-gray-500')} />
                    {tag.label}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

/**
 * VersionCard - Individual version display card
 */
function VersionCard({
  version,
  state,
  previousVersion,
  onSelect,
  onPublish,
  onRestore,
  isRestoring,
  onExpand,
  isExpanded,
}) {
  const config = getVersionTypeConfig(version.version_type)
  const Icon = config.icon
  const toggleStarred = useToggleVersionStarred()
  const setBaseline = useSetVersionBaseline()

  const handleStar = async (e) => {
    e.stopPropagation()
    await toggleStarred.mutateAsync(version.id)
  }

  const handleSetBaseline = async () => {
    await setBaseline.mutateAsync({ articleId: version.article_id, versionId: version.id })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'border-2 rounded-lg p-4 transition-all',
        state.isSelected
          ? 'border-green-500 bg-green-50 ring-2 ring-green-200'
          : state.isLive
            ? 'border-blue-300 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {/* Selection Indicator */}
          <button
            onClick={() => onSelect(version.id)}
            className={cn(
              'mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
              state.isSelected
                ? 'border-green-500 bg-green-500'
                : state.isLive
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-gray-300 bg-white hover:border-gray-400'
            )}
          >
            {state.isSelected ? (
              <Check className="w-4 h-4 text-white" />
            ) : state.isLive ? (
              <Radio className="w-4 h-4 text-white" />
            ) : (
              <Circle className="w-4 h-4 text-gray-300" />
            )}
          </button>

          {/* Version Icon */}
          <div className={cn('p-2 rounded-lg', config.bgColor)}>
            <Icon className={cn('w-4 h-4', config.textColor)} />
          </div>

          {/* Version Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">
                Version {version.version_number}
              </span>
              <Badge variant="secondary" className="text-xs capitalize">
                {config.label}
              </Badge>
              {state.isSelected && (
                <Badge className="bg-green-600 text-xs gap-1">
                  <Check className="w-3 h-3" />
                  Selected
                </Badge>
              )}
              {state.isLive && (
                <Badge className="bg-blue-600 text-xs gap-1">
                  <Radio className="w-3 h-3" />
                  Live
                </Badge>
              )}
              {state.isLatest && !state.isSelected && !state.isLive && (
                <Badge variant="outline" className="text-xs bg-amber-50 border-amber-300 text-amber-700">
                  NEW
                </Badge>
              )}
              {version.is_starred && (
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              )}
              {version.is_baseline && (
                <Badge variant="outline" className="text-xs bg-blue-50 border-blue-300 text-blue-700 gap-1">
                  <Bookmark className="w-3 h-3" />
                  Baseline
                </Badge>
              )}
            </div>

            <p className="text-sm text-gray-500 mt-1">
              {format(new Date(version.created_at), 'MMM d, yyyy h:mm a')}
              {version.revised_by && ` by ${version.revised_by}`}
            </p>

            {version.changes_summary && (
              <p className="text-sm text-gray-600 mt-2">
                {version.changes_summary}
              </p>
            )}

            <p className="text-xs text-gray-400 mt-1">
              {version.word_count?.toLocaleString() || 0} words
            </p>

            {/* Version Tags */}
            <VersionTags
              versionId={version.id}
              tags={version.tags || []}
            />

            {/* Version Notes - Always show when expanded or has notes */}
            {(isExpanded || version.notes) && (
              <VersionNotes
                versionId={version.id}
                initialNotes={version.notes}
              />
            )}

            {/* Show notes indicator if collapsed but has notes */}
            {!isExpanded && version.notes && (
              <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                <MessageSquare className="w-3 h-3" />
                Has notes
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* Star Button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStar}
                  disabled={toggleStarred.isPending}
                  className={cn(
                    'h-8 w-8 p-0',
                    version.is_starred && 'text-yellow-500'
                  )}
                >
                  {version.is_starred ? (
                    <Star className="w-4 h-4 fill-current" />
                  ) : (
                    <StarOff className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {version.is_starred ? 'Unstar' : 'Star'} version
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Expand Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExpand(version.id)}
            className="h-8"
          >
            <Eye className="w-4 h-4 mr-1" />
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>

          {/* More Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!state.isSelected && (
                <DropdownMenuItem onClick={() => onSelect(version.id)}>
                  <Check className="w-4 h-4 mr-2" />
                  Select for Preview
                </DropdownMenuItem>
              )}
              {!version.is_baseline && (
                <DropdownMenuItem onClick={handleSetBaseline}>
                  <Bookmark className="w-4 h-4 mr-2" />
                  Set as Baseline
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!state.isLive && (
                <DropdownMenuItem
                  onClick={() => onRestore(version.id)}
                  disabled={isRestoring}
                  className="text-orange-600"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Restore This Version
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Quick Select/Publish */}
          {!state.isSelected && (
            <Button
              variant={state.isLive ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => onSelect(version.id)}
              className="gap-1"
            >
              <Check className="w-3 h-3" />
              Select
            </Button>
          )}
          {state.isSelected && !state.isLive && (
            <Button
              size="sm"
              onClick={onPublish}
              className="gap-1 bg-green-600 hover:bg-green-700"
            >
              <Send className="w-3 h-3" />
              Publish
            </Button>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-4 pt-4 border-t overflow-hidden"
          >
            {/* Quick Diff with previous version */}
            {previousVersion && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2 font-medium">
                  Changes from v{previousVersion.version_number}:
                </p>
                <QuickDiff
                  oldContent={previousVersion.content_html}
                  newContent={version.content_html}
                  maxLength={300}
                />
              </div>
            )}

            {/* Content Preview */}
            <div
              className="prose prose-sm max-w-none max-h-64 overflow-y-auto p-3 bg-white rounded-lg text-sm border"
              dangerouslySetInnerHTML={{
                __html: version.content_html?.substring(0, 5000) || '<p>No content</p>'
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * VersionHistoryPanel - Main component for managing version history
 */
export default function VersionHistoryPanel({
  articleId,
  versions = [],
  currentVersionId,
  selectedVersionId,
  isLoading = false,
  onSelectVersion,
  onRestoreVersion,
  onPublish,
  isRestoring = false,
}) {
  const [expandedVersion, setExpandedVersion] = useState(null)
  const [showCompare, setShowCompare] = useState(false)
  const [filter, setFilter] = useState('all') // all, starred, tagged

  // Sort versions by version number (newest first)
  const sortedVersions = useMemo(() =>
    [...versions].sort((a, b) => b.version_number - a.version_number),
    [versions]
  )

  // Apply filters
  const filteredVersions = useMemo(() => {
    switch (filter) {
      case 'starred':
        return sortedVersions.filter(v => v.is_starred)
      case 'tagged':
        return sortedVersions.filter(v => v.tags?.length > 0)
      default:
        return sortedVersions
    }
  }, [sortedVersions, filter])

  // Compute version states
  const versionStates = useMemo(() => {
    const states = {}
    const latestVersion = sortedVersions[0]

    sortedVersions.forEach((version) => {
      states[version.id] = {
        isSelected: version.id === selectedVersionId,
        isLive: version.id === currentVersionId || version.is_current,
        isLatest: version.id === latestVersion?.id,
        isHistorical: version.id !== selectedVersionId && version.id !== currentVersionId && !version.is_current,
      }
    })

    return states
  }, [sortedVersions, selectedVersionId, currentVersionId])

  // Get previous version for diff
  const getPreviousVersion = useCallback((version) => {
    const index = sortedVersions.findIndex(v => v.id === version.id)
    return sortedVersions[index + 1] || null
  }, [sortedVersions])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <History className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p>No version history available yet.</p>
        <p className="text-sm mt-1">Revise the article to create versions.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{versions.length} versions</span>

          {/* Filters */}
          <div className="flex items-center border rounded-lg overflow-hidden ml-4">
            <button
              onClick={() => setFilter('all')}
              className={cn(
                'px-3 py-1.5 text-sm',
                filter === 'all' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
              )}
            >
              All
            </button>
            <button
              onClick={() => setFilter('starred')}
              className={cn(
                'px-3 py-1.5 text-sm flex items-center gap-1',
                filter === 'starred' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
              )}
            >
              <Star className="w-3 h-3" />
              Starred
            </button>
            <button
              onClick={() => setFilter('tagged')}
              className={cn(
                'px-3 py-1.5 text-sm flex items-center gap-1',
                filter === 'tagged' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
              )}
            >
              <Tag className="w-3 h-3" />
              Tagged
            </button>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCompare(true)}
          className="gap-2"
          disabled={versions.length < 2}
        >
          <GitCompare className="w-4 h-4" />
          Compare Versions
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 pb-4 border-b text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-50 flex items-center justify-center">
            <Check className="w-3 h-3 text-green-600" />
          </div>
          <span className="text-gray-600">Selected for Review</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-blue-500 bg-blue-50 flex items-center justify-center">
            <Radio className="w-3 h-3 text-blue-600" />
          </div>
          <span className="text-gray-600">Live on WordPress</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-amber-50 border-amber-300 text-amber-700">
            NEW
          </Badge>
          <span className="text-gray-600">Latest Version</span>
        </div>
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
          <span className="text-gray-600">Starred</span>
        </div>
      </div>

      {/* Version List */}
      <div className="space-y-3">
        {filteredVersions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No versions match the current filter.</p>
          </div>
        ) : (
          filteredVersions.map((version) => (
            <VersionCard
              key={version.id}
              version={version}
              state={versionStates[version.id] || {}}
              previousVersion={getPreviousVersion(version)}
              onSelect={onSelectVersion}
              onPublish={onPublish}
              onRestore={onRestoreVersion}
              isRestoring={isRestoring}
              onExpand={(id) => setExpandedVersion(expandedVersion === id ? null : id)}
              isExpanded={expandedVersion === version.id}
            />
          ))
        )}
      </div>

      {/* Comparison Tool Dialog */}
      <VersionComparisonTool
        open={showCompare}
        onOpenChange={setShowCompare}
        versions={versions}
        currentVersionId={currentVersionId}
        selectedVersionId={selectedVersionId}
        onRestore={onRestoreVersion}
        onSelect={onSelectVersion}
        isRestoring={isRestoring}
      />
    </div>
  )
}
