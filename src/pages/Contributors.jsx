import { useState } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useContributors,
  useContributorStats,
  useCreateContributor,
  useUpdateContributor,
  useDeleteContributor,
  useToggleContributorStatus,
  APPROVED_AUTHORS,
  AUTHOR_DISPLAY_NAMES,
} from '@/hooks/useContributors'
import { useArticles } from '@/hooks/useArticles'

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SortDropdown } from '@/components/ui/sort-dropdown'
import { NewBadge } from '@/components/ui/new-badge'
import { PERSON_SORT_OPTIONS, resolveSort } from '@/lib/sortOptions'
import { useStoredState } from '@/lib/useStoredState'
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
  Users,
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  Star,
  Award,
  User,
  Briefcase,
  Tag,
  TrendingUp,
  CheckCircle2,
  ExternalLink,
  Shield,
} from 'lucide-react'

// Content type options
const CONTENT_TYPE_OPTIONS = [
  { value: 'guide', label: 'Guide' },
  { value: 'listicle', label: 'Listicle' },
  { value: 'ranking', label: 'Ranking' },
  { value: 'explainer', label: 'Explainer' },
  { value: 'review', label: 'Review' },
  { value: 'tutorial', label: 'Tutorial' },
]

export default function Contributors() {
  const navigate = useNavigate()

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [filterActive, setFilterActive] = useState('all') // 'all', 'active', 'inactive'
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [editingContributor, setEditingContributor] = useState(null)
  const [viewingContributor, setViewingContributor] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    bio: '',
    expertise_areas: '',
    content_types: [],
    writing_style_profile: {
      tone: '',
      complexity_level: '',
      sentence_length_preference: '',
    },
  })

  // Persisted sort. Default: name A→Z (matches prior behaviour).
  const [sortKey, setSortKey] = useStoredState('perdia:sort:contributors', 'name-asc')
  const sort = resolveSort(PERSON_SORT_OPTIONS, sortKey)

  // Hooks
  const { data: contributors = [], isLoading } = useContributors({
    search: searchQuery || undefined,
    sort,
  })
  const stats = useContributorStats()
  const { data: articles = [] } = useArticles()

  // Separate approved active authors from others
  const approvedAuthors = contributors.filter(c => APPROVED_AUTHORS.includes(c.name) && c.is_active)
  const otherContributors = contributors.filter(c => !APPROVED_AUTHORS.includes(c.name) || !c.is_active)

  // Apply filter
  const getFilteredContributors = (list) => {
    if (filterActive === 'active') return list.filter(c => c.is_active)
    if (filterActive === 'inactive') return list.filter(c => !c.is_active)
    return list
  }

  // Mutations
  const createMutation = useCreateContributor()
  const updateMutation = useUpdateContributor()
  const deleteMutation = useDeleteContributor()
  const toggleStatusMutation = useToggleContributorStatus()

  // Get articles for a contributor
  const getContributorArticles = (contributorId) => {
    return articles.filter(a => a.contributor_id === contributorId)
  }

  // Handlers
  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        name: formData.name,
        bio: formData.bio || null,
        expertise_areas: formData.expertise_areas
          ? formData.expertise_areas.split(',').map(e => e.trim())
          : [],
        content_types: formData.content_types,
        writing_style_profile: formData.writing_style_profile,
      })
      setIsAddDialogOpen(false)
      resetForm()
    } catch (error) {
      console.error('Error creating contributor:', error)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!editingContributor) return

    try {
      await updateMutation.mutateAsync({
        id: editingContributor.id,
        updates: {
          name: formData.name,
          bio: formData.bio || null,
          expertise_areas: formData.expertise_areas
            ? formData.expertise_areas.split(',').map(e => e.trim())
            : [],
          content_types: formData.content_types,
          writing_style_profile: formData.writing_style_profile,
        },
      })
      setIsEditDialogOpen(false)
      setEditingContributor(null)
      resetForm()
    } catch (error) {
      console.error('Error updating contributor:', error)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this contributor?')) return
    try {
      await deleteMutation.mutateAsync(id)
    } catch (error) {
      console.error('Error deleting contributor:', error)
    }
  }

  const handleToggleStatus = async (contributor) => {
    try {
      await toggleStatusMutation.mutateAsync({
        id: contributor.id,
        isActive: !contributor.is_active,
      })
    } catch (error) {
      console.error('Error toggling status:', error)
    }
  }

  const openEditDialog = (contributor) => {
    setEditingContributor(contributor)
    setFormData({
      name: contributor.name,
      bio: contributor.bio || '',
      expertise_areas: (contributor.expertise_areas || []).join(', '),
      content_types: contributor.content_types || [],
      writing_style_profile: contributor.writing_style_profile || {
        tone: '',
        complexity_level: '',
        sentence_length_preference: '',
      },
    })
    setIsEditDialogOpen(true)
  }

  const openViewDialog = (contributor) => {
    setViewingContributor(contributor)
    setIsViewDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({
      name: '',
      bio: '',
      expertise_areas: '',
      content_types: [],
      writing_style_profile: {
        tone: '',
        complexity_level: '',
        sentence_length_preference: '',
      },
    })
  }

  const toggleContentType = (type) => {
    setFormData(prev => ({
      ...prev,
      content_types: prev.content_types.includes(type)
        ? prev.content_types.filter(t => t !== type)
        : [...prev.content_types, type],
    }))
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
            Authors & Contributors
          </h1>
          <p className="text-gray-600 text-lg">
            Manage author profiles with comprehensive writing styles for AI content generation
          </p>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-none shadow-sm bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <Shield className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-green-700 font-medium">Approved Authors</p>
                  <p className="text-2xl font-bold text-green-900">{approvedAuthors.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 rounded-xl">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Contributors</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-amber-50 rounded-xl">
                  <Eye className="w-6 h-6 text-amber-600" />
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
                <div className="p-3 bg-purple-50 rounded-xl">
                  <FileText className="w-6 h-6 text-purple-600" />
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
                  placeholder="Search contributors..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <Button
                    variant={filterActive === 'all' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setFilterActive('all')}
                  >
                    All
                  </Button>
                  <Button
                    variant={filterActive === 'active' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setFilterActive('active')}
                  >
                    Active
                  </Button>
                  <Button
                    variant={filterActive === 'inactive' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setFilterActive('inactive')}
                  >
                    Inactive
                  </Button>
                </div>
                <SortDropdown
                  value={sortKey}
                  onChange={setSortKey}
                  options={PERSON_SORT_OPTIONS}
                />
                <Button onClick={() => { resetForm(); setIsAddDialogOpen(true) }} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Contributor
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contributors Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="border-none shadow-sm">
                <CardContent className="p-6">
                  <Skeleton className="h-16 w-16 rounded-full mb-4" />
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-4" />
                  <Skeleton className="h-8 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : contributors.length === 0 ? (
          <Card className="border-none shadow-sm">
            <CardContent className="p-12 text-center">
              <Users className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                No contributors found
              </h3>
              <p className="text-gray-500 mb-4">
                Create AI contributor personas for diverse content styles
              </p>
              <Button onClick={() => { resetForm(); setIsAddDialogOpen(true) }} className="gap-2">
                <Plus className="w-4 h-4" />
                Add First Contributor
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {/* Approved Authors Section */}
            {getFilteredContributors(approvedAuthors).length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-green-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Approved Authors</h2>
                  <Badge className="bg-green-100 text-green-800 border-green-200">
                    Active for Publishing
                  </Badge>
                </div>
                <p className="text-sm text-gray-500">
                  These are the only authors approved for GetEducated content. Click to view and edit their comprehensive writing profiles.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AnimatePresence>
                    {getFilteredContributors(approvedAuthors).map((contributor, index) => {
                      const contributorArticles = getContributorArticles(contributor.id)
                      const avgQuality = contributorArticles.length > 0
                        ? Math.round(contributorArticles.reduce((sum, a) => sum + (a.quality_score || 0), 0) / contributorArticles.length)
                        : 0
                      const displayName = AUTHOR_DISPLAY_NAMES[contributor.name]

                      return (
                        <motion.div
                          key={contributor.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <Card
                            className="border-2 border-green-200 bg-gradient-to-br from-white to-green-50 shadow-sm hover:shadow-lg hover:border-green-300 transition-all h-full cursor-pointer"
                            onClick={() => navigate(`/contributors/${contributor.id}`)}
                          >
                            <CardContent className="p-6">
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-4">
                                  <div className="relative">
                                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md">
                                      {contributor.name?.charAt(0) || 'C'}
                                    </div>
                                    <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1">
                                      <CheckCircle2 className="w-4 h-4 text-white" />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h3 className="font-bold text-gray-900 text-lg">{contributor.name}</h3>
                                      <NewBadge timestamp={contributor.created_at} />
                                    </div>
                                    {displayName && (
                                      <p className="text-sm text-gray-500">
                                        Writes as <span className="font-medium text-green-700">{displayName}</span>
                                      </p>
                                    )}
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge className="bg-green-100 text-green-800 border-green-200">
                                        <CheckCircle2 className="w-3 h-3 mr-1" />
                                        Approved
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                      <MoreVertical className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/contributors/${contributor.id}`) }}>
                                      <Pencil className="w-4 h-4 mr-2" />
                                      Edit Full Profile
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openViewDialog(contributor) }}>
                                      <Eye className="w-4 h-4 mr-2" />
                                      Quick View
                                    </DropdownMenuItem>
                                    {contributor.author_page_url && (
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); window.open(contributor.author_page_url, '_blank') }}>
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        View Author Page
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>

                              {contributor.bio && (
                                <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                                  {contributor.bio}
                                </p>
                              )}

                              {/* Voice preview */}
                              {contributor.voice_description && (
                                <div className="mb-4 p-3 bg-white/70 rounded-lg border border-green-100">
                                  <p className="text-xs text-green-700 font-medium mb-1">Writing Voice</p>
                                  <p className="text-sm text-gray-600 line-clamp-2">{contributor.voice_description}</p>
                                </div>
                              )}

                              {/* Expertise Areas */}
                              {contributor.expertise_areas && contributor.expertise_areas.length > 0 && (
                                <div className="mb-4">
                                  <div className="flex flex-wrap gap-1">
                                    {contributor.expertise_areas.slice(0, 4).map((area, i) => (
                                      <Badge key={i} variant="secondary" className="text-xs bg-green-100 text-green-800">
                                        {area}
                                      </Badge>
                                    ))}
                                    {contributor.expertise_areas.length > 4 && (
                                      <Badge variant="outline" className="text-xs">
                                        +{contributor.expertise_areas.length - 4}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Stats */}
                              <div className="flex items-center gap-4 pt-4 border-t border-green-100 text-sm">
                                <div className="flex items-center gap-1 text-gray-600">
                                  <FileText className="w-4 h-4" />
                                  <span>{contributorArticles.length} articles</span>
                                </div>
                                {avgQuality > 0 && (
                                  <div className="flex items-center gap-1 text-gray-600">
                                    <Star className="w-4 h-4 text-yellow-500" />
                                    <span>{avgQuality}% avg</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1 text-green-600 ml-auto">
                                  <Pencil className="w-4 h-4" />
                                  <span className="text-xs">Click to edit</span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Other Contributors Section */}
            {getFilteredContributors(otherContributors).length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-gray-500" />
                  <h2 className="text-lg font-semibold text-gray-900">Other Contributors</h2>
                  <Badge variant="outline" className="text-gray-500">
                    Inactive / Legacy
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <AnimatePresence>
                    {getFilteredContributors(otherContributors).map((contributor, index) => {
                      const contributorArticles = getContributorArticles(contributor.id)
                      const avgQuality = contributorArticles.length > 0
                        ? Math.round(contributorArticles.reduce((sum, a) => sum + (a.quality_score || 0), 0) / contributorArticles.length)
                        : 0

                      return (
                        <motion.div
                          key={contributor.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <Card className={`border-none shadow-sm hover:shadow-md transition-all h-full ${!contributor.is_active ? 'opacity-60' : ''}`}>
                            <CardContent className="p-6">
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-14 h-14 bg-gradient-to-br from-gray-400 to-gray-500 rounded-full flex items-center justify-center text-white text-xl font-bold">
                                    {contributor.name?.charAt(0) || 'C'}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h3 className="font-bold text-gray-900">{contributor.name}</h3>
                                      <NewBadge timestamp={contributor.created_at} />
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={contributor.is_active
                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                        : 'bg-gray-100 text-gray-600'
                                      }
                                    >
                                      {contributor.is_active ? 'Active (Not Approved)' : 'Inactive'}
                                    </Badge>
                                  </div>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                      <MoreVertical className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => navigate(`/contributors/${contributor.id}`)}>
                                      <Pencil className="w-4 h-4 mr-2" />
                                      Edit Profile
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openViewDialog(contributor)}>
                                      <Eye className="w-4 h-4 mr-2" />
                                      View Details
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleToggleStatus(contributor)}>
                                      {contributor.is_active ? (
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
                                      onClick={() => handleDelete(contributor.id)}
                                      className="text-red-600"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>

                              {contributor.bio && (
                                <p className="text-sm text-gray-500 mb-4 line-clamp-2">
                                  {contributor.bio}
                                </p>
                              )}

                              {/* Expertise Areas */}
                              {contributor.expertise_areas && contributor.expertise_areas.length > 0 && (
                                <div className="mb-4">
                                  <div className="flex flex-wrap gap-1">
                                    {contributor.expertise_areas.slice(0, 3).map((area, i) => (
                                      <Badge key={i} variant="secondary" className="text-xs">
                                        {area}
                                      </Badge>
                                    ))}
                                    {contributor.expertise_areas.length > 3 && (
                                      <Badge variant="outline" className="text-xs">
                                        +{contributor.expertise_areas.length - 3}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Stats */}
                              <div className="flex items-center gap-4 pt-4 border-t text-sm">
                                <div className="flex items-center gap-1 text-gray-500">
                                  <FileText className="w-4 h-4" />
                                  <span>{contributorArticles.length} articles</span>
                                </div>
                                {avgQuality > 0 && (
                                  <div className="flex items-center gap-1 text-gray-500">
                                    <Star className="w-4 h-4 text-yellow-500" />
                                    <span>{avgQuality}% avg quality</span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Contributor Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Add Contributor</DialogTitle>
            <DialogDescription>
              Create a new AI persona for content generation
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Alex Thompson"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  placeholder="Brief biography or description..."
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expertise">Expertise Areas (comma-separated)</Label>
                <Input
                  id="expertise"
                  placeholder="e.g., tech, finance, gaming"
                  value={formData.expertise_areas}
                  onChange={(e) => setFormData({ ...formData, expertise_areas: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Content Types</Label>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPE_OPTIONS.map(type => (
                    <Badge
                      key={type.value}
                      variant={formData.content_types.includes(type.value) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleContentType(type.value)}
                    >
                      {type.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                <Label className="text-sm font-medium">Writing Style Profile</Label>
                <div className="space-y-2">
                  <Input
                    placeholder="Tone (e.g., conversational, formal, witty)"
                    value={formData.writing_style_profile.tone}
                    onChange={(e) => setFormData({
                      ...formData,
                      writing_style_profile: { ...formData.writing_style_profile, tone: e.target.value }
                    })}
                  />
                  <Input
                    placeholder="Complexity (e.g., simple, moderate, advanced)"
                    value={formData.writing_style_profile.complexity_level}
                    onChange={(e) => setFormData({
                      ...formData,
                      writing_style_profile: { ...formData.writing_style_profile, complexity_level: e.target.value }
                    })}
                  />
                  <Input
                    placeholder="Sentence length (e.g., short, varied, long)"
                    value={formData.writing_style_profile.sentence_length_preference}
                    onChange={(e) => setFormData({
                      ...formData,
                      writing_style_profile: { ...formData.writing_style_profile, sentence_length_preference: e.target.value }
                    })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Contributor'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Contributor Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Edit Contributor</DialogTitle>
            <DialogDescription>
              Update contributor details and writing style
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate}>
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name *</Label>
                <Input
                  id="edit-name"
                  placeholder="e.g., Alex Thompson"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-bio">Bio</Label>
                <Textarea
                  id="edit-bio"
                  placeholder="Brief biography or description..."
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-expertise">Expertise Areas (comma-separated)</Label>
                <Input
                  id="edit-expertise"
                  placeholder="e.g., tech, finance, gaming"
                  value={formData.expertise_areas}
                  onChange={(e) => setFormData({ ...formData, expertise_areas: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Content Types</Label>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPE_OPTIONS.map(type => (
                    <Badge
                      key={type.value}
                      variant={formData.content_types.includes(type.value) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleContentType(type.value)}
                    >
                      {type.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                <Label className="text-sm font-medium">Writing Style Profile</Label>
                <div className="space-y-2">
                  <Input
                    placeholder="Tone (e.g., conversational, formal, witty)"
                    value={formData.writing_style_profile.tone}
                    onChange={(e) => setFormData({
                      ...formData,
                      writing_style_profile: { ...formData.writing_style_profile, tone: e.target.value }
                    })}
                  />
                  <Input
                    placeholder="Complexity (e.g., simple, moderate, advanced)"
                    value={formData.writing_style_profile.complexity_level}
                    onChange={(e) => setFormData({
                      ...formData,
                      writing_style_profile: { ...formData.writing_style_profile, complexity_level: e.target.value }
                    })}
                  />
                  <Input
                    placeholder="Sentence length (e.g., short, varied, long)"
                    value={formData.writing_style_profile.sentence_length_preference}
                    onChange={(e) => setFormData({
                      ...formData,
                      writing_style_profile: { ...formData.writing_style_profile, sentence_length_preference: e.target.value }
                    })}
                  />
                </div>
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

      {/* View Contributor Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Contributor Details</DialogTitle>
          </DialogHeader>
          {viewingContributor && (
            <div className="space-y-6 py-4">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-3xl font-bold">
                  {viewingContributor.name?.charAt(0) || 'C'}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{viewingContributor.name}</h3>
                  <Badge
                    variant="outline"
                    className={viewingContributor.is_active
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-gray-100 text-gray-600'
                    }
                  >
                    {viewingContributor.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>

              {viewingContributor.bio && (
                <div>
                  <Label className="text-gray-500">Bio</Label>
                  <p className="text-gray-900 mt-1">{viewingContributor.bio}</p>
                </div>
              )}

              {viewingContributor.expertise_areas?.length > 0 && (
                <div>
                  <Label className="text-gray-500">Expertise Areas</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {viewingContributor.expertise_areas.map((area, i) => (
                      <Badge key={i} variant="secondary">{area}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewingContributor.content_types?.length > 0 && (
                <div>
                  <Label className="text-gray-500">Content Types</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {viewingContributor.content_types.map((type, i) => (
                      <Badge key={i} variant="outline">{type}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewingContributor.writing_style_profile && (
                <div>
                  <Label className="text-gray-500">Writing Style</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-2">
                    {viewingContributor.writing_style_profile.tone && (
                      <p className="text-sm">
                        <span className="text-gray-500">Tone:</span>{' '}
                        <span className="text-gray-900">{viewingContributor.writing_style_profile.tone}</span>
                      </p>
                    )}
                    {viewingContributor.writing_style_profile.complexity_level && (
                      <p className="text-sm">
                        <span className="text-gray-500">Complexity:</span>{' '}
                        <span className="text-gray-900">{viewingContributor.writing_style_profile.complexity_level}</span>
                      </p>
                    )}
                    {viewingContributor.writing_style_profile.sentence_length_preference && (
                      <p className="text-sm">
                        <span className="text-gray-500">Sentence Length:</span>{' '}
                        <span className="text-gray-900">{viewingContributor.writing_style_profile.sentence_length_preference}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-6 pt-4 border-t">
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {getContributorArticles(viewingContributor.id).length}
                  </p>
                  <p className="text-sm text-gray-500">Articles</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {viewingContributor.average_quality_score || 0}%
                  </p>
                  <p className="text-sm text-gray-500">Avg Quality</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
