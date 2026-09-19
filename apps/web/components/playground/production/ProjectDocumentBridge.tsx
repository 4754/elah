'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ProjectDocumentError,
  beginImportUrl,
  readProjectDocument,
  relinkProjectMedia,
  useMediaLibraryStore,
  useTimelineEngine,
  type MediaAssetAnalysis,
  type Project as EditorDocument,
  type ProjectDocumentErrorCode,
} from '@elah/editor'
import { createAutosave, type Autosave } from '@/lib/project-autosave'
import { proxyGalleryAsset } from '@/lib/gallery/proxyAsset'
import { shortAssetName } from '@/lib/shortAssetName'
import {
  getProjectAssetsPage,
  hasStoredDocument,
  openProject,
  saveProjectDocument,
} from '@/lib/projects'
import { projectScope } from '@/lib/media-library-snapshot'
import { DEFAULT_TRACK_HEIGHT } from './trackConstants'
import { useProjectSaveStore } from './projectSave.store'
import { referencedSrcsOf, useMediaLibrarySnapshot } from './useMediaLibrarySnapshot'

/** What the editor needs to know about the project it was opened for. */
export interface EditorProjectChrome {
  id: string
  name: string
  /** The stored editor document, or null on a project that has never been saved. */
  document: Record<string, unknown> | null
  documentVersion: number
}

/**
 * Everything that binds the timeline engine to a stored project: restore on
 * open, autosave on change, media re-link, and recovery when somebody else
 * saved first.
 *
 * Headless, and mounted **inside** `EditorProvider` — the engine comes from
 * that context, so this cannot be a wrapper around `ProductionEditor`. State it
 * needs to share upward goes through `projectSave.store`.
 *
 * The order of what happens on open is the whole design:
 *
 *  1. **Parse, then decide.** `readProjectDocument` turns the stored JSON into
 *     a `Project` or refuses it. Refusing is a real outcome with a dialog — the
 *     alternative is an editor that looks empty and is one idle click away from
 *     PUT-ing that emptiness over the user's work.
 *  2. **Restore, and call it saved.** `engine.loadProject` swaps the whole
 *     composition in, drops undo history, and rewinds the playhead. The
 *     autosave is created with that same object as its baseline, so the
 *     `change` the restore emits writes nothing — an open is a read.
 *  3. **Re-link the media afterwards.** The stored document carries each clip's
 *     `src` but not the media library, which is rebuilt per page load with
 *     fresh ids. The composition plays regardless (the renderer reads `src`);
 *     what a stale `assetId` costs is the clip's filmstrip and the size of its
 *     selection box. So the library is refilled from the project's own assets
 *     and the references repaired in a second, playhead-preserving load.
 *
 * A clip whose media cannot come back at all — a file dragged in from the
 * user's device, whose `blob:` URL died with that session — is **kept**, not
 * dropped. It holds its name, position and length, renders nothing, and is
 * named to the user by `ProjectMediaNotice`. Dropping it would be the one
 * outcome they could neither see nor undo.
 */
