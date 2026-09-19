import { create } from 'zustand'
import type { MissingMedia, ProjectDocumentErrorCode } from '@elah/editor'
import type { AutosaveStatus } from '@/lib/project-autosave'

/**
 * The editor's autosave state, shared between the two places that need it:
 * `ProjectDocumentBridge` (inside `EditorProvider`, where the engine is)
 * writes it, and `AppHeader` plus the conflict dialog (outside it) read it.
 */
interface ProjectSaveState {
  status: AutosaveStatus
  /** Set while the reload-latest recovery is running, so the dialog can wait. */
  reloading: boolean
  /** Why the reload failed, if it did. Keeps the dialog open with a next click. */
  reloadError: string | null
  /** Registered by the bridge; pulls the stored document back into the engine. */
  reloadLatest: (() => Promise<void>) | null
  /**
   * Why the project's stored document could not be opened, or `null` when it
   * was. The editor behind it is showing an empty composition that is *not* the
   * project's work, so the bridge attaches no autosave and a dialog says so.
   */
  unreadableReason: ProjectDocumentErrorCode | null
  /**
   * Registered by the bridge; abandons the unreadable document and starts an
   * empty one, autosave and all. The user's own choice — an unreadable project
   * is otherwise an editor with no way forward.
   */
  replaceUnreadable: (() => void) | null
  /**
   * Clips that came back from the server without a source file that can be
   * fetched again — a video imported from the user's own device, whose `blob:`
   * URL died with the session that made it.
   */
  missingMedia: MissingMedia[]
  /**
   * True once the bridge has finished restoring: the stored document is in the
   * engine, the project's media has been imported, and the clips' library
   * references have been repaired.
   */
  documentReady: boolean

  setStatus: (status: AutosaveStatus) => void
  setReloading: (reloading: boolean) => void
  setReloadError: (message: string | null) => void
  registerReload: (fn: (() => Promise<void>) | null) => void
  setUnreadableReason: (reason: ProjectDocumentErrorCode | null) => void
  registerReplaceUnreadable: (fn: (() => void) | null) => void
  setMissingMedia: (missing: MissingMedia[]) => void
  setDocumentReady: (ready: boolean) => void
  reset: () => void
}

const INITIAL = {
  status: { kind: 'idle' } as AutosaveStatus,
  reloading: false,
  reloadError: null,
  reloadLatest: null,
  unreadableReason: null,
  replaceUnreadable: null,
  missingMedia: [] as MissingMedia[],
  documentReady: false,
}

export const useProjectSaveStore = create<ProjectSaveState>((set) => ({
  ...INITIAL,
  setStatus: (status) => set({ status }),
  setReloading: (reloading) => set({ reloading }),
  setReloadError: (reloadError) => set({ reloadError }),
  registerReload: (reloadLatest) => set({ reloadLatest }),
  setUnreadableReason: (unreadableReason) => set({ unreadableReason }),
  registerReplaceUnreadable: (replaceUnreadable) => set({ replaceUnreadable }),
  setMissingMedia: (missingMedia) => set({ missingMedia }),
  setDocumentReady: (documentReady) => set({ documentReady }),
  reset: () => set(INITIAL),
}))
