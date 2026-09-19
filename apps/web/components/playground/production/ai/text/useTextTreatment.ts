'use client'

import { useCallback } from 'react'
import { insertElement, useTimelineEngine, type Clip } from '@elah/editor'
import { useAIWorkspaceStore } from '@/lib/ai-workspace/store'
import { useTextTreatmentStore } from '@/lib/text/treatment.store'
import { parkFrame, resolveInsertFrame, rippleShifts } from '@/lib/text/ripple'
import { patchForSuggestion, type TreatmentSuggestion } from '@/lib/text/treatment'

/**
 * Runs one text turn from the chat: two transcript entries and one request.
 *
 * Shaped like `runPlainGeneration` in `ChatComposer` — a user bubble, then a
 * card that fills in when the answer lands — so a text turn reads as part of
 * the same conversation rather than as a panel that happens to sit nearby.
 *
 * Two modes, decided by whether a text clip is selected rather than by a toggle
 * the user has to find first:
 *
 *   create  — nothing selected. The model writes the words AND picks a look,
 *             and the card offers "Add to editor". Nothing touches the timeline
 *             until the user accepts, which is what makes a misrouted message
 *             cost a click rather than an edit.
 *   restyle — a text clip is selected. The words are the user's and are never
 *             rewritten; only the look changes.
 *
 * The request never rejects. `/api/ai/text-treatment` is fail-soft by design
 * (see its header): no key, a timeout or an unusable model response all return
 * ranked suggestions with `source: 'deterministic'`. So the error branch here
 * is for the request itself failing — offline, a 500, a body that is not JSON.
 */
