import type { ClassValue } from 'clsx'
import { cn } from '../utils'

/**
 * The class recipes behind `components/ui/*`.
 *
 * They live under `lib/` rather than next to the components because `lib/` is
 * the only tree vitest runs (see `vitest.config.ts`). A variant table is
 * exactly the kind of thing that rots quietly — a size dropped here changes
 * every button in the coming SaaS shell — so it is kept where a test can hold
 * it still, and the components stay thin wrappers with no branching of their own.
 *
 * The vocabulary started as the playground's — the editor's dense tool chrome,
 * 11-13px on a dark ground — and has been re-pitched for pages people read
 * rather than operate. Type sits at 13-14px, and every control now carries an
 * explicit minimum height instead of deriving one from padding plus line-box.
 *
 * That last part is the substantive change. `px-3 py-1.5` around a 12px face
 * produced a ~28px button: under the 32px that reads as pressable with a mouse
 * and well under the 44px a finger needs. Padding alone cannot promise a height,
 * because the height it yields depends on the font size it happens to wrap — so
 * the size table states the height and lets padding handle the sides.
 *
 * Sizes follow a 36px button / 40px field / pill chip control scale, which is
 * the register this product is aiming at.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive'
export type ButtonSize = 'sm' | 'md'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[32px] px-3 py-1 text-[13px]',
  md: 'min-h-[36px] px-4 py-1.5 text-[14px]',
}

/**
 * Four variants, and the split between the first two is the point.
 *
 * `primary` is FILLED. Until this table was rewritten every variant here was an
 * outline, on the argument that an accent border and label read well enough as
 * "press this". They do — individually. What that argument missed is what
 * happens on a real screen: a workflow step footer carries Back, Save draft and
 * Generate, and drawn as three outlines differing only in hue they have the
 * same visual weight, so nothing tells you which one finishes the job. A page
 * needs exactly one control that is obviously the way forward, and weight is
 * how you say it. Hue alone also fails for the ~8% of men with a colour vision
 * deficiency, for whom "the blue-bordered one" is not a distinction at all.
 *
 * So: one filled `primary` per surface, and everything beside it steps down.
 * `secondary` is the old outline-accent treatment, for an action that is real
 * but not the point of the screen. `quiet` is neutral. Two filled buttons side
 * by side is the regression to watch for — it puts you back where this started.
 *
 * `secondary` and `quiet` wear `ed-outline`, not `ed-border`. The two tokens
 * are not interchangeable: `border` is the structural hairline between surfaces
 * and is deliberately faint, while this is the edge of something you can press,
 * which WCAG 1.4.11 asks to be 3:1 against its background. On the light theme
 * the hairline is 1.5:1 — a quiet button drawn with it had no visible edge.
 */
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-ed-accent text-ed-accent-text hover:bg-ed-accent-hover',
  secondary: 'border-ed-accent text-ed-accent hover:bg-ed-accent-soft',
  quiet: 'border-ed-outline text-ed-text hover:bg-ed-elevated',
  destructive: 'border-ed-error text-ed-error hover:bg-ed-error/10',
}

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], className)
}

/**
 * `invalid` swaps the resting border rather than adding an outline, so a bad
 * field changes weight without changing size and nothing below it reflows.
 */
export function inputClass(invalid = false, className?: string): string {
  return cn(
    'w-full min-h-[40px] rounded-lg border bg-ed-card px-3.5 py-2 text-[14px] text-ed-text outline-none transition-colors',
    'placeholder:text-ed-text-muted disabled:cursor-not-allowed disabled:opacity-60',
    invalid ? 'border-ed-error' : 'border-ed-outline focus:border-ed-accent',
    className,
  )
}

/**
 * One row of Select's popover. Kept identical to the playground Dropdown's
 * option styling on purpose — the two controls differ in their trigger, not in
 * the list they open.
 */
export function selectOptionClass(selected: boolean, disabled = false): string {
  return cn(
    'block w-full px-3.5 py-2 text-left text-[13px] transition-colors',
    disabled
      ? 'cursor-not-allowed text-ed-text-muted opacity-40'
      : selected
        ? 'bg-ed-bg-2 text-ed-text'
        : 'text-ed-text-muted hover:bg-ed-bg-2 hover:text-ed-text',
  )
}

export function labelClass(className?: string): string {
  return cn('block text-[13px] font-medium text-ed-text-muted', className)
}

/**
 * The sidebar's type scale.
 *
 * Three sizes, because the workflow sidebar is 300px wide and had four — titles,
 * body, hints and slot hints — chosen one element at a time. Four sizes in that
 * width is not a hierarchy, it is noise: two adjacent steps are
 * indistinguishable at a glance and the reader gets no information from the
 * difference.
 *
 * The three moved up a step with the rest of the app (11/12/13 → 12/13/14). The
 * floor is what mattered: 11px of supporting copy in a side panel is text people
 * lean in to read, and a hint nobody reads is a hint that may as well not be
 * rendered.
 *
 * The one place smaller type survives is `overlayBadgeClass` below, where it
 * sits on top of a generated image rather than in the panel and is correct.
 */
