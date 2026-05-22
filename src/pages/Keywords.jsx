import { useState, useMemo } from 'react'
import { format, addDays } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useKeywords,
  useCreateKeyword,
  useUpdateKeyword,
  useDeleteKeyword,
  useBulkImportKeywords,
} from '@/hooks/useKeywords'
import {
  useClusters,
  useClusterStats,
  useCreateCluster,
  useUpdateCluster,
  useDeleteCluster,
} from '@/hooks/useClusters'
import {
  useDataForSEOResearch,
  useStarredKeywords,
  useQueuedKeywords,
  useToggleStarKeyword,
  useQueueKeywords,
  useDequeueKeywords,
  useSaveResearchedKeywords,
  useCatalogAnalysis,
  useKeywordResearchStats,
  useCreateIdeasFromKeywords,
} from '@/hooks/useKeywordResearch'

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { SortDropdown } from '@/components/ui/sort-dropdown'
import { NewBadge } from '@/components/ui/new-badge'
import { DateLabel } from '@/components/ui/date-label'
import { KEYWORD_SORT_OPTIONS, resolveSort } from '@/lib/sortOptions'
import { useStoredState } from '@/lib/useStoredState'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// Icons
import {
  Search,
  Plus,
  Upload,
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  Layers,
  Hash,
  FileText,
  FolderTree,
  BarChart2,
  Zap,
  Star,
  StarOff,
  Clock,
  PlayCircle,
  Sparkles,
  Lightbulb,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Database,
  Globe,
  DollarSign,
  Gauge,
  ListPlus,
  Calendar,
} from 'lucide-react'

