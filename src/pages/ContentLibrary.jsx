import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useArticles } from '../hooks/useArticles'
import { useSubmitArticleFeedback, useArticleFeedbackSummary } from '../hooks/useArticleFeedback'
import { useDeleteArticleWithReason } from '../hooks/useDeletionLog'
import { DeleteWithReasonModal } from '../components/ui/DeleteWithReasonModal'
import { Search, Filter, Loader2, FileText, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react'
import { SortDropdown } from '../components/ui/sort-dropdown'
import { NewBadge } from '../components/ui/new-badge'
import { DateLabel } from '../components/ui/date-label'
import { RegenerateButton } from '../components/article/RegenerateButton'
import { CONTENT_SORT_OPTIONS, resolveSort } from '../lib/sortOptions'
import { useStoredState } from '../lib/useStoredState'

// Small component to display feedback for each article card
function ArticleFeedback({ articleId }) {
  const { data: summary } = useArticleFeedbackSummary(articleId)

  if (!summary || summary.total === 0) return null

  return (
    <div className="flex items-center gap-1 text-xs">
      <ThumbsUp className="w-3 h-3 text-green-500" />
      <span className="text-green-600">{summary.positive}</span>
      <ThumbsDown className="w-3 h-3 text-red-500 ml-1" />
      <span className="text-red-600">{summary.negative}</span>
    </div>
  )
}

function ContentLibrary() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [deleteModalArticle, setDeleteModalArticle] = useState(null)

  const deleteArticleWithReason = useDeleteArticleWithReason()

  const [sortKey, setSortKey] = useStoredState('perdia:sort:library', 'newest')
  const sort = resolveSort(CONTENT_SORT_OPTIONS, sortKey)

  const { data: articles = [], isLoading } = useArticles({
    search: search || undefined,
    status: statusFilter || undefined,
    sort,
  })

  const handleDeleteWithReason = async (formData) => {
    if (!deleteModalArticle) return

    try {
      await deleteArticleWithReason.mutateAsync({
        article: deleteModalArticle,
        deletionCategory: formData.deletionCategory,
        deletionReason: formData.deletionReason,
        additionalNotes: formData.additionalNotes,
      })
      setDeleteModalArticle(null)
    } catch (error) {
      console.error('Failed to delete article:', error)
      alert('Failed to delete article. Please try again.')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Content Library</h1>
        <p className="text-gray-600 mt-1">Browse and manage all your articles</p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search articles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All Statuses</option>
          <option value="drafting">Drafting</option>
          <option value="refinement">Refinement</option>
          <option value="qa_review">QA Review</option>
          <option value="ready_to_publish">Ready to Publish</option>
          <option value="published">Published</option>
        </select>

        <SortDropdown
          value={sortKey}
          onChange={setSortKey}
          options={CONTENT_SORT_OPTIONS}
        />
      </div>

      {/* Articles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {articles.map(article => (
          <div
            key={article.id}
            onClick={() => navigate(`/editor/${article.id}`)}
            className="bg-white p-6 rounded-lg border border-gray-200 hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div className="flex items-start justify-between mb-3">
              <FileText className="w-5 h-5 text-blue-600" />
              <div className="flex items-center gap-2">
                <NewBadge timestamp={article.created_at} />
                {article.quality_score > 0 && (
                  <span className={`px-2 py-1 text-xs rounded ${
                    article.quality_score >= 80 ? 'bg-green-100 text-green-700' :
                    article.quality_score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {article.quality_score}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteModalArticle(article)
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Delete article"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">
              {article.title}
            </h3>

            {article.excerpt && (
              <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                {article.excerpt}
              </p>
            )}

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{article.word_count} words</span>
              <span className="capitalize">{article.status?.replace('_', ' ')}</span>
            </div>

            <div className="mt-2">
              <DateLabel createdAt={article.created_at} updatedAt={article.updated_at} />
            </div>

            <div className="flex items-center justify-between mt-2">
              {article.contributor_name && (
                <p className="text-xs text-gray-600">
                  By {article.contributor_name}
                </p>
              )}
              <ArticleFeedback articleId={article.id} />
            </div>

            <div
              className="mt-3 flex justify-end"
              onClick={(e) => e.stopPropagation()}
            >
              <RegenerateButton articleId={article.id} />
            </div>
          </div>
        ))}
      </div>

      {articles.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No articles found</p>
        </div>
      )}

      {/* Delete with Reason Modal */}
      <DeleteWithReasonModal
        isOpen={!!deleteModalArticle}
        onClose={() => setDeleteModalArticle(null)}
        onConfirm={handleDeleteWithReason}
        title={deleteModalArticle?.title}
        entityType="article"
        isDeleting={deleteArticleWithReason.isPending}
      />
    </div>
  )
}

export default ContentLibrary
