'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCUSABLE_SELECTOR, nextTrapFocus } from '@/lib/ui/focusTrap'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  width?: number
  className?: string
}

export function Dialog({ open, onClose, title, description, children, width = 420, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    panel?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current()
      if (e.key !== 'Tab' || !panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      const target = nextTrapFocus(nodes, document.activeElement as HTMLElement | null, e.shiftKey, panel)
      if (!target) return
      e.preventDefault()
      target.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, mounted])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--elah-dialog-overlay)] p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className={cn(
          'max-h-[85vh] w-full overflow-y-auto rounded-xl border border-ed-border bg-ed-panel p-5 shadow-xl outline-none',
          className,
        )}
      >
        {title && (
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-[14px] font-medium text-ed-text">{title}</h2>
              {description && <p className="mt-1 text-[13px] text-ed-text-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="-mr-1 -mt-1 rounded p-1 text-ed-text-muted transition-colors hover:text-ed-text">
              <X size={14} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export default Dialog
