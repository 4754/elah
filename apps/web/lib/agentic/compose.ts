import {
  secondsToFrames,
  transformFromCoverRect,
  usePlaybackStore,
  useMediaLibraryStore,
  type TimelineEngine,
  type TimelineRef,
  type Transform,
} from '@elah/editor'
import type { RefObject } from 'react'
import { useAIWorkspaceStore } from '../ai-workspace/store'
import type { Shot } from './types'

/**
 * Lays a finished run's media onto the timeline.
 *
 * Structurally this is `loadPixabayTopic` (see
 * `components/playground/production/loadRandomPixabay.ts`) with generated
 * assets instead of stock ones: one `engine.batch` that clears the lanes this
 * composer owns, places the visuals in plan order with fade transitions, and
 * writes the shot captions onto a captions lane of its own. Everything happens
 * inside the single batch so Ctrl+Z removes the whole reel as one entry.
 *
 * Ownership is narrow and explicit. The composer owns exactly two things: the
 * video lane, and the captions lane *it* created (recorded in
 * `useAIWorkspaceStore.captionTrackIds`). It never writes into — let alone
 * clears — an elements lane it did not make: the editor ships a default
 * Elements lane and the user can add more, so "every elements track" is other
 * people's work. That also keeps `captionTrackIds` honest, which is what lets
 * the subtitles step remove the caption lane wholesale.
 *
 * Deliberately does NOT touch the audio (Voice over) track — that lane belongs
 * to the voice-over step, which runs later and clears it itself.
 */

/** 400ms transition / fade at the project fps — same feel as the stock loader. */
const FADE_MS = 400

/** Captions sit inset from the clip edges so a fade never clips the first word. */
const CAPTION_PAD_SEC = 0.3

/**
 * Normalized stage positions for caption copy, cycled shot by shot. Vertical
 * (9:16) so the safe area is narrow — everything stays near the centre column,
 * alternating low/high so consecutive captions don't stack on top of each other.
 */
const CAPTION_PLACEMENTS: Array<{ x: number; y: number }> = [
  { x: 0.5, y: 0.8 },
  { x: 0.5, y: 0.2 },
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 0.74 },
  { x: 0.5, y: 0.26 },
]

/** The hook line gets the hero size; everything after is a kicker. */
const HERO_FONT_SIZE = 72
const KICKER_FONT_SIZE = 46

