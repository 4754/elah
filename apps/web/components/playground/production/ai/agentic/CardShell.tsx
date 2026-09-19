'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonClass } from '@/lib/ui/styles'

/**
 * Shared chrome for every agentic step card, so the run reads as one
 * continuous surface rather than six differently-shaped panels.
 *
 * Cards are wider than chat bubbles and full-bleed inside the transcript: they
 * are the interface at that moment, not a remark about it. The eyebrow row
 * (icon + uppercase label) is what carries the step's identity — the accent
 * colour is reserved for whatever the user is meant to press.
 */
export function CardShell({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon
  /** Short step name, rendered uppercase. e.g. "Plan", "Voice over". */
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex w-full flex-col gap-3 rounded-xl border border-ed-border bg-ed-bg-2 p-3',
        className,
      )}
    >
      <header className="flex items-center gap-1.5">
        <Icon size={12} className="text-ed-accent" aria-hidden />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ed-text-muted">
          {label}
        </h3>
      </header>
      {children}
    </section>
  )
}

/** Selectable pill. The whole clarify + subtitles surface is built from these. */
export function Chip({
  children,
  selected = false,
  disabled = false,
  onClick,
  className,
}: {
  children: React.ReactNode
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        selected
          ? 'border-ed-accent bg-ed-accent-soft text-ed-accent'
          : 'border-ed-border bg-ed-elevated text-ed-text-muted hover:border-ed-text-muted hover:text-ed-text',
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * The card's one committing action. Carries its own price so the number the
 * user agrees to and the button they press are never separated — the pattern
 * the plain composer's Generate button already follows.
 */
export function PrimaryAction({
  label,
  price,
  icon: Icon,
  disabled = false,
  onClick,
}: {
  label: string
  /** Formatted, e.g. "$4.75". Omitted for actions that cost nothing. */
  price?: string
  icon?: LucideIcon
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(buttonClass('primary', 'sm'), 'h-8 w-full')}
    >
      {Icon && <Icon size={13} aria-hidden />}
      {label}
      {price && <span className="font-mono opacity-80">· {price}</span>}
    </button>
  )
}

export function SecondaryAction({
  label,
  icon: Icon,
  disabled = false,
  onClick,
}: {
  label: string
  icon?: LucideIcon
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(buttonClass('quiet', 'sm'), 'h-8 shrink-0')}
    >
      {Icon && <Icon size={13} aria-hidden />}
      {label}
    </button>
  )
}

export function CardError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-[12px] leading-relaxed text-ed-error">
      {message}
    </p>
  )
}

/** Muted one-liner under a card header, explaining what the step will do. */
export function CardHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-ed-text-muted">{children}</p>
}

/** Three dots bouncing in sequence — the animated half of {@link ThinkingRow}. */
function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
    </span>
  )
}

/**
 * "Planning your reel", "Thinking about your answer" — the live-LLM-call
 * indicator shared by every step that waits on a model response. Bouncing
 * dots read as active work in progress rather than a stalled spinner, which
 * matters most on the very first planning round: nothing else is on screen
 * yet for the user to look at.
 */
export function ThinkingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-ed-text-muted">
      <span>{label}</span>
      <ThinkingDots />
    </div>
  )
}
