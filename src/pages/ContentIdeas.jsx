import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  useContentIdeas,
  useCreateContentIdea,
  useUpdateContentIdea,
  useIdeaFeedback,
  useRejectIdeaWithReason,
  useApproveIdeaWithFeedback,
} from '../hooks/useContentIdeas'
import { cleanTitle } from '../utils/titleUtils'
import { useDeleteContentIdeaWithReason } from '../hooks/useDeletionLog'
import { useGenerateArticle } from '../hooks/useGeneration'
import {
  useRecordFeedback,
  useUntrainedFeedback,
  useFeedbackStats,
  REJECTION_CATEGORIES,
} from '../hooks/useIdeaFeedbackHistory'
import IdeaDiscoveryService from '../services/ideaDiscoveryService'
import {
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
  Sparkles,
  FileText,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  History,
  Brain,
  ChevronRight,
  BarChart3,
  DollarSign,
  TrendingUp,
  Search,
  Lightbulb,
  ToggleLeft,
  ToggleRight,
  Wand2,
  Eye,
  ChevronDown,
  ChevronUp,
  Maximize2,
  X,
} from 'lucide-react'
import { ProgressModal, useProgressModal, MinimizedProgressIndicator } from '../components/ui/progress-modal'
import IdeaFeedbackHistory from '../components/ideas/IdeaFeedbackHistory'
import AILearningModal from '../components/ideas/AILearningModal'
import TitleSuggestions from '../components/ideas/TitleSuggestions'
import { DeleteWithReasonModal } from '../components/ui/DeleteWithReasonModal'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'
import { useErrorModal } from '../components/ui/ErrorModal'
import ArticlePreviewModal from '../components/ideas/ArticlePreviewModal'
import { SortDropdown } from '../components/ui/sort-dropdown'
import { NewBadge } from '../components/ui/new-badge'
import { DateLabel } from '../components/ui/date-label'
import { CONTENT_SORT_OPTIONS, resolveSort } from '../lib/sortOptions'
import { useStoredState } from '../lib/useStoredState'

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700', icon: FileText },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700', icon: XCircle },
  completed: { label: 'Completed', color: 'bg-blue-100 text-blue-700', icon: CheckCircle },
}

