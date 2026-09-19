'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { missingMediaSummary } from '@elah/editor'
import { Button, Dialog } from '@/components/ui'
import { autosaveLabel, isAutosaveProblem } from '@/lib/project-autosave'
import { buttonClass } from '@/lib/ui/styles'
import { cn } from '@/lib/utils'
import { useProjectSaveStore } from './projectSave.store'

/**
 * The autosave indicator in the editor header.
 *
 * Not decoration: for a user who has never seen this editor, it is the only
 * evidence their work exists anywhere but on the screen (V1 spec §4.4). So it
 * re-renders on a timer as well as on state changes — "Saved just now" that is
 * still claiming "just now" ten minutes later is worse than no indicator at
 * all. The tick is a minute, matching the coarsest unit the label can show
 * inside an hour.
 */
export function ProjectSaveIndicator() {
  const status = useProjectSaveStore((s) => s.status)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (status.kind !== 'saved') return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [status.kind])

  // Re-read the clock whenever the state itself moves, so "Saved just now"
  // appears immediately rather than at the next tick.
  useEffect(() => setNow(Date.now()), [status])

  const problem = isAutosaveProblem(status)

  return (
    <span
      // A save is progress, not news; a failure is worth interrupting for.
      role={problem ? 'alert' : 'status'}
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px]',
        problem ? 'text-ed-error' : 'text-ed-text-muted',
      )}
    >
      {status.kind === 'saving' && <Loader2 size={11} className="animate-spin" aria-hidden />}
      {status.kind === 'saved' && <Check size={11} aria-hidden />}
      {problem && <AlertTriangle size={11} aria-hidden />}
      {autosaveLabel(status, now)}
    </span>
  )
}

/**
 * What happens when the same project was saved somewhere else first.
 *
 * The server rejects the stale save rather than overwriting (409), which means
 * the *other* copy is the one that survived — so the only honest primary action
 * is to take it. Saying that plainly, and making the button that does it the
 * obvious one, is the whole dialog. There is deliberately no "save mine
 * anyway": it would silently discard whatever the other tab wrote, which is the
 * exact outcome the 409 exists to prevent.
 */
export function ProjectConflictDialog() {
  const status = useProjectSaveStore((s) => s.status)
  const reloading = useProjectSaveStore((s) => s.reloading)
  const reloadError = useProjectSaveStore((s) => s.reloadError)
  const reloadLatest = useProjectSaveStore((s) => s.reloadLatest)

  const open = status.kind === 'conflict'
  if (!open) return null

  return (
    <Dialog
      open
      // Not dismissible into a broken state: closing without reloading leaves
      // an editor that silently stops saving, so the close button re-runs the
      // same recovery the primary action does.
      onClose={() => void reloadLatest?.()}
      title="This project was edited somewhere else"
      description="Another tab or device saved a newer version. Yours hasn't been saved, and saving it now would overwrite theirs."
    >
      {reloadError && (
        <p role="alert" className="mb-3 text-[13px] text-ed-error">
          {reloadError} Check your connection and try again.
        </p>
      )}
      <div className="flex justify-end">
        <Button loading={reloading} onClick={() => void reloadLatest?.()}>
          Load the latest version
        </Button>
      </div>
    </Dialog>
  )
}

/**
 * What happens when the saved video can't be opened by this build.
 *
 * The editor behind this dialog is empty, and that emptiness is a lie — the
 * project's work is on the server, intact, and would be destroyed by the first
 * autosave. So the bridge attaches nothing (see `ProjectDocumentBridge`) and
 * this says so plainly.
 *
 * The two reasons get different words on purpose. A video saved by a newer
 * build is not damaged, and telling that user it is would send them looking for
 * a fault instead of to the tab where it opens perfectly well.
 *
 * Going back to Home is the primary action because it is the one that loses
 * nothing: the pictures and videos are all still there, and only the timeline
 * can't be opened. Starting again is offered too, quietly, because an editor
 * with no way forward is a dead end — but it is the user's decision to make
 * and the copy names the cost before they make it.
 */
export function ProjectUnreadableDialog() {
  const reason = useProjectSaveStore((s) => s.unreadableReason)
  const replaceUnreadable = useProjectSaveStore((s) => s.replaceUnreadable)
  const router = useRouter()

  if (!reason) return null

  const description =
    reason === 'unsupported-version'
      ? 'It was saved by a newer version of this app. Nothing has been changed, and nothing will be saved over it — reload this page, or open the project where you last saved it.'
      : "Some of what was saved doesn't make sense to this app. Nothing has been changed, and nothing will be saved over it."

  return (
    <Dialog
      open
      // Same reasoning as the conflict dialog: there is nothing usable behind
      // this one, so dismissing it takes the user somewhere real instead of
      // leaving them in an editor that saves nothing.
      onClose={() => router.push('/home')}
      title="We can't open this project's video"
      description={description}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="quiet" onClick={() => replaceUnreadable?.()}>
          Start a new video
        </Button>
        <Link href="/home" className={buttonClass('primary', 'md')}>
          Back to Home
        </Link>
      </div>
    </Dialog>
  )
}

/**
 * The clips whose media didn't come back.
 *
 * A video or picture added straight from the user's own device lives at a
 * `blob:` URL that only exists for as long as that page does. The clip survives
 * a save — its name, its place on the timeline, its length — but the file
 * behind it does not, so on reopening it is a clip that plays nothing.
 *
 * Silence is the wrong answer to that. The user would find it during playback,
 * as an unexplained gap, and have no idea which of their files to add again.
 * This names them and says what fixes it. Dismissible, because it is
 * information rather than a decision, and the clips stay on the timeline either
 * way.
 */
export function ProjectMediaNotice() {
  const missing = useProjectSaveStore((s) => s.missingMedia)
  const [dismissed, setDismissed] = useState(false)

  // A fresh restore (a different project, or the reload-latest recovery) is
  // worth speaking up about again.
  useEffect(() => setDismissed(false), [missing])

  if (dismissed || missing.length === 0) return null

  const names = missingMediaSummary(missing)
  const count = missing.length

  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-ed-border bg-ed-card px-3 py-2 text-[13px] text-ed-text"
    >
      <AlertTriangle size={13} className="mt-[2px] shrink-0 text-ed-error" aria-hidden />
      <p className="min-w-0 flex-1">
        {count === 1 ? '1 clip is' : `${count} clips are`} still on the timeline but{' '}
        {count === 1 ? 'its file' : 'their files'} didn&apos;t come back —{' '}
        <span className="text-ed-text-muted">{names}</span>. {count === 1 ? 'It was' : 'They were'}{' '}
        added from your device, so add the {count === 1 ? 'file' : 'files'} again to see{' '}
        {count === 1 ? 'it' : 'them'} play.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded px-1 text-ed-text-muted hover:text-ed-text"
      >
        Dismiss
      </button>
    </div>
  )
}