export const TYPE = {
  /** Section and step titles. */
  title: 'text-[14px]',
  /** Ordinary copy, form labels, anything the user reads to make a decision. */
  body: 'text-[13px]',
  /** Supporting detail under a control. Still has to be legible. */
  hint: 'text-[12px]',
} as const

export type ChipState = 'on' | 'off'

/**
 * The selectable pill, in one place.
 *
 * This class string was copy-pasted across nine call sites — the pose picker,
 * the wardrobe swatches, the sketch tags, the camera moves, the motion presets,
 * the text templates, the storyboard, and two near-variants in the motion panel.
 * Nine copies is nine chances for one of them to drift, and two of them already
 * had.
 *
 * Two deliberate changes from the string it replaces:
 *
 *  1. **A stated minimum height, not `px-2 py-0.5`.** The old padding gave a
 *     small face a hit target around 20px tall, under any reasonable minimum and
 *     far under a comfortable touch one. It is now 32px — the same floor every
 *     other control in `lib/ui` carries. It costs about one chip per row in a
 *     300px column, which is what the categories and the search field in the
 *     pose picker are there to buy back.
 *  2. **Disabled has its own resting colours instead of `opacity-40`.** Stacking
 *     40% opacity on `ed-text-muted`, which is already a low-contrast token,
 *     lands around 1.6:1 against the panel — well under the 3:1 floor even for
 *     text that is only informative. That matters here because the disabled
 *     state carries meaning: it is how the pose picker says the cap is full.
 */
export function chipClass(state: ChipState, className?: string): string {
  return cn(
    'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors',
    state === 'on'
      ? 'border-ed-accent bg-ed-accent-soft text-ed-accent'
      : 'border-ed-outline text-ed-text-muted hover:border-ed-accent hover:text-ed-text',
    'disabled:cursor-not-allowed disabled:border-ed-border-subtle disabled:text-ed-text-muted',
    'disabled:hover:border-ed-border-subtle disabled:hover:text-ed-text-muted',
    className,
  )
}

export function cardClass(className?: string): string {
  return cn('rounded-xl border border-ed-border bg-ed-card p-5', className)
}

/**
 * Anything drawn *on top of a generated picture* — a view name, a "Simulated"
 * flag, a delete or expand control in a tile's corner.
 *
 * Its own recipe rather than the panel colours these all used to wear, and the
 * reason is worth stating because the mistake is easy to repeat. `bg-ed-panel`
 * and `text-ed-text-muted` are calibrated against the dark chrome, where muted
 * text on a panel is comfortably readable. A tile is not chrome: it is a
 * full-bleed photograph, frequently a bright one — a sunlit facade, a white
 * studio backdrop — and over that, a translucent dark panel is barely a tint and
 * muted grey text lands at roughly the contrast of the sky behind it. Both
 * workflows' galleries had view names and corner icons that effectively
 * disappeared on exactly the renders they mattered most on.
 *
 * So an overlay brings its own ground: an opaque-enough dark scrim, a light
 * hairline to separate it from whatever it covers, and full-strength white text.
 * That reads on a black interior and on an overexposed sky alike, which is the
 * only guarantee worth having when the background is user-generated and
 * therefore unknowable.
 *
 * `backdrop-blur-sm` is what keeps it from looking pasted on — the scrim picks
 * up the picture's colour without picking up its detail.
 */
const OVERLAY_BASE =
  'rounded-full border border-white/20 bg-black/70 text-white shadow-sm backdrop-blur-sm'

/**
 * A caption over a picture — a view name, a count, a provenance flag.
 *
 * Vertical padding and an explicit `leading` are part of the recipe rather than
 * left to the caller: several of these were written with horizontal padding
 * only, which cropped descenders against the border.
 */
export function overlayBadgeClass(...className: ClassValue[]): string {
  return cn(
    OVERLAY_BASE,
    'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium leading-4',
    className,
  )
}

/**
 * An icon control over a picture — delete, expand, select.
 *
 * Square-ish and `rounded-md` rather than the badge's pill, matching the icon
 * buttons elsewhere in the product; `hover` is left to the caller because what a
 * control does on hover (turn red to delete, brighten to expand) is specific to
 * the control and not to the fact that it sits over an image.
 */
export function overlayButtonClass(...className: ClassValue[]): string {
  return cn(
    OVERLAY_BASE,
    'flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )
}

/** Sized in `em` so the ring tracks whatever font-size it is dropped into. */
export function spinnerClass(className?: string): string {
  return cn(
    'inline-block h-[1em] w-[1em] shrink-0 animate-spin rounded-full border-2 border-current/30',
    className,
  )
}
