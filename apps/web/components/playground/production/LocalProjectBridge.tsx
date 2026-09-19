'use client'

import { useEffect, useRef } from 'react'
import {
  relinkProjectMedia,
  useMediaLibraryStore,
  useTimelineEngine,
  type Project as EditorDocument,
} from '@elah/editor'
import { createAutosave, type Autosave } from '@/lib/project-autosave'
import {
  backupUnreadableLocalProject,
  localStorageOrNull,
  readLocalProject,
  writeLocalProject,
} from '@/lib/local-project'
import { DEFAULT_TRACK_HEIGHT } from './trackConstants'
import { useProjectSaveStore } from './projectSave.store'
import { referencedSrcsOf, useMediaLibrarySnapshot } from './useMediaLibrarySnapshot'

/**
 * Keeps the standalone `/editor` timeline across a refresh, in `localStorage`.
 *
 * The counterpart to `ProjectDocumentBridge`, and mounted the same way — inside
 * `EditorProvider`, because the engine comes from that context. The two are
 * mutually exclusive: this one runs when there is no project behind the editor,
 * which is exactly when the server autosave has nowhere to save to.
 *
 * It reuses `createAutosave` rather than a debounce of its own. The rules that
 * helper exists to enforce are about *when* to write, not about where, and two
 * of them matter just as much here: a drag emits a change per commit and must
 * write once at the end of it, and the change the restore itself emits must
 * write nothing (`baseline`). What does drop out is the server half — the
 * version is pinned at 0 and the save resolves synchronously, so the 409
 * conflict path can never be entered.
 *
 * What a refresh cannot bring back is a file the user dragged in from their own
 * device: its `blob:` URL died with the session that minted it. That clip is
 * *kept* — name, position, length, all of it — and named to the user by
 * `ProjectMediaNotice`, the same as on a stored project. Dropping it would be
 * the one outcome they could neither see nor undo. Its filmstrip does come
 * back, from the media-library snapshot: the thumbnails were decoded while the
 * file was still readable and stored as images, so the clip is recognisable on
 * the timeline even though its source is gone.
 *
 * Scope worth knowing: one key, so two `/editor` tabs are last-write-wins.
 * That's acceptable for a local scratch composition and would not be for a
 * shared document — which is what `/projects/:id/edit` and its version guard
 * are for.
 */
export function LocalProjectBridge() {
  const engine = useTimelineEngine()
  const setMissingMedia = useProjectSaveStore((s) => s.setMissingMedia)
  const { hydrate } = useMediaLibrarySnapshot('local')

  // Read by the pagehide handler below, which is registered once and must not
  // re-register every time the autosave is rebuilt.
  const autosaveRef = useRef<Autosave<EditorDocument> | null>(null)

  useEffect(() => {
    const store = localStorageOrNull()
    // No storage (SSR, private mode, blocked). The editor works; it just won't
    // remember — which is exactly what it did before this component existed.
    if (store === null) return

    const restore = readLocalProject(store, { defaultTrackHeight: DEFAULT_TRACK_HEIGHT })

    /**
     * A document this build can't read is copied aside before anything is
     * allowed to write over it.
     *
     * `ProjectDocumentBridge` blocks and shows a dialog in this case, because
     * there the alternative is PUT-ing an empty composition over work the user
     * cannot get back any other way. Here the blob is on the user's own machine
     * and now sits under a second key, so there is nothing left to protect and
     * nothing worth a modal over — the editor opens empty and saves normally.
     */
    if (restore.kind === 'refused') {
      backupUnreadableLocalProject(store)
      console.warn(
        `[editor] Stored timeline could not be opened (${restore.reason}); ` +
          'it has been kept under "myeditor-local-project-backup".',
      )
    }

    const restored = restore.kind === 'ready' ? restore.project : null

    const autosave = createAutosave<EditorDocument>({
      // No versioning: one writer, one key, no way to conflict.
      version: 0,
      // What storage already holds. Scheduling it writes nothing, which is what
      // makes the restore below a read.
      baseline: restored,
      save: (document) => {
        // Deliberately synchronous before the first yield: `flush` relies on
        // that to get the write out inside a `pagehide` handler, where a real
        // async gap would never resume.
        writeLocalProject(store, document)
        return Promise.resolve({ documentVersion: 0 })
      },
      // A local write has nothing to say that the timeline doesn't already show,
      // and the indicator this would feed belongs to the server project chrome.
      onStatus: () => {},
    })
    autosaveRef.current = autosave

    let live = true

    if (restored) {
      engine.loadProject(restored)
      // Named immediately from the document alone, before the library is back:
      // the clips whose `src` can never resolve are knowable without it, and
      // the user should be told rather than left with silent black rectangles.
      setMissingMedia(relinkProjectMedia(restored, mediaLibraryAssets()).missing)

      // Then the library itself, from the snapshot written during the session
      // that saved this composition. Without it every clip comes back to a grey
      // placeholder where its filmstrip was — the library is module-scoped and
      // starts empty, and nothing else in a standalone editor refills it.
      void hydrate(referencedSrcsOf(restored)).then(() => {
        if (!live) return
        const before = engine.getProject()
        const { project: repaired, missing } = relinkProjectMedia(before, mediaLibraryAssets())
        if (repaired !== before) {
          // Rebase before the load, and keep transport + history: this is a
          // cosmetic reference repair, not an edit. See the long note on
          // `ProjectDocumentBridge.relink`, which this mirrors deliberately.
          autosave.rebase(repaired)
          engine.loadProject(repaired, { transport: 'keep', history: 'keep' })
        }
        setMissingMedia(missing)
      })
    }

    const onChange = () => autosave.schedule(engine.getProject())
    engine.on('change', onChange)

    return () => {
      live = false
      engine.off('change', onChange)
      // An edit from the last couple of seconds would otherwise die with the
      // component. `flush` performs the write before it yields, so disposing
      // immediately afterwards cancels nothing.
      void autosave.flush()
      autosave.dispose()
      autosaveRef.current = null
      // The store is module-scoped: a missing-media notice left behind here
      // would greet whatever editor mounts next.
      setMissingMedia([])
    }
  }, [engine, setMissingMedia, hydrate])

  /**
   * A tab closed or backgrounded mid-debounce would lose the last edit.
   * `pagehide` is the one event that fires reliably on mobile (`beforeunload`
   * does not), and `visibilitychange` covers the tab that is switched away from
   * and then discarded under memory pressure without ever firing anything else.
   * Both are cheap here — the write is synchronous and local.
   */
  useEffect(() => {
    const flush = () => void autosaveRef.current?.flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}

function mediaLibraryAssets(): { id: string; src: string }[] {
  return Object.values(useMediaLibraryStore.getState().assets)
}
