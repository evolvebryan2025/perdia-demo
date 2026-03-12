import { useState, useCallback, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useArticles, useUpdateArticleStatus, useApproveArticle } from '../hooks/useArticles'
import { useApprovedForPublishing, useBulkPublish } from '../hooks/usePublish'
import { useAuth } from '../contexts/AuthContext'
import { useContentIdeas, useCreateContentIdea } from '../hooks/useContentIdeas'
import { cleanTitle } from '../utils/titleUtils'
import { useGenerateArticle } from '../hooks/useGeneration'
import { useSystemSettings } from '../hooks/useSystemSettings'
import { useBulkAddToQueue } from '../hooks/useAutomation'
import { useGenerationProgress } from '../contexts/GenerationProgressContext'
import { differenceInDays, differenceInHours, isPast, subDays } from 'date-fns'
import { Plus, Loader2, FileText, Clock, CheckCircle, AlertCircle, GripVertical, Sparkles, Search, Zap, Settings2, TrendingUp, ShieldCheck, AlertTriangle, Timer, DollarSign, BarChart3, UserCheck, Send, HelpCircle } from 'lucide-react'
import SourceSelector from '../components/ideas/SourceSelector'
import IdeaDiscoveryService from '../services/ideaDiscoveryService'
import { useToast } from '../components/ui/toast'
import { ProgressModal, useProgressModal, MinimizedProgressIndicator } from '../components/ui/progress-modal'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useSortable } from '@dnd-kit/sortable'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

const STATUSES = [
  { value: 'idea', label: 'Ideas', icon: FileText, color: 'bg-gray-100 text-gray-700' },
  { value: 'drafting', label: 'Drafting', icon: Loader2, color: 'bg-blue-100 text-blue-700' },
  { value: 'refinement', label: 'Refinement', icon: Clock, color: 'bg-yellow-100 text-yellow-700' },
  { value: 'qa_review', label: 'QA Review', icon: AlertCircle, color: 'bg-orange-100 text-orange-700' },
  { value: 'ready_to_publish', label: 'Ready', icon: CheckCircle, color: 'bg-green-100 text-green-700' },
]

