'use client'

import { forwardRef, type HTMLAttributes } from 'react'
import { spinnerClass } from '@/lib/ui/styles'

export const Spinner = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function Spinner({ className, style, ...props }, ref) {
    return (
      <span
        ref={ref}
        role="status"
        aria-label="Loading"
        className={spinnerClass(className)}
        style={{ borderTopColor: 'currentColor', ...style }}
        {...props}
      />
    )
  },
)

export default Spinner
