'use client'

import { useSelectionStore, useTracksStore, type Clip } from '@elah/editor'

/**
 * The one selected text clip, or null.
 *
 * Null for a multi-selection as well as for an empty one: every caller acts on
 * a single clip, and silently picking the first of three would apply a template
 * to something the user did not point at.
 *
 * Shared rather than duplicated because two surfaces now answer the same
 * question — the properties panel, which edits the clip, and the AI composer,
 * which offers to style it. They must agree about what "the selected text clip"
 * means or the composer will offer to style a clip the panel is not showing.
 */
export function useSelectedTextClip(): Clip | null {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const clips = useTracksStore((s) => s.clips)

  if (selectedClipIds.size !== 1) return null
  const [id] = selectedClipIds
  for (const trackClips of Object.values(clips)) {
    const clip = trackClips.find((c) => c.id === id && c.type === 'text')
    if (clip) return clip
  }
  return null
}

/**
 * Every text clip on the timeline, in timeline order.
 *
 * The AI chat needs these to answer "change the text from Text 1 to ..." —
 * without them the only clip it can act on is whatever happens to be selected,
 * so naming an element by what it SAYS could not work and the request created a
 * second clip instead of editing the first.
 *
 * Ordered by start frame rather than by track, because that is the order the
 * user sees them in and the order that makes "the first title" mean something.
 */
export function useTextClips(): Clip[] {
  const clips = useTracksStore((s) => s.clips)
  return Object.values(clips)
    .flat()
    .filter((clip) => clip.type === 'text')
    .sort((a, b) => a.startFrame - b.startFrame)
}