// Helper function to get initials from email
function getInitialsFromEmail(email) {
  if (!email) return '??'
  const parts = email.split('@')[0].split(/[._-]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return email.substring(0, 2).toUpperCase()
}

function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data: articles = [], isLoading } = useArticles()
  const { data: ideas = [] } = useContentIdeas({ status: 'approved' })
  const { data: allIdeas = [] } = useContentIdeas({})
  const updateStatus = useUpdateArticleStatus()
  const approveArticle = useApproveArticle()
  const generateArticle = useGenerateArticle()
  const createContentIdea = useCreateContentIdea()
  const { data: settings } = useSystemSettings()
  const { addToast } = useToast()
  const bulkAddToQueue = useBulkAddToQueue()
  const { startQueueProcessing } = useGenerationProgress()

  // Publishing queue hooks
  const { data: publishQueue = [], isLoading: isLoadingQueue } = useApprovedForPublishing()
  const bulkPublish = useBulkPublish()
  const [isPublishing, setIsPublishing] = useState(false)

  // Get current user's initials for approval
  const userInitials = useMemo(() => getInitialsFromEmail(user?.email), [user?.email])

  const [generatingIdea, setGeneratingIdea] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [automationMode, setAutomationMode] = useState('manual') // 'manual' | 'semiauto' | 'full_auto'
  const [isStartingBatch, setIsStartingBatch] = useState(false)

  // Force refetch when navigating to dashboard to ensure fresh data
  useEffect(() => {
    // Invalidate and refetch articles and content ideas when dashboard is visited
    queryClient.invalidateQueries({ queryKey: ['articles'] })
    queryClient.invalidateQueries({ queryKey: ['content_ideas'] })
  }, [location.pathname, queryClient])

  // Progress modal for article generation
  const progressModal = useProgressModal()

  // GetEducated Metrics Calculations
  const getEducatedMetrics = useMemo(() => {
    const now = new Date()
    const weekAgo = subDays(now, 7)

    // Published this week
    const publishedThisWeek = articles.filter(a =>
      a.status === 'published' &&
      a.published_at &&
      new Date(a.published_at) > weekAgo
    ).length

    // Articles ready for auto-publish (deadline passed)
    const autoPublishReady = articles.filter(a =>
      a.status === 'ready_to_publish' &&
      a.autopublish_deadline &&
      !a.human_reviewed &&
      isPast(new Date(a.autopublish_deadline))
    ).length

    // Articles approaching deadline (within 48 hours)
    const urgentReview = articles.filter(a => {
      if (!a.autopublish_deadline || a.human_reviewed) return false
      if (a.status !== 'qa_review' && a.status !== 'ready_to_publish') return false
      const deadline = new Date(a.autopublish_deadline)
      const hoursRemaining = differenceInHours(deadline, now)
      return hoursRemaining > 0 && hoursRemaining <= 48
    }).length

    // Risk distribution
    const riskDistribution = {
      LOW: articles.filter(a => a.risk_level === 'LOW').length,
      MEDIUM: articles.filter(a => a.risk_level === 'MEDIUM').length,
      HIGH: articles.filter(a => a.risk_level === 'HIGH').length,
      CRITICAL: articles.filter(a => a.risk_level === 'CRITICAL').length,
    }

    // Average quality score
    const articlesWithQuality = articles.filter(a => a.quality_score != null)
    const avgQualityScore = articlesWithQuality.length > 0
      ? Math.round(articlesWithQuality.reduce((sum, a) => sum + a.quality_score, 0) / articlesWithQuality.length)
      : 0

    // Human reviewed vs auto-publish rate (published articles)
    const publishedArticles = articles.filter(a => a.status === 'published')
    const humanReviewedCount = publishedArticles.filter(a => a.human_reviewed).length
    const autoPublishedCount = publishedArticles.length - humanReviewedCount

    // Average time to review (for human-reviewed articles with reviewed_at)
    const reviewedArticles = articles.filter(a => a.reviewed_at && a.created_at)
    const avgReviewDays = reviewedArticles.length > 0
      ? Math.round(reviewedArticles.reduce((sum, a) => {
          return sum + differenceInDays(new Date(a.reviewed_at), new Date(a.created_at))
        }, 0) / reviewedArticles.length)
      : 0

    return {
      publishedThisWeek,
      autoPublishReady,
      urgentReview,
      riskDistribution,
      avgQualityScore,
      humanReviewedCount,
      autoPublishedCount,
      avgReviewDays,
      totalArticles: articles.length,
    }
  }, [articles])

  // Initialize idea discovery service
  const ideaDiscoveryService = new IdeaDiscoveryService()

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement required before dragging starts
      },
    })
  )

  const handleDragStart = (event) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event) => {
    const { active, over } = event

    if (!over) {
      setActiveId(null)
      return
    }

    const articleId = active.id
    const validStatuses = STATUSES.map(s => s.value)

    // Determine which column was dropped on
    let newStatus
    if (validStatuses.includes(over.id)) {
      // Dropped directly on a column
      newStatus = over.id
    } else if (over.data?.current?.type === 'article') {
      // Dropped on another article — resolve to that article's column
      const targetArticle = articles.find(a => a.id === over.id)
      newStatus = targetArticle?.status
    }

    if (!newStatus) {
      setActiveId(null)
      return
    }

    const article = articles.find(a => a.id === articleId)

    if (article && article.status !== newStatus) {
      handleStatusChange(article, newStatus)
    }

    setActiveId(null)
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const handleGenerateArticle = async (idea) => {
    setGeneratingIdea(idea.id)

    // Start progress modal
    progressModal.start(
      'Generating Article',
      `Creating "${idea.title.substring(0, 50)}${idea.title.length > 50 ? '...' : ''}"`
    )

    try {
      await generateArticle.mutateAsync({
        idea,
        options: {
          contentType: 'guide',
          targetWordCount: 2000,
          autoAssignContributor: true,
          addInternalLinks: true,
        },
        onProgress: ({ message, percentage }) => {
          // Update progress modal with current step
          progressModal.updateProgress(percentage)

          // Add step to the typing list
          if (message) {
            progressModal.addStep(message)
            // Mark previous steps as completed
            if (percentage > 10) {
              progressModal.completeStep(message)
            }
          }
        },
      })

      progressModal.addStep('Article saved to database!')
      progressModal.completeStep('Article saved to database!')
      progressModal.complete()

      addToast({
        title: 'Article Generated',
        description: `"${idea.title}" has been created successfully`,
        variant: 'success',
      })

    } catch (error) {
      console.error('Generation error:', error)
      progressModal.addStep(`Error: ${error.message}`)
      progressModal.errorStep(`Error: ${error.message}`)
      progressModal.error(error.message)
    } finally {
      setGeneratingIdea(null)
    }
  }

  const handleArticleClick = (article) => {
    navigate(`/editor/${article.id}`)
  }

  const handleStatusChange = async (article, newStatus) => {
    try {
      await updateStatus.mutateAsync({
        articleId: article.id,
        status: newStatus,
      })
    } catch (error) {
      console.error('Status update error:', error)
    }
  }

  // Handle article approval with user initials
  const handleApproveArticle = async (article) => {
    try {
      await approveArticle.mutateAsync({
        articleId: article.id,
        initials: userInitials,
      })
      addToast({
        title: 'Article Approved',
        description: `"${article.title}" has been approved by ${userInitials}`,
        variant: 'success',
      })
    } catch (error) {
      console.error('Approval error:', error)
      addToast({
        title: 'Approval Failed',
        description: error.message,
        variant: 'error',
      })
    }
  }

  // Handle publishing approved articles from the queue
  const handlePublishQueue = async () => {
    if (publishQueue.length === 0) {
      addToast({
        title: 'No Articles to Publish',
        description: 'Approve some articles first to add them to the publishing queue.',
        variant: 'info',
      })
      return
    }

    setIsPublishing(true)
    try {
      const result = await bulkPublish.mutateAsync({
        articles: publishQueue,
        options: {
          status: 'publish',
          environment: 'staging', // Default to staging for safety
        },
      })

      addToast({
        title: 'Publishing Complete',
        description: `Successfully published ${result.successful}/${result.total} articles.`,
        variant: result.failed > 0 ? 'warning' : 'success',
      })
    } catch (error) {
      console.error('Publishing error:', error)
      addToast({
        title: 'Publishing Failed',
        description: error.message,
        variant: 'error',
      })
    } finally {
      setIsPublishing(false)
    }
  }

  const getArticlesByStatus = (status) => {
    return articles.filter(a => a.status === status)
  }

  // Handle idea discovery from sources (monetization-first approach)
  const handleDiscoverIdeas = useCallback(async ({ sources, customTopic, existingTopics }) => {
    setIsDiscovering(true)

    try {
      // Get existing idea titles to avoid duplicates
      const existingTitles = allIdeas.map(idea => idea.title)

      // Discover ideas using the monetization-first service
      // Returns { ideas, rejected, stats }
      const result = await ideaDiscoveryService.discoverIdeas({
        sources,
        customTopic,
        existingTopics: existingTitles,
        strictMonetization: true, // Filter out non-monetizable ideas
        minMonetizationScore: 25,
      })

      const { ideas: discoveredIdeas, rejected, stats } = result

      // Build toast message with monetization info
      let description = `Found ${discoveredIdeas.length} monetizable content ideas`
      if (rejected?.length > 0) {
        description += ` (${rejected.length} rejected for low monetization potential)`
      }

      addToast({
        title: 'Ideas Discovered',
        description,
        variant: 'success',
      })

      // Log stats for debugging
      console.log('[Dashboard] Idea discovery stats:', stats)

      return discoveredIdeas
    } catch (error) {
      console.error('Idea discovery error:', error)
      addToast({
        title: 'Discovery Failed',
        description: error.message || 'Failed to discover ideas',
        variant: 'error',
      })
      throw error
    } finally {
      setIsDiscovering(false)
    }
  }, [allIdeas, addToast, ideaDiscoveryService])

  // Handle batch generation - Generate All button
  const handleGenerateAll = useCallback(async () => {
    if (ideas.length === 0 || isStartingBatch) return

    setIsStartingBatch(true)

    try {
      // 1. Add all approved ideas to the generation queue
      const queueItems = ideas.map((idea, index) => ({
        contentIdeaId: idea.id,
        priority: ideas.length - index, // Higher priority for earlier items
      }))

      await bulkAddToQueue.mutateAsync(queueItems)

      addToast({
        title: 'Batch Generation Started',
        description: `Added ${ideas.length} articles to the queue`,
        variant: 'success',
      })

      // 2. Start queue processing
      startQueueProcessing()

      // 3. Open the batch progress page in a new tab
      const progressWindow = window.open('/batch-progress', '_blank')

      // If popup was blocked, show a message
      if (!progressWindow) {
        addToast({
          title: 'Progress Window',
          description: 'Pop-up blocked! Check the Batch Progress page manually at /batch-progress',
          variant: 'warning',
        })
      }

    } catch (error) {
      console.error('Failed to start batch generation:', error)
      addToast({
        title: 'Batch Generation Failed',
        description: error.message || 'Failed to add items to queue',
        variant: 'error',
      })
    } finally {
      setIsStartingBatch(false)
    }
  }, [ideas, isStartingBatch, bulkAddToQueue, addToast, startQueueProcessing])

  // Handle adding selected ideas to the content queue
  const handleSourceSelectorClose = useCallback(async (open, selectedIdeas) => {
    setSourceSelectorOpen(open)

    if (selectedIdeas && selectedIdeas.length > 0) {
      // Add selected ideas to content_ideas table
      for (const idea of selectedIdeas) {
        try {
          await createContentIdea.mutateAsync({
            title: idea.title,
            description: idea.description,
            content_type: idea.content_type,
            target_keywords: idea.target_keywords,
            search_intent: idea.search_intent,
            trending_reason: idea.trending_reason,
            source: idea.source,
            status: 'approved', // Auto-approve discovered ideas
          })
        } catch (error) {
          console.error('Failed to add idea:', error)
        }
      }

      addToast({
        title: 'Ideas Added',
        description: `Added ${selectedIdeas.length} ideas to your content queue`,
        variant: 'success',
      })

      // In auto mode, start generating articles automatically
      if (automationMode === 'full_auto') {
        addToast({
          title: 'Auto Mode Active',
          description: 'Starting automatic article generation...',
          variant: 'info',
        })
        // TODO: Trigger automatic generation pipeline
      }
    }
  }, [createContentIdea, addToast, automationMode])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="w-10 h-10 text-blue-600" />
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-4 text-gray-500"
        >
          Loading your content pipeline...
        </motion.p>
      </div>
    )
  }

  // Get the active article for drag overlay
  const activeArticle = activeId ? articles.find(a => a.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="p-8"
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Content Pipeline</h1>
              <p className="text-gray-600 mt-1">Manage your content workflow from idea to publication</p>
            </div>

            {/* Auto/Manual Mode Toggle */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="flex items-center gap-2 bg-white p-3 rounded-lg border border-gray-200 shadow-sm"
            >
              <Settings2 className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Mode:</span>
              <div className="flex rounded-lg bg-gray-100 p-1">
                <button
                  onClick={() => setAutomationMode('manual')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    automationMode === 'manual'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Manual Mode: Generate articles one at a time"
                >
                  Manual
                </button>
                <button
                  onClick={() => setAutomationMode('semiauto')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    automationMode === 'semiauto'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Semi-Auto: Discover ideas, generate with approval"
                >
                  Semi-Auto
                </button>
                <button
                  onClick={() => setAutomationMode('full_auto')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    automationMode === 'full_auto'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Full Auto: Autonomous pipeline - discover, generate, fix, ready for review"
                >
                  <Zap className="w-3 h-3 inline mr-1" />
                  Auto
                </button>
              </div>
            </motion.div>
          </div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center gap-3"
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSourceSelectorOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 font-medium shadow-sm transition-all"
            >
              <Search className="w-4 h-4" />
              Find New Ideas
              <Sparkles className="w-4 h-4" />
            </motion.button>

            {automationMode === 'full_auto' && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm"
              >
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Zap className="w-4 h-4" />
                </motion.div>
                <span>Auto Mode Active - Ideas will be generated automatically</span>
              </motion.div>
            )}

            {ideas.length > 0 && automationMode !== 'manual' && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerateAll}
                disabled={isStartingBatch}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStartingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Generate All ({ideas.length})
                  </>
                )}
              </motion.button>
            )}
          </motion.div>
        </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {STATUSES.map((status, index) => {
          const count = getArticlesByStatus(status.value).length
          const StatusIcon = status.icon

          return (
            <motion.div
              key={status.value}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={{ scale: 1.02, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              className="bg-white p-4 rounded-lg border border-gray-200 cursor-default"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">{status.label}</p>
                  <motion.p
                    key={count}
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                    className="text-2xl font-bold text-gray-900 mt-1"
                  >
                    {count}
                  </motion.p>
                </div>
                <div className={`p-3 rounded-lg ${status.color}`}>
                  <StatusIcon className="w-5 h-5" />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* GetEducated Metrics Panel */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-6 mb-8"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-gray-900">GetEducated Metrics</h2>
          </div>
          <span className="text-xs text-gray-500">Auto-refreshes with data</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {/* Published This Week */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white rounded-lg p-4 border border-blue-100"
          >
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-xs text-gray-600">This Week</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{getEducatedMetrics.publishedThisWeek}</p>
            <p className="text-xs text-gray-500">articles published</p>
          </motion.div>

          {/* Average Quality Score */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white rounded-lg p-4 border border-blue-100"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-gray-600">Avg Quality</span>
            </div>
            <p className={`text-2xl font-bold ${
              getEducatedMetrics.avgQualityScore >= 85 ? 'text-green-600' :
              getEducatedMetrics.avgQualityScore >= 70 ? 'text-yellow-600' :
              'text-red-600'
            }`}>
              {getEducatedMetrics.avgQualityScore}%
            </p>
            <p className="text-xs text-gray-500">quality score</p>
          </motion.div>

          {/* Urgent Review */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className={`rounded-lg p-4 border ${
              getEducatedMetrics.urgentReview > 0
                ? 'bg-orange-50 border-orange-200'
                : 'bg-white border-blue-100'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className={`w-4 h-4 ${getEducatedMetrics.urgentReview > 0 ? 'text-orange-600' : 'text-gray-400'}`} />
              <span className="text-xs text-gray-600">Urgent</span>
            </div>
            <p className={`text-2xl font-bold ${getEducatedMetrics.urgentReview > 0 ? 'text-orange-600' : 'text-gray-900'}`}>
              {getEducatedMetrics.urgentReview}
            </p>
            <p className="text-xs text-gray-500">need review in 48h</p>
          </motion.div>

          {/* Auto-Publish Ready */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className={`rounded-lg p-4 border ${
              getEducatedMetrics.autoPublishReady > 0
                ? 'bg-purple-50 border-purple-200'
                : 'bg-white border-blue-100'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Timer className={`w-4 h-4 ${getEducatedMetrics.autoPublishReady > 0 ? 'text-purple-600' : 'text-gray-400'}`} />
              <span className="text-xs text-gray-600">Auto-Publish</span>
            </div>
            <p className={`text-2xl font-bold ${getEducatedMetrics.autoPublishReady > 0 ? 'text-purple-600' : 'text-gray-900'}`}>
              {getEducatedMetrics.autoPublishReady}
            </p>
            <p className="text-xs text-gray-500">ready to auto-publish</p>
          </motion.div>

          {/* Publish Queue */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className={`rounded-lg p-4 border cursor-pointer ${
              publishQueue.length > 0
                ? 'bg-green-50 border-green-200'
                : 'bg-white border-blue-100'
            }`}
            onClick={handlePublishQueue}
          >
            <div className="flex items-center gap-2 mb-2">
              <Send className={`w-4 h-4 ${publishQueue.length > 0 ? 'text-green-600' : 'text-gray-400'}`} />
              <span className="text-xs text-gray-600">Publish Queue</span>
            </div>
            <p className={`text-2xl font-bold ${publishQueue.length > 0 ? 'text-green-600' : 'text-gray-900'}`}>
              {isPublishing ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                publishQueue.length
              )}
            </p>
            <p className="text-xs text-gray-500">
              {isPublishing ? 'publishing...' : 'approved to publish'}
            </p>
          </motion.div>

          {/* Avg Review Time */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white rounded-lg p-4 border border-blue-100"
          >
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-gray-600">Review Time</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {getEducatedMetrics.avgReviewDays}d
            </p>
            <p className="text-xs text-gray-500">avg days to review</p>
          </motion.div>

          {/* Risk Distribution Mini Chart */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white rounded-lg p-4 border border-blue-100"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-gray-600" />
              <span className="text-xs text-gray-600">Risk Levels</span>
            </div>
            <div className="flex items-center gap-1 h-6">
              {getEducatedMetrics.riskDistribution.LOW > 0 && (
                <div
                  className="bg-green-500 h-full rounded-sm"
                  style={{ width: `${(getEducatedMetrics.riskDistribution.LOW / getEducatedMetrics.totalArticles) * 100}%`, minWidth: '8px' }}
                  title={`Low: ${getEducatedMetrics.riskDistribution.LOW}`}
                />
              )}
              {getEducatedMetrics.riskDistribution.MEDIUM > 0 && (
                <div
                  className="bg-yellow-500 h-full rounded-sm"
                  style={{ width: `${(getEducatedMetrics.riskDistribution.MEDIUM / getEducatedMetrics.totalArticles) * 100}%`, minWidth: '8px' }}
                  title={`Medium: ${getEducatedMetrics.riskDistribution.MEDIUM}`}
                />
              )}
              {getEducatedMetrics.riskDistribution.HIGH > 0 && (
                <div
                  className="bg-orange-500 h-full rounded-sm"
                  style={{ width: `${(getEducatedMetrics.riskDistribution.HIGH / getEducatedMetrics.totalArticles) * 100}%`, minWidth: '8px' }}
                  title={`High: ${getEducatedMetrics.riskDistribution.HIGH}`}
                />
              )}
              {getEducatedMetrics.riskDistribution.CRITICAL > 0 && (
                <div
                  className="bg-red-500 h-full rounded-sm"
                  style={{ width: `${(getEducatedMetrics.riskDistribution.CRITICAL / getEducatedMetrics.totalArticles) * 100}%`, minWidth: '8px' }}
                  title={`Critical: ${getEducatedMetrics.riskDistribution.CRITICAL}`}
                />
              )}
              {getEducatedMetrics.totalArticles === 0 && (
                <div className="bg-gray-200 h-full w-full rounded-sm" />
              )}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span className="text-green-600">{getEducatedMetrics.riskDistribution.LOW} low</span>
              <span className="text-red-600">{getEducatedMetrics.riskDistribution.HIGH + getEducatedMetrics.riskDistribution.CRITICAL} high</span>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 overflow-x-auto">
        {/* Ideas Column */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="bg-gray-50 rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-gray-900">Ideas</h3>
            </div>
            <span className="text-sm text-gray-600 bg-white px-2 py-1 rounded">
              {ideas.length}
            </span>
          </div>

          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {ideas.map((idea, index) => (
                <motion.div
                  key={idea.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  whileHover={{ scale: 1.02 }}
                  className="bg-white p-4 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <h4 className="font-medium text-gray-900 text-sm mb-2">{cleanTitle(idea.title)}</h4>
                  {idea.description && (
                    <p className="text-xs text-gray-600 mb-3 line-clamp-2">{idea.description}</p>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleGenerateArticle(idea)}
                    disabled={generatingIdea === idea.id}
                    className="w-full bg-blue-600 text-white text-xs py-2 px-3 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center transition-colors"
                  >
                    {generatingIdea === idea.id ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        >
                          <Loader2 className="w-3 h-3 mr-1" />
                        </motion.div>
                        Generating...
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3 mr-1" />
                        Generate Article
                      </>
                    )}
                  </motion.button>
                </motion.div>
              ))}
            </AnimatePresence>

            {ideas.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center text-sm text-gray-500 py-8"
              >
                No approved ideas yet
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Article Columns */}
        {STATUSES.slice(1).map((status, columnIndex) => {
          const statusArticles = getArticlesByStatus(status.value)
          const StatusIcon = status.icon

          return (
            <DroppableColumn key={status.value} id={status.value}>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.25 + columnIndex * 0.05 }}
                className="bg-gray-50 rounded-lg p-4 h-full"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <StatusIcon className="w-4 h-4 mr-2 text-gray-600" />
                    <h3 className="font-semibold text-gray-900">{status.label}</h3>
                  </div>
                  <motion.span
                    key={statusArticles.length}
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                    className="text-sm text-gray-600 bg-white px-2 py-1 rounded"
                  >
                    {statusArticles.length}
                  </motion.span>
                </div>

                <SortableContext
                  items={statusArticles.map(a => a.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout">
                      {statusArticles.map((article, index) => (
                        <SortableArticleCard
                          key={article.id}
                          article={article}
                          onClick={() => handleArticleClick(article)}
                          onStatusChange={handleStatusChange}
                          onApprove={handleApproveArticle}
                          index={index}
                        />
                      ))}
                    </AnimatePresence>

                    {statusArticles.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center text-sm text-gray-500 py-8 border-2 border-dashed border-gray-200 rounded-lg"
                      >
                        Drop articles here
                      </motion.div>
                    )}
                  </div>
                </SortableContext>
              </motion.div>
            </DroppableColumn>
          )
        })}
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeArticle ? (
          <ArticleCard article={activeArticle} isDragging />
        ) : null}
      </DragOverlay>

      {/* Source Selector Modal */}
      <SourceSelector
        open={sourceSelectorOpen}
        onOpenChange={handleSourceSelectorClose}
        onDiscoverIdeas={handleDiscoverIdeas}
        existingTopics={allIdeas.map(i => i.title)}
        isLoading={isDiscovering}
      />

      {/* Progress Modal for Article Generation */}
      <ProgressModal {...progressModal.modalProps} />
      <MinimizedProgressIndicator {...progressModal.minimizedProps} />
      </motion.div>
    </DndContext>
  )
}

// Droppable Column Component
function DroppableColumn({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'column',
    },
  })

  return (
    <div
      ref={setNodeRef}
      className={`transition-colors min-h-[100px] ${isOver ? 'ring-2 ring-blue-400 ring-offset-2 rounded-lg bg-blue-50/50' : ''}`}
    >
      {children}
    </div>
  )
}

// Sortable Article Card Component
function SortableArticleCard({ article, onClick, onStatusChange, onApprove, index = 0 }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: article.id,
    data: {
      type: 'article',
      article,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 50 : undefined,
  }

  const isReadyToPublish = article.status === 'ready_to_publish'
  const isApproved = article.human_reviewed && article.approved_by_initials

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={isDragging ? { duration: 0 } : { duration: 0.2, delay: index * 0.02 }}
      whileHover={isDragging ? undefined : { scale: 1.02 }}
      className={`bg-white p-4 rounded-lg border hover:shadow-md transition-shadow group ${
        isDragging ? 'cursor-grabbing shadow-lg ring-2 ring-blue-300' : 'cursor-pointer'
      } ${
        isApproved ? 'border-green-300 bg-green-50' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start space-x-2">
        {/* Drag Handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Article Content */}
        <div className="flex-1" onClick={onClick}>
          <h4 className="font-medium text-gray-900 text-sm mb-2 line-clamp-2">
            {article.title}
          </h4>

          {article.contributor_name && (
            <p className="text-xs text-gray-600 mb-2">
              By {article.contributor_name}
            </p>
          )}

          <div className="flex items-center justify-between text-xs">
            <span
              className="text-gray-500 cursor-help"
              title="Word Count: Total words in this article. Target: 1,500-2,500 words for optimal SEO."
            >
              {article.word_count || 0} words
            </span>
            <div className="flex items-center gap-2">
              {article.quality_score > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className={`px-2 py-1 rounded cursor-help ${
                    article.quality_score >= 80 ? 'bg-green-100 text-green-700' :
                    article.quality_score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}
                  title={`Quality Score: ${article.quality_score}/100. Checks word count, internal links, external citations, headings, banned links, and author. Green (80+) = Ready, Yellow (60-79) = Review, Red (<60) = Issues.`}
                >
                  {article.quality_score}
                </motion.span>
              )}

              {/* Approval Badge or Button */}
              {isReadyToPublish && (
                isApproved ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="px-2 py-1 rounded bg-green-600 text-white font-medium flex items-center gap-1"
                    title={`Approved by ${article.approved_by_initials}`}
                  >
                    <UserCheck className="w-3 h-3" />
                    {article.approved_by_initials}
                  </motion.span>
                ) : (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onApprove?.(article)
                    }}
                    className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
                    title="Approve for publishing"
                  >
                    <UserCheck className="w-3 h-3" />
                    Approve
                  </motion.button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// Simple Article Card (for drag overlay - kept separate for drag preview)
function ArticleCard({ article, isDragging = false }) {
  return (
    <motion.div
      initial={{ scale: 1, rotate: 0 }}
      animate={{ scale: 1.05, rotate: isDragging ? 3 : 0 }}
      className="bg-white p-4 rounded-lg border-2 border-blue-500 shadow-xl"
    >
      <h4 className="font-medium text-gray-900 text-sm mb-2">
        {article.title}
      </h4>
      {article.contributor_name && (
        <p className="text-xs text-gray-600">By {article.contributor_name}</p>
      )}
    </motion.div>
  )
}

export default Dashboard