function ContentIdeas() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState(null)
  const [filterMonetization, setFilterMonetization] = useState(null) // high, medium, low, or null for all
  const [searchQuery, setSearchQuery] = useState('')
  const [generatingIdea, setGeneratingIdea] = useState(null)
  const [rejectModalIdea, setRejectModalIdea] = useState(null) // For rejection reason modal
  const [activeTab, setActiveTab] = useState('ideas') // ideas, history
  const [learningModalOpen, setLearningModalOpen] = useState(false)
  const [deleteModalIdea, setDeleteModalIdea] = useState(null) // For delete with reason modal

  // Article preview modal state
  const [previewArticleId, setPreviewArticleId] = useState(null)
  const [completedArticleIds, setCompletedArticleIds] = useState([])

  // Dual-Track Mode: monetization-first (default) or free-form research
  // Per Dec 22, 2025 meeting - allows user-initiated research mode
  const [ideaMode, setIdeaMode] = useState('monetization') // 'monetization' or 'research'
  const [showResearchModal, setShowResearchModal] = useState(false)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [researchTopic, setResearchTopic] = useState('')

  // Progress modal for article generation
  const progressModal = useProgressModal()

  // Error modal for structured error display
  const { showError, errorModal } = useErrorModal()

  // Persisted sort preference. Default: newest first.
  const [sortKey, setSortKey] = useStoredState('perdia:sort:ideas', 'newest')
  const sort = resolveSort(CONTENT_SORT_OPTIONS, sortKey)

  const { data: ideas = [], isLoading } = useContentIdeas({
    status: filterStatus,
    search: searchQuery || undefined,
    sort,
  })
  const createIdea = useCreateContentIdea()
  const updateIdea = useUpdateContentIdea()
  const deleteIdeaWithReason = useDeleteContentIdeaWithReason()
  const generateArticle = useGenerateArticle()
  const ideaFeedback = useIdeaFeedback()
  const rejectWithReason = useRejectIdeaWithReason()
  const approveWithFeedback = useApproveIdeaWithFeedback()
  const recordFeedback = useRecordFeedback()
  const { data: untrainedFeedback = [] } = useUntrainedFeedback(100)
  const { data: feedbackStats } = useFeedbackStats()

  const handleCreateIdea = async (formData) => {
    try {
      await createIdea.mutateAsync(formData)
      setIsModalOpen(false)
    } catch (error) {
      showError(error, {
        action: 'create idea',
        context: { ideaTitle: formData.title },
        onRetry: () => handleCreateIdea(formData),
      })
    }
  }

  const handleApprove = async (ideaId) => {
    try {
      await updateIdea.mutateAsync({
        ideaId,
        updates: { status: 'approved' },
      })
      // Record feedback for AI learning
      await recordFeedback.mutateAsync({
        ideaId,
        decision: 'approved',
      })
    } catch (error) {
      showError(error, {
        action: 'approve idea',
        context: { ideaId },
        onRetry: () => handleApprove(ideaId),
      })
    }
  }

  // Open rejection modal instead of immediate rejection
  const handleReject = (idea) => {
    setRejectModalIdea(idea)
  }

  // Handle rejection with reason (from modal)
  const handleRejectWithReason = async (rejectionData) => {
    try {
      await rejectWithReason.mutateAsync({
        ideaId: rejectModalIdea.id,
        ...rejectionData,
      })
      // Record feedback for AI learning
      await recordFeedback.mutateAsync({
        ideaId: rejectModalIdea.id,
        decision: 'rejected',
        rejectionCategory: rejectionData.rejectionCategory,
        rejectionReason: rejectionData.rejectionReason,
        feedbackNotes: rejectionData.feedbackNotes,
      })
      setRejectModalIdea(null)
    } catch (error) {
      showError(error, {
        action: 'reject idea',
        context: { ideaId: rejectModalIdea?.id, ideaTitle: rejectModalIdea?.title },
        onRetry: () => handleRejectWithReason(rejectionData),
      })
    }
  }

  // Quick thumbs up/down feedback
  const handleQuickFeedback = async (ideaId, isPositive) => {
    try {
      await ideaFeedback.mutateAsync({ ideaId, isPositive })
      // Record feedback for AI learning
      await recordFeedback.mutateAsync({
        ideaId,
        decision: isPositive ? 'thumbs_up' : 'thumbs_down',
      })
    } catch (error) {
      showError(error, {
        action: 'submit feedback',
        context: { ideaId, feedbackType: isPositive ? 'positive' : 'negative' },
      })
    }
  }

  // Open delete modal instead of immediate deletion
  const handleDelete = (idea) => {
    setDeleteModalIdea(idea)
  }

  // Handle deletion with reason (from modal)
  const handleDeleteWithReason = async (deletionData) => {
    try {
      await deleteIdeaWithReason.mutateAsync({
        idea: deleteModalIdea,
        ...deletionData,
      })
      setDeleteModalIdea(null)
    } catch (error) {
      showError(error, {
        action: 'delete idea',
        context: { ideaId: deleteModalIdea?.id, ideaTitle: deleteModalIdea?.title },
        onRetry: () => handleDeleteWithReason(deletionData),
      })
    }
  }

  const handleGenerate = async (idea) => {
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
          autoFix: true,
          maxFixAttempts: 3,
        },
        onProgress: ({ message, percentage }) => {
          progressModal.updateProgress(percentage)
          if (message) {
            progressModal.addStep(message)
            if (percentage > 10) {
              progressModal.completeStep(message)
            }
          }
        },
      })

      progressModal.addStep('Article saved to database!')
      progressModal.completeStep('Article saved to database!')
      progressModal.complete()

    } catch (error) {
      progressModal.addStep(`Error: ${error.message}`)
      progressModal.errorStep(`Error: ${error.message}`)
      progressModal.error(error.message)
    } finally {
      setGeneratingIdea(null)
    }
  }

  // Handle free-form research discovery (per Dec 22, 2025 meeting - Dual-Track)
  const handleResearchDiscover = async () => {
    if (!researchTopic.trim()) {
      showError({ message: 'Please enter a topic to research' }, {
        action: 'start research discovery',
      })
      return
    }

    setIsDiscovering(true)
    setShowResearchModal(false)

    // Start progress modal for research
    progressModal.start(
      'Discovering Ideas',
      `Researching "${researchTopic.substring(0, 50)}${researchTopic.length > 50 ? '...' : ''}"`
    )

    try {
      // Generate multiple ideas from the research topic
      // This uses free-form research rather than monetization-first approach
      const topics = researchTopic.split(',').map(t => t.trim()).filter(Boolean)

      progressModal.addStep('Analyzing topic for content opportunities...')
      progressModal.updateProgress(20)

      // Create ideas from the research topic
      for (let i = 0; i < Math.min(topics.length * 2, 5); i++) {
        const topicIndex = i % topics.length
        const variationSuffix = i < topics.length ? '' : ' - In-Depth Guide'

        progressModal.addStep(`Creating idea ${i + 1}...`)

        await createIdea.mutateAsync({
          title: `${topics[topicIndex]}${variationSuffix}`,
          description: `Research-driven content idea about ${topics[topicIndex]}. Generated from free-form research mode.`,
          seed_topics: topics,
          source: 'research',
          status: 'pending',
        })

        progressModal.updateProgress(20 + (i + 1) * (60 / Math.min(topics.length * 2, 5)))
        progressModal.completeStep(`Creating idea ${i + 1}...`)
      }

      progressModal.addStep('Ideas created successfully!')
      progressModal.completeStep('Ideas created successfully!')
      progressModal.updateProgress(100)
      progressModal.complete()

      setResearchTopic('')
    } catch (error) {
      progressModal.addStep(`Error: ${error.message}`)
      progressModal.errorStep(`Error: ${error.message}`)
      progressModal.error(error.message)
    } finally {
      setIsDiscovering(false)
    }
  }

  // Handle AI-powered idea discovery for monetization mode
  // Uses IdeaDiscoveryService with monetization-first approach
  const handleAIDiscoverIdeas = useCallback(async () => {
    setIsDiscovering(true)

    // Start progress modal
    progressModal.start(
      'AI Idea Discovery',
      'Analyzing monetizable categories and generating content ideas...'
    )

    try {
      const ideaDiscoveryService = new IdeaDiscoveryService()

      // Get existing idea titles to avoid duplicates
      const existingTitles = ideas.map(idea => idea.title)

      progressModal.addStep('Loading monetization context...')
      progressModal.updateProgress(10)

      progressModal.addStep('Discovering monetizable content opportunities...')
      progressModal.updateProgress(30)

      // Call the AI discovery service with monetization-first settings
      const result = await ideaDiscoveryService.discoverIdeas({
        sources: ['reddit', 'news', 'trends', 'general'],
        existingTopics: existingTitles,
        strictMonetization: true,
        minMonetizationScore: 25,
      })

      const { ideas: discoveredIdeas, rejected, stats } = result

      progressModal.addStep(`Found ${discoveredIdeas.length} monetizable ideas`)
      progressModal.updateProgress(50)

      if (rejected?.length > 0) {
        progressModal.addStep(`Filtered out ${rejected.length} non-monetizable ideas`)
      }

      // Save each discovered idea to the database
      let savedCount = 0
      let failedCount = 0
      let lastError = null

      for (const idea of discoveredIdeas) {
        // Check if user cancelled the process
        if (progressModal.isCancelled) {
          progressModal.addStep(`Stopped - saved ${savedCount} of ${discoveredIdeas.length} ideas`)
          break
        }

        try {
          await createIdea.mutateAsync({
            title: idea.title,
            description: idea.description,
            seed_topics: idea.target_keywords || [],
            content_type: idea.content_type || 'guide',
            source: idea.source || 'ai_generated',
            status: 'pending',
            monetization_score: idea.monetization_score || 0,
            monetization_confidence: idea.monetization_confidence || 'medium',
            monetization_category: idea.monetization_category || idea.ai_monetization_category || null,
          })
          savedCount++
          progressModal.updateProgress(50 + (savedCount / discoveredIdeas.length) * 40)
        } catch (saveError) {
          failedCount++
          lastError = saveError
          console.warn(`Failed to save idea "${idea.title}":`, saveError?.message || saveError)
        }
      }

      // Only show completion if not cancelled
      if (!progressModal.isCancelled) {
        if (failedCount > 0) {
          progressModal.addStep(`Warning: ${failedCount} ideas failed to save`)
          console.error('[ContentIdeas] Save failures:', {
            failedCount,
            lastError: lastError?.message || lastError,
            hint: 'Check if source value is in database constraint'
          })
        }
        progressModal.addStep(`Saved ${savedCount} new ideas to your library`)
        progressModal.updateProgress(100)
        progressModal.completeStep(`Saved ${savedCount} new ideas to your library`)
        progressModal.complete()
      }

      console.log('[ContentIdeas] AI discovery stats:', stats)
    } catch (error) {
      console.error('AI idea discovery error:', error)
      progressModal.addStep(`Error: ${error.message}`)
      progressModal.errorStep(`Error: ${error.message}`)
      progressModal.error(error.message)
    } finally {
      setIsDiscovering(false)
    }
  }, [ideas, createIdea, progressModal])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-8 min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Content Ideas</h1>
          <p className="text-gray-600 mt-1">Manage and generate content ideas</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Dual-Track Mode Toggle - per Dec 22, 2025 meeting */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
            <button
              onClick={() => setIdeaMode('monetization')}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
                ideaMode === 'monetization'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
              title="Monetization-first: prioritizes ideas with revenue potential"
            >
              <DollarSign className="w-4 h-4" />
              <span className="hidden sm:inline">Monetization</span>
            </button>
            <button
              onClick={() => setIdeaMode('research')}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
                ideaMode === 'research'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
              title="Free-form: user-initiated topic research"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Research</span>
            </button>
          </div>

          {/* Stats Badge */}
          {feedbackStats && feedbackStats.total > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
              <BarChart3 className="w-4 h-4 text-gray-500" />
              <span className="text-gray-700">{feedbackStats.approvalRate}% approval</span>
            </div>
          )}
          {/* Train AI Badge */}
          {untrainedFeedback.length > 0 && (
            <button
              onClick={() => setLearningModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-sm hover:bg-purple-200 transition-colors"
            >
              <Brain className="w-4 h-4" />
              <span>Train AI</span>
              <Badge className="bg-purple-600 text-white text-xs">
                {untrainedFeedback.length}
              </Badge>
            </button>
          )}

          {/* Monetization Mode: AI Suggest Ideas Button */}
          {ideaMode === 'monetization' && (
            <button
              onClick={handleAIDiscoverIdeas}
              disabled={isDiscovering}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
            >
              {isDiscovering ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Wand2 className="w-5 h-5" />
              )}
              {isDiscovering ? 'Discovering...' : 'AI Suggest Ideas'}
            </button>
          )}

          {/* Research Mode: Discover Ideas Button */}
          {ideaMode === 'research' && (
            <button
              onClick={() => setShowResearchModal(true)}
              disabled={isDiscovering}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
            >
              {isDiscovering ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Lightbulb className="w-5 h-5" />
              )}
              {isDiscovering ? 'Discovering...' : 'Discover Ideas'}
            </button>
          )}

          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            New Idea
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="ideas" className="gap-2">
            <FileText className="w-4 h-4" />
            Ideas
            <Badge variant="secondary" className="ml-1">{ideas.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="w-4 h-4" />
            Feedback History
            {feedbackStats && (
              <Badge variant="secondary" className="ml-1">{feedbackStats.total}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ideas" className="mt-0">
          {/* Search bar */}
          <div className="relative mb-4 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ideas by title or description…"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Filters + Sort */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={() => setFilterStatus(null)}
              className={`px-4 py-2 rounded-lg ${
                filterStatus === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All ({ideas.length})
            </button>
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-4 py-2 rounded-lg ${
                  filterStatus === status
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {config.label}
              </button>
            ))}
            <div className="ml-auto">
              <SortDropdown
                value={sortKey}
                onChange={setSortKey}
                options={CONTENT_SORT_OPTIONS}
              />
            </div>
          </div>

          {/* Monetization Filters */}
          <div className="flex gap-2 mb-6">
            <span className="text-sm text-gray-500 flex items-center gap-1 mr-2">
              <DollarSign className="w-4 h-4" /> Revenue:
            </span>
            <button
              onClick={() => setFilterMonetization(null)}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                filterMonetization === null
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterMonetization('high')}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${
                filterMonetization === 'high'
                  ? 'bg-green-600 text-white'
                  : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
              }`}
            >
              <TrendingUp className="w-3 h-3" /> High $
            </button>
            <button
              onClick={() => setFilterMonetization('medium')}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                filterMonetization === 'medium'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200'
              }`}
            >
              Med $
            </button>
            <button
              onClick={() => setFilterMonetization('low')}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                filterMonetization === 'low'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
              }`}
            >
              Low $
            </button>
          </div>

          {/* Ideas Grid - filtered by monetization */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ideas
              .filter(idea => !filterMonetization || idea.monetization_confidence === filterMonetization)
              .map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onApprove={handleApprove}
                onReject={handleReject}
                onDelete={handleDelete}
                onGenerate={handleGenerate}
                onQuickFeedback={handleQuickFeedback}
                onPreview={(articleId) => {
                  // Build list of all completed article IDs for navigation
                  const completedIds = ideas
                    .filter(i => i.status === 'completed' && i.article_id)
                    .map(i => i.article_id)
                  setCompletedArticleIds(completedIds)
                  setPreviewArticleId(articleId)
                }}
                isGenerating={generatingIdea === idea.id}
              />
            ))}
          </div>

          {ideas.length === 0 && (
            <div className="text-center py-16">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No ideas yet</h3>
              <p className="text-gray-600 mb-4">Create your first content idea to get started</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
              >
                Create Idea
              </button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <IdeaFeedbackHistory onStartLearning={() => setLearningModalOpen(true)} />
        </TabsContent>
      </Tabs>

      {/* Create Idea Modal */}
      {isModalOpen && (
        <CreateIdeaModal
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleCreateIdea}
          isSubmitting={createIdea.isPending}
        />
      )}

      {/* Progress Modal for Article Generation */}
      <ProgressModal {...progressModal.modalProps} allowCancel={true} />
      <MinimizedProgressIndicator {...progressModal.minimizedProps} />

      {/* Rejection Reason Modal */}
      {rejectModalIdea && (
        <RejectIdeaModal
          idea={rejectModalIdea}
          onClose={() => setRejectModalIdea(null)}
          onSubmit={handleRejectWithReason}
          isSubmitting={rejectWithReason.isPending}
        />
      )}

      {/* AI Learning Modal */}
      <AILearningModal
        open={learningModalOpen}
        onOpenChange={setLearningModalOpen}
      />

      {/* Research Discovery Modal - per Dec 22, 2025 meeting */}
      {showResearchModal && (
        <ResearchDiscoveryModal
          onClose={() => setShowResearchModal(false)}
          onSubmit={handleResearchDiscover}
          researchTopic={researchTopic}
          setResearchTopic={setResearchTopic}
          isDiscovering={isDiscovering}
        />
      )}

      {/* Delete with Reason Modal */}
      <DeleteWithReasonModal
        isOpen={!!deleteModalIdea}
        onClose={() => setDeleteModalIdea(null)}
        onConfirm={handleDeleteWithReason}
        title={deleteModalIdea?.title || ''}
        entityType="content idea"
        isDeleting={deleteIdeaWithReason.isPending}
      />

      {/* Article Preview Modal - allows full content viewing without navigation */}
      <ArticlePreviewModal
        articleId={previewArticleId}
        isOpen={!!previewArticleId}
        onClose={() => setPreviewArticleId(null)}
        hasPrev={completedArticleIds.indexOf(previewArticleId) > 0}
        hasNext={completedArticleIds.indexOf(previewArticleId) < completedArticleIds.length - 1}
        onNavigatePrev={() => {
          const currentIndex = completedArticleIds.indexOf(previewArticleId)
          if (currentIndex > 0) {
            setPreviewArticleId(completedArticleIds[currentIndex - 1])
          }
        }}
        onNavigateNext={() => {
          const currentIndex = completedArticleIds.indexOf(previewArticleId)
          if (currentIndex < completedArticleIds.length - 1) {
            setPreviewArticleId(completedArticleIds[currentIndex + 1])
          }
        }}
      />

      {/* Error Modal - structured error display with copyable details */}
      {errorModal}
    </div>
  )
}

