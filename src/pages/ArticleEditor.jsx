import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useArticle, useUpdateArticle, useUpdateArticleStatus } from '../hooks/useArticles'
import { useAutoFixQuality, useHumanizeContent, useReviseWithFeedback, useComplianceUpdate } from '../hooks/useGeneration'
import { calculateQualityScore, getQualityThresholds } from '../services/qualityScoreService'
import { useSubmitArticleFeedback, useUserArticleFeedback, useArticleFeedbackSummary } from '../hooks/useArticleFeedback'
import { useActiveContributors } from '../hooks/useContributors'
import { useCreateAIRevision } from '../hooks/useAIRevisions'
import { usePublishArticle, usePublishEligibility } from '../hooks/usePublish'
import {
  ArrowLeft,
  Save,
  Loader2,
  Eye,
  EyeOff,
  Settings,
  ChevronLeft,
  ChevronRight,
  Send,
  MoreVertical,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  FileText,
  Globe,
  MessageSquare,
  MessageSquarePlus,
  Brain,
  Edit3,
  ThumbsUp,
  ThumbsDown,
  RefreshCcw
} from 'lucide-react'
// TipTap editor - React 19 compatible rich text editor
import { RichTextEditor, getWordCount } from '@/components/ui/rich-text-editor'

// UI Components
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useToast, ToastProvider } from '@/components/ui/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'

// Article Sidebar Components
import {
  QualityChecklist,
  SchemaGenerator,
  LinkComplianceChecker,
  BLSCitationHelper,
  ArticleNavigationGenerator,
  ContentTypeSelector,
  ContributorAssignment,
  InternalLinkSuggester,
  ShortcodeInspector,
  MonetizationPreview,
  CommentableArticle,
  AITrainingPanel,
  AIReasoningPanel
} from '@/components/article'
import GetEducatedPreview from '@/components/article/GetEducatedPreview'

// Status options for workflow
const STATUS_OPTIONS = [
  { value: 'idea', label: 'Idea', color: 'bg-gray-100 text-gray-700' },
  { value: 'drafting', label: 'Drafting', color: 'bg-blue-100 text-blue-700' },
  { value: 'refinement', label: 'Refinement', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'qa_review', label: 'QA Review', color: 'bg-purple-100 text-purple-700' },
  { value: 'ready_to_publish', label: 'Ready', color: 'bg-green-100 text-green-700' },
  { value: 'published', label: 'Published', color: 'bg-emerald-100 text-emerald-700' }
]

