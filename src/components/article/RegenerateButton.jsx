import { useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useRegenerateArticle } from '@/hooks/useGeneration'

/**
 * Regenerate an EXISTING article through the current pipeline so all the
 * latest fixes (level uniqueness, dedup, school shortcodes, MASK fix, etc.)
 * apply to articles generated before those fixes shipped.
 *
 * Two modes:
 *   Refine — keep the existing draft as a reference. Grok rewrites it
 *            under current rules, preserving structure / voice / facts.
 *            Best default for articles you've manually edited.
 *   Fresh  — discard the existing draft. Regenerate from the source idea.
 *            Best when the article is fundamentally wrong (e.g. wrong
 *            category baked in).
 *
 * Props:
 *   articleId   — string, required
 *   onComplete  — optional callback after successful regen (e.g. refetch)
 *   variant     — Button variant ('outline' default)
 *   size        — Button size
 *   className
 */
export function RegenerateButton({ articleId, onComplete, variant = 'outline', size = 'sm', className }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('refine')
  const regenerate = useRegenerateArticle()

  const handleConfirm = async () => {
    try {
      const result = await regenerate.mutateAsync({ articleId, mode })
      setOpen(false)
      if (onComplete) onComplete(result?.article)
    } catch (err) {
      console.error('[RegenerateButton] failed:', err)
    }
  }

  const isBusy = regenerate.isPending

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        disabled={isBusy || !articleId}
      >
        {isBusy ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Regenerating…
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4 mr-2" />
            Regenerate
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !isBusy && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Regenerate this article</DialogTitle>
            <DialogDescription>
              Re-runs the article through the current pipeline so the latest fixes apply. Pick how aggressive you want it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label
              className={`flex gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                mode === 'refine' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="regen-mode"
                value="refine"
                checked={mode === 'refine'}
                onChange={() => setMode('refine')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Refine</div>
                <p className="text-sm text-gray-600 mt-0.5">
                  Use the existing draft as a reference. The AI rewrites it under the current rules, preserving structure, voice, and facts. <span className="font-medium text-gray-700">Recommended.</span>
                </p>
              </div>
            </label>

            <label
              className={`flex gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                mode === 'fresh' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="regen-mode"
                value="fresh"
                checked={mode === 'fresh'}
                onChange={() => setMode('fresh')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Fresh</div>
                <p className="text-sm text-gray-600 mt-0.5">
                  Discard the existing draft and start over from the source idea. Manual edits will be lost.
                </p>
              </div>
            </label>

            {regenerate.isError && (
              <p className="text-sm text-red-600">
                {regenerate.error?.message || 'Regeneration failed. See console.'}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isBusy}>
              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Regenerating…
                </>
              ) : (
                'Regenerate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default RegenerateButton
