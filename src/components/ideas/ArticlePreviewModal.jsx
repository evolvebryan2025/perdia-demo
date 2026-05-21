import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  ExternalLink,
  Edit3,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  FileText,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Link as LinkIcon,
  AlertCircle,
} from 'lucide-react'
import { supabase } from '../../services/supabaseClient'
import { shortcodesToHtml } from '../../lib/shortcodeRenderer'

/**
 * ArticlePreviewModal
 *
 * Shows full article content in a modal overlay without navigation
 * Allows Tony to review article content directly from the Ideas page
 *
 * Props:
 * - articleId: ID of the article to preview
 * - isOpen: Boolean to control modal visibility
 * - onClose: Function to close modal
 * - onNavigatePrev/Next: Optional navigation between articles
 * - hasPrev/hasNext: Boolean to show navigation arrows
 */
export default function ArticlePreviewModal({
  articleId,
  isOpen,
  onClose,
  onNavigatePrev,
  onNavigateNext,
  hasPrev = false,
  hasNext = false,
}) {
  const [article, setArticle] = useState(null)
  const [contributor, setContributor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('content') // content, meta, links

  // Fetch article data when modal opens
  useEffect(() => {
    if (isOpen && articleId) {
      fetchArticle()
    }
  }, [isOpen, articleId])

  const fetchArticle = async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch article with contributor
      const { data, error: fetchError } = await supabase
        .from('articles')
        .select(`
          *,
          article_contributors (
            id,
            name,
            writing_style_profile,
            expertise_areas,
            contributor_page_url
          )
        `)
        .eq('id', articleId)
        .single()

      if (fetchError) throw fetchError

      setArticle(data)
      setContributor(data.article_contributors)
    } catch (err) {
      console.error('Error fetching article:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && hasPrev && onNavigatePrev) {
        onNavigatePrev()
      } else if (e.key === 'ArrowRight' && hasNext && onNavigateNext) {
        onNavigateNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, hasPrev, hasNext, onNavigatePrev, onNavigateNext, onClose])

  if (!isOpen) return null

  // Extract internal links from content
  const extractLinks = (content) => {
    if (!content) return []
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g
    const links = []
    let match
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        url: match[1],
        text: match[2],
        isInternal: match[1].includes('geteducated.com') || match[1].startsWith('/'),
      })
    }
    return links
  }

  const links = article ? extractLinks(article.content) : []
  const internalLinks = links.filter(l => l.isInternal)
  const externalLinks = links.filter(l => !l.isInternal)

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60"
          onClick={onClose}
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Eye className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Article Preview</h2>
                <p className="text-sm text-gray-500">Full content view</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Navigation arrows */}
              {(hasPrev || hasNext) && (
                <div className="flex items-center gap-1 mr-4">
                  <button
                    onClick={onNavigatePrev}
                    disabled={!hasPrev}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Previous article (Left arrow)"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={onNavigateNext}
                    disabled={!hasNext}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Next article (Right arrow)"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* Open in Review */}
              {article && (
                <Link
                  to={`/review/${article.id}`}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit in Review
                </Link>
              )}

              {/* Close */}
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex-1 flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                <p className="text-gray-500">Loading article...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="flex-1 flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4 text-center px-8">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Failed to load article</h3>
                <p className="text-gray-500 max-w-md">{error}</p>
                <button
                  onClick={fetchArticle}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Content */}
          {!loading && !error && article && (
            <>
              {/* Title and Meta Bar */}
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{article.title}</h3>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                  {/* Status */}
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    article.status === 'published' ? 'bg-green-100 text-green-700' :
                    article.status === 'qa_review' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {article.status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>

                  {/* Quality Score */}
                  {article.quality_score !== undefined && (
                    <span className={`flex items-center gap-1 ${
                      article.quality_score >= 80 ? 'text-green-600' :
                      article.quality_score >= 60 ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      <BarChart3 className="w-4 h-4" />
                      {article.quality_score}% quality
                    </span>
                  )}

                  {/* Word count */}
                  {article.word_count && (
                    <span className="flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      {article.word_count.toLocaleString()} words
                    </span>
                  )}

                  {/* Author */}
                  {contributor && (
                    <span className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {contributor.name}
                    </span>
                  )}

                  {/* Date */}
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {new Date(article.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 px-6">
                <button
                  onClick={() => setActiveTab('content')}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'content'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Full Content
                </button>
                <button
                  onClick={() => setActiveTab('meta')}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'meta'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  SEO & Meta
                </button>
                <button
                  onClick={() => setActiveTab('links')}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'links'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <LinkIcon className="w-4 h-4" />
                  Links ({links.length})
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto">
                {/* Content Tab */}
                {activeTab === 'content' && (
                  <div className="p-6">
                    <article
                      className="prose prose-lg max-w-none
                        prose-headings:text-gray-900
                        prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4
                        prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3
                        prose-p:text-gray-700 prose-p:leading-relaxed
                        prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                        prose-ul:my-4 prose-li:my-1
                        prose-strong:text-gray-900"
                      dangerouslySetInnerHTML={{ __html: shortcodesToHtml(article.content) }}
                    />
                  </div>
                )}

                {/* Meta Tab */}
                {activeTab === 'meta' && (
                  <div className="p-6 space-y-6">
                    {/* SEO Title */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SEO Title</label>
                      <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="text-gray-900">{article.seo_title || article.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {(article.seo_title || article.title)?.length || 0} characters
                        </p>
                      </div>
                    </div>

                    {/* Meta Description */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Meta Description</label>
                      <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="text-gray-900">{article.seo_description || 'No description set'}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {article.seo_description?.length || 0} characters
                        </p>
                      </div>
                    </div>

                    {/* Focus Keyword */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Focus Keyword</label>
                      <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="text-gray-900">{article.focus_keyword || 'No keyword set'}</p>
                      </div>
                    </div>

                    {/* Target Keywords */}
                    {article.target_keywords && article.target_keywords.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Keywords</label>
                        <div className="flex flex-wrap gap-2">
                          {article.target_keywords.map((kw, i) => (
                            <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Author/Contributor */}
                    {contributor && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
                        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{contributor.name}</p>
                            <p className="text-sm text-gray-500">{contributor.writing_style_profile?.tone || 'Professional writer'}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Links Tab */}
                {activeTab === 'links' && (
                  <div className="p-6 space-y-6">
                    {/* Internal Links */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        Internal Links ({internalLinks.length})
                      </h4>
                      {internalLinks.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No internal links found</p>
                      ) : (
                        <div className="space-y-2">
                          {internalLinks.map((link, i) => (
                            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-green-50 rounded-lg border border-green-100">
                              <LinkIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate">{link.text}</p>
                                <p className="text-xs text-green-600 truncate">{link.url}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* External Links */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <ExternalLink className="w-4 h-4 text-blue-600" />
                        External Links ({externalLinks.length})
                      </h4>
                      {externalLinks.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No external links found</p>
                      ) : (
                        <div className="space-y-2">
                          {externalLinks.map((link, i) => (
                            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                              <ExternalLink className="w-4 h-4 text-blue-600 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate">{link.text}</p>
                                <p className="text-xs text-blue-600 truncate">{link.url}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Press <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">Esc</kbd> to close
                  {(hasPrev || hasNext) && (
                    <>, <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">←</kbd> / <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">→</kbd> to navigate</>
                  )}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors font-medium"
                  >
                    Close
                  </button>
                  <Link
                    to={`/review/${article.id}`}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve & Review
                  </Link>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
