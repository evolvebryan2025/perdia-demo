import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { GenerationProgressProvider } from './contexts/GenerationProgressContext'
import { HowToGuideProvider } from './contexts/HowToGuideContext'
import { ToastProvider } from './components/ui/toast'
import FloatingProgressWindow from './components/ui/FloatingProgressWindow'
import { queryClient } from './lib/queryClient'

// Pages
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import ArticleEditor from './pages/ArticleEditor'
import ContentIdeas from './pages/ContentIdeas'
import ContentLibrary from './pages/ContentLibrary'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import ReviewQueue from './pages/ReviewQueue'
import ArticleReview from './pages/ArticleReview'
import SiteCatalog from './pages/SiteCatalog'
import CatalogArticleDetail from './pages/CatalogArticleDetail'
import Keywords from './pages/Keywords'
import Automation from './pages/Automation'
import Integrations from './pages/Integrations'
import Contributors from './pages/Contributors'
import ContributorDetail from './pages/ContributorDetail'
import AITraining from './pages/AITraining'
import SecretJosh from './pages/SecretJosh'
import BatchProgress from './pages/BatchProgress'
import ReleaseHistory from './pages/ReleaseHistory'
import DevFeedbackQueue from './pages/DevFeedbackQueue'

// Layout
import MainLayout from './components/layout/MainLayout'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-gray-600 font-medium">Loading Perdia...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GenerationProgressProvider>
          <HowToGuideProvider>
            <ToastProvider>
              <BrowserRouter>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/secret/josh" element={<SecretJosh />} />

                  {/* Batch Progress - Standalone page for new tab/window */}
                  <Route
                    path="/batch-progress"
                    element={
                      <ProtectedRoute>
                        <BatchProgress />
                      </ProtectedRoute>
                    }
                  />

                  {/* Protected Routes */}
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <MainLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Dashboard />} />
                    <Route path="ideas" element={<ContentIdeas />} />
                    <Route path="editor/:articleId" element={<ArticleEditor />} />
                    <Route path="editor" element={<ArticleEditor />} />
                    <Route path="library" element={<ContentLibrary />} />
                    <Route path="review" element={<ReviewQueue />} />
                    <Route path="review/:articleId" element={<ArticleReview />} />
                    <Route path="catalog" element={<SiteCatalog />} />
                    <Route path="catalog/:articleId" element={<CatalogArticleDetail />} />
                    <Route path="keywords" element={<Keywords />} />
                    <Route path="automation" element={<Automation />} />
                    <Route path="integrations" element={<Integrations />} />
                    <Route path="contributors" element={<Contributors />} />
                    <Route path="contributors/:contributorId" element={<ContributorDetail />} />
                    <Route path="ai-training" element={<AITraining />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="releases" element={<ReleaseHistory />} />
                    <Route path="dev-feedback" element={<DevFeedbackQueue />} />
                  </Route>

                  {/* Fallback */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              {/* Global Floating Progress Window - persists across page navigation */}
              <FloatingProgressWindow />
              </BrowserRouter>
            </ToastProvider>
          </HowToGuideProvider>
        </GenerationProgressProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
