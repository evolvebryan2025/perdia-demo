import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, XCircle, Sparkles, X, Minimize2 } from 'lucide-react'
import { Progress } from './progress'
import { Button } from './button'

/**
 * ProgressModal - A reusable modal for displaying multi-step process progress
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {string} title - The title of the process
 * @param {string} subtitle - Optional subtitle text
 * @param {number} progress - Current progress percentage (0-100)
 * @param {string} currentStep - Current step being performed
 * @param {Array<{text: string, status: 'pending' | 'active' | 'completed' | 'error'}>} steps - Array of step objects
 * @param {string} status - Overall status: 'running' | 'completed' | 'error' | 'cancelled'
 * @param {string} errorMessage - Error message if status is 'error'
 * @param {function} onClose - Callback when modal should close
 * @param {function} onMinimize - Callback when modal should minimize (process continues in background)
 * @param {function} onCancel - Callback when user clicks STOP button
 * @param {boolean} allowDismissWhileRunning - Whether to allow closing/minimizing while running (default: true)
 * @param {boolean} allowCancel - Whether to show STOP button while running (default: false)
 */
export function ProgressModal({
  isOpen,
  title = 'Processing...',
  subtitle,
  progress = 0,
  currentStep = '',
  steps = [],
  status = 'running',
  errorMessage = '',
  onClose,
  onMinimize,
  onCancel,
  allowDismissWhileRunning = true,
  allowCancel = false,
}) {
  const [displayedSteps, setDisplayedSteps] = useState([])
  const [typingStep, setTypingStep] = useState(null)
  const [typedText, setTypedText] = useState('')
  const stepsContainerRef = useRef(null)

  // Typewriter effect for new steps
  useEffect(() => {
    if (steps.length === 0) return

    // Find new steps that haven't been displayed yet
    const newSteps = steps.filter(
      (step) => !displayedSteps.some((ds) => ds.text === step.text)
    )

    if (newSteps.length > 0) {
      const stepToType = newSteps[0]
      setTypingStep(stepToType)
      setTypedText('')

      let charIndex = 0
      const typeInterval = setInterval(() => {
        if (charIndex <= stepToType.text.length) {
          setTypedText(stepToType.text.slice(0, charIndex))
          charIndex++
        } else {
          clearInterval(typeInterval)
          setDisplayedSteps((prev) => [...prev, stepToType])
          setTypingStep(null)
          setTypedText('')
        }
      }, 15) // Fast typing speed

      return () => clearInterval(typeInterval)
    }
  }, [steps, displayedSteps])

  // Auto-scroll to bottom when new steps are added
  useEffect(() => {
    if (stepsContainerRef.current) {
      stepsContainerRef.current.scrollTop = stepsContainerRef.current.scrollHeight
    }
  }, [displayedSteps, typedText])

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setDisplayedSteps([])
      setTypingStep(null)
      setTypedText('')
    }
  }, [isOpen])

  const getStepIcon = (stepStatus) => {
    switch (stepStatus) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'active':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'from-green-500 to-emerald-600'
      case 'error':
        return 'from-red-500 to-red-600'
      default:
        return 'from-blue-500 to-indigo-600'
    }
  }

  if (!isOpen) return null

  const canDismiss = allowDismissWhileRunning || status !== 'running'

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && canDismiss && onMinimize) {
      onMinimize()
    }
  }

  const handleClose = () => {
    if (canDismiss) {
      if (status === 'running' && onMinimize) {
        onMinimize()
      } else if (onClose) {
        onClose()
      }
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleBackdropClick}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden relative"
        >
          {/* Close/Minimize Button - Always visible when allowed */}
          {canDismiss && (
            <div className="absolute top-3 right-3 z-10 flex gap-1">
              {status === 'running' && onMinimize && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onMinimize}
                  className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20 rounded-full"
                  title="Minimize - process continues in background"
                >
                  <Minimize2 className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20 rounded-full"
                title={status === 'running' ? 'Close - process continues in background' : 'Close'}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Header with gradient */}
          <div className={`bg-gradient-to-r ${getStatusColor()} p-6 text-white`}>
            <div className="flex items-center gap-3 mb-2 pr-16">
              {status === 'running' ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                  <Sparkles className="w-8 h-8" />
                </motion.div>
              ) : status === 'completed' ? (
                <CheckCircle2 className="w-8 h-8" />
              ) : (
                <XCircle className="w-8 h-8" />
              )}
              <h2 className="text-xl font-bold">{title}</h2>
            </div>
            {subtitle && (
              <p className="text-white/80 text-sm">{subtitle}</p>
            )}
            {status === 'running' && canDismiss && (
              <p className="text-white/60 text-xs mt-2">
                Click outside or press X to continue working — process runs in background
              </p>
            )}
          </div>

          {/* Progress Section */}
          <div className="p-6 space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 font-medium">{currentStep}</span>
                <span className="text-gray-500">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Steps List */}
            <div
              ref={stepsContainerRef}
              className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-sm"
            >
              {displayedSteps.map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 py-1"
                >
                  {getStepIcon(step.status)}
                  <span
                    className={`${
                      step.status === 'completed'
                        ? 'text-green-400'
                        : step.status === 'error'
                        ? 'text-red-400'
                        : 'text-gray-300'
                    }`}
                  >
                    {step.text}
                  </span>
                </motion.div>
              ))}

              {/* Currently typing step */}
              {typingStep && (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  <span className="text-blue-400">
                    {typedText}
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                      className="inline-block w-2 h-4 bg-blue-400 ml-0.5 align-middle"
                    />
                  </span>
                </div>
              )}

              {/* Blinking cursor when idle but running */}
              {status === 'running' && !typingStep && displayedSteps.length === 0 && (
                <div className="flex items-center gap-2 py-1">
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="inline-block w-2 h-4 bg-gray-400"
                  />
                </div>
              )}
            </div>

            {/* Error Message */}
            {status === 'error' && errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50 border border-red-200 rounded-lg"
              >
                <p className="text-red-700 text-sm">{errorMessage}</p>
              </motion.div>
            )}

            {/* STOP Button (only when running and allowed) */}
            {allowCancel && status === 'running' && onCancel && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={onCancel}
                className="w-full py-3 rounded-lg font-medium transition-colors bg-red-600 hover:bg-red-700 text-white flex items-center justify-center gap-2"
                title="Stop the current generation process. Any partial progress will be lost."
              >
                <XCircle className="w-5 h-5" />
                STOP
              </motion.button>
            )}

            {/* Running state info - show when no cancel button but still running */}
            {!allowCancel && status === 'running' && (
              <p className="text-xs text-center text-gray-500">
                Process is running. You can close this window - the process will continue in the background.
              </p>
            )}

            {/* Cancelled Message */}
            {status === 'cancelled' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-amber-50 border border-amber-200 rounded-lg"
              >
                <p className="text-amber-700 text-sm">Process was stopped by user</p>
              </motion.div>
            )}

            {/* Close Button (only when done or cancelled) */}
            {(status === 'completed' || status === 'error' || status === 'cancelled') && onClose && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={onClose}
                className={`w-full py-3 rounded-lg font-medium transition-colors ${
                  status === 'completed'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
                title={status === 'completed' ? 'Process completed successfully. Click to close this window.' : 'Close this window.'}
              >
                {status === 'completed' ? 'Done - Close Window' : 'Close'}
              </motion.button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * useProgressModal - Hook for managing progress modal state
 *
 * Usage:
 * const progress = useProgressModal()
 *
 * // Start a process
 * progress.start('Generating Article', 'Please wait while we create your content')
 *
 * // Add steps as they happen
 * progress.addStep('Initializing AI engine...')
 * progress.updateProgress(10)
 * progress.completeStep('Initializing AI engine...')
 *
 * // Add next step
 * progress.addStep('Generating draft content...')
 * progress.updateProgress(30)
 *
 * // Complete or error
 * progress.complete() // or progress.error('Something went wrong')
 *
 * // Render
 * <ProgressModal {...progress.modalProps} />
 */
export function useProgressModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [steps, setSteps] = useState([])
  const [status, setStatus] = useState('running')
  const [errorMessage, setErrorMessage] = useState('')

  const start = (titleText, subtitleText = '') => {
    setIsOpen(true)
    setIsMinimized(false)
    setTitle(titleText)
    setSubtitle(subtitleText)
    setProgress(0)
    setCurrentStep('')
    setSteps([])
    setStatus('running')
    setErrorMessage('')
  }

  const minimize = () => {
    setIsMinimized(true)
  }

  const restore = () => {
    setIsMinimized(false)
  }

  const addStep = (text) => {
    setCurrentStep(text)
    setSteps((prev) => [...prev, { text, status: 'active' }])
  }

  const updateStep = (text, newStatus) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.text === text ? { ...step, status: newStatus } : step
      )
    )
  }

  const completeStep = (text) => {
    updateStep(text, 'completed')
  }

  const errorStep = (text) => {
    updateStep(text, 'error')
  }

  const updateProgress = (value) => {
    setProgress(value)
  }

  const complete = () => {
    setProgress(100)
    setStatus('completed')
    setCurrentStep('Complete!')
  }

  const error = (message) => {
    setStatus('error')
    setErrorMessage(message)
    setCurrentStep('Error occurred')
  }

  const cancel = () => {
    setStatus('cancelled')
    setCurrentStep('Stopped by user')
  }

  const close = () => {
    setIsOpen(false)
  }

  const reset = () => {
    setIsOpen(false)
    setIsMinimized(false)
    setTitle('')
    setSubtitle('')
    setProgress(0)
    setCurrentStep('')
    setSteps([])
    setStatus('running')
    setErrorMessage('')
  }

  return {
    // Modal props to spread
    modalProps: {
      isOpen: isOpen && !isMinimized,
      title,
      subtitle,
      progress,
      currentStep,
      steps,
      status,
      errorMessage,
      onClose: close,
      onMinimize: minimize,
      onCancel: cancel,
      allowDismissWhileRunning: true,
      allowCancel: false, // Override in spread: { ...modalProps, allowCancel: true }
    },
    // Minimized indicator props
    minimizedProps: {
      isVisible: isOpen && isMinimized,
      title,
      progress,
      status,
      onRestore: restore,
    },
    // Control methods
    start,
    addStep,
    completeStep,
    errorStep,
    updateProgress,
    complete,
    error,
    cancel,
    close,
    reset,
    minimize,
    restore,
    // State getters
    isOpen,
    isMinimized,
    isRunning: status === 'running' && isOpen,
    isCancelled: status === 'cancelled',
  }
}

/**
 * MinimizedProgressIndicator - Small floating indicator shown when progress modal is minimized
 * Shows progress status and allows restoring the full modal
 */
export function MinimizedProgressIndicator({
  isVisible,
  title,
  progress,
  status,
  onRestore,
}) {
  if (!isVisible) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      className="fixed bottom-4 right-4 z-50"
    >
      <button
        onClick={onRestore}
        className={`flex items-center gap-3 px-4 py-3 rounded-full shadow-lg border transition-all hover:scale-105 ${
          status === 'running'
            ? 'bg-blue-600 border-blue-500 text-white'
            : status === 'completed'
            ? 'bg-green-600 border-green-500 text-white'
            : 'bg-red-600 border-red-500 text-white'
        }`}
        title="Click to show progress"
      >
        {status === 'running' ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : status === 'completed' ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : (
          <XCircle className="w-5 h-5" />
        )}
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium truncate max-w-32">
            {title || 'Processing...'}
          </span>
          <span className="text-xs opacity-80">
            {status === 'running' ? `${Math.round(progress)}%` : status === 'completed' ? 'Done!' : 'Error'}
          </span>
        </div>
        {status === 'running' && (
          <div className="w-12 h-1.5 bg-white/30 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-white rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}
      </button>
    </motion.div>
  )
}

export default ProgressModal
