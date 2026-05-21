import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useSiteArticles,
  useSiteArticleStats,
  useCreateSiteArticle,
  useUpdateSiteArticle,
  useDeleteSiteArticle,
  useBulkImportSiteArticles,
  useToggleSiteArticleStatus,
} from '@/hooks/useSiteArticles'
import {
  useGetEducatedArticlesPaginated,
  useGetEducatedCatalogStats,
  useGetEducatedFilterOptions,
} from '@/hooks/useGetEducatedCatalog'
import { useClusters } from '@/hooks/useClusters'

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SortDropdown } from '@/components/ui/sort-dropdown'
import { NewBadge } from '@/components/ui/new-badge'
import { CATALOG_SORT_OPTIONS, resolveSort } from '@/lib/sortOptions'
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

// Icons
import {
  Search,
  Plus,
  Upload,
  Download,
  ExternalLink,
  Link2,
  MoreVertical,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Globe,
  FileText,
  Tag,
  Filter,
  X,
  Check,
  AlertCircle,
  FolderOpen,
  BookOpen,
  GraduationCap,
  Briefcase,
  Database,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  History,
  RefreshCw,
} from 'lucide-react'

export default function SiteCatalog() {
  const navigate = useNavigate()

  // State
  const [activeTab, setActiveTab] = useState('geteducated') // 'geteducated' or 'custom'
  const [geSubTab, setGeSubTab] = useState('all') // 'all' or 'revised' - sub-tab for GetEducated
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCluster, setSelectedCluster] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [contentTypeFilter, setContentTypeFilter] = useState('all')
  const [degreeLevelFilter, setDegreeLevelFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [editingArticle, setEditingArticle] = useState(null)
  const [importText, setImportText] = useState('')
  const [formData, setFormData] = useState({
    title: '',
    url: '',
    excerpt: '',
    topics: '',
    cluster_id: '',
  })

  // File input ref for CSV import
  const fileInputRef = useRef(null)

  // Persisted sort for both tabs. Custom catalog defaults to Title A→Z
  // (matches prior behaviour); GetEducated catalog stays on updated_at desc.
  const [customSortKey, setCustomSortKey] = useStoredState('perdia:sort:catalog:custom', 'title-asc')
  const customSort = resolveSort(CATALOG_SORT_OPTIONS, customSortKey)
  const [geSortKey, setGeSortKey] = useStoredState('perdia:sort:catalog:ge', 'newest')
  const geSort = resolveSort(CATALOG_SORT_OPTIONS, geSortKey)

  // Hooks - Legacy site_articles
  const { data: articles = [], isLoading } = useSiteArticles({
    search: searchQuery || undefined,
    sort: customSort,
  })
  const stats = useSiteArticleStats()
  const { data: clusters = [] } = useClusters()

  // Hooks - GetEducated catalog with pagination
  const { data: geStats, isLoading: geStatsLoading } = useGetEducatedCatalogStats()
  const geFilters = useGetEducatedFilterOptions()
  const { data: gePaginatedData, isLoading: geLoading } = useGetEducatedArticlesPaginated({
    page: currentPage,
    pageSize,
    search: searchQuery || undefined,
    contentType: contentTypeFilter,
    degreeLevel: degreeLevelFilter,
    revisedOnly: geSubTab === 'revised',
    sortBy: geSort.column === 'created_at' ? 'updated_at' : geSort.column,
    sortAsc: geSort.direction === 'asc',
  })

  // Extract pagination data
  const geArticles = gePaginatedData?.articles || []
  const totalPages = gePaginatedData?.totalPages || 1
  const totalCount = gePaginatedData?.totalCount || 0
  const createMutation = useCreateSiteArticle()
  const updateMutation = useUpdateSiteArticle()
  const deleteMutation = useDeleteSiteArticle()
  const toggleStatusMutation = useToggleSiteArticleStatus()
  const bulkImportMutation = useBulkImportSiteArticles()

  // Filter articles
  const filteredArticles = articles.filter(article => {
    if (selectedCluster !== 'all' && article.cluster_id !== selectedCluster) return false
    if (statusFilter === 'active' && !article.is_active) return false
    if (statusFilter === 'inactive' && article.is_active) return false
    return true
  })

  // Handlers
  const handleAddArticle = async (e) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        title: formData.title,
        url: formData.url,
        excerpt: formData.excerpt || null,
        topics: formData.topics ? formData.topics.split(',').map(t => t.trim()) : [],
        cluster_id: formData.cluster_id || null,
      })
      setIsAddDialogOpen(false)
      resetForm()
    } catch (error) {
      console.error('Error creating article:', error)
    }
  }

  const handleEditArticle = async (e) => {
    e.preventDefault()
    if (!editingArticle) return

    try {
      await updateMutation.mutateAsync({
        id: editingArticle.id,
        updates: {
          title: formData.title,
          url: formData.url,
          excerpt: formData.excerpt || null,
          topics: formData.topics ? formData.topics.split(',').map(t => t.trim()) : [],
          cluster_id: formData.cluster_id || null,
        },
      })
      setIsEditDialogOpen(false)
      setEditingArticle(null)
      resetForm()
    } catch (error) {
      console.error('Error updating article:', error)
    }
  }

  const handleDeleteArticle = async (id) => {
    if (!window.confirm('Are you sure you want to delete this article from the catalog?')) return
    try {
      await deleteMutation.mutateAsync(id)
    } catch (error) {
      console.error('Error deleting article:', error)
    }
  }

  const handleToggleStatus = async (article) => {
    try {
      await toggleStatusMutation.mutateAsync({
        id: article.id,
        isActive: !article.is_active,
      })
    } catch (error) {
      console.error('Error toggling status:', error)
    }
  }

  const handleBulkImport = async () => {
    if (!importText.trim()) return

    try {
      // Parse CSV/TSV format: URL, Title, Topics (optional)
      const lines = importText.trim().split('\n')
      const articles = lines
        .map(line => {
          const parts = line.split(/[,\t]/).map(p => p.trim())
          if (parts.length < 2) return null
          return {
            url: parts[0],
            title: parts[1],
            topics: parts[2] ? parts[2].split('|').map(t => t.trim()) : [],
          }
        })
        .filter(Boolean)

      if (articles.length === 0) {
        alert('No valid articles found in import data')
        return
      }

      await bulkImportMutation.mutateAsync(articles)
      setIsImportDialogOpen(false)
      setImportText('')
    } catch (error) {
      console.error('Error importing articles:', error)
    }
  }

  const handleFileImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      setImportText(event.target.result)
    }
    reader.readAsText(file)
  }

  const handleExport = () => {
    const csvContent = articles
      .map(a => `${a.url},${a.title},${(a.topics || []).join('|')}`)
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `site-catalog-${format(new Date(), 'yyyy-MM-dd')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const openEditDialog = (article) => {
    setEditingArticle(article)
    setFormData({
      title: article.title,
      url: article.url,
      excerpt: article.excerpt || '',
      topics: (article.topics || []).join(', '),
      cluster_id: article.cluster_id || '',
    })
    setIsEditDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({
      title: '',
      url: '',
      excerpt: '',
      topics: '',
      cluster_id: '',
    })
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
            Site Catalog
          </h1>
          <p className="text-gray-600 text-lg">
            Manage your internal linking library for SEO optimization
          </p>
        </motion.div>

        {/* Tab Switcher */}
        <div className="flex gap-2 border-b pb-2">
          <Button
            variant={activeTab === 'geteducated' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('geteducated')}
            className="gap-2"
          >
            <Database className="w-4 h-4" />
            GetEducated Catalog
            {geStats && (
              <Badge variant="secondary" className="ml-1">
                {geStats.totalArticles?.toLocaleString()}
              </Badge>
            )}
          </Button>
          <Button
            variant={activeTab === 'custom' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('custom')}
            className="gap-2"
          >
            <Globe className="w-4 h-4" />
            Custom Articles
            <Badge variant="secondary" className="ml-1">{stats.total}</Badge>
          </Button>
        </div>

        {/* Stats Cards - GetEducated */}
        {activeTab === 'geteducated' && (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 rounded-xl">
                    <Database className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total URLs</p>
                    <p className="text-2xl font-bold text-gray-900">{geStats?.totalArticles?.toLocaleString() || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-50 rounded-xl">
                    <BookOpen className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Enriched</p>
                    <p className="text-2xl font-bold text-gray-900">{geStats?.enrichedArticles?.toLocaleString() || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-none shadow-sm cursor-pointer transition-all ${geSubTab === 'revised' ? 'ring-2 ring-indigo-500 ring-offset-2' : 'hover:shadow-md'}`}
              onClick={() => { setGeSubTab('revised'); setCurrentPage(1); }}
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-50 rounded-xl">
                    <RefreshCw className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Revised</p>
                    <p className="text-2xl font-bold text-gray-900">{geStats?.revisedArticles?.toLocaleString() || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-50 rounded-xl">
                    <GraduationCap className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Degree Levels</p>
                    <p className="text-2xl font-bold text-gray-900">{Object.keys(geStats?.degreeLevels || {}).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-orange-50 rounded-xl">
                    <Briefcase className="w-6 h-6 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Subjects</p>
                    <p className="text-2xl font-bold text-gray-900">{Object.keys(geStats?.subjectAreas || {}).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-teal-50 rounded-xl">
                    <FileText className="w-6 h-6 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Enrichment</p>
                    <p className="text-2xl font-bold text-gray-900">{geStats?.enrichmentProgress || 0}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sub-tabs for GetEducated */}
        {activeTab === 'geteducated' && (
          <div className="flex items-center gap-2">
            <Button
              variant={geSubTab === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setGeSubTab('all'); setCurrentPage(1); }}
              className="gap-2"
            >
              <Database className="w-4 h-4" />
              All Articles
              <Badge variant="secondary" className="ml-1">
                {geStats?.totalArticles?.toLocaleString() || 0}
              </Badge>
            </Button>
            <Button
              variant={geSubTab === 'revised' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setGeSubTab('revised'); setCurrentPage(1); }}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Revised Articles
              <Badge variant={geSubTab === 'revised' ? 'secondary' : 'outline'} className="ml-1">
                {geStats?.revisedArticles?.toLocaleString() || 0}
              </Badge>
            </Button>
          </div>
        )}

        {/* Stats Cards - Custom */}
        {activeTab === 'custom' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 rounded-xl">
                    <Globe className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Articles</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-50 rounded-xl">
                    <Eye className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Active</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-yellow-50 rounded-xl">
                    <EyeOff className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Inactive</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.inactive}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-50 rounded-xl">
                    <FolderOpen className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Categories</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.categories?.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Toolbar */}
        <Card className="border-none shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search articles by title or URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* GetEducated Filters */}
              {activeTab === 'geteducated' && (
                <>
                  <Select value={contentTypeFilter} onValueChange={(v) => { setContentTypeFilter(v); setCurrentPage(1); }}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Content Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {geFilters.contentTypes.map(type => (
                        <SelectItem key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={degreeLevelFilter} onValueChange={(v) => { setDegreeLevelFilter(v); setCurrentPage(1); }}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Degree Level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      {geFilters.degreeLevels.map(level => (
                        <SelectItem key={level} value={level}>
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <SortDropdown
                    value={geSortKey}
                    onChange={(k) => { setGeSortKey(k); setCurrentPage(1); }}
                    options={CATALOG_SORT_OPTIONS}
                  />
                </>
              )}

              {/* Custom Catalog Filters */}
              {activeTab === 'custom' && (
                <>
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

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>

                  <SortDropdown
                    value={customSortKey}
                    onChange={setCustomSortKey}
                    options={CATALOG_SORT_OPTIONS}
                  />

                  {/* Actions - Only for custom catalog */}
                  <div className="flex gap-2">
                    <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
                      <Plus className="w-4 h-4" />
                      Add Article
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
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* GetEducated Articles Table */}
        {activeTab === 'geteducated' && (
          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
              {geLoading ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-12 w-12 rounded" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-3/4 mb-2" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : geArticles.length === 0 ? (
                <div className="p-12 text-center">
                  <Database className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    No articles found
                  </h3>
                  <p className="text-gray-500 mb-4">
                    Try adjusting your filters or run the enrichment script
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-4 font-medium text-gray-600">Article</th>
                        <th className="text-left p-4 font-medium text-gray-600">Type</th>
                        <th className="text-left p-4 font-medium text-gray-600">Level</th>
                        <th className="text-left p-4 font-medium text-gray-600">Subject</th>
                        <th className="text-left p-4 font-medium text-gray-600">Words</th>
                        <th className="text-left p-4 font-medium text-gray-600">Versions</th>
                        <th className="text-left p-4 font-medium text-gray-600">Linked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <AnimatePresence>
                        {geArticles.map((article, index) => (
                          <motion.tr
                            key={article.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ delay: index * 0.02 }}
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => navigate(`/catalog/${article.id}`)}
                          >
                            <td className="p-4">
                              <div className="flex items-start gap-3">
                                <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
                                  <BookOpen className="w-5 h-5 text-blue-600" />
                                </div>
                                <div className="min-w-0">
                                  <span className="font-medium text-gray-900 hover:text-blue-600 line-clamp-1 flex items-center gap-2 flex-wrap">
                                    {article.title}
                                    <NewBadge timestamp={article.created_at} />
                                  </span>
                                  <p className="text-sm text-gray-500 line-clamp-1">{article.slug}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <Badge variant="secondary" className="text-xs">
                                {article.content_type || 'other'}
                              </Badge>
                            </td>
                            <td className="p-4">
                              {article.degree_level ? (
                                <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                                  {article.degree_level}
                                </Badge>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="p-4">
                              {article.subject_area ? (
                                <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                                  {article.subject_area.replace('_', ' ')}
                                </Badge>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="p-4">
                              <span className="text-gray-900">{article.word_count?.toLocaleString() || '-'}</span>
                            </td>
                            <td className="p-4">
                              {(article.version_count || 1) > 1 ? (
                                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 gap-1">
                                  <History className="w-3 h-3" />
                                  v{article.version_count}
                                </Badge>
                              ) : (
                                <span className="text-gray-400 text-sm">Original</span>
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <Link2 className="w-4 h-4 text-gray-400" />
                                <span className="text-gray-900">{article.times_linked_to || 0}</span>
                              </div>
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
        )}

        {/* Custom Articles Table */}
        {activeTab === 'custom' && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredArticles.length === 0 ? (
              <div className="p-12 text-center">
                <Globe className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  No articles found
                </h3>
                <p className="text-gray-500 mb-4">
                  {searchQuery || selectedCluster !== 'all' || statusFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Add articles to build your internal linking catalog'}
                </p>
                <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add First Article
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left p-4 font-medium text-gray-600">Article</th>
                      <th className="text-left p-4 font-medium text-gray-600">Topics</th>
                      <th className="text-left p-4 font-medium text-gray-600">Linked</th>
                      <th className="text-left p-4 font-medium text-gray-600">Status</th>
                      <th className="text-right p-4 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <AnimatePresence>
                      {filteredArticles.map((article, index) => (
                        <motion.tr
                          key={article.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ delay: index * 0.02 }}
                          className="hover:bg-gray-50"
                        >
                          <td className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="p-2 bg-gray-100 rounded-lg flex-shrink-0">
                                <FileText className="w-5 h-5 text-gray-500" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <a
                                    href={article.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-gray-900 hover:text-blue-600 line-clamp-1 flex items-center gap-1"
                                  >
                                    {article.title}
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                  <NewBadge timestamp={article.created_at} />
                                </div>
                                <p className="text-sm text-gray-500 line-clamp-1">{article.url}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1">
                              {(article.topics || []).slice(0, 3).map((topic, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {topic}
                                </Badge>
                              ))}
                              {(article.topics || []).length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{article.topics.length - 3}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Link2 className="w-4 h-4 text-gray-400" />
                              <span className="text-gray-900">{article.times_linked_to || 0}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <Badge
                              variant={article.is_active ? 'default' : 'secondary'}
                              className={article.is_active
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-gray-100 text-gray-600'
                              }
                            >
                              {article.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="p-4 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDialog(article)}>
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleToggleStatus(article)}>
                                  {article.is_active ? (
                                    <>
                                      <EyeOff className="w-4 h-4 mr-2" />
                                      Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="w-4 h-4 mr-2" />
                                      Activate
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteArticle(article.id)}
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
        )}

        {/* Pagination Controls */}
        {activeTab === 'geteducated' && !geLoading && totalPages > 0 && (
          <Card className="border-none shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalCount)} of {totalCount.toLocaleString()} articles
                </div>

                <div className="flex items-center gap-2">
                  {/* Page size selector */}
                  <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(parseInt(v)); setCurrentPage(1); }}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
                      <SelectItem value="100">100 / page</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Pagination buttons */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <span className="px-3 py-1 text-sm font-medium">
                      Page {currentPage} of {totalPages}
                    </span>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Custom Articles Results Count */}
        {activeTab === 'custom' && !isLoading && filteredArticles.length > 0 && (
          <p className="text-sm text-gray-500 text-center">
            Showing {filteredArticles.length} of {articles.length} articles
          </p>
        )}
      </div>

      {/* Add Article Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Article to Catalog</DialogTitle>
            <DialogDescription>
              Add an existing article from your site to the internal linking catalog.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddArticle}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                <Input
                  id="url"
                  placeholder="https://example.com/article-slug"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  placeholder="Article title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="excerpt">Excerpt</Label>
                <Textarea
                  id="excerpt"
                  placeholder="Brief description of the article..."
                  value={formData.excerpt}
                  onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="topics">Topics (comma-separated)</Label>
                <Input
                  id="topics"
                  placeholder="seo, marketing, content"
                  value={formData.topics}
                  onChange={(e) => setFormData({ ...formData, topics: e.target.value })}
                />
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
                {createMutation.isPending ? 'Adding...' : 'Add Article'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Article Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Article</DialogTitle>
            <DialogDescription>
              Update the article details in your catalog.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditArticle}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-url">URL *</Label>
                <Input
                  id="edit-url"
                  placeholder="https://example.com/article-slug"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title *</Label>
                <Input
                  id="edit-title"
                  placeholder="Article title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-excerpt">Excerpt</Label>
                <Textarea
                  id="edit-excerpt"
                  placeholder="Brief description of the article..."
                  value={formData.excerpt}
                  onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-topics">Topics (comma-separated)</Label>
                <Input
                  id="edit-topics"
                  placeholder="seo, marketing, content"
                  value={formData.topics}
                  onChange={(e) => setFormData({ ...formData, topics: e.target.value })}
                />
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
            <DialogTitle>Import Articles</DialogTitle>
            <DialogDescription>
              Import multiple articles at once. Use CSV format: URL, Title, Topics (pipe-separated)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                Upload CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileImport}
                className="hidden"
              />
            </div>
            <div className="space-y-2">
              <Label>Or paste your data:</Label>
              <Textarea
                placeholder={`https://example.com/article-1,Article Title 1,topic1|topic2
https://example.com/article-2,Article Title 2,topic3|topic4`}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
            <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              <p className="font-medium mb-1">Format Guide:</p>
              <p>Each line: URL, Title, Topics (optional, pipe-separated)</p>
              <p className="text-blue-600 mt-1">Example: https://site.com/post,My Post Title,seo|marketing</p>
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
              {bulkImportMutation.isPending ? 'Importing...' : 'Import Articles'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
