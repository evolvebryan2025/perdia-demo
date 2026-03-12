import { useState, useMemo, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, isPast, differenceInDays, differenceInHours } from 'date-fns'
import { motion } from 'framer-motion'
import { supabase } from '@/services/supabaseClient'
import { useAuth } from '@/contexts/AuthContext'
import { useAllRevisions } from '@/hooks/useArticleRevisions'
import { useDeleteArticleWithReason } from '@/hooks/useDeletionLog'
import { usePublishArticle } from '@/hooks/usePublish'
import { calculateQualityScore, getQualityThresholds } from '@/services/qualityScoreService'
import { DeleteWithReasonModal } from '@/components/ui/DeleteWithReasonModal'

// UI Components
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ArrowRight,
  Calendar,
  MessageSquare,
  FileText,
  Filter,
  Search,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Zap,
  Trash2,
  Sparkles,
  RefreshCw,
  Upload,
  Loader2
} from 'lucide-react'
import { Input } from '@/components/ui/input'

// Status configuration
const REVIEW_STATUSES = [
  { value: 'qa_review', label: 'In Review', icon: Clock, color: 'blue' },
  { value: 'refinement', label: 'Needs Work', icon: AlertCircle, color: 'yellow' },
  { value: 'ready_to_publish', label: 'Approved', icon: CheckCircle2, color: 'green' }
]

const STATUS_COLORS = {
  qa_review: 'bg-blue-50 text-blue-700 border-blue-200',
  refinement: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  ready_to_publish: 'bg-green-50 text-green-700 border-green-200',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  drafting: 'bg-purple-50 text-purple-700 border-purple-200',
  idea: 'bg-gray-50 text-gray-700 border-gray-200'
}

// Risk level configuration for GetEducated
const RISK_LEVEL_CONFIG = {
  LOW: {
    label: 'Low Risk',
    icon: ShieldCheck,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    description: 'Safe for auto-publish'
  },
  MEDIUM: {
    label: 'Medium Risk',
    icon: AlertTriangle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    description: 'Needs review before publish'
  },
  HIGH: {
    label: 'High Risk',
    icon: ShieldAlert,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    description: 'Blocking issues found'
  },
  CRITICAL: {
    label: 'Critical',
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    description: 'Cannot publish - fix required'
  }
}

/**
 * RiskLevelBadge - Shows risk level with icon and tooltip
 */
function RiskLevelBadge({ riskLevel }) {
  const config = RISK_LEVEL_CONFIG[riskLevel] || RISK_LEVEL_CONFIG.LOW
  const Icon = config.icon

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`${config.bgColor} ${config.color} ${config.borderColor} font-medium gap-1`}
          >
            <Icon className="w-3 h-3" />
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * AutoPublishDeadline - Shows countdown to auto-publish deadline
 */
