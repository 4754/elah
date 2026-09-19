'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { useTimelineEngine, type TimelineRef } from '@elah/editor'
import { importGeneratedMedia } from '@/lib/ai-workspace/adapter'
import { composeReel, type ComposedShot } from '@/lib/agentic/compose'
import { clearPendingStoryboard, readPendingStoryboard } from '@/lib/storyboard/handoff'
import { localStoryboardRepository } from '@/lib/storyboard/repository'
import { sceneMedia, sceneToShot } from '@/lib/storyboard/toShots'
import { FIXED_TRACK_HEIGHT } from './trackConstants'
import { useProjectSaveStore } from './projectSave.store'

/**
 * Lays a storyboard sent from Ad Studio onto this project's timeline.
 *
 * The receiving half of "Send to editor". The workflow surface has no
 * `TimelineEngine` — by design; there is no timeline behind a wizard step — so
 * the handoff is a navigation plus a pointer in storage, and this is what picks
 * the pointer up. See `lib/storyboard/handoff.ts` for why it is not a headless
 * `PUT /projects/:id/document`.
 *
 * Headless, and mounted **inside** `EditorProvider` alongside
 * `ProjectDocumentBridge` — the engine comes from that context.
 *
 * Three things make this safe to run on open:
 *
 *  1. **It waits for `documentReady`.** Composing before the restore would be
 *     overwritten by it; composing before the media re-link would let that
 *     pass's `rebase` mark a brand-new reel as already saved on the server.
 *  2. **It checks the project.** A record written for another project is
 *     discarded rather than composed — laying one film into another project's
 *     timeline is the worst thing this could do, and it would autosave.
 *  3. **It clears the record only on success.** A failure leaves it, so a reload
 *     retries rather than silently losing the arrangement the user built.
 *
 * The composition itself is `composeReel`, unchanged and shared with the
 * editor's own agentic runs: clips in order, 400ms fades between them, narration
 * spread across the caption lanes, all inside one `engine.batch` so Ctrl+Z
 * removes the whole reel as a single entry. Autosave then persists it through
 * the editor's own pipeline, which is the only writer.
 */
export function StoryboardComposeBridge({
  projectId,
  timelineRef,
}: {
  projectId: string
  timelineRef: RefObject<TimelineRef | null>
}) {
  const engine = useTimelineEngine()
  const documentReady = useProjectSaveStore((s) => s.documentReady)

  // Module-scoped stores and a remount-happy editor mean this could otherwise
  // run twice for one record — and the second run would compose over the first,
  // which `composeReel` handles but which would also cost a second import of
  // every clip.
  const composed = useRef(false)

  useEffect(() => {
    if (!documentReady || composed.current) return

    const record = readPendingStoryboard()
    if (!record) return

    // Not ours. Left in place rather than cleared: the editor for the project it
    // *is* for has not opened yet, and clearing here would lose the handoff.
    if (record.projectId !== projectId) return

    const storyboard = localStoryboardRepository()
      .list()
      .find((board) => board.id === record.storyboardId)
    if (!storyboard) {
      // The record points at nothing — the storyboard was deleted between the
      // click and the mount. Nothing to retry, so the record goes.
      clearPendingStoryboard()
      return
    }

    composed.current = true
    let live = true

    void (async () => {
      try {
        const shots: ComposedShot[] = []

        for (const scene of storyboard.scenes) {
          const media = sceneMedia(scene)
          // A motion scene the render never reached. Skipped rather than
          // failing the whole reel — the footer gates on every scene being
          // ready, so reaching here means the storyboard changed underneath.
          if (!media) continue

          const asset = await importGeneratedMedia(
            { url: media.url },
            media.kind,
            media.name,
            // The probe is what protects against `durationSec === 0`: a clip
            // whose analysis pass never landed would otherwise be placed at its
            // planned length with nothing to correct it later. `composeReel`
            // trims to the probed duration once this resolves.
            { awaitMetadata: true },
          )

          shots.push({ shot: sceneToShot(scene), assetId: asset.id })
        }

        // Navigated away mid-import. The record is deliberately left alone so
        // coming back composes rather than losing the film.
        if (!live) {
          composed.current = false
          return
        }

        if (shots.length === 0) {
          clearPendingStoryboard()
          return
        }

        composeReel({
          engine,
          timelineRef,
          title: storyboard.title,
          composed: shots,
          captionTrackHeight: FIXED_TRACK_HEIGHT,
        })

        // Only now — a cleared record with no reel on the timeline is the one
        // outcome the user could neither see nor recover.
        clearPendingStoryboard()
      } catch {
        // Left for a reload to retry. Nothing is reported here because the
        // editor behind this is fully usable and the assets are all in the
        // media panel: the user can place them by hand, which is exactly what
        // they did before this bridge existed.
        composed.current = false
      }
    })()

    return () => {
      live = false
    }
  }, [documentReady, projectId, engine, timelineRef])

  return null
}

export default StoryboardComposeBridge
