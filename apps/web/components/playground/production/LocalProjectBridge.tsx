'use client'

import { useEffect, useRef } from 'react'
import {
  relinkProjectMedia,
  scheduleThumbnailById,
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
import { getMediaBlob, getMediaRecord, getAllStoredMediaIds } from '@/lib/media-file-storage'

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
    let projectLoaded = !restored

    if (restored) {
      void (async () => {
        // 1. Hydrate the library from the snapshot written during the session
        // that saved this composition.
        await hydrate(referencedSrcsOf(restored))
        if (!live) return

        // 2. Recover stored Blobs from IndexedDB and mint fresh object URLs for this session
        const initialAssets = useMediaLibraryStore.getState().assets
        const restoredBlobSrcs = new Map<string, string>()
        const assetIdByOldSrc = new Map<string, string>()
        const recoveredClipIds = new Set<string>()

        for (const asset of Object.values(initialAssets)) {
          const blob = await getMediaBlob(asset.id)
          if (blob) {
            const freshUrl = URL.createObjectURL(blob)
            restoredBlobSrcs.set(asset.src, freshUrl)
            assetIdByOldSrc.set(asset.src, asset.id)
            useMediaLibraryStore.getState().updateAsset(asset.id, { src: freshUrl })
            scheduleThumbnailById(asset.id)
          }
        }

        // Also check any stored blobs in IndexedDB that might not yet be in the store snapshot
        const storedIds = await getAllStoredMediaIds()
        for (const id of storedIds) {
          let asset = useMediaLibraryStore.getState().assets[id]
          const record = await getMediaRecord(id)
          if (record && record.blob) {
            const freshUrl = URL.createObjectURL(record.blob)
            restoredBlobSrcs.set(id, freshUrl)

            if (!asset) {
              const kind = record.type?.startsWith('video/')
                ? 'video'
                : record.type?.startsWith('audio/')
                  ? 'audio'
                  : 'image'
              useMediaLibraryStore.getState().addAsset({
                id,
                kind,
                name: record.name || 'Uploaded Media',
                src: freshUrl,
                status: 'ready',
                durationSec: 0,
                byteSize: record.blob.size || 0,
                lastModified: (record.blob as File).lastModified || record.savedAt || Date.now(),
                addedAt: record.savedAt || Date.now(),
              })
              asset = useMediaLibraryStore.getState().assets[id]
            }

            scheduleThumbnailById(id)
          }
        }

        // 3. Pre-repair restored project document with fresh URLs and linked assetIds BEFORE engine load
        const updatedAssets = useMediaLibraryStore.getState().assets
        const repairedClips: Record<string, (typeof restored.clips)[string]> = {}
        for (const [trackId, clips] of Object.entries(restored.clips)) {
          repairedClips[trackId] = clips.map((clip) => {
            let newSrc = clip.src
            let assetId = clip.assetId

            if (typeof clip.src === 'string' && restoredBlobSrcs.has(clip.src)) {
              newSrc = restoredBlobSrcs.get(clip.src)!
              if (!assetId && assetIdByOldSrc.has(clip.src)) {
                assetId = assetIdByOldSrc.get(clip.src)
              }
              recoveredClipIds.add(clip.id)
            } else if (clip.assetId) {
              const fresh =
                updatedAssets[clip.assetId]?.src ||
                (restoredBlobSrcs.has(clip.assetId) ? restoredBlobSrcs.get(clip.assetId) : undefined)
              if (fresh) {
                newSrc = fresh
                recoveredClipIds.add(clip.id)
              }
            }

            // Fallback: If clip has no assetId, match by src or name in updatedAssets
            if (!assetId) {
              const matched = Object.values(updatedAssets).find(
                (a) => a.src === clip.src || (a.name === clip.name && a.kind === clip.type),
              )
              if (matched) {
                assetId = matched.id
                if (!newSrc || newSrc.startsWith('blob:')) {
                  newSrc = matched.src
                }
                recoveredClipIds.add(clip.id)
              }
            }

            return {
              ...clip,
              src: newSrc,
              ...(assetId ? { assetId } : {}),
            }
          })
        }

        const projectToLoad: EditorDocument = {
          ...restored,
          clips: repairedClips,
        }

        if (!live) return

        // 4. Load the repaired project directly into the engine with working URLs
        engine.loadProject(projectToLoad)
        autosave.rebase(projectToLoad)
        projectLoaded = true

        const { missing } = relinkProjectMedia(projectToLoad, mediaLibraryAssets())
        // Clips successfully recovered from IndexedDB are no longer missing
        const actualMissing = missing.filter((m) => !recoveredClipIds.has(m.clipId))
        setMissingMedia(actualMissing)
      })()
    }

    const onChange = () => {
      if (!projectLoaded) return
      const current = engine.getProject()
      autosave.schedule(current)
      const missing = useProjectSaveStore.getState().missingMedia
      if (missing.length > 0) {
        const remainingClipIds = new Set<string>()
        for (const bucket of Object.values(current.clips)) {
          for (const clip of bucket) remainingClipIds.add(clip.id)
        }
        const nextMissing = missing.filter((m) => remainingClipIds.has(m.clipId))
        if (nextMissing.length !== missing.length) {
          setMissingMedia(nextMissing)
        }
      }
    }
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
