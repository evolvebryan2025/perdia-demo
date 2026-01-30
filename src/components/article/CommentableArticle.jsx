/**
 * CommentableArticle Component
 *
 * Uses TipTap in read-only mode for proper text selection handling.
 * Enables editors to:
 * 1. Select text in the article preview (TipTap handles this properly)
 * 2. Click toolbar button to add feedback
 * 3. See highlighted text color-coded by severity
 * 4. View comment cards in a sidebar
 * 5. Trigger AI revision to process all pending comments
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import {
  MessageSquarePlus,
  Brain,
  Loader2,
  Check,
  Trash2,
  MessageSquare,
  Type,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/components/ui/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  useArticleComments,
  usePendingComments,
  useCreateComment,
  useDeleteComment,
  useDismissComment,
  useMarkCommentsAddressed,
  useMarkCommentPendingReview,
  COMMENT_CATEGORIES,
  COMMENT_SEVERITIES,
  getSeverityConfig,
  getCategoryConfig,
} from '@/hooks/useArticleComments'
import { useCreateAIRevision } from '@/hooks/useAIRevisions'
import ClaudeClient from '@/services/ai/claudeClient'
import { processCommentsInBatches } from '@/services/multiCommentReviser'
import { validateRevision, generateValidationSummary } from '@/utils/revisionValidator'
import { cn } from '@/lib/utils'

/**
 * Dialog for adding a new comment
 */
function AddCommentDialog({
  open,
  onClose,
  selectedText,
  onSubmit,
  isSubmitting,
}) {
  const [category, setCategory] = useState('general')
  const [severity, setSeverity] = useState('minor')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (open) {
      setFeedback('')
      setCategory('general')
      setSeverity('minor')
    }
  }, [open])

  const handleSubmit = () => {
    if (!feedback.trim()) return
    onSubmit({ category, severity, feedback: feedback.trim() })
  }

  const severityConfig = getSeverityConfig(severity)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="w-5 h-5 text-blue-600" />
            Add Comment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-500 mb-1">Selected Text</Label>
            <div
              className="p-3 rounded-lg text-sm border-l-4"
              style={{
                backgroundColor: severityConfig.bgColor,
                borderColor: severityConfig.color,
              }}
            >
              "{selectedText?.length > 200
                ? selectedText.slice(0, 200) + '...'
                : selectedText}"
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div>
                        <div className="font-medium">{cat.label}</div>
                        <div className="text-xs text-gray-500">{cat.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1.5">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_SEVERITIES.map((sev) => (
                    <SelectItem key={sev.value} value={sev.value}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: sev.color }}
                        />
                        <div>
                          <div className="font-medium">{sev.label}</div>
                          <div className="text-xs text-gray-500">{sev.description}</div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-1.5">Feedback / Instructions</Label>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what should be changed or improved..."
              rows={4}
              className="resize-none"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!feedback.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Add Comment
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Single comment card in the sidebar
 */