export function useTextTreatment() {
  const engine = useTimelineEngine()
  const appendMessage = useAIWorkspaceStore((s) => s.appendMessage)
  const start = useTextTreatmentStore((s) => s.start)
  const resolve = useTextTreatmentStore((s) => s.resolve)
  const fail = useTextTreatmentStore((s) => s.fail)
  const markApplied = useTextTreatmentStore((s) => s.markApplied)

  return useCallback(
    async (
      description: string,
      textClips: readonly Clip[],
      selected: Clip | null,
      appliedByClip: Record<string, string>,
    ) => {
      const id = crypto.randomUUID()

      appendMessage({ id: `${id}-u`, role: 'user', text: description })
      // Mode is provisional until the model says which element it means. It is
      // recorded now only so the card can render something while the request is
      // in flight.
      start({
        id,
        description,
        mode: selected ? 'restyle' : 'create',
        clipId: selected?.id,
        trackId: selected?.trackId,
        clipText: selected && typeof selected.content === 'string' ? selected.content : '',
      })
      appendMessage({ id: `${id}-a`, role: 'assistant', text: '', card: 'text-treatment', treatmentId: id })

      try {
        const res = await fetch('/api/ai/text-treatment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description,
            // Everything on the timeline, so a request can name an element by
            // what it says. `selected` is a hint, not the answer — a name the
            // user gave beats it.
            // Already in timeline order (`useTextClips` sorts by start frame), which
            // is what makes the index the route assigns mean "the first one".
            existingText: textClips.map((candidate) => ({
              id: candidate.id,
              startSec: candidate.startFrame / (engine.getProject().fps || 30),
              text: typeof candidate.content === 'string' ? candidate.content : '',
              selected: candidate.id === selected?.id,
            })),
            // Shapes the shortlist and the ramp. The selected clip when there
            // is one, otherwise just the project frame rate.
            clip: {
              text: selected && typeof selected.content === 'string' ? selected.content : '',
              durationFrames: selected?.durationFrames,
              fps: engine.getProject().fps,
            },
            // Present only when a template is already on the selected clip,
            // which is what turns "choose me a look" into "adjust the one I
            // have". The route resolves it against the catalogue.
            current: selected && appliedByClip[selected.id] ? { templateId: appliedByClip[selected.id] } : undefined,
          }),
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          fail(id, body.error ?? 'Could not suggest a look.')
          return
        }

        const body = (await res.json()) as {
          suggestions?: TreatmentSuggestion[]
          source?: 'model' | 'deterministic'
          copy?: string
          /** The element to change, or null for a new one. Never absent — see the route. */
          targetId?: string | null
          changesLook?: boolean
          placeAfterId?: string | null
          placeAtSec?: number | null
        }
        const suggestions = Array.isArray(body.suggestions) ? body.suggestions : []
        if (suggestions.length === 0) {
          fail(id, 'Could not suggest a look.')
          return
        }
        /**
         * Which element this turn is about.
         *
         * The model's `targetId` decides, not the selection. That is the whole
         * point of sending the timeline's text: "change the text from Text 1 to
         * X" names an element by its words, and keying off the selection made
         * that request create a second element instead of editing the first.
         *
         * Falls back to the selection when the model named nothing, which is
         * also what the deterministic path returns.
         */
        const acting = body.targetId
          ? (textClips.find((candidate) => candidate.id === body.targetId) ?? null)
          : null

        /**
         * Where a new element starts, in frames.
         *
         * Resolved here, against the timeline as this request saw it: "after
         * the 2nd element" means after the clip that was second when the user
         * asked, not whichever is second by the time they press Add.
         *
         * Undefined leaves `insertElement` to its own rule — the playhead —
         * which is where dragging an element in puts it.
         */
        const fps = engine.getProject().fps || 30
        const after = body.placeAfterId
          ? textClips.find((candidate) => candidate.id === body.placeAfterId)
          : undefined
        const startFrame = after
          ? after.startFrame + after.durationFrames
          : typeof body.placeAtSec === 'number'
            ? Math.max(0, Math.round(body.placeAtSec * fps))
            : undefined

        resolve(id, {
          startFrame,
          suggestions,
          source: body.source === 'model' ? 'model' : 'deterministic',
          copy: body.copy,
          // Defaults true: hiding the looks on a turn that did want a restyle
          // leaves no way to apply one, which is worse than an extra choice.
          changesLook: body.changesLook !== false,
          mode: acting ? 'restyle' : 'create',
          clipId: acting?.id,
          trackId: acting?.trackId,
          clipText: acting && typeof acting.content === 'string' ? acting.content : '',
        })

        /**
         * An adjustment applies itself.
         *
         * "Make it bigger" is an instruction, not a question. Answering it with
         * three cards to choose between asks the user to re-pick the template
         * they just said they liked, and leaves the size unchanged until they
         * do.
         *
         * Gated on all of: a clip is selected, a template was already applied,
         * the model's first pick is that same template (wanting to switch is a
         * suggestion the user should decide, not an adjustment), and it
         * actually asked to change something.
         *
         * Never on a create — nothing may reach the timeline before the user
         * presses Add.
         */
        // A wording-only turn has nothing to adjust — the look is untouched by
        // definition, so there is no automatic apply to consider.
        if (body.changesLook === false) return

        const [top] = suggestions
        const currentTemplateId = acting ? appliedByClip[acting.id] : undefined
        const adjustsCurrent =
          Boolean(currentTemplateId) &&
          top?.kind === 'template' &&
          top.templateId === currentTemplateId &&
          Object.keys(top.overrides).length > 0 &&
          // A wording change is never automatic. "Make it bigger" is safe to
          // just do — the old size is one undo away and obvious. Replacing what
          // the text SAYS is not: the user has to see the new words first, so a
          // response carrying copy always waits for a press.
          !body.copy

        if (acting && adjustsCurrent) {
          const patch = patchForSuggestion(top, acting)
          if (patch) {
            engine.updateClip(acting.id, acting.trackId, patch)
            markApplied(id, top.id)
          }
        }
      } catch (err) {
        // An aborted request is the user navigating away, not a failure worth
        // showing — but the card is already in the transcript, so it needs some
        // terminal state either way.
        fail(id, err instanceof Error ? err.message : 'Could not suggest a look.')
      }
    },
    [engine, appendMessage, start, resolve, fail, markApplied],
  )
}

/**
 * Apply a suggestion to a clip that already exists.
 *
 * Separate from `useAddTextFromSuggestion` because the two do different things:
 * this one edits, that one creates. Both write look and words in a single
 * `updateClip` so either is one undo step.
 *
 * `copy` is only passed when the user asked for the wording to change. Omitting
 * it leaves `content` out of the patch entirely, which is what keeps an
 * ordinary restyle from touching their words.
 */