// Intent colors and labels
const INTENT_CONFIG = {
  informational: { label: 'Informational', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  navigational: { label: 'Navigational', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  transactional: { label: 'Transactional', color: 'bg-green-50 text-green-700 border-green-200' },
  commercial: { label: 'Commercial', color: 'bg-orange-50 text-orange-700 border-orange-200' },
}

// Difficulty colors
const getDifficultyColor = (score) => {
  if (score == null) return 'text-gray-400 bg-gray-50'
  if (score <= 30) return 'text-green-600 bg-green-50'
  if (score <= 60) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

const getDifficultyLabel = (score) => {
  if (score == null) return '-'
  if (score <= 30) return 'Easy'
  if (score <= 60) return 'Medium'
  return 'Hard'
}

// Opportunity colors
const getOpportunityColor = (score) => {
  if (score == null) return 'text-gray-400 bg-gray-50'
  if (score >= 70) return 'text-green-600 bg-green-50'
  if (score >= 40) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

// Trend icon
const TrendIcon = ({ trend }) => {
  if (trend === 'rising') return <TrendingUp className="w-4 h-4 text-green-500" />
  if (trend === 'declining') return <TrendingDown className="w-4 h-4 text-red-500" />
  return <Minus className="w-4 h-4 text-gray-400" />
}

export default function Keywords() {
  const [activeTab, setActiveTab] = useState('research')

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight mb-2">
            Keywords
          </h1>
          <p className="text-gray-600 text-lg">
            Research, organize, and queue keywords for content generation
          </p>
        </motion.div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="research" className="gap-2">
              <Sparkles className="w-4 h-4" />
              Research
            </TabsTrigger>
            <TabsTrigger value="library" className="gap-2">
              <Database className="w-4 h-4" />
              Library
            </TabsTrigger>
            <TabsTrigger value="clusters" className="gap-2">
              <FolderTree className="w-4 h-4" />
              Clusters
            </TabsTrigger>
          </TabsList>

          <TabsContent value="research" className="space-y-6 mt-6">
            <ResearchTab />
          </TabsContent>

          <TabsContent value="library" className="space-y-6 mt-6">
            <LibraryTab />
          </TabsContent>

          <TabsContent value="clusters" className="space-y-6 mt-6">
            <ClustersTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// ========================================
// RESEARCH TAB
// ========================================
function ResearchTab() {
  const [seedKeywords, setSeedKeywords] = useState('')
  const [selectedResults, setSelectedResults] = useState(new Set())
  const [researchLimit, setResearchLimit] = useState('50')
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [saveOptions, setSaveOptions] = useState({
    clusterId: '',
    autoStar: false,
    addToQueue: false,
    queueDays: 7,
  })

  // Hooks
  const { research, results, isResearching, error, clearResults } = useDataForSEOResearch()
  const { data: catalogAnalysis, isLoading: isAnalyzing } = useCatalogAnalysis()
  const { data: clusters = [] } = useClusters()
  const saveMutation = useSaveResearchedKeywords()
  const queueMutation = useQueueKeywords()
  const stats = useKeywordResearchStats()

  // Handle research
  const handleResearch = async () => {
    if (!seedKeywords.trim()) return

    const seeds = seedKeywords.split(',').map(s => s.trim()).filter(Boolean)
    setSelectedResults(new Set())

    try {
      await research(seeds, { limit: parseInt(researchLimit) })
    } catch (err) {
      console.error('Research failed:', err)
    }
  }

  // Handle suggestion click
  const handleSuggestionClick = (keyword) => {
    setSeedKeywords(prev => {
      if (prev.trim()) {
        return `${prev}, ${keyword}`
      }
      return keyword
    })
  }

  // Toggle result selection
  const toggleResult = (keyword) => {
    setSelectedResults(prev => {
      const newSet = new Set(prev)
      if (newSet.has(keyword)) {
        newSet.delete(keyword)
      } else {
        newSet.add(keyword)
      }
      return newSet
    })
  }

  // Select all results
  const selectAll = () => {
    setSelectedResults(new Set(results.map(r => r.keyword)))
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedResults(new Set())
  }

  // Save selected keywords
  const handleSave = async () => {
    const selectedKeywords = results.filter(r => selectedResults.has(r.keyword))

    try {
      const saved = await saveMutation.mutateAsync({
        keywords: selectedKeywords,
        clusterId: saveOptions.clusterId || null,
        autoStar: saveOptions.autoStar,
      })

      // Optionally add to queue
      if (saveOptions.addToQueue && saved?.length > 0) {
        const expiresAt = addDays(new Date(), saveOptions.queueDays).toISOString()
        await queueMutation.mutateAsync({
          keywordIds: saved.map(k => k.id),
          expiresAt,
        })
      }

      setIsSaveDialogOpen(false)
      setSelectedResults(new Set())
      clearResults()
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-50 rounded-xl">
                <Database className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">In Library</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.total || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-50 rounded-xl">
                <Star className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Starred</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.starred || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">In Queue</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.queued || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-50 rounded-xl">
                <Zap className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">High Opportunity</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.highOpportunity || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Research Panel */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-500" />
            DataForSEO Keyword Research
          </CardTitle>
          <CardDescription>
            Enter seed keywords to discover related opportunities with search volume and difficulty data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder="Enter seed keywords (comma-separated, e.g., online nursing degree, healthcare careers)"
                value={seedKeywords}
                onChange={(e) => setSeedKeywords(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
              />
            </div>
            <Select value={researchLimit} onValueChange={setResearchLimit}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 results</SelectItem>
                <SelectItem value="50">50 results</SelectItem>
                <SelectItem value="100">100 results</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleResearch}
              disabled={isResearching || !seedKeywords.trim()}
              className="gap-2"
            >
              {isResearching ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Researching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Research
                </>
              )}
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Catalog Suggestions */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            Suggested Keywords from Site Analysis
          </CardTitle>
          <CardDescription>
            Based on content gaps in the GetEducated catalog ({catalogAnalysis?.totalArticles || 0} articles analyzed)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAnalyzing ? (
            <div className="flex items-center gap-2 text-gray-500">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Analyzing catalog...
            </div>
          ) : catalogAnalysis?.suggestions?.length > 0 ? (
            <div className="space-y-4">
              {/* Gap Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-orange-50 rounded-lg">
                  <h4 className="font-medium text-orange-800 mb-2">Underrepresented Subjects</h4>
                  <div className="flex flex-wrap gap-2">
                    {catalogAnalysis.gaps?.underrepresentedSubjects?.map(({ subject, count }) => (
                      <Badge
                        key={subject}
                        variant="outline"
                        className="cursor-pointer hover:bg-orange-100"
                        onClick={() => handleSuggestionClick(`online ${subject} degree`)}
                      >
                        {subject} ({count})
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2">Degree Level Gaps</h4>
                  <div className="flex flex-wrap gap-2">
                    {catalogAnalysis.gaps?.underrepresentedDegrees?.map(({ degree, count }) => (
                      <Badge
                        key={degree}
                        variant="outline"
                        className="cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSuggestionClick(`affordable ${degree} online`)}
                      >
                        {degree} ({count})
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              {/* Keyword Suggestions */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Click to add as seed keywords:</h4>
                <div className="flex flex-wrap gap-2">
                  {catalogAnalysis.suggestions.slice(0, 15).map((suggestion, i) => (
                    <TooltipProvider key={i}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className={`cursor-pointer transition-colors ${
                              suggestion.priority === 'high'
                                ? 'border-green-300 hover:bg-green-50'
                                : 'hover:bg-gray-100'
                            }`}
                            onClick={() => handleSuggestionClick(suggestion.keyword)}
                          >
                            {suggestion.keyword}
                            {suggestion.priority === 'high' && (
                              <Zap className="w-3 h-3 ml-1 text-green-500" />
                            )}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{suggestion.reason}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">No suggestions available. Make sure the site catalog is populated.</p>
          )}
        </CardContent>
      </Card>

      {/* Research Results */}
      {results.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Research Results ({results.length} keywords)
                </CardTitle>
                <CardDescription>
                  {selectedResults.size} selected
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  disabled={selectedResults.size === 0}
                  onClick={() => setIsSaveDialogOpen(true)}
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Save to Library ({selectedResults.size})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-3 font-medium text-gray-600 w-10"></th>
                    <th className="text-left p-3 font-medium text-gray-600">Keyword</th>
                    <th className="text-left p-3 font-medium text-gray-600">Volume</th>
                    <th className="text-left p-3 font-medium text-gray-600">Difficulty</th>
                    <th className="text-left p-3 font-medium text-gray-600">Opportunity</th>
                    <th className="text-left p-3 font-medium text-gray-600">CPC</th>
                    <th className="text-left p-3 font-medium text-gray-600">Trend</th>
                    <th className="text-left p-3 font-medium text-gray-600">Competition</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {results.map((result, index) => (
                    <motion.tr
                      key={result.keyword}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        selectedResults.has(result.keyword) ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => toggleResult(result.keyword)}
                    >
                      <td className="p-3">
                        <Checkbox
                          checked={selectedResults.has(result.keyword)}
                          onCheckedChange={() => toggleResult(result.keyword)}
                        />
                      </td>
                      <td className="p-3 font-medium text-gray-900">{result.keyword}</td>
                      <td className="p-3 text-gray-600">
                        {result.search_volume?.toLocaleString() || '-'}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-sm font-medium ${getDifficultyColor(result.difficulty)}`}>
                          {result.difficulty || '-'} {getDifficultyLabel(result.difficulty)}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-sm font-medium ${getOpportunityColor(result.opportunity_score)}`}>
                          {result.opportunity_score || '-'}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600">
                        {result.cpc ? `$${result.cpc.toFixed(2)}` : '-'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <TrendIcon trend={result.trend} />
                          <span className="text-sm text-gray-500 capitalize">{result.trend || '-'}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {result.competition_level || '-'}
                        </Badge>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Dialog */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Save Keywords to Library</DialogTitle>
            <DialogDescription>
              Save {selectedResults.size} selected keywords to your library
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Assign to Cluster (optional)</Label>
              <Select
                value={saveOptions.clusterId}
                onValueChange={(value) => setSaveOptions({ ...saveOptions, clusterId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No cluster" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No cluster</SelectItem>
                  {clusters.map(cluster => (
                    <SelectItem key={cluster.id} value={cluster.id}>
                      {cluster.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="autoStar"
                checked={saveOptions.autoStar}
                onCheckedChange={(checked) => setSaveOptions({ ...saveOptions, autoStar: checked })}
              />
              <Label htmlFor="autoStar" className="flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500" />
                Star all keywords (mark as high priority)
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="addToQueue"
                checked={saveOptions.addToQueue}
                onCheckedChange={(checked) => setSaveOptions({ ...saveOptions, addToQueue: checked })}
              />
              <Label htmlFor="addToQueue" className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                Add to generation queue
              </Label>
            </div>

            {saveOptions.addToQueue && (
              <div className="space-y-2 pl-6">
                <Label>Queue for (days)</Label>
                <Select
                  value={saveOptions.queueDays.toString()}
                  onValueChange={(value) => setSaveOptions({ ...saveOptions, queueDays: parseInt(value) })}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save Keywords'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ========================================
// LIBRARY TAB
// ========================================
function LibraryTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCluster, setSelectedCluster] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [viewFilter, setViewFilter] = useState('all') // all, starred, queued
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isQueueDialogOpen, setIsQueueDialogOpen] = useState(false)
  const [editingKeyword, setEditingKeyword] = useState(null)
  const [importText, setImportText] = useState('')
  const [selectedKeywords, setSelectedKeywords] = useState(new Set())
  const [queueDays, setQueueDays] = useState(7)
  const [formData, setFormData] = useState({
    keyword: '',
    search_volume: '',
    intent: '',
    difficulty_score: '',
    cluster_id: '',
  })

  // Persisted sort. Default keeps the prior behaviour: keyword A→Z.
  const [sortKey, setSortKey] = useStoredState('perdia:sort:keywords', 'keyword-asc')
  const sort = resolveSort(KEYWORD_SORT_OPTIONS, sortKey)

  // Hooks
  const { data: allKeywords = [], isLoading } = useKeywords({
    search: searchQuery || undefined,
    clusterId: selectedCluster !== 'all' ? selectedCluster : undefined,
    sort,
  })
  const { data: starredKeywords = [] } = useStarredKeywords()
  const { data: queuedKeywords = [] } = useQueuedKeywords()
  const { data: clusters = [] } = useClusters()
  const stats = useKeywordResearchStats()

  const createMutation = useCreateKeyword()
  const updateMutation = useUpdateKeyword()
  const deleteMutation = useDeleteKeyword()
  const bulkImportMutation = useBulkImportKeywords()
  const toggleStarMutation = useToggleStarKeyword()
  const queueMutation = useQueueKeywords()
  const dequeueMutation = useDequeueKeywords()
  const createIdeasMutation = useCreateIdeasFromKeywords()

  // Filter keywords based on view and source
  const filteredKeywords = useMemo(() => {
    let result = allKeywords

    // View filter
    if (viewFilter === 'starred') {
      result = result.filter(k => k.is_starred)
    } else if (viewFilter === 'queued') {
      result = result.filter(k => k.is_queued)
    }

    // Source filter
    if (sourceFilter !== 'all') {
      result = result.filter(k => k.source === sourceFilter)
    }

    return result
  }, [allKeywords, viewFilter, sourceFilter])

  // Handlers
  const handleAddKeyword = async (e) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        keyword: formData.keyword,
        search_volume: formData.search_volume ? parseInt(formData.search_volume) : null,
        intent: formData.intent || null,
        difficulty_score: formData.difficulty_score ? parseInt(formData.difficulty_score) : null,
        cluster_id: formData.cluster_id || null,
        source: 'manual',
      })
      setIsAddDialogOpen(false)
      resetForm()
    } catch (error) {
      console.error('Error creating keyword:', error)
    }
  }

  const handleEditKeyword = async (e) => {
    e.preventDefault()
    if (!editingKeyword) return

    try {
      await updateMutation.mutateAsync({
        id: editingKeyword.id,
        updates: {
          keyword: formData.keyword,
          search_volume: formData.search_volume ? parseInt(formData.search_volume) : null,
          intent: formData.intent || null,
          difficulty_score: formData.difficulty_score ? parseInt(formData.difficulty_score) : null,
          cluster_id: formData.cluster_id || null,
        },
      })
      setIsEditDialogOpen(false)
      setEditingKeyword(null)
      resetForm()
    } catch (error) {
      console.error('Error updating keyword:', error)
    }
  }

  const handleDeleteKeyword = async (id) => {
    if (!window.confirm('Are you sure you want to delete this keyword?')) return
    try {
      await deleteMutation.mutateAsync(id)
    } catch (error) {
      console.error('Error deleting keyword:', error)
    }
  }

  const handleToggleStar = async (keyword) => {
    try {
      await toggleStarMutation.mutateAsync({
        id: keyword.id,
        isStarred: !keyword.is_starred,
      })
    } catch (error) {
      console.error('Error toggling star:', error)
    }
  }

  const handleBulkQueue = async () => {
    if (selectedKeywords.size === 0) return

    try {
      const expiresAt = addDays(new Date(), queueDays).toISOString()
      await queueMutation.mutateAsync({
        keywordIds: Array.from(selectedKeywords),
        expiresAt,
      })
      setSelectedKeywords(new Set())
      setIsQueueDialogOpen(false)
    } catch (error) {
      console.error('Error queuing keywords:', error)
    }
  }

  const handleCreateIdeas = async () => {
    if (selectedKeywords.size === 0) return

    try {
      await createIdeasMutation.mutateAsync(Array.from(selectedKeywords))
      setSelectedKeywords(new Set())
    } catch (error) {
      console.error('Error creating ideas:', error)
    }
  }

  const handleBulkImport = async () => {
    if (!importText.trim()) return

    try {
      const lines = importText.trim().split('\n')
      const keywordsToImport = lines
        .map(line => {
          const parts = line.split(/[,\t]/).map(p => p.trim())
          if (!parts[0]) return null
          return {
            keyword: parts[0],
            search_volume: parts[1] ? parseInt(parts[1]) : null,
            intent: parts[2] || null,
            difficulty_score: parts[3] ? parseInt(parts[3]) : null,
            source: 'manual',
          }
        })
        .filter(Boolean)

      if (keywordsToImport.length === 0) {
        alert('No valid keywords found in import data')
        return
      }

      await bulkImportMutation.mutateAsync(keywordsToImport)
      setIsImportDialogOpen(false)
      setImportText('')
    } catch (error) {
      console.error('Error importing keywords:', error)
    }
  }

  const handleExport = () => {
    const csvContent = filteredKeywords
      .map(k => `${k.keyword},${k.search_volume || ''},${k.intent || ''},${k.difficulty_score || ''},${k.opportunity_score || ''},${k.source || ''}`)
      .join('\n')

    const blob = new Blob([`keyword,search_volume,intent,difficulty,opportunity,source\n${csvContent}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `keywords-${format(new Date(), 'yyyy-MM-dd')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const openEditDialog = (keyword) => {
    setEditingKeyword(keyword)
    setFormData({
      keyword: keyword.keyword,
      search_volume: keyword.search_volume?.toString() || '',
      intent: keyword.intent || '',
      difficulty_score: keyword.difficulty_score?.toString() || '',
      cluster_id: keyword.cluster_id || '',
    })
    setIsEditDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({
      keyword: '',
      search_volume: '',
      intent: '',
      difficulty_score: '',
      cluster_id: '',
    })
  }

  const toggleKeywordSelection = (id) => {
    setSelectedKeywords(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl">
                <Hash className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Keywords</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.total || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-50 rounded-xl">
                <Star className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Starred</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.starred || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-50 rounded-xl">
                <Gauge className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg. Opportunity</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.avgOpportunityScore || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-50 rounded-xl">
                <Globe className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">From DataForSEO</p>
                <p className="text-2xl font-bold text-gray-900">{stats.data?.fromDataForSEO || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="border-none shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* View Filter */}
            <Select value={viewFilter} onValueChange={setViewFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All Keywords" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Keywords</SelectItem>
                <SelectItem value="starred">
                  <span className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-yellow-500" />
                    Starred
                  </span>
                </SelectItem>
                <SelectItem value="queued">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-500" />
                    Queued
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Source Filter */}
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="dataforseo">DataForSEO</SelectItem>
                <SelectItem value="catalog_analysis">Catalog</SelectItem>
              </SelectContent>
            </Select>

            {/* Cluster Filter */}
            <Select value={selectedCluster} onValueChange={setSelectedCluster}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Clusters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clusters</SelectItem>
                {clusters.map(cluster => (
                  <SelectItem key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <SortDropdown
              value={sortKey}
              onChange={setSortKey}
              options={KEYWORD_SORT_OPTIONS}
            />

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Add
              </Button>
              <Button variant="outline" onClick={() => setIsImportDialogOpen(true)} className="gap-2">
                <Upload className="w-4 h-4" />
                Import
              </Button>
              <Button variant="outline" onClick={handleExport} className="gap-2">
                <Download className="w-4 h-4" />
                Export
              </Button>
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedKeywords.size > 0 && (
            <div className="flex items-center gap-4 mt-4 pt-4 border-t">
              <span className="text-sm text-gray-600">
                {selectedKeywords.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsQueueDialogOpen(true)}
                className="gap-2"
              >
                <Clock className="w-4 h-4" />
                Add to Queue
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateIdeas}
                disabled={createIdeasMutation.isPending}
                className="gap-2"
              >
                <Lightbulb className="w-4 h-4" />
                Create Ideas
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedKeywords(new Set())}
              >
                Clear Selection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keywords Table */}
      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredKeywords.length === 0 ? (
            <div className="p-12 text-center">
              <Hash className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                No keywords found
              </h3>
              <p className="text-gray-500 mb-4">
                Start by researching keywords or adding them manually
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Add First Keyword
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600 w-10"></th>
                    <th className="text-left p-4 font-medium text-gray-600 w-10"></th>
                    <th className="text-left p-4 font-medium text-gray-600">Keyword</th>
                    <th className="text-left p-4 font-medium text-gray-600">Volume</th>
                    <th className="text-left p-4 font-medium text-gray-600">Difficulty</th>
                    <th className="text-left p-4 font-medium text-gray-600">Opportunity</th>
                    <th className="text-left p-4 font-medium text-gray-600">Source</th>
                    <th className="text-left p-4 font-medium text-gray-600">Cluster</th>
                    <th className="text-right p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <AnimatePresence>
                    {filteredKeywords.map((keyword, index) => (
                      <motion.tr
                        key={keyword.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ delay: index * 0.02 }}
                        className={`hover:bg-gray-50 ${selectedKeywords.has(keyword.id) ? 'bg-blue-50' : ''}`}
                      >
                        <td className="p-4">
                          <Checkbox
                            checked={selectedKeywords.has(keyword.id)}
                            onCheckedChange={() => toggleKeywordSelection(keyword.id)}
                          />
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => handleToggleStar(keyword)}
                            className="hover:scale-110 transition-transform"
                          >
                            {keyword.is_starred ? (
                              <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                            ) : (
                              <StarOff className="w-5 h-5 text-gray-300 hover:text-yellow-500" />
                            )}
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{keyword.keyword}</span>
                            <NewBadge timestamp={keyword.created_at} />
                            {keyword.is_queued && (
                              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                <Clock className="w-3 h-3 mr-1" />
                                Queued
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1">
                            <DateLabel createdAt={keyword.created_at} updatedAt={keyword.updated_at} />
                          </div>
                        </td>
                        <td className="p-4">
                          {keyword.search_volume ? (
                            <span className="text-gray-600">
                              {keyword.search_volume.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          {keyword.difficulty_score !== null ? (
                            <span className={`px-2 py-1 rounded text-sm font-medium ${getDifficultyColor(keyword.difficulty_score)}`}>
                              {keyword.difficulty_score}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          {keyword.opportunity_score !== null ? (
                            <span className={`px-2 py-1 rounded text-sm font-medium ${getOpportunityColor(keyword.opportunity_score)}`}>
                              {keyword.opportunity_score}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="text-xs">
                            {keyword.source === 'dataforseo' ? 'DataForSEO' : keyword.source || 'manual'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          {keyword.clusters?.name ? (
                            <Badge variant="secondary">
                              {keyword.clusters.name}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(keyword)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleStar(keyword)}>
                                {keyword.is_starred ? (
                                  <>
                                    <StarOff className="w-4 h-4 mr-2" />
                                    Unstar
                                  </>
                                ) : (
                                  <>
                                    <Star className="w-4 h-4 mr-2" />
                                    Star
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteKeyword(keyword.id)}
                                className="text-red-600"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Keyword Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Add Keyword</DialogTitle>
            <DialogDescription>
              Add a new keyword to your library manually.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddKeyword}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="keyword">Keyword *</Label>
                <Input
                  id="keyword"
                  placeholder="Enter keyword"
                  value={formData.keyword}
                  onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="search_volume">Search Volume</Label>
                  <Input
                    id="search_volume"
                    type="number"
                    placeholder="e.g., 1000"
                    value={formData.search_volume}
                    onChange={(e) => setFormData({ ...formData, search_volume: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="difficulty">Difficulty (0-100)</Label>
                  <Input
                    id="difficulty"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g., 45"
                    value={formData.difficulty_score}
                    onChange={(e) => setFormData({ ...formData, difficulty_score: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="intent">Search Intent</Label>
                <Select
                  value={formData.intent}
                  onValueChange={(value) => setFormData({ ...formData, intent: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select intent" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INTENT_CONFIG).map(([value, config]) => (
                      <SelectItem key={value} value={value}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cluster">Cluster</Label>
                <Select
                  value={formData.cluster_id}
                  onValueChange={(value) => setFormData({ ...formData, cluster_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters.map(cluster => (
                      <SelectItem key={cluster.id} value={cluster.id}>
                        {cluster.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding...' : 'Add Keyword'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Keyword Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Keyword</DialogTitle>
            <DialogDescription>
              Update keyword details.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditKeyword}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-keyword">Keyword *</Label>
                <Input
                  id="edit-keyword"
                  placeholder="Enter keyword"
                  value={formData.keyword}
                  onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-search_volume">Search Volume</Label>
                  <Input
                    id="edit-search_volume"
                    type="number"
                    placeholder="e.g., 1000"
                    value={formData.search_volume}
                    onChange={(e) => setFormData({ ...formData, search_volume: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-difficulty">Difficulty (0-100)</Label>
                  <Input
                    id="edit-difficulty"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g., 45"
                    value={formData.difficulty_score}
                    onChange={(e) => setFormData({ ...formData, difficulty_score: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-intent">Search Intent</Label>
                <Select
                  value={formData.intent}
                  onValueChange={(value) => setFormData({ ...formData, intent: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select intent" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INTENT_CONFIG).map(([value, config]) => (
                      <SelectItem key={value} value={value}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cluster">Cluster</Label>
                <Select
                  value={formData.cluster_id}
                  onValueChange={(value) => setFormData({ ...formData, cluster_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters.map(cluster => (
                      <SelectItem key={cluster.id} value={cluster.id}>
                        {cluster.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Import Keywords</DialogTitle>
            <DialogDescription>
              Import keywords in CSV format: keyword, search_volume, intent, difficulty
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Textarea
              placeholder={`best online nursing degree,5400,commercial,65
how to become a nurse,2900,informational,35
nursing salary guide,8100,informational,45`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
            <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              <p className="font-medium mb-1">Format Guide:</p>
              <p>keyword, search_volume, intent, difficulty</p>
              <p className="text-blue-600 mt-1">Intent: informational, navigational, transactional, commercial</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBulkImport}
              disabled={!importText.trim() || bulkImportMutation.isPending}
            >
              {bulkImportMutation.isPending ? 'Importing...' : 'Import Keywords'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Queue Dialog */}
      <Dialog open={isQueueDialogOpen} onOpenChange={setIsQueueDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add to Generation Queue</DialogTitle>
            <DialogDescription>
              Queue {selectedKeywords.size} keywords for article generation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Queue duration</Label>
              <Select value={queueDays.toString()} onValueChange={(v) => setQueueDays(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-gray-500">
                Keywords will be available for generation until {format(addDays(new Date(), queueDays), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsQueueDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkQueue} disabled={queueMutation.isPending}>
              {queueMutation.isPending ? 'Queuing...' : 'Add to Queue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ========================================
// CLUSTERS TAB
// ========================================
function ClustersTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingCluster, setEditingCluster] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    parent_cluster_id: '',
  })

  // Hooks
  const { data: clusters = [], isLoading } = useClusters({
    search: searchQuery || undefined,
  })
  const stats = useClusterStats()
  const createMutation = useCreateCluster()
  const updateMutation = useUpdateCluster()
  const deleteMutation = useDeleteCluster()

  // Handlers
  const handleAddCluster = async (e) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        name: formData.name,
        description: formData.description || null,
        parent_cluster_id: formData.parent_cluster_id || null,
      })
      setIsAddDialogOpen(false)
      resetForm()
    } catch (error) {
      console.error('Error creating cluster:', error)
    }
  }

  const handleEditCluster = async (e) => {
    e.preventDefault()
    if (!editingCluster) return

    try {
      await updateMutation.mutateAsync({
        id: editingCluster.id,
        updates: {
          name: formData.name,
          description: formData.description || null,
          parent_cluster_id: formData.parent_cluster_id || null,
        },
      })
      setIsEditDialogOpen(false)
      setEditingCluster(null)
      resetForm()
    } catch (error) {
      console.error('Error updating cluster:', error)
    }
  }

  const handleDeleteCluster = async (id) => {
    if (!window.confirm('Are you sure you want to delete this cluster? Keywords will be unassigned.')) return
    try {
      await deleteMutation.mutateAsync(id)
    } catch (error) {
      console.error('Error deleting cluster:', error)
    }
  }

  const openEditDialog = (cluster) => {
    setEditingCluster(cluster)
    setFormData({
      name: cluster.name,
      description: cluster.description || '',
      parent_cluster_id: cluster.parent_cluster_id || '',
    })
    setIsEditDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      parent_cluster_id: '',
    })
  }

  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl">
                <FolderTree className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Clusters</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-50 rounded-xl">
                <Zap className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Active Clusters</p>
                <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-50 rounded-xl">
                <Hash className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Keywords</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalKeywords}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-orange-50 rounded-xl">
                <FileText className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Articles</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalArticles}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="border-none shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search clusters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Add Cluster
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Clusters Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-none shadow-sm">
              <CardContent className="p-6">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-4" />
                <Skeleton className="h-8 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clusters.length === 0 ? (
        <Card className="border-none shadow-sm">
          <CardContent className="p-12 text-center">
            <FolderTree className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              No clusters found
            </h3>
            <p className="text-gray-500 mb-4">
              Create topic clusters to organize your keywords and content
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Create First Cluster
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {clusters.map((cluster, index) => (
              <motion.div
                key={cluster.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="border-none shadow-sm hover:shadow-md transition-all h-full">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 bg-blue-50 rounded-xl">
                        <Layers className="w-6 h-6 text-blue-600" />
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(cluster)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeleteCluster(cluster.id)}
                            className="text-red-600"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <h3 className="font-bold text-lg text-gray-900 mb-2">
                      {cluster.name}
                    </h3>

                    {cluster.description && (
                      <p className="text-gray-500 text-sm mb-4 line-clamp-2">
                        {cluster.description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1.5 text-gray-500">
                        <Hash className="w-4 h-4" />
                        <span>{cluster.keyword_count || 0} keywords</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-500">
                        <FileText className="w-4 h-4" />
                        <span>{cluster.article_count || 0} articles</span>
                      </div>
                    </div>

                    {cluster.status && (
                      <div className="mt-4">
                        <Badge
                          variant="outline"
                          className={cluster.status === 'active'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-gray-100 text-gray-600'
                          }
                        >
                          {cluster.status}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add Cluster Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Create Cluster</DialogTitle>
            <DialogDescription>
              Create a new topic cluster to organize your keywords and content.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCluster}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Nursing Careers"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe this topic cluster..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parent">Parent Cluster (optional)</Label>
                <Select
                  value={formData.parent_cluster_id}
                  onValueChange={(value) => setFormData({ ...formData, parent_cluster_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters.map(cluster => (
                      <SelectItem key={cluster.id} value={cluster.id}>
                        {cluster.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Cluster'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Cluster Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Cluster</DialogTitle>
            <DialogDescription>
              Update cluster details.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditCluster}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name *</Label>
                <Input
                  id="edit-name"
                  placeholder="e.g., Nursing Careers"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  placeholder="Describe this topic cluster..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-parent">Parent Cluster</Label>
                <Select
                  value={formData.parent_cluster_id}
                  onValueChange={(value) => setFormData({ ...formData, parent_cluster_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters
                      .filter(c => c.id !== editingCluster?.id)
                      .map(cluster => (
                        <SelectItem key={cluster.id} value={cluster.id}>
                          {cluster.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