function AutoPublishDeadline({ deadline, humanReviewed }) {
  if (!deadline) return null

  const deadlineDate = new Date(deadline)
  const now = new Date()
  const isOverdue = isPast(deadlineDate)
  const hoursRemaining = differenceInHours(deadlineDate, now)
  const daysRemaining = differenceInDays(deadlineDate, now)

  // If human reviewed, show that instead
  if (humanReviewed) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
        <CheckCircle2 className="w-3 h-3" />
        Human reviewed
      </div>
    )
  }

  // Determine urgency color
  let urgencyClass = 'text-gray-600 bg-gray-50 border-gray-200'
  let icon = <Timer className="w-3 h-3" />

  if (isOverdue) {
    urgencyClass = 'text-red-600 bg-red-50 border-red-200'
    icon = <Zap className="w-3 h-3" />
  } else if (hoursRemaining <= 24) {
    urgencyClass = 'text-orange-600 bg-orange-50 border-orange-200'
    icon = <AlertTriangle className="w-3 h-3" />
  } else if (daysRemaining <= 2) {
    urgencyClass = 'text-yellow-600 bg-yellow-50 border-yellow-200'
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1.5 text-xs ${urgencyClass} px-2.5 py-1 rounded-md border`}>
            {icon}
            {isOverdue
              ? 'Auto-publish ready'
              : hoursRemaining <= 24
                ? `${hoursRemaining}h remaining`
                : `${daysRemaining}d remaining`
            }
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {isOverdue
              ? 'Deadline passed. Will auto-publish on next scheduler run.'
              : `Auto-publish deadline: ${format(deadlineDate, 'MMM d, yyyy h:mm a')}`
            }
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(deadlineDate, { addSuffix: true })}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Article type filter options
const ARTICLE_TYPE_OPTIONS = [
  { value: 'all', label: 'All', icon: FileText },
  { value: 'generated', label: 'Generated', icon: Sparkles, description: 'Fresh AI-generated articles' },
  { value: 'revised', label: 'Revised', icon: RefreshCw, description: 'Articles that have been AI-revised' }
]

export default function ReviewQueue() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [selectedStatus, setSelectedStatus] = useState('qa_review')
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModalArticle, setDeleteModalArticle] = useState(null)
  const [articleTypeFilter, setArticleTypeFilter] = useState('all')

  // Delete with reason hook
  const deleteArticleWithReason = useDeleteArticleWithReason()

  // Publish to stage hook
  const publishArticle = usePublishArticle()
  const [publishingArticleId, setPublishingArticleId] = useState(null)

  // Fetch articles in review statuses (include new GetEducated fields)
  const { data: articles = [], isLoading, refetch } = useQuery({
    queryKey: ['review-articles', selectedStatus],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('articles')
        .select('*, article_contributors(*)')
        .eq('status', selectedStatus)
        .order('autopublish_deadline', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      // Recalculate quality scores client-side to ensure they match the editor's real-time calculation
      const thresholds = await getQualityThresholds()
      const articles = (data || []).map(article => {
        if (article.content) {
          const result = calculateQualityScore(article.content, article, thresholds)
          if (result.score !== article.quality_score) {
            // Update stale DB score in background (fire-and-forget)
            supabase.from('articles').update({ quality_score: result.score }).eq('id', article.id)
          }
          return { ...article, quality_score: result.score }
        }
        return article
      })
      return articles
    },
    enabled: !!user,
    refetchOnMount: 'always', // Always refetch when navigating back to this page
    staleTime: 0 // Consider data immediately stale to ensure fresh data on navigation
  })

  // Refetch when navigating back to this page (handles browser back button)
  useEffect(() => {
    // Refetch data when location changes to this page
    if (location.pathname === '/review') {
      refetch()
    }
  }, [location.key, refetch])

  // Calculate articles with urgent deadlines
  const urgentCount = useMemo(() => {
    const now = new Date()
    return articles.filter(a => {
      if (!a.autopublish_deadline || a.human_reviewed) return false
      const deadline = new Date(a.autopublish_deadline)
      const hoursRemaining = differenceInHours(deadline, now)
      return hoursRemaining <= 48 // Less than 48 hours
    }).length
  }, [articles])

  // Get all revisions for comment counts
  const { data: allRevisions = [] } = useAllRevisions()

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from('articles')
        .update({ status })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-articles'] })
      queryClient.invalidateQueries({ queryKey: ['articles'] })
    }
  })

  const handleQuickAction = async (articleId, newStatus) => {
    await updateStatusMutation.mutateAsync({ id: articleId, status: newStatus })
  }

  // Handle publish to stage website
  const handlePublishToStage = async (article) => {
    setPublishingArticleId(article.id)
    try {
      const result = await publishArticle.mutateAsync({
        article,
        options: { environment: 'staging' }
      })

      if (result.success) {
        // Update status to published after successful publish
        await updateStatusMutation.mutateAsync({ id: article.id, status: 'published' })
        // Refresh the list
        queryClient.invalidateQueries({ queryKey: ['review-articles'] })
      } else {
        alert(`Publish failed: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Publish to stage error:', error)
      alert(`Publish failed: ${error.message}`)
    } finally {
      setPublishingArticleId(null)
    }
  }

  // Handle deletion with reason - with optimistic updates
  const handleDeleteWithReason = async (deletionData) => {
    const articleToDelete = deleteModalArticle

    // Immediately close modal and optimistically remove from UI
    setDeleteModalArticle(null)

    // Snapshot previous data for potential rollback
    const previousData = queryClient.getQueryData(['review-articles', selectedStatus])

    // Optimistically remove the article from the cache immediately
    queryClient.setQueryData(['review-articles', selectedStatus], (old) => {
      if (!old) return old
      return old.filter(article => article.id !== articleToDelete.id)
    })

    try {
      await deleteArticleWithReason.mutateAsync({
        article: articleToDelete,
        ...deletionData,
      })
    } catch (error) {
      // Rollback on error - restore the article to the list
      queryClient.setQueryData(['review-articles', selectedStatus], previousData)
      alert('Failed to delete article: ' + error.message)
    }
  }

  const getArticleCommentCount = (articleId) => {
    return allRevisions.filter(r => r.article_id === articleId && r.status === 'pending').length
  }

  // Check if an article is a revision (either from is_revision field or has ai_revised revisions)
  const isArticleRevision = (article) => {
    // First check the direct is_revision field (for site catalog revisions)
    if (article.is_revision === true) return true
    // Fall back to checking revision history (for in-app revisions)
    return allRevisions.some(r => r.article_id === article.id && r.ai_revised)
  }

  // Filter articles by search and type
  const filteredArticles = articles.filter(article => {
    // Search filter
    const matchesSearch = !searchQuery ||
      article.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.focus_keyword?.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch) return false

    // Article type filter
    if (articleTypeFilter === 'all') return true
    if (articleTypeFilter === 'revised') return isArticleRevision(article)
    if (articleTypeFilter === 'generated') return !isArticleRevision(article)

    return true
  })

  // Counts for type filter badges
  const typeCounts = useMemo(() => ({
    all: articles.length,
    revised: articles.filter(a => isArticleRevision(a)).length,
    generated: articles.filter(a => !isArticleRevision(a)).length
  }), [articles, allRevisions])

  // Count by status
  const statusCounts = {
    qa_review: articles.filter(a => a.status === 'qa_review').length,
    refinement: articles.filter(a => a.status === 'refinement').length,
    ready_to_publish: articles.filter(a => a.status === 'ready_to_publish').length
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight mb-2">
            Review Queue
          </h1>
          <p className="text-gray-600 text-lg">
            Review articles, add comments, and approve for publishing
          </p>

          {/* Urgent Banner */}
          {urgentCount > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="font-semibold text-orange-900">
                    {urgentCount} article{urgentCount !== 1 ? 's' : ''} approaching auto-publish deadline
                  </p>
                  <p className="text-sm text-orange-700">
                    Review soon or articles will auto-publish within 48 hours
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search articles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {REVIEW_STATUSES.map(({ value, label, icon: Icon, color }) => (
              <Button
                key={value}
                variant={selectedStatus === value ? 'default' : 'outline'}
                onClick={() => setSelectedStatus(value)}
                className={`gap-2 whitespace-nowrap ${
                  selectedStatus === value
                    ? color === 'blue' ? 'bg-blue-600 hover:bg-blue-700' :
                      color === 'yellow' ? 'bg-yellow-600 hover:bg-yellow-700' :
                      color === 'green' ? 'bg-green-600 hover:bg-green-700' : ''
                    : 'border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                <Badge
                  variant="secondary"
                  className={`ml-1 ${
                    selectedStatus === value
                      ? 'bg-white/20 text-inherit border-0'
                      : ''
                  }`}
                >
                  {statusCounts[value] || 0}
                </Badge>
              </Button>
            ))}
          </div>
        </div>

        {/* Article Type Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-600">Show:</span>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {ARTICLE_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
              <TooltipProvider key={value}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={articleTypeFilter === value ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setArticleTypeFilter(value)}
                      className={`gap-1.5 px-3 ${
                        articleTypeFilter === value
                          ? 'bg-white shadow-sm hover:bg-white text-gray-900'
                          : 'hover:bg-gray-200 text-gray-600'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                      <span className={`text-xs ${
                        articleTypeFilter === value ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                        ({typeCounts[value]})
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {value === 'all' && 'Show all articles'}
                    {value === 'generated' && 'Show only fresh AI-generated articles'}
                    {value === 'revised' && 'Show only AI-revised articles'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>

        {/* Queue Items */}
        <div className="space-y-4">
          {isLoading ? (
            // Loading skeletons
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="border-none shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1">
                      <Skeleton className="h-6 w-24 mb-3" />
                      <Skeleton className="h-8 w-3/4 mb-2" />
                      <Skeleton className="h-4 w-full mb-4" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-10 w-32" />
                      <Skeleton className="h-10 w-32" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : filteredArticles.length === 0 ? (
            <Card className="border-none shadow-sm">
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-4" />
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  All caught up!
                </h3>
                <p className="text-gray-500">
                  No articles with "{REVIEW_STATUSES.find(s => s.value === selectedStatus)?.label}" status
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredArticles.map((article, index) => {
              const commentCount = getArticleCommentCount(article.id)
              const contributorName = article.article_contributors?.name || article.contributor_name

              return (
                <motion.div
                  key={article.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="border-none shadow-sm hover:shadow-md transition-all bg-white">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-6">
                        <div className="flex-1 min-w-0">
                          {/* Badges Row */}
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`${STATUS_COLORS[article.status]} border font-medium`}
                            >
                              {article.status?.replace(/_/g, ' ')}
                            </Badge>

                            {/* Risk Level Badge */}
                            {article.risk_level && (
                              <RiskLevelBadge riskLevel={article.risk_level} />
                            )}

                            {/* Quality Score Badge */}
                            {article.quality_score != null && (
                              <Badge
                                variant="outline"
                                className={`${
                                  article.quality_score >= 80
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : article.quality_score >= 60
                                      ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                      : 'bg-red-50 text-red-700 border-red-200'
                                }`}
                              >
                                Quality: {article.quality_score}%
                              </Badge>
                            )}

                            {/* Auto-publish Deadline */}
                            <AutoPublishDeadline
                              deadline={article.autopublish_deadline}
                              humanReviewed={article.human_reviewed}
                            />

                            {/* Revision Indicator */}
                            {isArticleRevision(article) && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="bg-purple-50 text-purple-700 border-purple-200 flex items-center gap-1"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      Revised
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>This article is a revision of existing content</p>
                                    {article.source_ge_article_id && (
                                      <p className="text-xs text-gray-400 mt-1">
                                        From site catalog
                                      </p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}

                            {/* Comment Count */}
                            {commentCount > 0 && (
                              <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                                <MessageSquare className="w-3 h-3" />
                                {commentCount} comment{commentCount !== 1 ? 's' : ''}
                              </div>
                            )}
                          </div>

                          {/* Title */}
                          <h3 className="font-bold text-xl text-gray-900 mb-2 line-clamp-2">
                            {article.title}
                          </h3>

                          {/* Excerpt */}
                          {article.excerpt && (
                            <p className="text-gray-600 mb-4 leading-relaxed line-clamp-2">
                              {article.excerpt}
                            </p>
                          )}

                          {/* Metadata */}
                          <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                            {article.content_type && (
                              <span className="capitalize">
                                {article.content_type?.replace(/_/g, ' ')}
                              </span>
                            )}
                            <span>•</span>
                            <span>{article.word_count?.toLocaleString() || 0} words</span>
                            {contributorName && (
                              <>
                                <span>•</span>
                                <span>By {contributorName}</span>
                              </>
                            )}
                            <span>•</span>
                            <span>
                              Created {format(new Date(article.created_at), 'MMM d')}
                            </span>
                          </div>

                          {/* Risk Flags */}
                          {article.risk_flags && article.risk_flags.length > 0 && (
                            <div className="mt-4 p-4 bg-yellow-50 rounded-xl border border-yellow-200">
                              <div className="flex items-center gap-2 mb-2">
                                <AlertCircle className="w-4 h-4 text-yellow-600" />
                                <span className="text-sm font-semibold text-yellow-900">
                                  {article.risk_flags.length} risk flag{article.risk_flags.length > 1 ? 's' : ''}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {article.risk_flags.map((flag, i) => (
                                  <Badge
                                    key={i}
                                    variant="outline"
                                    className="bg-white text-yellow-700 border-yellow-300"
                                  >
                                    {flag?.replace(/_/g, ' ') || flag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <Link to={`/review/${article.id}`}>
                            <Button className="bg-blue-600 hover:bg-blue-700 gap-2 w-full">
                              Review Article
                              <ArrowRight className="w-4 h-4" />
                            </Button>
                          </Link>

                          {article.status === 'qa_review' && (
                            <>
                              <Button
                                variant="outline"
                                className="gap-2 text-green-600 border-green-200 hover:bg-green-50"
                                onClick={() => handleQuickAction(article.id, 'ready_to_publish')}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Quick Approve
                              </Button>
                              <Button
                                variant="outline"
                                className="gap-2 text-yellow-600 border-yellow-200 hover:bg-yellow-50"
                                onClick={() => handleQuickAction(article.id, 'refinement')}
                              >
                                <XCircle className="w-4 h-4" />
                                Needs Work
                              </Button>
                            </>
                          )}

                          {article.status === 'ready_to_publish' && (
                            <Button
                              variant="outline"
                              className="gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                              onClick={() => handlePublishToStage(article)}
                              disabled={publishingArticleId === article.id}
                            >
                              {publishingArticleId === article.id ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Publishing...
                                </>
                              ) : (
                                <>
                                  <Upload className="w-4 h-4" />
                                  Publish to Stage
                                </>
                              )}
                            </Button>
                          )}

                          <Button variant="ghost" className="gap-2 w-full" onClick={() => navigate(`/editor/${article.id}`)}>
                            <FileText className="w-4 h-4" />
                            Edit
                          </Button>

                          <Button
                            variant="ghost"
                            className="gap-2 w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteModalArticle(article)}
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })
          )}
        </div>
      </div>

      {/* Delete with Reason Modal */}
      <DeleteWithReasonModal
        isOpen={!!deleteModalArticle}
        onClose={() => setDeleteModalArticle(null)}
        onConfirm={handleDeleteWithReason}
        title={deleteModalArticle?.title || ''}
        entityType="article"
        isDeleting={deleteArticleWithReason.isPending}
      />
    </div>
  )
}