export function ProjectDocumentBridge({ project }: { project: EditorProjectChrome }) {
  const engine = useTimelineEngine()
  const setStatus = useProjectSaveStore((s) => s.setStatus)
  const setReloading = useProjectSaveStore((s) => s.setReloading)
  const setReloadError = useProjectSaveStore((s) => s.setReloadError)
  const registerReload = useProjectSaveStore((s) => s.registerReload)
  const setUnreadableReason = useProjectSaveStore((s) => s.setUnreadableReason)
  const registerReplaceUnreadable = useProjectSaveStore((s) => s.registerReplaceUnreadable)
  const setMissingMedia = useProjectSaveStore((s) => s.setMissingMedia)
  const setDocumentReady = useProjectSaveStore((s) => s.setDocumentReady)
  const resetSaveState = useProjectSaveStore((s) => s.reset)
  // Scoped per project: one browser's Assets panel must never show project A's
  // media while project B is open.
  const { hydrate } = useMediaLibrarySnapshot(projectScope(project.id))

  // The autosave outlives individual renders and is read by the change handler,
  // the media re-link and the reload path, so it lives in a ref rather than
  // state.
  const autosaveRef = useRef<Autosave<EditorDocument> | null>(null)

  /**
   * Set when the user has chosen to abandon a document this build can't open
   * and start an empty one. Until then nothing is attached to the engine, so no
   * edit can reach the server — see the gate at the top of the effect below.
   */
  const [replacing, setReplacing] = useState(false)

  // Memoised on the document itself, not recomputed per render: `restored` is
  // the object handed to `loadProject` *and* the autosave's baseline, and a
  // fresh one each render would re-run the restore effect forever.
  const restore = useMemo(() => readRestore(project.document), [project.document])
  const gated = restore.kind === 'refused' && !replacing
  const refusedReason = restore.kind === 'refused' ? restore.reason : null
  const restored = restore.kind === 'ready' ? restore.project : null

  useEffect(() => {
    /**
     * A stored document this build can't open is *not* opened, and nothing is
     * autosaved over it.
     *
     * The engine would sit at its empty default, `project.documentVersion`
     * would still be current, and so the user's first idle click would PUT an
     * empty composition over their work and get a 200 for it. No amount of care
     * in the editor recovers from that, so the only safe move is to attach
     * nothing and say why (`ProjectUnreadableDialog`).
     */
    if (gated) {
      setUnreadableReason(refusedReason ?? 'unreadable')
      setStatus({ kind: 'blocked' })
      registerReplaceUnreadable(() => setReplacing(true))
      // Same reset the saving branch ends with: the store is module-scoped, so
      // a 'blocked' indicator left behind here would greet the next project.
      return resetSaveState
    }

    const autosave = createAutosave<EditorDocument>({
      version: project.documentVersion,
      // The document the server is already holding. Scheduling it saves
      // nothing, which is what makes opening a project a read.
      baseline: restored,
      save: async (document, version) => {
        // `document` is the engine's own immutable snapshot; the wire wants a
        // plain JSON object and `api()` stringifies it either way.
        const saved = await saveProjectDocument(
          project.id,
          document as unknown as Record<string, unknown>,
          version,
        )
        return { documentVersion: saved.documentVersion }
      },
      onStatus: setStatus,
    })
    autosaveRef.current = autosave

    if (restored) engine.loadProject(restored)

    const onChange = () => autosave.schedule(engine.getProject())
    engine.on('change', onChange)

    registerReload(async () => {
      setReloading(true)
      setReloadError(null)
      try {
        const latest = await openProject(project.id)
        const next = readRestore(latest.document)
        // A document the *other* tab could write and this build can't read is
        // the unreadable case arriving late. Leave the composition alone and
        // stop saving over it rather than silently carrying on.
        if (next.kind === 'refused') {
          setUnreadableReason(next.reason)
          setStatus({ kind: 'blocked' })
          return
        }
        if (next.kind === 'ready') {
          // Baseline first: the load announces its change synchronously, and a
          // document that came straight off the server must not read as
          // "Unsaved changes" on the way past.
          autosave.rebase(next.project)
          engine.loadProject(next.project)
        }
        // `resume` drops the pending edit — it was built on the version that
        // lost, and taking the latest is the choice the user just made.
        autosave.resume(latest.documentVersion)
      } catch (err) {
        setReloadError(
          err instanceof Error ? err.message : "Couldn't fetch the latest version of this project.",
        )
      } finally {
        setReloading(false)
      }
    })

    return () => {
      engine.off('change', onChange)
      // An edit made in the last couple of seconds would otherwise be lost on
      // navigation. `flush` issues the request synchronously before it yields,
      // so disposing immediately afterwards cancels nothing — it only stops the
      // response writing a status onto a store this page no longer owns, which
      // is why `dispose` is here rather than in a `.finally`.
      void autosave.flush()
      autosave.dispose()
      autosaveRef.current = null
      registerReload(null)
      resetSaveState()
    }
  }, [
    gated,
    refusedReason,
    restored,
    engine,
    project.id,
    project.documentVersion,
    setStatus,
    setReloading,
    setReloadError,
    registerReload,
    setUnreadableReason,
    registerReplaceUnreadable,
    resetSaveState,
  ])

  /**
   * A tab closed or backgrounded mid-debounce would lose the last edit.
   * `pagehide` is the one event that fires reliably on mobile (`beforeunload`
   * does not), and the save it triggers is best-effort by nature — the request
   * either gets out before the document is discarded or it does not.
   */
  useEffect(() => {
    const onPageHide = () => void autosaveRef.current?.flush()
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  /**
   * Repair the restored clips' library references, and report the ones whose
   * media is gone for good.
   *
   * This runs at the far end of an unbounded wait — the project's assets have to
   * be fetched and probed first — so it must assume the user has been editing
   * the whole time. Two rules follow from that, and both were learned the hard
   * way:
   *
   *  - **Touch the autosave only when there is something to repair.** `rebase`
   *    exists to swallow the announcement `loadProject` makes; with nothing to
   *    load there is no announcement, and calling it anyway would hand it the
   *    edit the user made while the assets were loading. `rebase` would see its
   *    own pending document, drop it, and the indicator would say "All changes
   *    saved" about work that had never left the tab.
   *  - **`history: 'keep'`.** A reference repair is not a new baseline. The
   *    trims and titles from the last few minutes are the user's, and so is the
   *    drag that may be open right now.
   */
  const relink = useCallback(() => {
    const before = engine.getProject()
    const assets = Object.values(useMediaLibraryStore.getState().assets)
    const { project: repaired, missing } = relinkProjectMedia(before, assets)

    if (repaired !== before) {
      // Rebase *before* the load, not after: `loadProject` announces the change
      // synchronously, and a baseline set afterwards would let that
      // announcement flash "Unsaved changes" over work the user has not
      // touched. A stale `assetId` is session-scoped and cosmetic — worth
      // repairing on screen, not worth a PUT. `repaired` is freshly built here,
      // so it can never be the document a real edit already queued.
      autosaveRef.current?.rebase(repaired)
      // 'keep' transport: the composition is already on screen and may be
      // playing. Repairing a reference is not a reason to throw the user back
      // to the start of their video, nor to empty their undo stack.
      engine.loadProject(repaired, { transport: 'keep', history: 'keep' })
    }

    setMissingMedia(missing)
  }, [engine, setMissingMedia])

  /**
   * Puts the project's own media back into the editor's library, which the
   * stored document does not carry (see the module note), then re-links the
   * restored clips against it.
   *
   * Best-effort: `beginImportUrl` dedupes on `src`, so an asset already
   * referenced by a restored clip is not imported twice, and a failure here
   * costs a filmstrip rather than the composition.
   *
   * The library is emptied first, and again on the way out. It is one
   * module-scoped store shared by every editor that mounts, which was fine when
   * `/` was the only one — with a per-project editor, project A's media would
   * otherwise still be in the Assets panel of project B, draggable onto B's
   * timeline, and would pile up across every project opened in the session.
   */
  useEffect(() => {
    // Emptied even for a project that won't open: the library is module-scoped
    // and shared, so skipping this would leave the *previous* project's media
    // in the Assets panel of one the user can't edit at all.
    clearMediaLibrary()
    if (gated) {
      // Nothing more is coming for this project — a document that will not open
      // never gets a re-link. Anything waiting to write to the timeline should
      // stop waiting, and decide for itself what to do about a blocked editor.
      setDocumentReady(true)
      return clearMediaLibrary
    }
    let live = true

    void (async () => {
      // The stored snapshot first, and before the network. It holds thumbnails
      // and waveforms already decoded in an earlier session — including for
      // assets past the single page fetched below, which would otherwise come
      // back to a grey placeholder on every load. `beginImportUrl` dedupes on
      // `src`, so anything hydrated here is not fetched or re-probed again.
      await hydrate(referencedSrcsOf(engine.getProject()))
      if (!live) return
      try {
        const { data } = await getProjectAssetsPage(project.id, 1)
        if (!live) return
        await Promise.allSettled(
          data
            .filter((item) => item.type !== 'audio') // the Audio panel owns those
            .map((item) =>
              beginImportUrl(proxyGalleryAsset(item.url, item.type), {
                kind: item.type,
                name: shortAssetName(item.prompt),
                dimensions:
                  item.width && item.height
                    ? { width: item.width, height: item.height }
                    : undefined,
                analysis: (item.catalog as unknown as MediaAssetAnalysis) ?? undefined,
              }),
            ),
        )
      } catch {
        // The editor is fully usable without a pre-filled library; assets can
        // still be added from the workspace. Not worth an error banner.
      }
      // Runs even when the fetch failed: the clips still have to be checked for
      // media that cannot come back at all, and that answer does not depend on
      // the library.
      if (live) {
        relink()
        // The restore is complete: document loaded, media imported, references
        // repaired. After this point the timeline is the user's — and safe for
        // another bridge to write to. See `documentReady`.
        setDocumentReady(true)
      }
    })()

    return () => {
      live = false
      clearMediaLibrary()
    }
  }, [gated, project.id, relink, setDocumentReady, hydrate, engine])

  return null
}

/**
 * What a project's stored document turns into.
 *
 * Three outcomes, because two of them look identical on screen — an empty
 * editor — and only one of them is safe to save over.
 */
type Restore =
  /** Nothing stored yet. The empty editor is the truth; the first edit stores it. */
  | { kind: 'empty' }
  | { kind: 'ready'; project: EditorDocument }
  | { kind: 'refused'; reason: ProjectDocumentErrorCode }

function readRestore(document: unknown): Restore {
  if (!hasStoredDocument(document)) return { kind: 'empty' }
  try {
    return {
      kind: 'ready',
      // A track whose stored height is missing lands on the same height the
      // rest of this editor's lanes use, rather than the engine's bare default.
      project: readProjectDocument(document, { defaultTrackHeight: DEFAULT_TRACK_HEIGHT }),
    }
  } catch (err) {
    return {
      kind: 'refused',
      reason: err instanceof ProjectDocumentError ? err.code : 'unreadable',
    }
  }
}

/**
 * Empties the editor's media library.
 *
 * `useMediaLibraryStore` was written for one editor per page load and so has no
 * clear of its own — only `addAsset`/`removeAsset`/`updateAsset`/`getAsset`.
 * This walks its own `removeAsset` rather than reaching into `setState`, which
 * keeps the store's surface the only way its state moves; the list is never
 * longer than a page of project assets, so the cost is irrelevant.
 *
 * Object URLs are not revoked here, matching `removeAsset` itself: a locally
 * imported file's URL may still be baked into a clip in the composition being
 * torn down, and revoking it mid-teardown would break the render for the sake
 * of a few bytes.
 */
function clearMediaLibrary(): void {
  const { order, removeAsset } = useMediaLibraryStore.getState()
  for (const id of [...order]) removeAsset(id)
}