function makeTransform(x: number, y: number): Transform {
  return { x, y, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
}

/** One shot's finished media, paired back up with the shot that planned it. */
export interface ComposedShot {
  shot: Shot
  assetId: string
}

export interface ComposeDeps {
  engine: TimelineEngine
  timelineRef: RefObject<TimelineRef | null>
  title: string
  composed: ComposedShot[]
  /**
   * Height for the captions lane this composer creates. Supplied by the
   * caller (`FIXED_TRACK_HEIGHT`) rather than imported, so this module stays
   * free of component-layer imports — the same value `useGenerateSubtitles`
   * gives its lanes, so captions and subtitles read as peers.
   */
  captionTrackHeight?: number
}

/**
 * Composes the reel and rewinds the timeline to its start. Returns the reel's
 * total length in frames so the caller can report it; returns 0 (and does
 * nothing) when every shot failed.
 */
export function composeReel({
  engine,
  timelineRef,
  title,
  composed,
  captionTrackHeight,
}: ComposeDeps): number {
  if (composed.length === 0) return 0

  const project = engine.getProject()
  const { fps, stage } = project
  const fadeFrames = Math.max(2, secondsToFrames(FADE_MS / 1000, fps))

  const videoTrack = project.tracks.find((t) => t.kind === 'video')
  if (!videoTrack) {
    throw new Error('This project has no Video / Image track.')
  }

  const hasCaptions = composed.some((c) => c.shot.caption)

  /**
   * Caption lanes an *earlier* run of this composer created — the only
   * elements tracks it is entitled to tear down. Taken from the store rather
   * than inferred from `kind === 'elements'`, which would sweep up the default
   * Elements lane and any lane the user added. Filtered against the live
   * project because these ids outlive the project they were recorded against:
   * the user can delete the lane by hand, and opening another project swaps
   * every track without resetting this store.
   */
  const priorCaptionTrackIds = new Set(useAIWorkspaceStore.getState().captionTrackIds)
  const ownedCaptionTracks = project.tracks.filter((t) => priorCaptionTrackIds.has(t.id))

  // Assets are read outside the batch: the batch recipe is synchronous and
  // this is a store read, not a mutation.
  const getAsset = useMediaLibraryStore.getState().getAsset

  let totalFrames = 0
  // Only the lane this call creates itself — never a pre-existing elements
  // track, which may belong to the user and must not be torn down later.
  let createdCaptionTrackIds: string[] = []

  engine.batch(() => {
    // This composer owns the video lane. Re-running (a second agentic run, or
    // a retry) must clear it first — the new clips start back at frame 0 and
    // would otherwise collide, which `addClip` rejects.
    for (const clip of engine.getClipsOnTrack(videoTrack.id)) {
      engine.removeClip(clip.id, videoTrack.id)
    }

    // ...and the caption lanes it made last time, which go away with their
    // clips. Removing the lane rather than emptying it keeps the lane count
    // stable across re-runs instead of stacking a new "Captions" every time.
    for (const track of ownedCaptionTracks) {
      engine.removeTrack(track.id)
    }

    // Captions always land on a lane this call makes for them, even when the
    // project already has elements lanes: writing into someone else's lane is
    // what made the clearing above destructive, and it is what left
    // `captionTrackIds` empty so the subtitles step had nothing to remove.
    // Created inside the batch so undo takes the lane with the reel rather
    // than leaving an empty track behind.
    const captionTrack = hasCaptions
      ? engine.addTrack('elements', {
          name: 'Captions',
          ...(captionTrackHeight ? { height: captionTrackHeight } : {}),
        })
      : null

    createdCaptionTrackIds = captionTrack ? [captionTrack.id] : []

    // --- VISUAL LANE -------------------------------------------------------
    let cursor = 0
    const clipIds: string[] = []
    const placed: Array<{ start: number; duration: number; caption?: string }> = []

    for (const { shot, assetId } of composed) {
      const asset = getAsset(assetId)
      if (!asset) continue

      const desiredFrames = Math.max(1, secondsToFrames(shot.durationSec, fps))
      // A still holds for as long as the plan says; a video can only show what
      // it actually generated, so trim to the source when it came back short.
      // `runMediaJob` awaits the real probe for motion shots before a clip
      // ever reaches this function (see importGeneratedMedia's awaitMetadata),
      // so `asset.status === 'pending'` here is a defensive fallback only —
      // e.g. a probe failure, or a future caller that skips that wait — not
      // the expected path. Nothing resizes this clip later if it stays
      // pending, so trust the plan's duration in that case rather than a
      // fallback value.
      const durationFrames =
        shot.kind === 'motion' && asset.status !== 'pending' && asset.durationSec > 0
          ? Math.min(desiredFrames, Math.max(1, secondsToFrames(asset.durationSec, fps)))
          : desiredFrames

      const clip = engine.addClip({
        trackId: videoTrack.id,
        type: shot.kind === 'motion' ? 'video' : 'image',
        name: asset.name,
        startFrame: cursor,
        durationFrames,
        src: asset.src,
        assetId: asset.id,
        transform: transformFromCoverRect(
          asset.width ?? stage.width,
          asset.height ?? stage.height,
          stage.width,
          stage.height,
        ),
      })
      clipIds.push(clip.id)
      placed.push({ start: cursor, duration: durationFrames, caption: shot.caption })
      cursor += durationFrames
    }

    totalFrames = cursor

    // --- FADES between every adjacent visual --------------------------------
    for (let i = 0; i < clipIds.length - 1; i++) {
      engine.addTransition({
        fromClipId: clipIds[i],
        toClipId: clipIds[i + 1],
        trackId: videoTrack.id,
        kind: 'fade',
        durationFrames: fadeFrames,
        easing: 'ease-out',
      })
    }

    // --- CAPTIONS on this composer's own lane -------------------------------
    // `captionTrack` is null exactly when no shot carried caption copy, so
    // there is nothing to place and no empty lane was forced on the user.
    // One lane is enough: consecutive captions can't overlap while shots stay
    // at their planned length (`STILL_DURATION_RANGE.min` is 3s and the
    // minimum caption is `fadeFrames * 2 + 1` frames), and the vertical
    // variation readers see comes from CAPTION_PLACEMENTS, not from the lane.
    if (captionTrack) {
      let captionIndex = 0
      for (const slot of placed) {
        if (!slot.caption) continue
        const pad = Math.round(fps * CAPTION_PAD_SEC)
        const start = slot.start + pad
        const duration = Math.max(fadeFrames * 2 + 1, slot.duration - pad * 2)
        const { x, y } = CAPTION_PLACEMENTS[captionIndex % CAPTION_PLACEMENTS.length]

        const created = engine.addClip({
          trackId: captionTrack.id,
          type: 'text',
          name: slot.caption,
          startFrame: start,
          durationFrames: duration,
          opacity: 0.92,
          transform: makeTransform(x, y),
          text: {
            content: slot.caption,
            fontSize: captionIndex === 0 ? HERO_FONT_SIZE : KICKER_FONT_SIZE,
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontWeight: 'bold',
            textAlign: 'center',
          },
        })
        engine.updateClip(created.id, captionTrack.id, {
          textAnimation: { in: 'fade', out: 'fade', durationFrames: fadeFrames },
        })
        captionIndex += 1
      }
    }
  }, `Agentic AI — ${title}`)

  // The subtitles step (`useGenerateSubtitles`) removes these lanes when it
  // places its own, so a finished run doesn't end with both the per-shot
  // captions and the narration subtitles rendering at once. Safe to remove
  // wholesale precisely because the list only ever holds lanes this function
  // created. Written unconditionally: an empty list is the correct record for
  // a run with no caption copy, and it retires the ids of the lanes removed
  // above.
  useAIWorkspaceStore.getState().setCaptionTrackIds(createdCaptionTrackIds)

  // --- Post-compose: rewind and fit the new reel into view -----------------
  const playback = usePlaybackStore.getState()
  playback.pause()
  playback.setCurrentFrame(0)
  requestAnimationFrame(() => {
    timelineRef.current?.fitToWindow()
  })

  return totalFrames
}
