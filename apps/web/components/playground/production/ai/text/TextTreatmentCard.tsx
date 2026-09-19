'use client'

import { useState } from 'react'
import { Check, Type } from 'lucide-react'
import { useTracksStore } from '@elah/editor'
import { cn } from '@/lib/utils'
import { patchForSuggestion } from '@/lib/text/treatment'
import { useTextTreatmentStore } from '@/lib/text/treatment.store'
import { CardError, CardShell, PrimaryAction, ThinkingRow } from '../agentic/CardShell'
import { useAddTextFromSuggestion, useApplyCopyToClip, useApplySuggestionToClip } from './useTextTreatment'

/**
 * The answer to one text turn: add an element, restyle one, or reword one.
 *
 * Which of those it renders depends on what the model decided, not on a prop —
 * `mode` says whether an element exists yet, and `changesLook` whether the
 * request was about appearance at all. A wording change shows the new words and
 * a single action; everything else shows three looks to choose between.
 *
 * Unlike the agentic cards beside it, this one is addressed by id — see the
 * header of `lib/text/treatment.store.ts` for why: several of these can sit in
 * one transcript, each about a different clip, and each has to keep showing its
 * own answer rather than the latest one.
 *
 * Applying is a single `updateClip`, which is what makes it one undo step. The
 * card stays interactive afterwards, so a user who dislikes their first choice
 * presses the second rather than re-typing the description — `applyTextTemplate`
 * is documented as replacing rather than accumulating, so switching between
 * suggestions is clean no matter how many times it happens.
 */
