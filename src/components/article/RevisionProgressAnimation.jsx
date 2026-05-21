import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  Sparkles,
  Check,
  X,
  ChevronRight,
  FileText,
  MessageSquare,
  Pencil,
  Zap,
  Minimize2,
  Maximize2,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { shortcodesToHtml } from '@/lib/shortcodeRenderer'

// Severity colors for feedback display
const SEVERITY_COLORS = {
  minor: 'bg-blue-100 text-blue-700 border-blue-300',
  moderate: 'bg-amber-100 text-amber-700 border-amber-300',
  major: 'bg-orange-100 text-orange-700 border-orange-300',
  critical: 'bg-red-100 text-red-700 border-red-300'
}

/**
 * AnalyzingPhase - Shows feedback items being processed one by one
 */
function AnalyzingPhase({ feedbackItems }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [processedCount, setProcessedCount] = useState(0)

  useEffect(() => {
    if (feedbackItems.length === 0) return

    const timer = setInterval(() => {
      setCurrentIndex(i => {
        const next = (i + 1) % feedbackItems.length
        if (next === 0) {
          setProcessedCount(c => Math.min(c + feedbackItems.length, feedbackItems.length))
        }
        return next
      })
    }, 1200)

    return () => clearInterval(timer)
  }, [feedbackItems.length])

  const currentFeedback = feedbackItems[currentIndex]

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      {/* Animated Brain Icon */}
      <div className="relative w-24 h-24 mb-8">
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-full opacity-20"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <motion.div
          className="absolute inset-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center"
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <Brain className="w-10 h-10 text-white" />
        </motion.div>

        {/* Orbiting dots */}
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 bg-cyan-400 rounded-full"
            style={{ top: '50%', left: '50%' }}
            animate={{
              x: [0, 40, 0, -40, 0],
              y: [-40, 0, 40, 0, -40],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              delay: i * 0.6,
              ease: 'linear'
            }}
          />
        ))}
      </div>

      <h3 className="text-xl font-bold text-gray-900 mb-2">
        Analyzing Editorial Feedback
      </h3>

      <p className="text-gray-500 mb-6">
        Processing {feedbackItems.length} comment{feedbackItems.length !== 1 ? 's' : ''}...
      </p>

      {/* Current feedback being analyzed */}
      <AnimatePresence mode="wait">
        {currentFeedback && (
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="max-w-lg w-full"
          >
            <div className="bg-white rounded-xl border-2 border-cyan-200 shadow-lg overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-cyan-50 to-blue-50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-cyan-600" />
                  <span className="text-sm font-medium text-cyan-900">
                    Feedback {currentIndex + 1} of {feedbackItems.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize bg-white">
                    {currentFeedback.category}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs ${SEVERITY_COLORS[currentFeedback.severity]}`}
                  >
                    {currentFeedback.severity}
                  </Badge>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-3">
                {currentFeedback.selected_text && (
                  <div className="text-sm text-gray-600 italic border-l-2 border-cyan-300 pl-3 bg-cyan-50/50 py-2 rounded-r">
                    "{currentFeedback.selected_text.substring(0, 100)}
                    {currentFeedback.selected_text.length > 100 ? '...' : ''}"
                  </div>
                )}

                <p className="text-gray-900 font-medium">
                  {currentFeedback.comment}
                </p>
              </div>

              {/* Processing indicator */}
              <div className="bg-cyan-500 h-1 relative overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-cyan-300"
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1.2, ease: 'linear' }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * ProcessingPhase - Shows "thinking" animation while waiting for AI
 */
function ProcessingPhase() {
  const [dots, setDots] = useState('')

  useEffect(() => {
    const timer = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.')
    }, 400)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      {/* Pulsing Sparkles */}
      <div className="relative w-24 h-24 mb-8">
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-violet-400 to-purple-600 rounded-full"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.8, 1, 0.8]
          }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-white" />
        </div>

        {/* Sparkle particles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 bg-yellow-300 rounded-full"
            style={{
              top: '50%',
              left: '50%',
            }}
            animate={{
              x: [0, Math.cos(i * 60 * Math.PI / 180) * 50],
              y: [0, Math.sin(i * 60 * Math.PI / 180) * 50],
              opacity: [1, 0],
              scale: [1, 0.5],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.15,
            }}
          />
        ))}
      </div>

      <h3 className="text-xl font-bold text-gray-900 mb-2">
        Generating Revised Article{dots}
      </h3>

      <p className="text-gray-500 mb-6 text-center max-w-md">
        AI is rewriting the content based on your feedback while preserving structure and citations
      </p>

      {/* Progress steps */}
      <div className="space-y-3 text-sm">
        {[
          { text: 'Analyzing feedback context', done: true },
          { text: 'Identifying sections to revise', done: true },
          { text: 'Generating improved content', done: false, active: true },
          { text: 'Preserving internal links', done: false },
        ].map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.2 }}
            className={`flex items-center gap-3 ${
              step.done ? 'text-green-600' :
              step.active ? 'text-purple-600' :
              'text-gray-400'
            }`}
          >
            {step.done ? (
              <Check className="w-4 h-4" />
            ) : step.active ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Zap className="w-4 h-4" />
              </motion.div>
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-current" />
            )}
            <span className={step.active ? 'font-medium' : ''}>
              {step.text}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/**
 * TypingReveal - Progressive reveal of HTML content with typing effect
 */
function TypingReveal({ htmlContent, onComplete, speed = 'normal' }) {
  const containerRef = useRef(null)
  const contentRef = useRef(null)
  const [revealProgress, setRevealProgress] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  // Calculate duration based on content length and speed
  const duration = useMemo(() => {
    if (!htmlContent) return 5000
    const baseLength = htmlContent.length
    const baseDuration = Math.min(Math.max(baseLength / 100, 5), 20) * 1000

    const speedMultiplier = speed === 'fast' ? 0.5 : speed === 'slow' ? 1.5 : 1
    return baseDuration * speedMultiplier
  }, [htmlContent, speed])

  useEffect(() => {
    if (!htmlContent) return

    const startTime = performance.now()
    let animationFrame

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Ease-out cubic for natural feel
      const eased = 1 - Math.pow(1 - progress, 3)
      setRevealProgress(eased * 100)

      // Auto-scroll to keep cursor visible
      if (containerRef.current && contentRef.current) {
        const totalHeight = contentRef.current.scrollHeight
        const revealHeight = (eased * totalHeight)
        const containerHeight = containerRef.current.clientHeight
        const scrollTarget = revealHeight - containerHeight * 0.7
        containerRef.current.scrollTop = Math.max(0, scrollTarget)
      }

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate)
      } else {
        setIsComplete(true)
        onComplete?.()
      }
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [htmlContent, duration, onComplete])

  if (!htmlContent) return null

  return (
    <div ref={containerRef} className="h-full overflow-auto relative">
      <div className="relative">
        {/* Content with clip mask */}
        <div
          ref={contentRef}
          className="article-content prose prose-lg max-w-none"
          style={{
            clipPath: `inset(0 0 ${100 - revealProgress}% 0)`,
            WebkitClipPath: `inset(0 0 ${100 - revealProgress}% 0)`,
          }}
          dangerouslySetInnerHTML={{ __html: shortcodesToHtml(htmlContent) }}
        />

        {/* Typing cursor line */}
        {!isComplete && (
          <motion.div
            className="absolute left-0 right-0 flex items-center gap-2 pointer-events-none"
            style={{ top: `${revealProgress}%` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="flex-1 h-px bg-gradient-to-r from-blue-500 via-cyan-500 to-transparent" />
            <motion.div
              className="flex items-center gap-1 bg-blue-500 text-white px-2 py-1 rounded-full text-xs font-medium shadow-lg"
              animate={{ opacity: [1, 0.7, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              <Pencil className="w-3 h-3" />
              Writing...
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

/**
 * ArticlePreview - Renders article content with optional dimming
 */
function ArticlePreview({ content, dimmed = false, title = 'Article' }) {
  return (
    <div className={`h-full flex flex-col ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 px-6 py-3 border-b bg-gray-50">
        <FileText className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-700">{title}</span>
      </div>
      <ScrollArea className="flex-1">
        <div
          className="p-6 article-content prose prose-lg max-w-none"
          dangerouslySetInnerHTML={{ __html: shortcodesToHtml(content) }}
        />
      </ScrollArea>
    </div>
  )
}

/**
 * MinimizedRevisionIndicator - Shows when revision is minimized
 */
function MinimizedRevisionIndicator({ phase, feedbackCount, onRestore }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      className="fixed bottom-4 right-4 z-50"
    >
      <button
        onClick={onRestore}
        className="flex items-center gap-3 px-4 py-3 rounded-full shadow-lg border transition-all hover:scale-105 bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
        title="Click to show revision progress"
      >
        {phase === 'complete' ? (
          <Check className="w-5 h-5" />
        ) : (
          <Loader2 className="w-5 h-5 animate-spin" />
        )}
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium">
            {phase === 'complete' ? 'Revision Ready' : 'Revising Article...'}
          </span>
          <span className="text-xs opacity-80">
            {feedbackCount} feedback items
          </span>
        </div>
      </button>
    </motion.div>
  )
}