function IdeaCard({ idea, onApprove, onReject, onDelete, onGenerate, onQuickFeedback, onPreview, isGenerating }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const statusConfig = STATUS_CONFIG[idea.status]
  const StatusIcon = statusConfig.icon
  const feedbackScore = idea.feedback_score || 0

  // Check if content is long enough to need expansion
  const needsExpansion = (idea.title?.length > 60) || (idea.description?.length > 150)

  // Monetization score badge configuration
  const getMonetizationBadge = () => {
    const confidence = idea.monetization_confidence || 'unscored'
    const score = idea.monetization_score || 0

    if (confidence === 'unscored' || confidence === null) {
      return null // Don't show badge for unscored ideas
    }

    const configs = {
      high: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', label: 'High $' },
      medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200', label: 'Med $' },
      low: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', label: 'Low $' },
    }

    return configs[confidence] || null
  }

  // SEO score badge from keyword research data
  const getSEOBadge = () => {
    const krd = idea.keyword_research_data
    if (!krd) return null

    // Calculate an SEO opportunity score from available data
    const opportunityScore = krd.opportunity_score || 0
    const searchVolume = krd.search_volume || 0
    const difficulty = krd.difficulty || 50

    // If we have an explicit opportunity score, use it
    if (opportunityScore > 0) {
      if (opportunityScore >= 70) {
        return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', label: `SEO ${opportunityScore}`, score: opportunityScore }
      } else if (opportunityScore >= 40) {
        return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', label: `SEO ${opportunityScore}`, score: opportunityScore }
      } else {
        return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', label: `SEO ${opportunityScore}`, score: opportunityScore }
      }
    }

    // Otherwise calculate from search volume and difficulty
    if (searchVolume > 0) {
      // Higher volume and lower difficulty = better opportunity
      const calculatedScore = Math.round((searchVolume / 1000) * (100 - difficulty) / 100)
      const level = calculatedScore >= 50 ? 'high' : calculatedScore >= 20 ? 'med' : 'low'

      const configs = {
        high: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
        med: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
        low: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
      }

      return {
        ...configs[level],
        label: `${Math.round(searchVolume / 1000)}K vol`,
        score: calculatedScore,
        volume: searchVolume,
        difficulty,
      }
    }

    return null
  }

  const monetizationBadge = getMonetizationBadge()
  const seoBadge = getSEOBadge()

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow">
      {/* Header: Status Badge + Monetization + Quick Feedback + Delete */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <NewBadge timestamp={idea.created_at} />
          <DateLabel createdAt={idea.created_at} updatedAt={idea.updated_at} />
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
          {/* Monetization Score Badge */}
          {monetizationBadge && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${monetizationBadge.bg} ${monetizationBadge.text} border ${monetizationBadge.border}`}
              title={`Monetization potential: ${idea.monetization_confidence} (score: ${idea.monetization_score})`}
            >
              <DollarSign className="w-3 h-3" />
              {monetizationBadge.label}
            </span>
          )}
          {/* SEO/Keyword Research Score Badge */}
          {seoBadge && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${seoBadge.bg} ${seoBadge.text} border ${seoBadge.border}`}
              title={`Keyword research: Vol ${idea.keyword_research_data?.search_volume || 0}, Diff ${idea.keyword_research_data?.difficulty || 'N/A'}`}
            >
              <TrendingUp className="w-3 h-3" />
              {seoBadge.label}
            </span>
          )}
          {/* Feedback Score Badge */}
          {feedbackScore !== 0 && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              feedbackScore > 0
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}>
              {feedbackScore > 0 ? '+' : ''}{feedbackScore}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Quick Feedback Buttons */}
          <button
            onClick={() => onQuickFeedback(idea.id, true)}
            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
            title="Good idea"
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onQuickFeedback(idea.id, false)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Not a good idea"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(idea)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Delete idea"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content - with expand/collapse */}
      <div className="relative">
        <h3 className={`font-semibold text-gray-900 mb-2 ${!isExpanded ? 'line-clamp-2' : ''}`}>{cleanTitle(idea.title)}</h3>
        {idea.description && (
          <p className={`text-sm text-gray-600 mb-2 ${!isExpanded ? 'line-clamp-3' : ''}`}>{idea.description}</p>
        )}
        {/* Expand/Collapse button */}
        {needsExpansion && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium mb-2"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Show full content
              </>
            )}
          </button>
        )}
      </div>

      {/* Rejection reason display (for rejected ideas) */}
      {idea.status === 'rejected' && idea.rejection_category && (
        <div className="mb-4 p-2 bg-red-50 rounded-lg border border-red-100">
          <div className="flex items-center gap-1 text-xs font-medium text-red-700 mb-1">
            <MessageSquare className="w-3 h-3" />
            {REJECTION_CATEGORIES[idea.rejection_category]?.label || idea.rejection_category}
          </div>
          {idea.rejection_reason && (
            <p className="text-xs text-red-600 line-clamp-2">{idea.rejection_reason}</p>
          )}
        </div>
      )}

      {/* Degree Level + Topics */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Degree Level Badge */}
        {idea.monetization_degree_level && (
          <span className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded border border-purple-200">
            {idea.monetization_degree_level}
          </span>
        )}
        {/* Topics */}
        {idea.seed_topics && idea.seed_topics.slice(0, 3).map((topic, i) => (
          <span
            key={i}
            className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
          >
            {topic}
          </span>
        ))}
      </div>

      {/* AI Source/Reasoning - per GetEducated request Issue #7 */}
      {idea.source === 'ai_discovery' && idea.monetization_category && (
        <div className="mb-4 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-1">
            <Brain className="w-3.5 h-3.5" />
            Why this idea was suggested:
          </div>
          <p className="text-xs text-blue-600 leading-relaxed">
            {idea.monetization_category && (
              <>Matches monetizable category: <strong>{idea.monetization_category}</strong>. </>
            )}
            {idea.monetization_score > 0 && (
              <>Revenue score: {idea.monetization_score}/100. </>
            )}
            {idea.seed_topics?.length > 0 && (
              <>Target keywords: {idea.seed_topics.slice(0, 3).join(', ')}.</>
            )}
          </p>
        </div>
      )}

      {/* Research mode source */}
      {idea.source === 'research' && (
        <div className="mb-4 p-2.5 bg-indigo-50 rounded-lg border border-indigo-100">
          <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 mb-1">
            <Search className="w-3.5 h-3.5" />
            Research-based idea
          </div>
          <p className="text-xs text-indigo-600">
            Generated from free-form research mode.
            {idea.seed_topics?.length > 0 && <> Based on topics: {idea.seed_topics.join(', ')}.</>}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-4">
        {idea.status === 'pending' && (
          <>
            <button
              onClick={() => onApprove(idea.id)}
              className="flex-1 bg-green-600 text-white text-sm py-2 px-3 rounded hover:bg-green-700 flex items-center justify-center gap-1"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
            <button
              onClick={() => onReject(idea)}
              className="flex-1 bg-red-600 text-white text-sm py-2 px-3 rounded hover:bg-red-700 flex items-center justify-center gap-1"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </>
        )}

        {idea.status === 'approved' && (
          <button
            onClick={() => onGenerate(idea)}
            disabled={isGenerating}
            className="flex-1 bg-blue-600 text-white text-sm py-2 px-3 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Article
              </>
            )}
          </button>
        )}

        {idea.status === 'completed' && idea.article_id && (
          <div className="flex-1 flex flex-col gap-3">
            {/* Success message with helpful context */}
            <div className="flex items-center justify-center gap-2 py-1.5 bg-green-50 rounded-lg border border-green-200">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-sm text-green-700 font-medium">Article ready - click below to review or edit</span>
            </div>
            {/* Action buttons - HIGHLY PROMINENT per GetEducated feedback */}
            <div className="flex flex-col gap-2">
              {/* Primary action: View Full Article - this is what Tony needs */}
              <button
                onClick={() => onPreview(idea.article_id)}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-base py-3.5 px-4 rounded-lg hover:from-indigo-700 hover:to-purple-700 flex items-center justify-center gap-2 transition-all font-semibold shadow-lg hover:shadow-xl animate-pulse-subtle"
              >
                <Eye className="w-5 h-5" />
                👁️ View Full Article Content
              </button>
              {/* Secondary action: Edit in Review Page */}
              <Link
                to={`/review/${idea.article_id}`}
                className="w-full bg-blue-600 text-white text-sm py-2.5 px-4 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 transition-colors font-medium"
              >
                <Maximize2 className="w-4 h-4" />
                Open Full Editor & Add Comments
              </Link>
            </div>
          </div>
        )}

        {idea.status === 'rejected' && (
          <button
            onClick={() => onApprove(idea.id)}
            className="flex-1 bg-gray-100 text-gray-700 text-sm py-2 px-3 rounded hover:bg-gray-200 flex items-center justify-center gap-1"
          >
            <CheckCircle className="w-4 h-4" />
            Reconsider
          </button>
        )}
      </div>
    </div>
  )
}

