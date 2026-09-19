import { Sparkles, X } from 'lucide-react'
import type { TrackKind } from '@elah/core'
import { useAiTrackDialogStore } from './aiTrackDialog.store'
import { GenerationProgressBar } from './GenerationProgressBar'

/** Per-kind hint shown under the dialog title. */
const KIND_HINT: Record<TrackKind, string> = {
  video: 'Generate or edit visuals on this track with AI.',
  audio: 'AI tools for this track.',
  elements: 'Auto-generate or edit subtitles on this track with AI.',
}

/** Per-kind placeholder for the free-text instructions box. */
const PROMPT_PLACEHOLDER: Record<TrackKind, string> = {
  video: 'Add instructions for the AI (optional)…',
  audio: 'Add instructions for the AI (optional)…',
  elements: 'e.g. "Keep captions short" or "Use a playful tone" (optional)',
}

/**
 * Heuristic time budget per track kind — there's no real backend progress
 * signal (single request/response, no polling/SSE), so this only drives a
 * smooth, honest-effort progress bar. See GenerationProgressBar.
 */
const ESTIMATED_MS: Partial<Record<TrackKind, number>> = {
  elements: 12_000,
}
const DEFAULT_ESTIMATED_MS = 10_000

/**
 * AI-tools modal for a track — opened from the Sparkles button beside the
 * track name in TrackRow. Mounted once inside <Timeline>, like AudioDropDialog.
 */
export function AiTrackDialog() {
  const open = useAiTrackDialogStore((s) => s.open)
  const trackName = useAiTrackDialogStore((s) => s.trackName)
  const trackKind = useAiTrackDialogStore((s) => s.trackKind)
  const close = useAiTrackDialogStore((s) => s.close)
  const status = useAiTrackDialogStore((s) => s.status)
  const errorMessage = useAiTrackDialogStore((s) => s.errorMessage)
  const runGenerate = useAiTrackDialogStore((s) => s.runGenerate)
  const generators = useAiTrackDialogStore((s) => s.generators)
  const startedAt = useAiTrackDialogStore((s) => s.startedAt)
  const prompt = useAiTrackDialogStore((s) => s.prompt)
  const setPrompt = useAiTrackDialogStore((s) => s.setPrompt)
  const externalDialogs = useAiTrackDialogStore((s) => s.externalDialogs)

  if (!open || !trackKind) return null
  // The app owns this kind's modal (e.g. a multi-step flow) — render nothing
  // so the generic shell doesn't sit behind it. `open`/`trackId`/`trackKind`
  // still drive the app's own modal via the same store.
  if (externalDialogs[trackKind]) return null
  const busy = status === 'busy'
  const hasGenerator = Boolean(generators[trackKind])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`AI tools for ${trackName}`}
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `var(--elah-dialog-overlay)`,
        backdropFilter: 'blur(2px)',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: '90vw',
          background: `var(--elah-dialog-bg)`,
          border: `1px solid var(--elah-dialog-border)`,
          borderRadius: 12,
          boxShadow: `var(--elah-dialog-shadow)`,
          padding: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={15} className="text-ed-error" aria-hidden />
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: `var(--elah-text)`,
                letterSpacing: '-0.01em',
              }}
            >
              {trackName}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              padding: 0,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--elah-text-muted)',
            }}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        <p
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            lineHeight: 1.5,
            color: `var(--elah-text-muted)`,
          }}
        >
          {KIND_HINT[trackKind]}
        </p>

        {hasGenerator && (
          <>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              placeholder={PROMPT_PLACEHOLDER[trackKind]}
              rows={2}
              style={{
                marginTop: 12,
                width: '100%',
                resize: 'vertical',
                padding: '8px 10px',
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: 'inherit',
                color: 'var(--elah-text)',
                background: 'var(--elah-dialog-bg)',
                border: '1px solid var(--elah-dialog-border)',
                borderRadius: 8,
                boxSizing: 'border-box',
              }}
            />

            <button
              type="button"
              onClick={() => void runGenerate()}
              disabled={busy}
              style={{
                marginTop: 8,
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
                background: 'var(--elah-accent, #6366f1)',
                color: 'var(--elah-text-on-clip)',
              }}
            >
              <Sparkles size={13} aria-hidden />
              {busy ? 'Generating…' : 'Generate'}
            </button>

            {busy && startedAt && (
              <GenerationProgressBar
                startedAt={startedAt}
                estimatedMs={ESTIMATED_MS[trackKind] ?? DEFAULT_ESTIMATED_MS}
                className="mt-2"
              />
            )}

            {status === 'error' && errorMessage && (
              <p
                role="alert"
                style={{
                  margin: '8px 0 0',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--elah-error, #ef4444)',
                }}
              >
                {errorMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
