import { create } from 'zustand'
import type { TreatmentSuggestion } from './treatment'

/**
 * One "style this text" turn, keyed so a chat card can find its own.
 *
 * The agentic cards in this panel deliberately carry no data — `AgenticCard`'s
 * header explains why: they read the single live run, so a card scrolled ten
 * messages up still shows the plan *as it stands now* rather than a snapshot.
 *
 * This store is keyed by request id instead, because text treatment is the
 * opposite case. There is no single live run: a user styles one clip, scrolls
 * up, styles another, and both cards must keep showing their own suggestions.
 * A shared "current" slot would repoint the older card at the newer answer,
 * which is exactly the bug the agentic design is avoiding — the same goal
 * reached by opposite means, because the thing being displayed has different
 * lifetime.
 *
 * Entries are never evicted. One request is a handful of strings, they only
 * accumulate while the panel is open, and dropping one would blank a card that
 * is still on screen.
 */

export type TreatmentStatus = 'loading' | 'ready' | 'error'

export interface TreatmentRequest {
  id: string
  /** What the user typed. Echoed on the card so a scrolled-up answer still explains itself. */
  description: string
  status: TreatmentStatus
  /**
   * Creating a new text element, or restyling one that already exists.
   *
   * A create card has no clip to point at until the user accepts it, which is
   * why `clipId`/`trackId` are optional and why the card's action is "Add to
   * editor" rather than an immediate edit.
   */
  mode: 'create' | 'restyle'
  /** Which clip this styles. Absent on a create until one is added. */
  clipId?: string
  trackId?: string
  /** The clip's text at request time — for the card's heading, not for editing. */
  clipText: string
  /** The words the model wrote, on a create. The user's own words are never rewritten. */
  copy?: string
  /**
   * Whether this turn is about the look.
   *
   * False on a pure wording change, where the card offers only "Change text" —
   * three looks to choose from would mean the user cannot accept new words
   * without also restyling an element they were happy with.
   */
  changesLook: boolean
  /**
   * Where a new element should start, in frames.
   *
   * Resolved when the answer arrives rather than when Add is pressed, because
   * it is derived from the timeline as the request saw it — "after the 2nd
   * element" means after the clip that was second then.
   */
  startFrame?: number
  suggestions: TreatmentSuggestion[]
  /**
   * Whether the answer came from the model or the deterministic scorer.
   *
   * Surfaced quietly on the card rather than hidden: the fallback is a genuinely
   * worse answer (keyword ranking, no bounded tweaks), and a user who gets one
   * silently has no way to know that retrying might do better.
   */
  source?: 'model' | 'deterministic'
  /** Set once the user applies one, so the card can show which is live. */
  appliedTemplateId?: string
  error?: string
}

interface TreatmentState {
  requests: Record<string, TreatmentRequest>
  /**
   * The template this app last applied to a given clip.
   *
   * A `Clip` stores the fields a template set but not which template set them,
   * and deriving it backwards from font and motion would guess wrong the moment
   * an author nudges anything. So this records only what we know first-hand:
   * what the user applied from a suggestion card.
   *
   * Its one job is telling "choose me a look" apart from "adjust the one I
   * have". A clip styled from the properties panel's grid is absent here and is
   * treated as a fresh choice — the worse of the two answers, but an honest one,
   * where a guess could silently refuse to change a template the user never had.
   */
  appliedByClip: Record<string, string>
  start: (
    request: Pick<TreatmentRequest, 'id' | 'description' | 'mode' | 'clipId' | 'trackId' | 'clipText'>,
  ) => void
  /**
   * Fills in the answer, INCLUDING which element it turned out to be about.
   *
   * The target is not known until the model replies — it reads the timeline's
   * text and names the element the user meant, which is often not the selected
   * one. So `start` records a provisional target and this corrects it.
   */
  resolve: (
    id: string,
    result: {
      suggestions: TreatmentSuggestion[]
      source: 'model' | 'deterministic'
      copy?: string
      changesLook: boolean
      startFrame?: number
      mode: 'create' | 'restyle'
      clipId?: string
      trackId?: string
      clipText: string
    },
  ) => void
  /** Records the clip a create card produced, so its rows can restyle it afterwards. */
  attachClip: (id: string, clipId: string, trackId: string) => void
  fail: (id: string, error: string) => void
  markApplied: (id: string, templateId: string) => void
}

/** Patch one request, ignoring ids that are gone rather than resurrecting them. */
function patch(id: string, updates: Partial<TreatmentRequest>) {
  return (s: TreatmentState) => {
    const existing = s.requests[id]
    if (!existing) return s
    return { requests: { ...s.requests, [id]: { ...existing, ...updates } } }
  }
}

export const useTextTreatmentStore = create<TreatmentState>((set) => ({
  requests: {},
  appliedByClip: {},

  start: (request) =>
    set((s) => ({
      requests: {
        ...s.requests,
        [request.id]: { ...request, status: 'loading', suggestions: [], changesLook: true },
      },
    })),

  resolve: (id, { suggestions, source, copy, changesLook, startFrame, mode, clipId, trackId, clipText }) =>
    set(
      patch(id, {
        status: 'ready',
        suggestions,
        source,
        copy,
        changesLook,
        startFrame,
        mode,
        clipId,
        trackId,
        clipText,
      }),
    ),

  attachClip: (id, clipId, trackId) => set(patch(id, { clipId, trackId })),

  fail: (id, error) => set(patch(id, { status: 'error', error })),

  // Deliberately not cleared when another request is applied elsewhere: two
  // cards can each show an applied badge, because each styled a different clip
  // and both statements remain true.
  markApplied: (id, templateId) =>
    set((s) => {
      const existing = s.requests[id]
      if (!existing) return s
      return {
        requests: { ...s.requests, [id]: { ...existing, appliedTemplateId: templateId } },
        appliedByClip: existing.clipId
          ? { ...s.appliedByClip, [existing.clipId]: templateId }
          : s.appliedByClip,
      }
    }),
}))