function CreateIdeaModal({ onClose, onSubmit, isSubmitting }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    seed_topics: '',
    source: 'manual',
    status: 'pending',
  })

  const handleSubmit = (e) => {
    e.preventDefault()

    const topics = formData.seed_topics
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    onSubmit({
      ...formData,
      seed_topics: topics,
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Idea</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Best Online MBA Programs 2025"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Brief description of what this article should cover..."
              />
            </div>

            {/* AI Title Suggestions - per Dec 22, 2025 meeting */}
            {formData.description && (
              <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
                <TitleSuggestions
                  description={formData.description}
                  topics={formData.seed_topics}
                  onSelectTitle={(title) => setFormData({ ...formData, title })}
                  disabled={isSubmitting}
                />
              </div>
            )}

            {/* Topics */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Topics (comma-separated)
              </label>
              <input
                type="text"
                value={formData.seed_topics}
                onChange={(e) => setFormData({ ...formData, seed_topics: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., mba, business school, online education"
              />
            </div>

            {/* Auto-approve checkbox */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="autoApprove"
                checked={formData.status === 'approved'}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    status: e.target.checked ? 'approved' : 'pending',
                  })
                }
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="autoApprove" className="ml-2 text-sm text-gray-700">
                Auto-approve (skip review)
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating...' : 'Create Idea'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function RejectIdeaModal({ idea, onClose, onSubmit, isSubmitting }) {
  const [formData, setFormData] = useState({
    rejectionCategory: '',
    rejectionReason: '',
    feedbackNotes: '',
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!formData.rejectionCategory) {
      alert('Please select a rejection category')
      return
    }
    onSubmit(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Reject Idea</h2>
          <p className="text-sm text-gray-600 mb-4 line-clamp-2">
            "{idea.title}"
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Rejection Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Why is this idea being rejected? *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(REJECTION_CATEGORIES).map(([key, { label, description }]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFormData({ ...formData, rejectionCategory: key })}
                    className={`p-3 text-left rounded-lg border transition-colors ${
                      formData.rejectionCategory === key
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium text-sm">{label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Detailed Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Detailed Reason (for AI training)
              </label>
              <textarea
                value={formData.rejectionReason}
                onChange={(e) => setFormData({ ...formData, rejectionReason: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="Explain why this idea doesn't work so the AI can learn to avoid similar suggestions..."
              />
              <p className="text-xs text-gray-500 mt-1">
                This feedback will help train the AI to suggest better ideas in the future.
              </p>
            </div>

            {/* Additional Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Additional Notes (optional)
              </label>
              <input
                type="text"
                value={formData.feedbackNotes}
                onChange={(e) => setFormData({ ...formData, feedbackNotes: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="Any other context or suggestions..."
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Rejecting...
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    Reject Idea
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/**
 * Research Discovery Modal - per Dec 22, 2025 meeting
 * Free-form topic research mode for user-initiated idea discovery
 * Allows entering topics (comma-separated) to generate content ideas
 */
function ResearchDiscoveryModal({ onClose, onSubmit, researchTopic, setResearchTopic, isDiscovering }) {
  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Search className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Research Topics</h2>
              <p className="text-sm text-gray-600">
                Free-form idea discovery based on your topics
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Topics Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter Topics to Research
              </label>
              <textarea
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter topics separated by commas, e.g.:&#10;online nursing degrees, RN to BSN programs, nursing career paths"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Separate multiple topics with commas. Up to 5 ideas will be generated.
              </p>
            </div>

            {/* Mode Explanation */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Lightbulb className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800">
                    Research Mode
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Unlike monetization mode, research mode lets you explore any topic without
                    requiring sponsored school data. Great for editorial content, career guides,
                    and exploratory articles.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                disabled={isDiscovering}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                disabled={isDiscovering || !researchTopic.trim()}
              >
                {isDiscovering ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Lightbulb className="w-4 h-4" />
                    Discover Ideas
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default ContentIdeas
