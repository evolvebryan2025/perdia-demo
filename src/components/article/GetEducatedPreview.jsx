import { forwardRef } from 'react'
import { format } from 'date-fns'

/**
 * GetEducated WordPress Theme Preview
 *
 * This component renders article content using styles that match
 * the GetEducated.com WordPress theme exactly, so editors can see
 * how articles will appear when published.
 *
 * Based on GetEducated's Bootstrap-based theme:
 * - System font stack
 * - 1140px max content width
 * - Bootstrap heading hierarchy
 * - Blue links (#007bff)
 */
const GetEducatedPreview = forwardRef(function GetEducatedPreview(
  { article, highlightedContent, onMarkClick },
  ref
) {
  const content = highlightedContent || article?.content || ''

  return (
    <div className="geteducated-preview bg-white">
      {/* GetEducated Theme Styles */}
      <style>{`
        .geteducated-preview {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 16px;
          line-height: 1.5;
          color: #212529;
        }

        /* Article Header - matches GetEducated article pages */
        .ge-article-header {
          background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
          padding: 3rem 1.5rem;
          margin-bottom: 2rem;
        }

        .ge-article-header h1 {
          font-size: 2.25rem;
          font-weight: 600;
          color: #ffffff;
          line-height: 1.2;
          margin: 0 0 1rem 0;
          max-width: 900px;
        }

        .ge-article-meta {
          color: rgba(255, 255, 255, 0.85);
          font-size: 0.875rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .ge-article-meta span {
          display: inline-flex;
          align-items: center;
        }

        /* Main Content Container */
        .ge-content-container {
          max-width: 900px;
          margin: 0 auto;
          padding: 0 1.5rem 3rem;
        }

        /* Content Typography - Bootstrap-based */
        .ge-article-content {
          font-size: 1rem;
          line-height: 1.7;
          color: #212529;
        }

        .ge-article-content h2 {
          font-size: 1.75rem;
          font-weight: 600;
          color: #212529;
          margin: 2.5rem 0 1rem 0;
          line-height: 1.3;
          padding-bottom: 0.5rem;
          border-bottom: 2px solid #007bff;
        }

        .ge-article-content h3 {
          font-size: 1.375rem;
          font-weight: 600;
          color: #212529;
          margin: 2rem 0 0.75rem 0;
          line-height: 1.3;
        }

        .ge-article-content h4 {
          font-size: 1.125rem;
          font-weight: 600;
          color: #212529;
          margin: 1.5rem 0 0.5rem 0;
          line-height: 1.3;
        }

        .ge-article-content p {
          margin: 0 0 1rem 0;
          color: #212529;
        }

        /* Links - GetEducated blue */
        .ge-article-content a {
          color: #007bff;
          text-decoration: none;
          cursor: pointer;
        }

        .ge-article-content a:hover {
          color: #0056b3;
          text-decoration: underline;
        }

        /* Ensure links are clickable in preview */
        .ge-article-content a[href] {
          pointer-events: auto;
        }

        /* Lists */
        .ge-article-content ul,
        .ge-article-content ol {
          margin: 0 0 1.5rem 0;
          padding-left: 1.5rem;
        }

        .ge-article-content li {
          margin-bottom: 0.5rem;
          line-height: 1.6;
        }

        .ge-article-content ul li {
          list-style-type: disc;
        }

        .ge-article-content ol li {
          list-style-type: decimal;
        }

        /* Nested lists */
        .ge-article-content ul ul,
        .ge-article-content ol ol,
        .ge-article-content ul ol,
        .ge-article-content ol ul {
          margin-top: 0.5rem;
          margin-bottom: 0;
        }

        /* Blockquotes */
        .ge-article-content blockquote {
          border-left: 4px solid #007bff;
          padding: 1rem 1.5rem;
          margin: 1.5rem 0;
          background: #f8f9fa;
          font-style: italic;
          color: #495057;
        }

        .ge-article-content blockquote p:last-child {
          margin-bottom: 0;
        }

        /* Tables - Bootstrap style */
        .ge-article-content table {
          width: 100%;
          margin: 1.5rem 0;
          border-collapse: collapse;
          font-size: 0.9375rem;
        }

        .ge-article-content th,
        .ge-article-content td {
          padding: 0.75rem;
          border: 1px solid #dee2e6;
          text-align: left;
        }

        .ge-article-content th {
          background: #007bff;
          color: white;
          font-weight: 600;
        }

        .ge-article-content tr:nth-child(even) {
          background: #f8f9fa;
        }

        /* Images */
        .ge-article-content img {
          max-width: 100%;
          height: auto;
          margin: 1.5rem 0;
          border-radius: 4px;
        }

        /* School/University logos should be constrained */
        .ge-article-content img[src*="logo"],
        .ge-article-content img[src*="school"],
        .ge-article-content img[class*="logo"],
        .ge-article-content img.school-logo,
        .ge-article-content img.university-logo {
          max-width: 200px;
          max-height: 100px;
          width: auto;
          height: auto;
          object-fit: contain;
          margin: 0.75rem 0;
        }

        /* FAQ Section styling */
        .ge-article-content .faq-item,
        .ge-article-content details {
          margin: 1rem 0;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          overflow: hidden;
        }

        .ge-article-content summary,
        .ge-article-content .faq-question {
          padding: 1rem;
          background: #f8f9fa;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .ge-article-content summary:hover,
        .ge-article-content .faq-question:hover {
          background: #e9ecef;
        }

        .ge-article-content .faq-answer {
          padding: 1rem;
          background: white;
        }

        /* Strong/Bold */
        .ge-article-content strong,
        .ge-article-content b {
          font-weight: 600;
          color: #212529;
        }

        /* Emphasis/Italic */
        .ge-article-content em,
        .ge-article-content i {
          font-style: italic;
        }

        /* Code blocks (rare but supported) */
        .ge-article-content code {
          background: #f4f4f4;
          padding: 0.125rem 0.375rem;
          border-radius: 3px;
          font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.875em;
        }

        .ge-article-content pre {
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 1rem;
          border-radius: 4px;
          overflow-x: auto;
          margin: 1.5rem 0;
        }

        .ge-article-content pre code {
          background: none;
          padding: 0;
          color: inherit;
        }

        /* Horizontal rule */
        .ge-article-content hr {
          border: none;
          border-top: 1px solid #dee2e6;
          margin: 2rem 0;
        }

        /* Shortcode placeholders - show as styled boxes */
        .ge-article-content .shortcode-placeholder {
          display: block;
          background: linear-gradient(135deg, #fff3cd 0%, #ffeeba 100%);
          border: 1px dashed #856404;
          border-radius: 4px;
          padding: 1rem;
          margin: 1.5rem 0;
          text-align: center;
          color: #856404;
          font-size: 0.875rem;
          font-weight: 500;
        }

        /* Author box */
        .ge-author-box {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.5rem;
          background: #f8f9fa;
          border-radius: 8px;
          margin: 2rem 0;
          border: 1px solid #dee2e6;
        }

        .ge-author-avatar {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: #007bff;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .ge-author-info {
          flex: 1;
        }

        .ge-author-name {
          font-weight: 600;
          font-size: 1rem;
          color: #212529;
          margin: 0 0 0.25rem 0;
        }

        .ge-author-title {
          font-size: 0.875rem;
          color: #6c757d;
          margin: 0;
        }

        /* Article footer */
        .ge-article-footer {
          border-top: 1px solid #dee2e6;
          padding-top: 1.5rem;
          margin-top: 2rem;
          color: #6c757d;
          font-size: 0.875rem;
        }

        .ge-article-stats {
          display: flex;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        /* Quality indicator for preview */
        .ge-quality-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .ge-quality-good {
          background: #d4edda;
          color: #155724;
        }

        .ge-quality-warning {
          background: #fff3cd;
          color: #856404;
        }

        .ge-quality-poor {
          background: #f8d7da;
          color: #721c24;
        }

        /* Make highlighted marks visible */
        .ge-article-content mark {
          cursor: pointer;
          border-radius: 2px;
          padding: 0 2px;
        }

        /* Preview mode indicator */
        .ge-preview-banner {
          background: #fff3cd;
          border-bottom: 1px solid #ffc107;
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          color: #856404;
          text-align: center;
          font-weight: 500;
        }
      `}</style>

      {/* Preview Mode Banner */}
      <div className="ge-preview-banner">
        PREVIEW MODE - This shows how your article will appear on GetEducated.com
      </div>

      {/* Article Header */}
      <header className="ge-article-header">
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h1>{article?.title || 'Untitled Article'}</h1>
          <div className="ge-article-meta">
            {article?.article_contributors?.name && (
              <>
                <span>By {article.article_contributors.name}</span>
                <span>|</span>
              </>
            )}
            <span>
              {article?.created_at
                ? format(new Date(article.created_at), 'MMMM d, yyyy')
                : 'Draft'
              }
            </span>
            {article?.word_count > 0 && (
              <>
                <span>|</span>
                <span>{article.word_count.toLocaleString()} words</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="ge-content-container">
        {/* Excerpt/Introduction */}
        {article?.excerpt && (
          <p style={{
            fontSize: '1.125rem',
            color: '#495057',
            marginBottom: '2rem',
            fontStyle: 'italic',
            lineHeight: '1.8'
          }}>
            {article.excerpt}
          </p>
        )}

        {/* Article Body */}
        <article
          ref={ref}
          className="ge-article-content"
          dangerouslySetInnerHTML={{ __html: content }}
          onClick={(e) => {
            // Handle link clicks - open in new tab
            const link = e.target.closest('a[href]')
            if (link) {
              e.preventDefault()
              const href = link.getAttribute('href')
              if (href) {
                window.open(href, '_blank', 'noopener,noreferrer')
              }
              return
            }

            // Handle mark clicks for comments
            if (onMarkClick) {
              const mark = e.target.closest('mark[data-comment-id]')
              if (mark) {
                const commentId = mark.getAttribute('data-comment-id')
                onMarkClick(commentId)
              }
            }
          }}
        />

        {/* Author Box */}
        {article?.article_contributors && (
          <div className="ge-author-box">
            <div className="ge-author-avatar">
              {article.article_contributors.name?.charAt(0) || 'A'}
            </div>
            <div className="ge-author-info">
              <p className="ge-author-name">
                {article.article_contributors.name}
              </p>
              {article.article_contributors.title && (
                <p className="ge-author-title">
                  {article.article_contributors.title}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Article Footer/Stats */}
        <footer className="ge-article-footer">
          <div className="ge-article-stats">
            {article?.word_count > 0 && (
              <span>{article.word_count.toLocaleString()} words</span>
            )}
            {article?.quality_score !== undefined && (
              <span
                className={`ge-quality-badge ${
                  article.quality_score >= 85
                    ? 'ge-quality-good'
                    : article.quality_score >= 70
                      ? 'ge-quality-warning'
                      : 'ge-quality-poor'
                }`}
              >
                Quality Score: {article.quality_score}%
              </span>
            )}
            {article?.focus_keyword && (
              <span>Focus Keyword: {article.focus_keyword}</span>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
})

export default GetEducatedPreview