export function useApplySuggestionToClip() {
  const engine = useTimelineEngine()
  const markApplied = useTextTreatmentStore((s) => s.markApplied)

  return useCallback(
    (requestId: string, suggestion: TreatmentSuggestion, clip: Clip, copy?: string) => {
      const patch = patchForSuggestion(suggestion, clip)
      if (!patch) return
      engine.updateClip(clip.id, clip.trackId, copy ? { ...patch, content: copy } : patch)
      markApplied(requestId, suggestion.id)
    },
    [engine, markApplied],
  )
}

/**
 * Change what an element says, without touching how it looks.
 *
 * The whole point of the words-only path: `content` is the only field in the
 * patch, so accepting new wording cannot restyle an element the user was happy
 * with. `markApplied` is deliberately not called — no template was chosen, and
 * recording one would make the next "make it bigger" adjust a look this turn
 * never picked.
 */
export function useApplyCopyToClip() {
  const engine = useTimelineEngine()

  return useCallback(
    (clip: Clip, copy: string) => {
      engine.updateClip(clip.id, clip.trackId, { content: copy })
    },
    [engine],
  )
}

export function useAddTextFromSuggestion() {
  const engine = useTimelineEngine()
  const attachClip = useTextTreatmentStore((s) => s.attachClip)
  const markApplied = useTextTreatmentStore((s) => s.markApplied)

  return useCallback(
    (requestId: string, suggestion: TreatmentSuggestion, copy: string, startFrame?: number): boolean => {
      // Written inside the `batch` callback, so the type has to be declared
      // rather than inferred from the initialiser — TS narrows it to `never`
      // otherwise, not seeing that the callback runs synchronously.
      let created: { clipId: string; trackId: string } | null = null

      engine.batch(() => {
        const result = insertElement(
          engine,
          { kind: 'element', element: 'text' },
          startFrame === undefined ? {} : { desiredStartFrame: startFrame },
        )
        if (!result.ok || result.clipIds.length === 0) return

        const clipId = result.clipIds[0]
        const trackId = result.trackId
        // Read the clip back rather than assuming its shape: the one that
        // landed carries the real `durationFrames`, and that is what the
        // template's ramp has to be resolved against — and what the ripple
        // below has to shift by.
        const clip = (engine.getProject().clips[trackId] ?? []).find(
          (candidate) => candidate.id === clipId,
        )
        if (!clip) return

        /**
         * Make room, when the user said where.
         *
         * `insertElement` places into a GAP: `resolveDropPosition` moves the
         * clip clear of whatever is already on the track. On a track whose
         * clips run back to back — which is what a few "add text" turns
         * produces — there is no gap anywhere, so "after the 2nd element" got
         * pushed to the only free space, the end. That is the bug this fixes.
         *
         * Everything from the requested point onward moves right by the new
         * clip's length, and the new clip takes the space that opens. A ripple,
         * which is what "insert after" means in every editor.
         *
         * Rightmost first: shifting left-to-right would briefly overlap the
         * neighbour that has not moved yet.
         */
        if (startFrame !== undefined) {
          const onTrack = engine.getProject().clips[trackId] ?? []

          // A ripple can only move clips that start at or after the insertion
          // point, so a clip running THROUGH it has to be stepped over instead —
          // see `resolveInsertFrame`. Only an absolute time can land inside one.
          const at = resolveInsertFrame(onTrack, startFrame, clipId)

          if (clip.startFrame !== at) {
            // The new clip is sitting in whatever gap `insertElement` found —
            // past the end, on a packed track. Shifting the others right would
            // push one onto it and the engine refuses ("Update would cause clip
            // X to overlap with Y"), so it moves clear before anything else.
            engine.updateClip(clipId, trackId, { startFrame: parkFrame(onTrack, clip.durationFrames) })

            for (const shift of rippleShifts(onTrack, at, clipId, clip.durationFrames)) {
              engine.updateClip(shift.id, trackId, { startFrame: shift.startFrame })
            }
            engine.updateClip(clipId, trackId, { startFrame: at })
          }
        }

        const patch = patchForSuggestion(suggestion, clip)
        engine.updateClip(clipId, trackId, { ...(patch ?? {}), content: copy })
        created = { clipId, trackId }
      }, 'Add text')

      const result = created as { clipId: string; trackId: string } | null
      if (!result) return false
      attachClip(requestId, result.clipId, result.trackId)
      markApplied(requestId, suggestion.id)
      return true
    },
    [engine, attachClip, markApplied],
  )
}