/**
 * RevisionProgressAnimation - Main component for the revision progress display
 *
 * Phases:
 * 1. analyzing - Shows feedback items being processed
 * 2. processing - Shows "thinking" animation while AI generates
 * 3. writing - Progressive reveal of revised content
 * 4. complete - Full content shown with accept/compare options
 */
export default function RevisionProgressAnimation({
  originalContent,
  revisedContent,
  feedbackItems,
  isLoading,
  onAccept,
  onCancel,
  allowMinimize = true,
}) {
  const [phase, setPhase] = useState('analyzing')
  const [showDiff, setShowDiff] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)

  // Transition from analyzing to processing after cycling through feedback
  useEffect(() => {
    if (phase === 'analyzing') {
      const timer = setTimeout(() => {
        setPhase('processing')
      }, Math.min(feedbackItems.length * 1500, 5000))
      return () => clearTimeout(timer)
    }
  }, [phase, feedbackItems.length])

  // Transition to writing when content arrives
  useEffect(() => {
    if (revisedContent && phase !== 'complete' && phase !== 'writing') {
      setPhase('writing')
    }
  }, [revisedContent, phase])

  const handleWritingComplete = useCallback(() => {
    setPhase('complete')
  }, [])

  const handleMinimize = useCallback(() => {
    setIsMinimized(true)
  }, [])

  const handleRestore = useCallback(() => {
    setIsMinimized(false)
  }, [])

  // Show minimized indicator when minimized
  if (isMinimized) {
    return (
      <MinimizedRevisionIndicator
        phase={phase}
        feedbackCount={feedbackItems.length}
        onRestore={handleRestore}
      />
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        // Allow clicking backdrop to minimize (only when not complete)
        if (e.target === e.currentTarget && allowMinimize && phase !== 'complete') {
          handleMinimize()
        }
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              phase === 'complete'
                ? 'bg-green-100'
                : 'bg-gradient-to-br from-cyan-500 to-blue-600'
            }`}>
              {phase === 'complete' ? (
                <Check className="w-5 h-5 text-green-600" />
              ) : (
                <motion.div
                  animate={{ rotate: phase === 'processing' ? 360 : 0 }}
                  transition={{ duration: 2, repeat: phase === 'processing' ? Infinity : 0, ease: 'linear' }}
                >
                  <Sparkles className="w-5 h-5 text-white" />
                </motion.div>
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {phase === 'analyzing' && 'Analyzing Feedback'}
                {phase === 'processing' && 'Generating Revision'}
                {phase === 'writing' && 'Writing Revised Article'}
                {phase === 'complete' && 'Revision Complete'}
              </h2>
              <p className="text-sm text-gray-500">
                {phase === 'analyzing' && `Processing ${feedbackItems.length} editorial comments`}
                {phase === 'processing' && 'AI is crafting improved content'}
                {phase === 'writing' && 'Applying changes to your article'}
                {phase === 'complete' && 'Review the changes and accept when ready'}
              </p>
              {phase !== 'complete' && allowMinimize && (
                <p className="text-xs text-gray-400 mt-1">
                  Click outside or minimize to continue working — revision runs in background
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Phase indicators */}
            <div className="flex items-center gap-1">
              {['analyzing', 'processing', 'writing', 'complete'].map((p, i) => (
                <div
                  key={p}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    p === phase
                      ? 'bg-blue-500 w-4'
                      : ['analyzing', 'processing', 'writing', 'complete'].indexOf(phase) > i
                        ? 'bg-green-500'
                        : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>

            {/* Minimize button */}
            {phase !== 'complete' && allowMinimize && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMinimize}
                className="text-gray-500 hover:text-gray-700"
                title="Minimize - revision continues in background"
              >
                <Minimize2 className="w-4 h-4" />
              </Button>
            )}

            {/* Close/Cancel button */}
            {phase !== 'complete' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={allowMinimize ? handleMinimize : onCancel}
                className="text-gray-500 hover:text-gray-700"
                title={allowMinimize ? "Close - revision continues in background" : "Cancel revision"}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Content Area - Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Original Article */}
          <div className="w-1/2 border-r flex flex-col bg-gray-50/50">
            <ArticlePreview
              content={originalContent}
              dimmed={phase !== 'complete'}
              title="Original Article"
            />
          </div>

          {/* Right Panel - Revised/Animation */}
          <div className="w-1/2 flex flex-col bg-white">
            <div className="flex items-center gap-2 px-6 py-3 border-b bg-gradient-to-r from-cyan-50 to-blue-50">
              <Sparkles className="w-4 h-4 text-cyan-600" />
              <span className="text-sm font-medium text-cyan-900">
                {phase === 'complete' ? 'Revised Article' : 'AI Revision'}
              </span>
              {phase === 'writing' && (
                <Badge className="ml-auto bg-cyan-500 text-white animate-pulse">
                  Live
                </Badge>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              {phase === 'analyzing' && (
                <AnalyzingPhase feedbackItems={feedbackItems} />
              )}

              {phase === 'processing' && (
                <ProcessingPhase />
              )}

              {(phase === 'writing' || phase === 'complete') && revisedContent && (
                <div className="h-full">
                  {phase === 'writing' ? (
                    <TypingReveal
                      htmlContent={revisedContent}
                      onComplete={handleWritingComplete}
                      speed="normal"
                    />
                  ) : (
                    <ScrollArea className="h-full">
                      <div
                        className="p-6 article-content prose prose-lg max-w-none"
                        dangerouslySetInnerHTML={{ __html: shortcodesToHtml(revisedContent) }}
                      />
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer - Actions */}
        {phase === 'complete' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-6 py-4 border-t bg-gradient-to-r from-gray-50 to-white flex items-center justify-between"
          >
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Check className="w-4 h-4 text-green-500" />
                {feedbackItems.length} feedback items addressed
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={onCancel}
              >
                Discard Changes
              </Button>
              <Button
                onClick={onAccept}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 gap-2"
              >
                <Check className="w-4 h-4" />
                Accept Revision
              </Button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}
