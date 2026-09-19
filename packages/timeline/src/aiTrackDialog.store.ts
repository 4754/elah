import { create } from 'zustand'
import type { TrackKind } from '@elah/core'

export type AiTrackDialogStatus = 'idle' | 'busy' | 'error'

interface AiTrackDialogState {
  open: boolean
  trackId: string | null
  trackName: string
  trackKind: TrackKind | null
  status: AiTrackDialogStatus
  errorMessage: string | null
  /** Wall-clock time `runGenerate` started, for the heuristic progress bar. Cleared on close. */
  startedAt: number | null
  /** Free-text instructions the user typed in the AI dialog's prompt box, passed to the generator. */
  prompt: string
  /**
   * App-injected generate handlers, keyed by track kind. Registered from
   * `apps/web` (which owns the network/engine-mutation logic) so this
   * package stays free of app-level dependencies — see `registerGenerate`.
   */
  generators: Partial<Record<TrackKind, (prompt: string) => Promise<void>>>
  /**
   * Track kinds whose modal the app renders itself (e.g. a multi-step flow)
   * instead of the generic single-textarea `AiTrackDialog`. `openFor` still
   * drives `open`/`trackId`/`trackKind` as the shared "which track is this
   * about" state — the app's own modal reads those directly — but
   * `AiTrackDialog` renders nothing for a kind flagged here, so the generic
   * shell and the app's modal never render on top of each other.
   */
  externalDialogs: Partial<Record<TrackKind, boolean>>
}

interface AiTrackDialogActions {
  /** Open the AI dialog for a given track. */
  openFor: (track: { id: string; name: string; kind: TrackKind }) => void
  /** Close the dialog. */
  close: () => void
  /** Update the free-text prompt bound to the dialog's textarea. */
  setPrompt: (prompt: string) => void
  /** Register (or clear, with `null`) the generate handler for a track kind. */
  registerGenerate: (kind: TrackKind, fn: ((prompt: string) => Promise<void>) | null) => void
  /** Run the generate handler registered for the currently-open track's kind, if any. */
  runGenerate: () => Promise<void>
  /** Mark (or unmark) a track kind as owning its own external modal UI. */
  registerExternalDialog: (kind: TrackKind, enabled: boolean) => void
}

/**
 * Backs the AI-tools modal opened from the Sparkles button on each track's
 * label (see TrackRow). State + dispatch only — the actual generation work
 * (network calls, engine mutations) lives in the handler the app registers
 * via `registerGenerate`, keeping this package free of app-specific imports.
 */
export const useAiTrackDialogStore = create<AiTrackDialogState & AiTrackDialogActions>(
  (set, get) => ({
    open: false,
    trackId: null,
    trackName: '',
    trackKind: null,
    status: 'idle',
    errorMessage: null,
    startedAt: null,
    prompt: '',
    generators: {},
    externalDialogs: {},

    openFor: (track) =>
      set({
        open: true,
        trackId: track.id,
        trackName: track.name,
        trackKind: track.kind,
        status: 'idle',
        errorMessage: null,
        startedAt: null,
        prompt: '',
      }),

    close: () =>
      set({
        open: false,
        trackId: null,
        trackName: '',
        trackKind: null,
        status: 'idle',
        errorMessage: null,
        startedAt: null,
      }),

    setPrompt: (prompt) => set({ prompt }),

    registerGenerate: (kind, fn) =>
      set((s) => ({ generators: { ...s.generators, [kind]: fn ?? undefined } })),

    registerExternalDialog: (kind, enabled) =>
      set((s) => ({ externalDialogs: { ...s.externalDialogs, [kind]: enabled } })),

    runGenerate: async () => {
      const { trackKind, generators, status, prompt } = get()
      if (status === 'busy' || !trackKind) return
      const fn = generators[trackKind]
      if (!fn) return
      set({ status: 'busy', errorMessage: null, startedAt: Date.now() })
      try {
        await fn(prompt)
        set({ status: 'idle' })
      } catch (err) {
        set({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Generation failed.' })
      }
    },
  }),
)
