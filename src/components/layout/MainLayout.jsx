import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import HelpFeedbackButton from '../feedback/HelpFeedbackButton'
import HelpFeedbackModal from '../feedback/HelpFeedbackModal'
import {
  LayoutDashboard,
  FileText,
  Lightbulb,
  Library,
  BarChart3,
  Settings as SettingsIcon,
  LogOut,
  ClipboardCheck,
  Globe,
  Hash,
  Zap,
  Plug,
  Users,
  Brain,
  CheckCircle2,
  X,
  Sparkles,
  ChevronRight,
  History,
  MessageSquare,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'

// Import git info (generated at build time)
// Uses a synchronous import to avoid top-level await which can cause
// the module to load asynchronously and break React Router navigation
import gitInfoData from '../../data/git-info.json'
const gitInfo = gitInfoData || { recentCommits: [], version: 'dev', buildDate: '' }

// Get icon based on commit type
function getCommitIcon(type) {
  switch (type) {
    case 'fix': return '🔧'
    case 'feature': return '✨'
    case 'chore': return '🔨'
    case 'docs': return '📚'
    case 'refactor': return '♻️'
    case 'perf': return '⚡'
    case 'test': return '🧪'
    default: return '📝'
  }
}

// Format commit message for display (remove type prefix)
function formatCommitMessage(message) {
  // Remove conventional commit prefix like "fix: " or "feat(scope): "
  return message.replace(/^(fix|feat|chore|docs|refactor|perf|test|style)(\([^)]+\))?:\s*/i, '')
}

// System status banner component - now shows real git commits
function SystemStatusBanner() {
  const navigate = useNavigate()
  const [isVisible, setIsVisible] = useState(true)

  const version = gitInfo.version || 'dev'
  const buildDate = gitInfo.buildDate || ''
  const latestCommitHash = gitInfo.latestCommit?.hash || ''
  const recentCommits = (gitInfo.recentCommits || []).slice(0, 3)

  useEffect(() => {
    // Check if user has dismissed this version's banner (using commit hash)
    const dismissedVersion = localStorage.getItem('dismissedStatusVersion')
    if (dismissedVersion === latestCommitHash && latestCommitHash) {
      setIsVisible(false)
    }
  }, [latestCommitHash])

  const handleDismiss = (e) => {
    e.stopPropagation() // Prevent navigation when clicking X
    localStorage.setItem('dismissedStatusVersion', latestCommitHash)
    setIsVisible(false)
  }

  const handleClick = () => {
    navigate('/releases')
  }

  // Don't show if no commits or already dismissed
  if (!isVisible || recentCommits.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      onClick={handleClick}
      className="bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 border-b-2 border-green-300 cursor-pointer hover:from-green-100 hover:via-emerald-100 hover:to-teal-100 transition-colors group"
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold">System Updated & Ready</span>
              </div>
              <span className="text-sm text-green-600 bg-green-100 px-2 py-0.5 rounded">
                v{version}
              </span>
              <span className="text-sm text-green-600">
                {buildDate}
              </span>
              <div className="flex items-center gap-1 text-green-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <History className="w-4 h-4" />
                <span className="text-sm font-medium">View all updates</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
            {/* Show recent commits */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {recentCommits.map((commit, index) => (
                <div key={commit.hash || index} className="flex items-center gap-1.5 text-sm text-green-700">
                  <span className="flex-shrink-0">{getCommitIcon(commit.type)}</span>
                  <span>{formatCommitMessage(commit.message)}</span>
                  <span className="text-green-500 text-xs">({commit.hash})</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-lg transition-colors flex-shrink-0"
            title="Dismiss (won't show again for this version)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function MainLayout() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Content Ideas', href: '/ideas', icon: Lightbulb },
    { name: 'Library', href: '/library', icon: Library },
    { name: 'Review Queue', href: '/review', icon: ClipboardCheck },
    { name: 'Automation', href: '/automation', icon: Zap },
    { name: 'Site Catalog', href: '/catalog', icon: Globe },
    // { name: 'Keywords', href: '/keywords', icon: Hash }, // Hidden - not currently in use
    { name: 'Integrations', href: '/integrations', icon: Plug },
    { name: 'Contributors', href: '/contributors', icon: Users },
    { name: 'AI Training', href: '/ai-training', icon: Brain },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Settings', href: '/settings', icon: SettingsIcon },
    { name: 'Dev Feedback', href: '/dev-feedback', icon: MessageSquare },
  ]

  // Explicit navigation handler — bypasses <Link> which can fail
  // to trigger Outlet re-renders in React Router v7 + React 19
  const handleNavigation = useCallback((e, href) => {
    e.preventDefault()
    e.stopPropagation()
    // Only navigate if we're not already on this path
    if (location.pathname !== href) {
      navigate(href)
      window.scrollTo(0, 0)
    }
  }, [navigate, location.pathname])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar - uses div instead of motion.div to avoid transform creating
          a containing block that breaks fixed positioning of child elements
          and interferes with pointer events during animation */}
      <div
        className="fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 shadow-sm"
      >
        <div className="flex flex-col h-full">
          {/* Logo — click navigates to Dashboard */}
          <a
            href="/"
            onClick={(e) => handleNavigation(e, '/')}
            className="flex items-center h-16 px-6 border-b border-gray-200 cursor-pointer"
          >
            <div>
              <FileText className="w-8 h-8 text-blue-600" />
            </div>
            <span className="ml-2 text-xl font-bold text-gray-900">Perdia</span>
          </a>

          {/* Navigation — uses explicit navigate() instead of <Link>
              to guarantee route transitions work from any page */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              // Use startsWith for nested routes, exact match for root
              const isActive = item.href === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.href)
              const Icon = item.icon

              return (
                <a
                  key={item.name}
                  href={item.href}
                  onClick={(e) => handleNavigation(e, item.href)}
                  className={`
                    flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 relative cursor-pointer
                    ${
                      isActive
                        ? 'text-blue-700 bg-blue-50'
                        : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                    }
                  `}
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {item.name}
                </a>
              )
            })}
          </nav>

          {/* User Section */}
          <div
            className="p-4 border-t border-gray-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center min-w-0">
                <div className="flex-shrink-0">
                  <div
                    className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center text-white font-medium shadow-sm"
                  >
                    {user?.email?.[0].toUpperCase()}
                  </div>
                </div>
                <div className="ml-3 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user?.email}
                  </p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content — key moved from <main> to <Outlet>. Putting
          key on <main> forced the entire Outlet to remount, causing
          route context desync in React Router v7 + React 19. Keying
          the Outlet directly forces child component remount while
          preserving Outlet's own route context subscription. */}
      <div className="pl-64">
        <SystemStatusBanner />
        <main className="min-h-screen">
          <Outlet key={location.pathname} />
        </main>
      </div>

      {/* Help & Feedback Components */}
      <HelpFeedbackButton />
      <HelpFeedbackModal />
    </div>
  )
}

export default MainLayout
