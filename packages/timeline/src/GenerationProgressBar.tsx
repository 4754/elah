import { useEffect, useState } from 'react'

/**
 * Elapsed time -> display percentage, 0-99. Asymptotic curve
 * 100 * (1 - 0.5^(t/est)), capped at 99 so it approaches but never reaches
 * 100 before the caller's own status flips away from "busy". Ported from
 * apps/web's generation-estimates.ts heuristic (same formula/feel) so this
 * package doesn't need an app-level dependency to stay visually consistent.
 */
function estimateProgress(elapsedMs: number, estimatedMs: number): number {
  if (estimatedMs <= 0) return 99
  const raw = 100 * (1 - Math.pow(0.5, elapsedMs / estimatedMs))
  return Math.min(99, Math.round(raw))
}

/** Re-renders roughly once a second so the bar can animate off elapsed wall-clock time. */
function useElapsedProgress(startedAt: number, estimatedMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = globalThis.setInterval(() => setNow(Date.now()), 1_000)
    return () => globalThis.clearInterval(id)
  }, [])

  return estimateProgress(now - startedAt, estimatedMs)
}

/**
 * Heuristic progress bar for AI generation with no real backend progress
 * signal (single request/response, no polling/SSE) — shared by the AI-tools
 * modal and the track lane so both read the same elapsed-time estimate.
 */
export function GenerationProgressBar({
  startedAt,
  estimatedMs,
  label,
  className,
}: {
  startedAt: number
  estimatedMs: number
  label?: string
  className?: string
}) {
  const percent = useElapsedProgress(startedAt, estimatedMs)
  return (
    <div className={className}>
      <div
        style={{
          height: 6,
          overflow: 'hidden',
          borderRadius: 3,
          background: 'var(--elah-effect-placeholder-bg, rgba(255,255,255,0.08))',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 3,
            width: `${percent}%`,
            transition: 'width 300ms ease-out',
            background: 'linear-gradient(90deg, var(--elah-accent, #6366f1), var(--elah-accent-hover, #818cf8))',
          }}
        />
      </div>
      {label && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            fontFamily: 'monospace',
            color: 'var(--elah-text-muted)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

export default GenerationProgressBar