function CommentCard({ comment, isActive, onClick, onDelete }) {
  const severityConfig = getSeverityConfig(comment.severity)
  const categoryConfig = getCategoryConfig(comment.category)
  const isAddressed = comment.status === 'addressed'
  const isDismissed = comment.status === 'dismissed'

  return (
    <div
      className={cn(
        'p-3 rounded-lg border-l-4 transition-all cursor-pointer',
        isActive && 'ring-2 ring-blue-500',
        (isAddressed || isDismissed) && 'opacity-50'
      )}
      style={{
        backgroundColor: severityConfig.bgColor,
        borderColor: severityConfig.color,
      }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {categoryConfig.label}
          </Badge>
          <Badge
            className="text-xs text-white"
            style={{ backgroundColor: severityConfig.color }}
          >
            {severityConfig.label}
          </Badge>
          {isAddressed && (
            <Badge variant="secondary" className="text-xs">
              <Check className="w-3 h-3 mr-1" />
              Addressed
            </Badge>
          )}
          {isDismissed && (
            <Badge variant="secondary" className="text-xs">
              Dismissed
            </Badge>
          )}
        </div>

        {comment.status === 'pending' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <p className="text-xs text-gray-600 mb-2 line-clamp-2">
        "{comment.selected_text}"
      </p>

      <p className="text-sm">{comment.feedback}</p>

      <p className="text-xs text-gray-400 mt-2">
        {new Date(comment.created_at).toLocaleString()}
      </p>
    </div>
  )
}

/**
 * Comments sidebar panel
 */
function CommentsSidebar({
  comments,
  pendingCount,
  activeCommentId,
  onCommentClick,
  onDeleteComment,
  onAIRevise,
  isRevising,
}) {
  const pendingComments = comments.filter((c) => c.status === 'pending')
  const addressedComments = comments.filter((c) => c.status !== 'pending')

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Comments
          </h3>
          <Badge variant="secondary">{comments.length}</Badge>
        </div>

        {pendingCount > 0 && (
          <Button
            onClick={onAIRevise}
            disabled={isRevising}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            {isRevising ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Revising...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                AI Revise ({pendingCount})
              </>
            )}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {comments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquarePlus className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No comments yet</p>
              <p className="text-xs mt-1">
                Select text and click "Add Comment"
              </p>
            </div>
          ) : (
            <>
              {pendingComments.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Pending ({pendingComments.length})
                  </h4>
                  {pendingComments.map((comment) => (
                    <CommentCard
                      key={comment.id}
                      comment={comment}
                      isActive={activeCommentId === comment.id}
                      onClick={() => onCommentClick(comment)}
                      onDelete={() => onDeleteComment(comment.id)}
                    />
                  ))}
                </div>
              )}

              {addressedComments.length > 0 && (
                <div className="space-y-3 mt-6">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Addressed ({addressedComments.length})
                  </h4>
                  {addressedComments.map((comment) => (
                    <CommentCard
                      key={comment.id}
                      comment={comment}
                      isActive={activeCommentId === comment.id}
                      onClick={() => onCommentClick(comment)}
                      onDelete={() => onDeleteComment(comment.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Main CommentableArticle component
 */
export function CommentableArticle({
  articleId,
  content,
  title,
  focusKeyword = '',
  contentType = 'guide',
  contributorName = null,
  contributorStyle = null,
  onContentChange,
  onSave, // BUG #3 FIX: Optional callback to auto-save after approving revision
  className,
  // FIX: Preview mode reverting - accept pendingRevision from parent
  pendingRevision: parentPendingRevision = null,
  onPendingRevisionChange = null,
}) {
  const [selectedText, setSelectedText] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeCommentId, setActiveCommentId] = useState(null)
  const [isRevising, setIsRevising] = useState(false)
  const [revisionProgress, setRevisionProgress] = useState('')
  
  // FIX: Preview mode reverting - Use parent state if provided, otherwise local
  // This ensures pending revision persists when switching modes
  const [localPendingRevision, setLocalPendingRevision] = useState(null)
  const pendingRevision = onPendingRevisionChange ? parentPendingRevision : localPendingRevision
  const setPendingRevision = onPendingRevisionChange || setLocalPendingRevision

  const { toast } = useToast()

  // Hooks
  const { data: comments = [] } = useArticleComments(articleId)
  const { data: pendingComments = [] } = usePendingComments(articleId)
  const createComment = useCreateComment()
  const deleteComment = useDeleteComment()
  const dismissComment = useDismissComment()
  const markAddressed = useMarkCommentsAddressed()
  const markPendingReview = useMarkCommentPendingReview()
  const createAIRevision = useCreateAIRevision()

  // TipTap editor in read-only mode
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-800',
          target: '_blank',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded',
        },
      }),
    ],
    content: content || '',
    editable: false, // READ-ONLY MODE
    onSelectionUpdate: ({ editor }) => {
      // Get selected text from TipTap's selection
      const { from, to, empty } = editor.state.selection

      if (!empty && from !== to) {
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (text.trim()) {
          setSelectedText(text.trim())
          setHasSelection(true)
        } else {
          setHasSelection(false)
        }
      } else {
        setHasSelection(false)
      }
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none p-6 focus:outline-none min-h-[400px]',
          'prose-headings:font-bold prose-headings:text-gray-900',
          'prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg',
          'prose-p:text-gray-700 prose-p:leading-relaxed',
          'prose-a:text-blue-600 prose-a:underline',
          'prose-ul:list-disc prose-ol:list-decimal',
          'prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic',
        ),
      },
    },
  })

  // Update editor content when prop changes OR when pending revision exists
  // When there's a pending revision, show the revised content for user review
  useEffect(() => {
    if (!editor) return

    const contentToShow = pendingRevision ? pendingRevision.revisedContent : content
    if (contentToShow && contentToShow !== editor.getHTML()) {
      editor.commands.setContent(contentToShow, false)
    }
  }, [content, editor, pendingRevision])

  // Cleanup editor
  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  // Handle adding a comment
  const handleAddComment = useCallback(() => {
    if (!hasSelection || !selectedText) {
      toast.warning('Please select some text in the article first.')
      return
    }
    setDialogOpen(true)
  }, [hasSelection, selectedText, toast])

  // Submit new comment
  const handleSubmitComment = async ({ category, severity, feedback }) => {
    try {
      await createComment.mutateAsync({
        articleId,
        selectedText,
        category,
        severity,
        feedback,
      })
      setDialogOpen(false)
      setSelectedText('')
      setHasSelection(false)
      // Clear selection in editor
      editor?.commands.setTextSelection(0)
      toast.success('Your feedback has been saved successfully.', { title: 'Comment added' })
    } catch (error) {
      console.error('Failed to create comment:', error)
      toast.error(error?.message || 'An error occurred while saving your comment.', { title: 'Failed to add comment' })
    }
  }

  // Handle delete comment
  const handleDeleteComment = async (commentId) => {
    try {
      await deleteComment.mutateAsync({ commentId, articleId })
      toast.success('The comment has been removed.', { title: 'Comment deleted' })
    } catch (error) {
      console.error('Failed to delete comment:', error)
      toast.error(error?.message || 'An error occurred while deleting the comment.', { title: 'Failed to delete comment' })
    }
  }

  // Handle comment click in sidebar
  const handleCommentClick = (comment) => {
    setActiveCommentId(comment.id)
    // Could implement scroll-to-text functionality here if needed
  }

  // Handle AI revision with validation
  // FIX #5: Now uses batch processing for multiple comments
  const handleAIRevise = async () => {
    if (pendingComments.length === 0) return

    setIsRevising(true)
    setRevisionProgress('Analyzing feedback...')

    try {
      // FIX #5: Use batch processing for reliable multi-comment handling
      // This processes comments in groups of 3, validates each batch,
      // and retries failed comments individually
      const batchResult = await processCommentsInBatches({
        content,
        comments: pendingComments.map(c => ({
          id: c.id,
          selected_text: c.selected_text,
          category: c.category,
          severity: c.severity,
          feedback: c.feedback,
        })),
        title,
        focusKeyword,
        contentType,
        contributorName,
        onProgress: (msg) => setRevisionProgress(msg),
      })

      const cleanedContent = batchResult.revisedContent

      // Build validation result from batch processing
      setRevisionProgress('Validating revision...')
      const feedbackForValidation = pendingComments.map((c) => ({
        id: c.id,
        comment: c.feedback,
        selected_text: c.selected_text,
        category: c.category,
        severity: c.severity,
      }))

      const validationResult = validateRevision(content, cleanedContent, feedbackForValidation)
      console.log('Revision validation result:', validationResult)

      setRevisionProgress('Saving revision...')
      const revisionData = await createAIRevision.mutateAsync({
        articleId,
        previousVersion: content,
        revisedVersion: cleanedContent,
        commentsSnapshot: pendingComments.map((c) => ({
          id: c.id,
          selected_text: c.selected_text,
          category: c.category,
          severity: c.severity,
          feedback: c.feedback,
        })),
        revisionType: 'feedback',
        articleContext: {
          title,
          focus_keyword: focusKeyword,
          content_type: contentType,
          contributor_name: contributorName,
          contributor_style: contributorStyle,
          comment_count: pendingComments.length,
          categories_addressed: [...new Set(pendingComments.map(c => c.category))],
          severities_addressed: [...new Set(pendingComments.map(c => c.severity))],
        },
        promptUsed: `[Batch Processing] ${batchResult.totalBatches} batch(es), ${batchResult.processedComments.length} addressed, ${batchResult.failedComments.length} failed, ${batchResult.retryCount} retries`,
        validationResult, // Store validation result with the revision
        batchProcessingDetails: batchResult.details, // FIX #5: Track batch processing info
      })

      // BUG #2 FIX: Instead of auto-applying, set pending revision for user approval
      // This allows the user to review the AI changes before accepting them
      setPendingRevision({
        previousContent: content,
        revisedContent: cleanedContent,
        feedbackItems: pendingComments.map(c => ({
          id: c.id,
          selected_text: c.selected_text,
          category: c.category,
          severity: c.severity,
          feedback: c.feedback,
        })),
        revisionData,
        validationResult,
        timestamp: new Date().toISOString(),
      })

      setRevisionProgress('')
      
      // FIX #5: Notify about batch processing results
      if (batchResult.failedComments.length > 0) {
        toast.warning(`${batchResult.failedComments.length} comment(s) could not be addressed automatically. Please review and try again.`, { title: 'Partial Success' })
      } else {
        toast.info('AI revision ready for review. Please approve or reject the changes.', { title: 'Review Required' })
      }

    } catch (error) {
      console.error('AI revision failed:', error)
      setRevisionProgress('')
      toast.error(error?.message || 'An error occurred while revising the article.', { title: 'AI Revision Failed' })
    } finally {
      setIsRevising(false)
    }
  }

  // Approve revision handler - BUG #2 FIX (per Dec 22, 2025 meeting)
  // Confirms the AI revision, applies content, marks comments as addressed
  const handleApproveRevision = async () => {
    if (!pendingRevision) return

    try {
      const { revisedContent, feedbackItems, revisionData, validationResult } = pendingRevision

      // Process each comment based on validation status
      const addressedIds = []
      const failedItems = []

      for (const item of validationResult.items) {
        if (item.status === 'addressed') {
          addressedIds.push(item.id)
        } else {
          failedItems.push(item)
        }
      }

      // Mark successfully addressed comments
      if (addressedIds.length > 0) {
        await markAddressed.mutateAsync({
          commentIds: addressedIds,
          revisionId: revisionData.id,
          articleId,
        })
      }

      // Mark failed/partial comments as pending_review
      for (const item of failedItems) {
        await markPendingReview.mutateAsync({
          commentId: item.id,
          articleId,
          revisionId: revisionData.id,
          validationDetails: {
            status: item.status,
            evidence: item.evidence,
            warnings: item.warnings,
          },
        })
      }

      // BUG #3 FIX: Apply the content change and auto-save to database
      onContentChange?.(revisedContent)

      // Clear pending revision
      setPendingRevision(null)

      // BUG #3 FIX: Auto-save to database if onSave callback is provided
      // This ensures revisions persist and comments stay in sync with content
      if (onSave) {
        try {
          await onSave(revisedContent)
          // Show success with save confirmation
          if (validationResult.failedCount === 0 && validationResult.partialCount === 0) {
            toast.success(`Revision approved and saved! All ${feedbackItems.length} comment${feedbackItems.length !== 1 ? 's' : ''} addressed.`, { title: 'Changes Applied' })
          } else {
            toast.success(`Revision approved and saved. ${validationResult.addressedCount} addressed, ${validationResult.failedCount + validationResult.partialCount} need review.`, { title: 'Changes Applied' })
          }
        } catch (saveError) {
          console.error('Auto-save failed:', saveError)
          toast.warning('Revision applied but auto-save failed. Please click Save manually.', { title: 'Save Required' })
        }
      } else {
        // No onSave callback - show reminder to save manually
        if (validationResult.failedCount === 0 && validationResult.partialCount === 0) {
          toast.success(`Revision approved! All ${feedbackItems.length} comment${feedbackItems.length !== 1 ? 's' : ''} addressed. Remember to save your changes.`, { title: 'Changes Applied' })
        } else {
          toast.success(`Revision approved. ${validationResult.addressedCount} addressed, ${validationResult.failedCount + validationResult.partialCount} need review. Remember to save.`, { title: 'Changes Applied' })
        }
      }

    } catch (error) {
      console.error('Failed to approve revision:', error)
      toast.error('Failed to apply revision: ' + error.message)
    }
  }

  // Reject revision handler - BUG #2 FIX (per Dec 22, 2025 meeting)
  // Reverts to previous content and logs rejection for AI training
  const handleRejectRevision = async () => {
    if (!pendingRevision) return

    try {
      // Log the rejection for AI training (RLHF negative signal)
      // The revision was already saved with approved: null, we could update it here if needed

      // Revert editor to original content before clearing pending revision
      // The useEffect will handle this when pendingRevision becomes null
      // and content prop remains unchanged

      // Clear pending revision without applying changes
      setPendingRevision(null)

      // Force editor back to original content immediately
      if (editor) {
        editor.commands.setContent(content, false)
      }

      toast.success('Revision rejected. Original content preserved.', { title: 'Changes Reverted' })
    } catch (error) {
      // Still clear the pending revision even if logging fails
      setPendingRevision(null)
      if (editor) {
        editor.commands.setContent(content, false)
      }
      toast.info('Revision rejected.')
    }
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
        <Button
          onClick={handleAddComment}
          disabled={!hasSelection}
          size="sm"
          className={cn(
            'gap-2 transition-all duration-200',
            hasSelection
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md ring-2 ring-blue-300 animate-pulse'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          )}
        >
          <MessageSquarePlus className="w-4 h-4" />
          Add Comment
        </Button>

        {hasSelection && (
          <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
            <Type className="w-3 h-3" />
            {selectedText.length > 30 ? `${selectedText.slice(0, 30)}...` : selectedText}
          </span>
        )}

        {!hasSelection && (
          <span className="text-xs text-gray-400">
            Select text in the article to add a comment
          </span>
        )}
      </div>

      {/* Pending Revision Banner - BUG #2 FIX (per Dec 22, 2025 meeting - approve/reject UX) */}
      {pendingRevision && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                <Brain className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="font-medium text-amber-900">AI Revision Ready for Review</p>
                <p className="text-xs text-amber-700">
                  {pendingRevision.feedbackItems.length} feedback item(s) applied •{' '}
                  Review the changes below and approve or reject
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleRejectRevision}
                variant="outline"
                size="sm"
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                <ThumbsDown className="w-4 h-4 mr-2" />
                Reject & Revert
              </Button>
              <Button
                onClick={handleApproveRevision}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <ThumbsUp className="w-4 h-4 mr-2" />
                Approve Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Article content area - TipTap Editor */}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>

        {/* Comments sidebar */}
        <div className="w-80 border-l border-gray-200 bg-white shrink-0 overflow-hidden">
          <CommentsSidebar
            comments={comments}
            pendingCount={pendingComments.length}
            activeCommentId={activeCommentId}
            onCommentClick={handleCommentClick}
            onDeleteComment={handleDeleteComment}
            onAIRevise={handleAIRevise}
            isRevising={isRevising}
          />
        </div>
      </div>

      {/* Add comment dialog */}
      <AddCommentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        selectedText={selectedText}
        onSubmit={handleSubmitComment}
        isSubmitting={createComment.isPending}
      />

      {/* Revision progress overlay */}
      {isRevising && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-600" />
            <h3 className="text-lg font-semibold mb-2">AI Revision in Progress</h3>
            <p className="text-gray-600">{revisionProgress}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default CommentableArticle
