/**
 * Making room on a track that has none.
 *
 * `insertElement` places a clip into a GAP — `resolveDropPosition` moves it
 * clear of whatever is already there. That is right for a drag, and wrong for
 * "add a text element after the 2nd one": a few added elements leave a track
 * whose clips run back to back, so there is no gap anywhere and the request
 * lands in the only free space, the end.
 *
 * This computes the ripple instead: everything from the requested point onward
 * moves right by the new clip's length, and the new clip takes the space that
 * opens. That is what "insert after" means in every editor.
 *
 * Pure, and separate from the hook, because placement has been the source of
 * three bugs in a row and the arithmetic is the part worth testing without an
 * engine or a browser.
 */

export interface RippleClip {
  id: string
  startFrame: number
  durationFrames: number
}

export interface RippleShift {
  id: string
  startFrame: number
}

/**
 * The clips to move, rightmost first, to open `durationFrames` at `startFrame`.
 *
 * Ordered so a caller applying them one at a time never creates a transient
 * overlap: shifting left to right would push a clip onto the neighbour that has
 * not moved yet, which an engine validating overlaps could reject.
 *
 * `newClipId` is excluded — it is the thing being made room FOR, and shifting it
 * along with the rest would leave it exactly where it started.
 */
export function rippleShifts(
  clips: readonly RippleClip[],
  startFrame: number,
  newClipId: string,
  durationFrames: number,
): RippleShift[] {
  if (durationFrames <= 0) return []
  return clips
    .filter((clip) => clip.id !== newClipId && clip.startFrame >= startFrame)
    .sort((a, b) => b.startFrame - a.startFrame)
    .map((clip) => ({ id: clip.id, startFrame: clip.startFrame + durationFrames }))
}

/**
 * Somewhere the new clip can sit while the ripple runs.
 *
 * The clip has already been inserted, and `insertElement` put it in the only
 * gap — on a packed track, past the end. Shifting the others right then pushes
 * one of them straight onto it, and the engine rejects that: "Update would
 * cause clip X to overlap with Y".
 *
 * So it is parked beyond everything first, the others move, and it takes its
 * place last. One frame past the furthest end is enough — the shifts only ever
 * move clips right by `durationFrames`, and every clip being shifted started
 * left of the park position by at least that much.
 */
export function parkFrame(clips: readonly RippleClip[], durationFrames: number): number {
  const end = clips.reduce((max, clip) => Math.max(max, clip.startFrame + clip.durationFrames), 0)
  return end + Math.max(1, durationFrames)
}

/**
 * The frame a new clip can actually start on.
 *
 * A ripple moves clips that START at or after the insertion point. A clip that
 * STARTS BEFORE it and runs past it cannot be handled that way: shifting it
 * right by the new clip's length moves its start too, so it still covers the
 * insertion point and the new clip still lands inside it. Splitting it is the
 * other answer, and is not something a text request should do silently.
 *
 * So the insertion point moves instead, to just after the clip it fell inside.
 * "Add a caption at five seconds" over a title running from zero to ten puts the
 * caption after the title, which is the readable outcome and the one that does
 * not destroy anything.
 *
 * Only reachable through an absolute time (`placeAtSec`). "After the 2nd
 * element" is already an end frame, so nothing straddles it.
 */
export function resolveInsertFrame(
  clips: readonly RippleClip[],
  desired: number,
  newClipId: string,
): number {
  const straddling = clips
    .filter(
      (clip) =>
        clip.id !== newClipId &&
        clip.startFrame < desired &&
        clip.startFrame + clip.durationFrames > desired,
    )
    // The furthest end wins: overlapping clips on one track are possible in a
    // stored document even though the editor does not create them, and clearing
    // the nearest would still leave the new clip inside another.
    .reduce((max, clip) => Math.max(max, clip.startFrame + clip.durationFrames), 0)

  return straddling > 0 ? straddling : desired
}