export function TextTreatmentCard({ requestId }: { requestId: string }) {
  const request = useTextTreatmentStore((s) => s.requests[requestId])
  const markApplied = useTextTreatmentStore((s) => s.markApplied)
  const addText = useAddTextFromSuggestion()
  const applyToClip = useApplySuggestionToClip()
  const applyCopy = useApplyCopyToClip()
  // Local, not in the store: this records that a button in THIS card was
  // pressed, which is card state. `markApplied` is about which template a clip
  // carries, and a wording change picks none.
  const [applied, setApplied] = useState(false)
  const clips = useTracksStore((s) => s.clips)

  if (!request) return null

  /**
   * The clip as it stands NOW, not as it was when the suggestion was made.
   *
   * The ramp is resolved against the clip's real length (`resolveTemplateRamp`),
   * so applying a suggestion to a clip the user has since trimmed must use the
   * new length or the entry never completes. Reading it live also means the card
   * can tell that the clip is gone.
   */
  const clip = request.trackId
    ? clips[request.trackId]?.find((candidate) => candidate.id === request.clipId)
    : undefined

  // On a create, the rows add the element; once added the card holds a clipId
  // and behaves exactly like a restyle card, so pressing a different row
  // changes the look of the clip that is already on the timeline.
  const creating = request.mode === 'create' && !clip

  /**
   * A turn about the words only.
   *
   * The looks are still in the response and are simply not shown: offering
   * three of them means the user cannot accept new wording without also
   * restyling an element they were happy with, which is the opposite of what
   * they asked for.
   */
  const wordsOnly = !request.changesLook && Boolean(request.copy) && Boolean(clip)

  return (
    <CardShell icon={Type} label="Text style">
      <p className="text-[12px] leading-relaxed text-ed-text-muted">
        <span className="text-ed-text">“{request.description}”</span>
        {request.clipText && <> for “{truncate(request.clipText)}”</>}
      </p>

      {/* The words. Shown before the looks because they are what the user is
          agreeing to put on screen — the look is how it is dressed, and picking
          a different row does not change them.

          Present on a restyle only when the user asked for the wording to
          change, which is why it is labelled: replacing text that is already on
          the timeline should never be something they discover afterwards. */}
      {request.copy && (
        <div className="rounded-lg border border-ed-border bg-ed-elevated px-2.5 py-2">
          {request.mode === 'restyle' && (
            <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ed-text-muted">
              New text
            </p>
          )}
          <p className="text-[13px] leading-snug text-ed-text">{request.copy}</p>
        </div>
      )}

      {request.status === 'loading' && <ThinkingRow label="Finding a look" />}

      {request.status === 'error' && <CardError message={request.error ?? 'Could not suggest a look.'} />}

      {/* A restyle card whose clip has since been deleted. A create card
          legitimately has no clip yet, hence the mode check. */}
      {request.status === 'ready' && !clip && request.mode === 'restyle' && (
        <CardError message="That text clip is no longer on the timeline." />
      )}

      {/* Nothing to place and no model to write it — the deterministic fallback
          ranks looks but cannot author words. Better to say so than to add an
          element that says "Text 1". */}
      {request.status === 'ready' && creating && !request.copy && (
        <CardError message="Could not write the text. Say what it should say and try again." />
      )}

      {/* Words only: one action, and it writes `content` and nothing else. */}
      {request.status === 'ready' && wordsOnly && clip && request.copy && (
        <>
          <PrimaryAction
            label={applied ? 'Changed' : 'Change text'}
            icon={applied ? Check : undefined}
            disabled={applied}
            onClick={() => {
              applyCopy(clip, request.copy!)
              setApplied(true)
            }}
          />
          <p className="text-[11px] text-ed-text-muted">
            {applied ? 'The wording is updated. The look is unchanged.' : 'Only the wording changes — the look stays as it is.'}
          </p>
        </>
      )}

      {request.status === 'ready' && !wordsOnly && (clip || (creating && request.copy)) && (
        <>
          <ul className="flex flex-col gap-1.5">
            {request.suggestions.map((suggestion) => {
              // No clip yet on a create, so there is nothing to patch against
              // until the element exists. The row is still offered — pressing
              // it is what creates the clip.
              const patch = clip ? patchForSuggestion(suggestion, clip) : null
              if (clip && !patch) return null
              const applied = request.appliedTemplateId === suggestion.id

              return (
                <li key={suggestion.id}>
                  <button
                    type="button"
                    // Applying is the card's action, so the whole row is the
                    // target rather than a small button at its edge.
                    onClick={() => {
                      if (clip) {
                        applyToClip(requestId, suggestion, clip, request.copy)
                        return
                      }
                      // First press on a create: the element does not exist
                      // yet, so this makes it. Afterwards the card holds a clip
                      // and takes the branch above.
                      if (request.copy) addText(requestId, suggestion, request.copy, request.startFrame)
                    }}
                    aria-pressed={applied}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      applied
                        ? 'border-ed-accent bg-ed-accent-soft'
                        : 'border-ed-border bg-ed-elevated hover:border-ed-text-muted',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-ed-text">
                      {suggestion.name}
                      {/* An authored look has no entry in the properties panel's
                          grid, so say where it came from — otherwise a name the
                          user cannot find anywhere reads as a bug. */}
                      {suggestion.kind === 'custom' && (
                        <span className="rounded-full border border-ed-border px-1.5 text-[10px] font-normal text-ed-text-muted">
                          made for you
                        </span>
                      )}
                      {applied && <Check size={12} className="text-ed-accent" aria-label="Applied" />}
                    </span>
                    <span className="text-[11.5px] leading-relaxed text-ed-text-muted">
                      {suggestion.reason}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* An adjustment applies itself (see useTextTreatment), so without this
              the only sign anything happened is a tick the user was not watching
              for. Says what changed AND that the other two remain live. */}
          {request.appliedTemplateId ? (
            <p className="text-[11px] text-ed-text-muted">
              {request.mode === 'create'
                ? 'Added to your timeline. Pick another to change the look.'
                : 'Applied to your text. Pick another to change it.'}
            </p>
          ) : (
            creating && <p className="text-[11px] text-ed-text-muted">Pick a look to add it to your timeline.</p>
          )}

          {/* The fallback is a genuinely worse answer — keyword ranking, no
              tweaks — so say so rather than passing it off as the model's. */}
          {request.source === 'deterministic' && (
            <p className="text-[11px] text-ed-text-muted">
              Matched by keyword — the AI suggestion was unavailable.
            </p>
          )}
        </>
      )}
    </CardShell>
  )
}

function truncate(value: string, max = 40): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

export default TextTreatmentCard