function ArticleEditorContent() {
  const { articleId } = useParams()
  const navigate = useNavigate()
  const { data: article, isLoading, refetch } = useArticle(articleId)
  const updateArticle = useUpdateArticle()
  const updateStatus = useUpdateArticleStatus()
  const autoFixQuality = useAutoFixQuality()
  const humanizeContent = useHumanizeContent()
  const reviseWithFeedback = useReviseWithFeedback()
  const complianceUpdate = useComplianceUpdate()
  const createAIRevision = useCreateAIRevision()
  const { data: contributors = [] } = useActiveContributors()
  const publishArticle = usePublishArticle()
  const { toast } = useToast()

  // Article feedback hooks (thumbs up/down per Dec 22, 2025 meeting)
  const submitFeedback = useSubmitArticleFeedback()
  const { data: userFeedback } = useUserArticleFeedback(articleId)
  const { data: feedbackSummary } = useArticleFeedbackSummary(articleId)

  // Editor state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [focusKeyword, setFocusKeyword] = useState('')
  const [contentType, setContentType] = useState('guide')
  const [selectedContributorId, setSelectedContributorId] = useState(null)
  const [faqs, setFaqs] = useState([])

  // UI state
  const [saving, setSaving] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [sidebarTab, setSidebarTab] = useState('quality')
  const [showPreview, setShowPreview] = useState(false)
  const [commentMode, setCommentMode] = useState(false) // Comment mode for text selection feedback
  const [qualityData, setQualityData] = useState(null)
  const [copied, setCopied] = useState(false)
  const [isHumanizing, setIsHumanizing] = useState(false)
  const [isRevising, setIsRevising] = useState(false)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [feedbackComments, setFeedbackComments] = useState([]) // Array of comments for AI revision

  // Compliance update state (per Dec 22, 2025 meeting - "Update" button)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(null)
  
  // FIX: Preview mode reverting - Lift pendingRevision to parent
  // This ensures revised content persists when switching between modes
  const [pendingRevision, setPendingRevision] = useState(null)

  // Thumbs up/down feedback state (per Dec 22, 2025 meeting)
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false)
  const [thumbsFeedbackComment, setThumbsFeedbackComment] = useState('')

  // Update local state when article loads
  useEffect(() => {
    if (article) {
      setTitle(article.title || '')
      setContent(article.content || '')
      setMetaDescription(article.meta_description || '')
      setFocusKeyword(article.focus_keyword || '')
      setContentType(article.content_type || 'guide')
      setSelectedContributorId(article.contributor_id || null)
      setFaqs(article.faqs || [])
    }
  }, [article])

  // Calculate word count using TipTap helper
  const wordCount = useMemo(() => getWordCount(content), [content])

  // Save handler
  const handleSave = async () => {
    setSaving(true)
    try {
      // Always recalculate quality score from current content before saving
      const thresholds = await getQualityThresholds()
      const freshQuality = calculateQualityScore(content, {
        contributor_id: selectedContributorId,
        faqs,
      }, thresholds)

      await updateArticle.mutateAsync({
        articleId,
        updates: {
          title,
          content,
          meta_description: metaDescription,
          focus_keyword: focusKeyword,
          content_type: contentType,
          contributor_id: selectedContributorId,
          faqs,
          word_count: freshQuality.word_count,
          quality_score: freshQuality.score
        }
      })
      toast.success('Article saved successfully')
    } catch (error) {
      toast.error('Failed to save: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  // BUG #3 FIX: Save handler that accepts content as parameter (for CommentableArticle auto-save)
  // This is called when user approves an AI revision in comment mode
  const handleSaveWithContent = useCallback(async (newContent) => {
    try {
      const thresholds = await getQualityThresholds()
      const freshQuality = calculateQualityScore(newContent, {
        contributor_id: selectedContributorId,
        faqs,
      }, thresholds)

      await updateArticle.mutateAsync({
        articleId,
        updates: {
          title,
          content: newContent,
          meta_description: metaDescription,
          focus_keyword: focusKeyword,
          content_type: contentType,
          contributor_id: selectedContributorId,
          faqs,
          word_count: freshQuality.word_count,
          quality_score: freshQuality.score
        }
      })
      // Don't show toast here - CommentableArticle handles the success message
    } catch (error) {
      throw error // Re-throw so CommentableArticle can handle it
    }
  }, [articleId, title, metaDescription, focusKeyword, contentType, selectedContributorId, faqs, updateArticle])

  // Status change handler
  const handleStatusChange = async (newStatus) => {
    try {
      await updateStatus.mutateAsync({
        articleId,
        status: newStatus
      })
      toast.success(`Article moved to ${newStatus.replace('_', ' ')}`)
      refetch()
    } catch (error) {
      toast.error('Failed to update status')
    }
  }

  // Publish to WordPress handler
  const handlePublish = async (publishStatus = 'draft') => {
    setIsPublishing(true)
    try {
      // Recalculate quality score from current content before publishing
      const thresholds = await getQualityThresholds()
      const freshQuality = calculateQualityScore(content, {
        contributor_id: selectedContributorId,
        faqs,
      }, thresholds)

      // Build full article object with current editor state
      const articleToPublish = {
        ...article,
        title,
        content,
        meta_description: metaDescription,
        focus_keyword: focusKeyword,
        content_type: contentType,
        contributor_id: selectedContributorId,
        contributor_name: contributors.find(c => c.id === selectedContributorId)?.name,
        faqs,
        word_count: freshQuality.word_count,
        quality_score: freshQuality.score
      }

      const result = await publishArticle.mutateAsync({
        article: articleToPublish,
        options: {
          status: publishStatus,
          validateFirst: true,
          updateDatabase: true
        }
      })

      if (result.success) {
        toast.success(`Article published to WordPress as ${publishStatus}!`)
        if (result.webhookResponse?.url) {
          toast.success(`Published URL: ${result.webhookResponse.url}`)
        }
        refetch()
      } else {
        if (result.blockingIssues?.length > 0) {
          toast.error(`Cannot publish: ${result.blockingIssues.map(i => i.message).join(', ')}`)
        } else {
          toast.error(`Publish failed: ${result.error}`)
        }
      }
    } catch (error) {
      toast.error('Publish failed: ' + error.message)
    } finally {
      setIsPublishing(false)
    }
  }

  // Auto-fix handler
  const handleAutoFix = async (issues) => {
    try {
      const result = await autoFixQuality.mutateAsync({
        articleId,
        content,
        issues,
      })
      setContent(result.content)
      toast.success('Quality issues have been automatically fixed')
    } catch (error) {
      toast.error('Auto-fix failed: ' + error.message)
    }
  }

  // Humanize handler
  const handleHumanize = async () => {
    setIsHumanizing(true)
    try {
      const contributor = contributors.find(c => c.id === selectedContributorId)
      const result = await humanizeContent.mutateAsync({
        content,
        contributorStyle: contributor?.writing_style,
        contributorName: contributor?.name
      })
      setContent(result.content)
      toast.success('Content has been rewritten for natural flow')
    } catch (error) {
      toast.error('Humanization failed: ' + error.message)
    } finally {
      setIsHumanizing(false)
    }
  }

  // AI Revise handler - per GetEducated spec section 8.3.3
  // Sends article + comments as context for AI revision and logs for training
  // Updated per Dec 22, 2025 meeting: Now creates pending revision for approve/reject workflow
  const handleAIRevise = async () => {
    if (feedbackComments.length === 0 && !feedbackComment.trim()) {
      toast.error('Please add at least one feedback comment before requesting AI revision')
      return
    }

    setIsRevising(true)
    const previousContent = content
    const allComments = feedbackComment.trim()
      ? [...feedbackComments, { comment: feedbackComment.trim(), timestamp: new Date().toISOString() }]
      : feedbackComments

    try {
      // Call AI revision with feedback
      const result = await reviseWithFeedback.mutateAsync({
        content,
        title,
        feedbackItems: allComments,
        contentType,
        focusKeyword,
      })

      // Set pending revision for approve/reject workflow (per Dec 22, 2025 meeting)
      setPendingRevision({
        previousContent,
        revisedContent: result.content,
        feedbackItems: allComments,
        timestamp: new Date().toISOString(),
      })

      // Update content to show the revised version (preview mode)
      setContent(result.content)

      // Clear feedback comments (they're stored in pendingRevision)
      setFeedbackComments([])
      setFeedbackComment('')

      toast.success('AI revision ready! Review and approve or reject the changes.')
    } catch (error) {
      toast.error('AI revision failed: ' + error.message)
    } finally {
      setIsRevising(false)
    }
  }

  // Approve revision handler - per Dec 22, 2025 meeting
  // Confirms the AI revision, saves to database, and logs for training
  const handleApproveRevision = async () => {
    if (!pendingRevision) return

    const contributor = contributors.find(c => c.id === selectedContributorId)

    try {
      // Recalculate quality score from revised content before saving
      const thresholds = await getQualityThresholds()
      const freshQuality = calculateQualityScore(pendingRevision.revisedContent, {
        contributor_id: selectedContributorId,
        faqs,
      }, thresholds)

      // First, save the revised content to the database
      await updateArticle.mutateAsync({
        articleId,
        updates: {
          title,
          content: pendingRevision.revisedContent, // Use the revised content
          meta_description: metaDescription,
          focus_keyword: focusKeyword,
          content_type: contentType,
          contributor_id: selectedContributorId,
          faqs,
          word_count: freshQuality.word_count,
          quality_score: freshQuality.score
        }
      })

      // Log the approved revision for AI training (per spec section 8.4)
      await createAIRevision.mutateAsync({
        articleId,
        previousVersion: pendingRevision.previousContent,
        revisedVersion: pendingRevision.revisedContent,
        commentsSnapshot: pendingRevision.feedbackItems,
        revisionType: 'feedback',
        approved: true, // Mark as approved for RLHF positive signal
        articleContext: {
          title,
          focus_keyword: focusKeyword,
          content_type: contentType,
          contributor_name: contributor?.name || null,
          contributor_style: contributor?.writing_style || null,
          article_status: article?.status,
        },
        qualityDelta: qualityData ? {
          before: qualityData.score,
          after: null, // Will be recalculated
        } : null,
      })

      // Clear pending revision - content is saved
      setPendingRevision(null)

      toast.success('Revision approved and saved!')
    } catch (error) {
      toast.error('Failed to save revision: ' + error.message)
    }
  }

  // Reject revision handler - per Dec 22, 2025 meeting
  // Reverts to previous content and logs rejection for training
  const handleRejectRevision = async () => {
    if (!pendingRevision) return

    try {
      // Revert to previous content
      setContent(pendingRevision.previousContent)

      // Log the rejected revision for AI training (negative signal)
      await createAIRevision.mutateAsync({
        articleId,
        previousVersion: pendingRevision.previousContent,
        revisedVersion: pendingRevision.revisedContent,
        commentsSnapshot: pendingRevision.feedbackItems,
        revisionType: 'feedback',
        approved: false, // Mark as rejected for RLHF negative signal
        articleContext: {
          title,
          focus_keyword: focusKeyword,
          content_type: contentType,
        },
      })

      // Clear pending revision
      setPendingRevision(null)

      toast.success('Revision rejected. Changes reverted.')
    } catch (error) {
      // Still revert the content even if logging fails
      setContent(pendingRevision.previousContent)
      setPendingRevision(null)
      toast.error('Failed to log rejection, but changes reverted.')
    }
  }

  // Add feedback comment to list
  const handleAddFeedbackComment = () => {
    if (!feedbackComment.trim()) return
    setFeedbackComments(prev => [
      ...prev,
      { comment: feedbackComment.trim(), timestamp: new Date().toISOString() }
    ])
    setFeedbackComment('')
  }

  // Remove feedback comment from list
  const handleRemoveFeedbackComment = (index) => {
    setFeedbackComments(prev => prev.filter((_, i) => i !== index))
  }

  // Insert citation handler
  const handleInsertCitation = (citation) => {
    setContent(prev => prev + '\n' + citation)
    toast.success('BLS citation inserted at end of article')
  }

  // Insert navigation handler
  const handleInsertNavigation = (navHtml) => {
    // Insert after first paragraph
    const firstPEnd = content.indexOf('</p>')
    if (firstPEnd > -1) {
      setContent(prev =>
        prev.slice(0, firstPEnd + 4) + '\n' + navHtml + '\n' + prev.slice(firstPEnd + 4)
      )
    } else {
      setContent(prev => navHtml + '\n' + prev)
    }
    toast.success('Table of contents inserted into article')
  }

  // Schema update handler
  const handleSchemaUpdate = (newFaqs, schema) => {
    setFaqs(newFaqs)
    toast.success(`${newFaqs.length} FAQ items updated`)
  }

  // Insert internal link handler
  const handleInsertInternalLink = (linkHtml, siteArticle) => {
    // For now, append to clipboard and notify
    navigator.clipboard.writeText(linkHtml)
    toast.success(`Link to "${siteArticle.title}" copied to clipboard`)
  }

  // Copy content handler
  const handleCopyContent = async () => {
    const plainText = content.replace(/<[^>]*>/g, '')
    await navigator.clipboard.writeText(plainText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Article content copied to clipboard')
  }

  // Auto-assign contributor
  const handleAutoAssignContributor = async () => {
    // Simple scoring based on content type and title
    const titleLower = title.toLowerCase()

    const scored = contributors.map(c => {
      let score = 0
      const expertise = c.expertise_areas || []
      const types = c.content_types || []

      expertise.forEach(area => {
        if (titleLower.includes(area.toLowerCase())) score += 20
      })
      if (types.includes(contentType)) score += 30

      return { ...c, score }
    })

    const best = scored.sort((a, b) => b.score - a.score)[0]
    if (best) {
      setSelectedContributorId(best.id)
      toast.success(`${best.name} selected as best match`)
    }
  }

  // Compliance update handler (per Dec 22, 2025 meeting - "Update" button)
  // Fixes shortcodes, monetization, internal links WITHOUT rewriting prose
  const handleComplianceUpdate = async () => {
    setIsUpdating(true)
    setUpdateProgress({ message: 'Starting compliance update...', percentage: 0 })

    try {
      // Build article object with current editor state
      const articleToUpdate = {
        ...article,
        title,
        content,
        meta_description: metaDescription,
        focus_keyword: focusKeyword,
        content_type: contentType,
      }

      const result = await complianceUpdate.mutateAsync({
        article: articleToUpdate,
        options: {
          fixShortcodes: true,
          fixMonetization: true,
          fixInternalLinks: true,
          fixFormatting: true,
        },
        onProgress: (progress) => {
          setUpdateProgress(progress)
        },
      })

      // Update local content with fixed version
      setContent(result.article.content)

      // Show summary of updates
      const updateCount = result.updates?.length || 0
      if (updateCount > 0) {
        toast.success(`Compliance update complete! ${updateCount} fixes applied.`)
      } else {
        toast.success('Article is already compliant - no changes needed.')
      }

      // Refetch to get updated quality score
      refetch()
    } catch (error) {
      toast.error('Compliance update failed: ' + error.message)
    } finally {
      setIsUpdating(false)
      setUpdateProgress(null)
    }
  }

  // Thumbs up/down feedback handlers (per Dec 22, 2025 meeting)
  const handleThumbsFeedback = async (type) => {
    // If thumbs down, show dialog for optional comment
    if (type === 'negative' && !showFeedbackDialog) {
      setShowFeedbackDialog(true)
      return
    }

    try {
      await submitFeedback.mutateAsync({
        articleId,
        feedbackType: type,
        comment: type === 'negative' ? thumbsFeedbackComment : null,
      })

      toast.success(type === 'positive' ? 'Thanks for the positive feedback!' : 'Feedback recorded')
      setShowFeedbackDialog(false)
      setThumbsFeedbackComment('')
    } catch (error) {
      toast.error('Failed to submit feedback')
    }
  }

  const handleCancelFeedback = () => {
    setShowFeedbackDialog(false)
    setThumbsFeedbackComment('')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <FileText className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500">Article not found</p>
        <Button onClick={() => navigate('/')} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    )
  }

  const currentStatus = STATUS_OPTIONS.find(s => s.value === article.status)

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>

            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-900 max-w-md truncate">
                {title || 'Untitled Article'}
              </h1>
              <Badge className={currentStatus?.color}>
                {currentStatus?.label}
              </Badge>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Thumbs Up/Down Feedback - per Dec 22, 2025 meeting */}
            <div className="flex items-center gap-1 border rounded-lg px-2 py-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleThumbsFeedback('positive')}
                className={`p-1 h-7 w-7 ${userFeedback?.feedback_type === 'positive' ? 'bg-green-100 text-green-700' : 'text-gray-400 hover:text-green-600'}`}
                title="Good article"
              >
                <ThumbsUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleThumbsFeedback('negative')}
                className={`p-1 h-7 w-7 ${userFeedback?.feedback_type === 'negative' ? 'bg-red-100 text-red-700' : 'text-gray-400 hover:text-red-600'}`}
                title="Needs improvement"
              >
                <ThumbsDown className="w-4 h-4" />
              </Button>
              {feedbackSummary?.total > 0 && (
                <span className="text-xs text-gray-500 ml-1">
                  {feedbackSummary.positive}/{feedbackSummary.total}
                </span>
              )}
            </div>

            {/* Quality Score Badge */}
            {qualityData && (
              <Badge
                variant="outline"
                className={`
                  ${qualityData.score >= 80 ? 'bg-green-50 text-green-700 border-green-200' :
                    qualityData.score >= 60 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                    'bg-red-50 text-red-700 border-red-200'}
                `}
              >
                Quality: {qualityData.score}%
              </Badge>
            )}

            {/* Word Count */}
            <Badge variant="secondary">
              {wordCount} words
            </Badge>

            {/* Edit/Preview/Comment Mode Toggle */}
            <div className="flex items-center border rounded-lg overflow-hidden">
              <Button
                variant={!showPreview && !commentMode ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none border-0"
                onClick={() => { setShowPreview(false); setCommentMode(false); }}
              >
                <Edit3 className="w-4 h-4 mr-1" />
                Edit
              </Button>
              <Button
                variant={showPreview ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none border-0 border-l"
                onClick={() => { setShowPreview(true); setCommentMode(false); }}
              >
                <Eye className="w-4 h-4 mr-1" />
                Preview
              </Button>
              <Button
                variant={commentMode ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none border-0 border-l"
                onClick={() => { setShowPreview(false); setCommentMode(true); }}
              >
                <MessageSquarePlus className="w-4 h-4 mr-1" />
                Comment
              </Button>
            </div>

            {/* Sidebar Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              {showSidebar ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </Button>

            {/* More Options */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleHumanize} disabled={isHumanizing}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {isHumanizing ? 'Humanizing...' : 'Humanize Content'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyContent}>
                  {copied ? (
                    <Check className="w-4 h-4 mr-2" />
                  ) : (
                    <Copy className="w-4 h-4 mr-2" />
                  )}
                  Copy Content
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.open(article.published_url, '_blank')} disabled={!article.published_url}>
                  <Globe className="w-4 h-4 mr-2" />
                  View Published
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handlePublish('draft')}
                  disabled={isPublishing || article.status === 'published'}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Publish as Draft
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handlePublish('publish')}
                  disabled={isPublishing || article.status === 'published'}
                  className="text-green-600"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Publish Live
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Status Dropdown */}
            <Select value={article.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(status => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Save Button */}
            <Button onClick={handleSave} disabled={saving} variant="outline">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </>
              )}
            </Button>

            {/* Publish Button - prominent when ready */}
            {article.status === 'ready_to_publish' && (
              <Button
                onClick={() => handlePublish('publish')}
                disabled={isPublishing}
                className="bg-green-600 hover:bg-green-700"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Publish to WordPress
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Pending Revision Banner - per Dec 22, 2025 meeting (approve/reject UX) */}
      {pendingRevision && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
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
                className="bg-green-600 hover:bg-green-700"
              >
                <ThumbsUp className="w-4 h-4 mr-2" />
                Approve Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Editor Area */}
        <div className={`flex-1 overflow-hidden flex flex-col ${showSidebar ? 'mr-80' : ''}`}>
          {commentMode ? (
            /* Comment Mode - Text selection feedback with CommentableArticle */
            <CommentableArticle
              articleId={articleId}
              content={content}
              title={title}
              focusKeyword={focusKeyword}
              contentType={contentType}
              contributorName={contributors.find(c => c.id === selectedContributorId)?.name}
              contributorStyle={contributors.find(c => c.id === selectedContributorId)?.writing_style}
              onContentChange={setContent}
              onSave={handleSaveWithContent}
              className="flex-1"
              // FIX: Preview mode reverting - share pending revision state
              pendingRevision={pendingRevision}
              onPendingRevisionChange={setPendingRevision}
            />
          ) : showPreview ? (
            /* Preview Mode - Shows exactly how article will appear on GetEducated.com */
            /* FIX: Use pendingRevision content if available to prevent reverting */
            <ScrollArea className="flex-1">
              <GetEducatedPreview
                article={{
                  ...article,
                  title,
                  content: pendingRevision?.revisedContent || content,
                  word_count: wordCount,
                  faqs,
                  article_contributors: contributors.find(c => c.id === selectedContributorId)
                }}
              />
            </ScrollArea>
          ) : (
            /* Edit Mode */
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto space-y-6">
                {/* Title */}
                <div>
                  <Label className="mb-2">Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="text-xl font-bold"
                    placeholder="Article title..."
                  />
                </div>

                {/* Meta Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-2">Focus Keyword</Label>
                    <Input
                      value={focusKeyword}
                      onChange={(e) => setFocusKeyword(e.target.value)}
                      placeholder="Primary keyword..."
                    />
                  </div>
                  <div>
                    <Label className="mb-2">Content Type</Label>
                    <Select value={contentType} onValueChange={setContentType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="guide">Guide</SelectItem>
                        <SelectItem value="listicle">Listicle</SelectItem>
                        <SelectItem value="ranking">Ranking</SelectItem>
                        <SelectItem value="explainer">Explainer</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                        <SelectItem value="tutorial">Tutorial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="mb-2">Meta Description</Label>
                  <Textarea
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    placeholder="SEO meta description (155-160 characters)..."
                    rows={2}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {metaDescription.length}/160 characters
                  </p>
                </div>

                {/* Content Editor - TipTap WYSIWYG */}
                <div>
                  <Label className="mb-2">Content</Label>
                  <RichTextEditor
                    value={content}
                    onChange={setContent}
                    placeholder="Write your article content here..."
                    minHeight="400px"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Word count: {wordCount} | Use toolbar for formatting
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className="w-80 border-l border-gray-200 bg-white fixed right-0 top-[57px] bottom-0 flex flex-col overflow-hidden">
            <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full border-b rounded-none h-auto p-1 bg-gray-50 flex-shrink-0 flex-wrap">
                <TabsTrigger value="quality" className="flex-1 text-xs py-2">Quality</TabsTrigger>
                <TabsTrigger value="seo" className="flex-1 text-xs py-2">SEO</TabsTrigger>
                <TabsTrigger value="links" className="flex-1 text-xs py-2">Links</TabsTrigger>
                <TabsTrigger value="monetize" className="flex-1 text-xs py-2">Monetize</TabsTrigger>
                <TabsTrigger value="tools" className="flex-1 text-xs py-2">Tools</TabsTrigger>
                <TabsTrigger value="reasoning" className="flex-1 text-xs py-2">
                  <Brain className="w-3 h-3 mr-1" />
                  Reasoning
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 min-h-0">
                <div className="p-4 space-y-4">
                  {/* Quality Tab */}
                  <TabsContent value="quality" className="mt-0 space-y-4">
                    <QualityChecklist
                      article={article}
                      content={content}
                      onQualityChange={setQualityData}
                      onAutoFix={handleAutoFix}
                    />

                    <ContributorAssignment
                      article={article}
                      selectedContributorId={selectedContributorId}
                      onContributorSelect={setSelectedContributorId}
                      onAutoAssign={handleAutoAssignContributor}
                    />
                  </TabsContent>

                  {/* SEO Tab */}
                  <TabsContent value="seo" className="mt-0 space-y-4">
                    <ContentTypeSelector
                      value={contentType}
                      onChange={setContentType}
                      showDetails
                    />

                    <SchemaGenerator
                      article={article}
                      faqs={faqs}
                      onSchemaUpdate={handleSchemaUpdate}
                    />

                    <ArticleNavigationGenerator
                      content={content}
                      onNavigationGenerated={handleInsertNavigation}
                    />
                  </TabsContent>

                  {/* Links Tab */}
                  <TabsContent value="links" className="mt-0 space-y-4">
                    <LinkComplianceChecker
                      content={content}
                      onComplianceChange={(compliant, stats) => {
                        // Could update quality data here
                      }}
                    />

                    <ShortcodeInspector
                      content={content}
                      onRefresh={() => {
                        // Re-analyze shortcodes by triggering content change
                        setContent(prev => prev)
                      }}
                    />

                    <InternalLinkSuggester
                      article={article}
                      content={content}
                      onInsertLink={handleInsertInternalLink}
                    />
                  </TabsContent>

                  {/* Monetization Tab */}
                  <TabsContent value="monetize" className="mt-0 space-y-4">
                    <MonetizationPreview
                      categoryId={article?.category_id}
                      concentrationId={article?.concentration_id}
                      levelCode={article?.degree_level_code}
                      maxPrograms={5}
                    />

                    <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-2">
                      <p className="font-medium">Monetization Tips:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Use <code className="bg-gray-200 px-1 rounded">[degree_table]</code> for program listings</li>
                        <li>Use <code className="bg-gray-200 px-1 rounded">[degree_offer]</code> for single program highlights</li>
                        <li>Sponsored listings display first automatically</li>
                        <li>Links always point to GetEducated pages</li>
                      </ul>
                    </div>
                  </TabsContent>

                  {/* Tools Tab */}
                  <TabsContent value="tools" className="mt-0 space-y-4">
                    {/* Compliance Update Button - per Dec 22, 2025 meeting */}
                    <div className="p-4 bg-green-50 rounded-lg border border-green-200 space-y-3">
                      <div className="flex items-center gap-2">
                        <RefreshCcw className="w-4 h-4 text-green-600" />
                        <h3 className="font-medium text-sm text-green-900">Compliance Update</h3>
                      </div>
                      <p className="text-xs text-green-700">
                        Fix shortcodes, monetization, and internal links without changing the prose content.
                      </p>

                      {/* Progress indicator */}
                      {updateProgress && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3 h-3 animate-spin text-green-600" />
                            <span className="text-xs text-green-700">{updateProgress.message}</span>
                          </div>
                          <div className="w-full bg-green-200 rounded-full h-1.5">
                            <div
                              className="bg-green-600 h-1.5 rounded-full transition-all"
                              style={{ width: `${updateProgress.percentage || 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <Button
                        onClick={handleComplianceUpdate}
                        disabled={isUpdating}
                        className="w-full bg-green-600 hover:bg-green-700"
                        size="sm"
                      >
                        {isUpdating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          <>
                            <RefreshCcw className="w-4 h-4 mr-2" />
                            Update Article
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Thumbs Down Feedback Dialog */}
                    {showFeedbackDialog && (
                      <div className="p-4 bg-orange-50 rounded-lg border border-orange-200 space-y-3">
                        <div className="flex items-center gap-2">
                          <ThumbsDown className="w-4 h-4 text-orange-600" />
                          <h3 className="font-medium text-sm text-orange-900">What needs improvement?</h3>
                        </div>
                        <Textarea
                          value={thumbsFeedbackComment}
                          onChange={(e) => setThumbsFeedbackComment(e.target.value)}
                          placeholder="(Optional) Tell us what could be better..."
                          rows={2}
                          className="text-xs"
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={handleCancelFeedback}
                            variant="outline"
                            size="sm"
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={() => handleThumbsFeedback('negative')}
                            size="sm"
                            className="flex-1 bg-orange-600 hover:bg-orange-700"
                          >
                            Submit Feedback
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* AI Revise with Feedback - per spec section 8.3.3 */}
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-blue-600" />
                        <h3 className="font-medium text-sm text-blue-900">AI Revise with Feedback</h3>
                      </div>

                      {/* Show pending revision status - per Dec 22, 2025 meeting */}
                      {pendingRevision ? (
                        <div className="space-y-3">
                          <div className="p-3 bg-amber-100 rounded border border-amber-200">
                            <p className="text-xs font-medium text-amber-900 mb-1">
                              ⚡ Revision pending approval
                            </p>
                            <p className="text-xs text-amber-700">
                              Review the changes above and use the banner to approve or reject.
                            </p>
                          </div>
                          <div className="text-xs text-gray-500">
                            <p className="font-medium mb-1">Applied feedback:</p>
                            <ul className="list-disc list-inside space-y-1">
                              {pendingRevision.feedbackItems.map((item, idx) => (
                                <li key={idx} className="truncate">{item.comment}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-blue-700">
                            Add feedback comments and let AI revise the article. All revisions are logged for training.
                          </p>

                          {/* Existing comments */}
                          {feedbackComments.length > 0 && (
                            <div className="space-y-2">
                              {feedbackComments.map((comment, index) => (
                                <div key={index} className="flex items-start gap-2 p-2 bg-white rounded border border-blue-100">
                                  <MessageSquare className="w-3 h-3 text-blue-500 mt-1 flex-shrink-0" />
                                  <p className="text-xs text-gray-700 flex-1">{comment.comment}</p>
                                  <button
                                    onClick={() => handleRemoveFeedbackComment(index)}
                                    className="text-gray-400 hover:text-red-500"
                                  >
                                    &times;
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add comment input */}
                          <div className="space-y-2">
                            <Textarea
                              value={feedbackComment}
                              onChange={(e) => setFeedbackComment(e.target.value)}
                              placeholder="Add feedback comment (e.g., 'Make the introduction more engaging', 'Add more statistics')"
                              rows={2}
                              className="text-xs"
                            />
                            <div className="flex gap-2">
                              <Button
                                onClick={handleAddFeedbackComment}
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                disabled={!feedbackComment.trim()}
                              >
                                <MessageSquare className="w-3 h-3 mr-1" />
                                Add Comment
                              </Button>
                              <Button
                                onClick={handleAIRevise}
                                size="sm"
                                className="flex-1 bg-blue-600 hover:bg-blue-700"
                                disabled={isRevising || (feedbackComments.length === 0 && !feedbackComment.trim())}
                              >
                                {isRevising ? (
                                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <Brain className="w-3 h-3 mr-1" />
                                )}
                                {isRevising ? 'Revising...' : 'AI Revise'}
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <BLSCitationHelper
                      onInsertCitation={handleInsertCitation}
                    />

                    {/* Quick Actions */}
                    <div className="p-4 bg-gray-50 rounded-lg space-y-2">
                      <h3 className="font-medium text-sm mb-3">Quick Actions</h3>

                      <Button
                        onClick={handleHumanize}
                        disabled={isHumanizing}
                        variant="outline"
                        className="w-full justify-start"
                        size="sm"
                      >
                        {isHumanizing ? (
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        Humanize Content
                      </Button>

                      <Button
                        onClick={handleCopyContent}
                        variant="outline"
                        className="w-full justify-start"
                        size="sm"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 mr-2" />
                        ) : (
                          <Copy className="w-4 h-4 mr-2" />
                        )}
                        Copy Plain Text
                      </Button>
                    </div>
                  </TabsContent>

                  {/* AI Reasoning Tab - per Dec 18, 2025 meeting with Tony */}
                  {/* Shows AI's thinking process during generation for debugging */}
                  <TabsContent value="reasoning" className="mt-0">
                    <AIReasoningPanel reasoning={article?.ai_reasoning} />
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  )
}

function ArticleEditor() {
  return (
    <ToastProvider>
      <ArticleEditorContent />
    </ToastProvider>
  )
}

export default ArticleEditor
