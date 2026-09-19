/**
 * A text look the model authored, rather than one it picked.
 *
 * `treatment.ts` constrains the model to the fourteen shipped templates plus a
 * few bounded knobs. That is the right default — the templates are hand-tuned
 * and a picked one is usable by construction — but it has a hard ceiling: the
 * model cannot say "white on a black chip" because no template is, and it cannot
 * say "slides in from the left" for a template with no `offsetX`, because
 * `intensity` scales motion that exists and cannot introduce motion that does
 * not.
 *
 * This module lifts that ceiling as far as the renderer allows, and no further.
 *
 * ---------------------------------------------------------------------------
 * Where the real ceiling is
 * ---------------------------------------------------------------------------
 * `MotionSpec` is the entire motion vocabulary for text: opacity, offsetX,
 * offsetY, scale, rotation, and an easing curve per channel group. So a
 * typewriter reveal, a per-letter wave, a blur-in, a shatter — none of those are
 * expressible here, whatever a model returns, because `TextLayer` cannot draw
 * them. Widening the model's freedom does not change that; only renderer work
 * would. Everything the renderer CAN draw is reachable from this file.
 *
 * ---------------------------------------------------------------------------
 * What replaces "usable by construction"
 * ---------------------------------------------------------------------------
 * A picked template is safe because we tuned it. An authored one is not, so the
 * guarantee has to be rebuilt from bounds:
 *
 *   - Fonts come from an allowlist, matched case-insensitively. The renderer
 *     silently falls back on an unknown family, so an invented font is not an
 *     error — it is a clip that quietly looks wrong.
 *   - Colours must parse as hex. A CSS colour string is anything at all,
 *     including `inherit` and `transparent`, and "the text vanished" is the
 *     failure that costs a user the most time to diagnose.
 *   - Every number is clamped to a range where the result is still ON the stage
 *     and still legible: offsets under two thirds of the frame, scale that
 *     cannot collapse to nothing, opacity that reaches rest.
 *   - `sanitizeCustomTreatment` returns null rather than a partial look when the
 *     required fields are missing, so a half-authored response falls back to a
 *     template pick instead of half-applying.
 *
 * The result: an authored look can be ugly — that is the user's judgement to
 * make and they can undo it — but it cannot be invisible, off-stage, or
 * unrenderable.
 */

import { DEFAULT_TEXT_TRANSFORM, resolveTemplateRamp } from '@elah/editor'
import type { Clip, MotionSpec, TextAnimationEasing, Transform } from '@elah/editor'
import { POSITION_Y, type TreatmentPosition } from './treatment'

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

/**
 * The families the properties panel offers, and the only ones a model may name.
 *
 * Shared with `TextClipProperties`' own dropdown so the two cannot drift: a font
 * the model can choose but the panel cannot show would be uneditable after the
 * fact, which is worse than not offering it.
 */
export const ALLOWED_FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'Georgia',
  'Impact',
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Courier New',
  'Palatino',
  'Garamond',
  'Comic Sans MS',
  'cursive',
  'fantasy',
] as const

export const ALLOWED_EASINGS: readonly TextAnimationEasing[] = [
  'linear',
  'quad-in',
  'quad-out',
  'quad-in-out',
  'cubic-out',
  'expo-out',
  'back-in',
  'back-out',
  'elastic-out',
  'bounce-out',
]

/** `#rgb` or `#rrggbb`. Deliberately not the full CSS colour space — see the header. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Every numeric range an authored look must land inside.
 *
 * Chosen so the extremes are still a clip someone might have made on purpose,
 * not so they are merely non-crashing. A 0.6 offset already starts the text
 * outside the frame and sweeps it in, which is a real look; 2.0 would be text
 * that is off-stage for most of its ramp, which is not.
 */
export const CUSTOM_BOUNDS = {
  fontSize: { min: 16, max: 240 },
  padding: { min: 0, max: 120 },
  borderRadius: { min: 0, max: 200 },
  borderWidth: { min: 0, max: 24 },
  backgroundOpacity: { min: 0, max: 1 },
  opacity: { min: 0, max: 1 },
  offset: { min: -0.6, max: 0.6 },
  /** Cannot reach 0: a scale of 0 at the extreme is text that starts as nothing and pops, which reads as a glitch. */
  scale: { min: 0.05, max: 4 },
  /** One full turn either way, in radians. */
  rotation: { min: -Math.PI * 2, max: Math.PI * 2 },
  rampFraction: { min: 0.02, max: 0.5 },
} as const

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface CustomTreatmentStyle {
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  fontSize: number
  textAlign: 'left' | 'center' | 'right'
  color: string
  backgroundColor?: string
  backgroundOpacity?: number
  padding?: number
  borderRadius?: number
  borderWidth?: number
  borderColor?: string
}

export interface CustomTreatment {
  /**
   * What the model called it, e.g. "Neon Slam".
   *
   * Shown on the card in the slot a template's name occupies. An authored look
   * has no id to look up, so without this the user is choosing between three
   * rows that all say the same thing.
   */
  name: string
  style: CustomTreatmentStyle
  motion: {
    in?: MotionSpec
    out?: MotionSpec
    rampFraction: number
  }
  /** Optional, same named positions a picked template's overrides may use. */
  position?: TreatmentPosition
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function clamp(value: unknown, bounds: { min: number; max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

function hexColor(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : undefined
}

/** Case-insensitive, returning the allowlist's own spelling so the panel's dropdown matches it. */
function font(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const wanted = value.trim().toLowerCase()
  return ALLOWED_FONTS.find((f) => f.toLowerCase() === wanted)
}

function motionSpec(value: unknown): MotionSpec | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: MotionSpec = {}

  const opacity = clamp(raw.opacity, CUSTOM_BOUNDS.opacity)
  if (opacity !== undefined) out.opacity = opacity

  const offsetX = clamp(raw.offsetX, CUSTOM_BOUNDS.offset)
  if (offsetX !== undefined) out.offsetX = offsetX

  const offsetY = clamp(raw.offsetY, CUSTOM_BOUNDS.offset)
  if (offsetY !== undefined) out.offsetY = offsetY

  const scale = clamp(raw.scale, CUSTOM_BOUNDS.scale)
  if (scale !== undefined) out.scale = scale

  const rotation = clamp(raw.rotation, CUSTOM_BOUNDS.rotation)
  if (rotation !== undefined) out.rotation = rotation

  if (typeof raw.ease === 'string' && ALLOWED_EASINGS.includes(raw.ease as TextAnimationEasing)) {
    out.ease = raw.ease as TextAnimationEasing
  }
  if (typeof raw.opacityEase === 'string' && ALLOWED_EASINGS.includes(raw.opacityEase as TextAnimationEasing)) {
    out.opacityEase = raw.opacityEase as TextAnimationEasing
  }

  /**
   * Drop channels that are already at rest.
   *
   * `MotionSpec` stores only the extreme; rest is structurally fixed at opacity
   * 1, zero offset, scale 1, zero rotation. So `opacity: 1` is not "no fade
   * specified" — it is a fade from full to full, which is the same as nothing
   * at all. Strict mode makes the model send every channel, and it fills the
   * ones it does not mean with rest values, so without this a pure spin is
   * stored as five no-ops and a rotation.
   *
   * Cosmetic for the renderer, which samples them to the same result either
   * way. Not cosmetic for the properties panel, where every no-op shows up as a
   * populated field the user then has to reason about.
   */
  const REST: Record<string, number> = { opacity: 1, offsetX: 0, offsetY: 0, scale: 1, rotation: 0 }
  for (const [channel, rest] of Object.entries(REST)) {
    if (out[channel as keyof MotionSpec] === rest) delete out[channel as keyof MotionSpec]
  }

  // A spec that animates nothing is not motion — returning `{}` would produce a
  // ramp with no visible effect and an entry the user asked for and cannot see.
  const animates = Object.keys(out).some((k) => k !== 'ease' && k !== 'opacityEase')
  return animates ? out : undefined
}

/**
 * Validate an authored look, or reject it entirely.
 *
 * All-or-nothing on the required style fields. A look missing its colour is not
 * "a look with a default colour" — it is a response the model did not finish,
 * and applying half of it produces something nobody chose. The caller falls back
 * to a template pick, which is always available.
 */
export function sanitizeCustomTreatment(value: unknown): CustomTreatment | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  const style = (raw.style ?? {}) as Record<string, unknown>
  const fontFamily = font(style.fontFamily)
  const fontSize = clamp(style.fontSize, CUSTOM_BOUNDS.fontSize)
  const color = hexColor(style.color)
  if (!fontFamily || fontSize === undefined || !color) return null

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Custom look'

  const out: CustomTreatment = {
    name,
    style: {
      fontFamily,
      fontSize,
      color,
      fontWeight: style.fontWeight === 'bold' ? 'bold' : 'normal',
      textAlign:
        style.textAlign === 'left' || style.textAlign === 'right'
          ? style.textAlign
          : 'center',
    },
    motion: {
      in: motionSpec((raw.motion as Record<string, unknown> | undefined)?.in),
      out: motionSpec((raw.motion as Record<string, unknown> | undefined)?.out),
      rampFraction:
        clamp((raw.motion as Record<string, unknown> | undefined)?.rampFraction, CUSTOM_BOUNDS.rampFraction) ?? 0.15,
    },
  }

  // The box treatment is genuinely optional — most looks have no chip — so
  // unlike the fields above, absence here is a valid answer rather than an
  // unfinished one.
  const backgroundColor = hexColor(style.backgroundColor)
  if (backgroundColor) {
    out.style.backgroundColor = backgroundColor
    out.style.backgroundOpacity = clamp(style.backgroundOpacity, CUSTOM_BOUNDS.backgroundOpacity) ?? 1
    out.style.padding = clamp(style.padding, CUSTOM_BOUNDS.padding) ?? 16
    out.style.borderRadius = clamp(style.borderRadius, CUSTOM_BOUNDS.borderRadius) ?? 0
  }

  const borderWidth = clamp(style.borderWidth, CUSTOM_BOUNDS.borderWidth)
  const borderColor = hexColor(style.borderColor)
  // A border needs both a width and a colour; either alone draws nothing, so
  // carrying one through would be state the user can see in the panel but not
  // on the stage.
  if (borderWidth !== undefined && borderWidth > 0 && borderColor) {
    out.style.borderWidth = borderWidth
    out.style.borderColor = borderColor
    out.style.padding = out.style.padding ?? clamp(style.padding, CUSTOM_BOUNDS.padding) ?? 16
    out.style.borderRadius = out.style.borderRadius ?? clamp(style.borderRadius, CUSTOM_BOUNDS.borderRadius) ?? 0
  }

  if (typeof raw.position === 'string' && raw.position in POSITION_Y) {
    out.position = raw.position as TreatmentPosition
  }

  return out
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * The `Partial<Clip>` patch that applies an authored look.
 *
 * Mirrors `applyTextTemplate`'s contract deliberately, including the part that
 * is easy to miss: every optional box field appears in the patch, `undefined`
 * when unused. Without that, switching from a look with a chip to one without
 * leaves the chip behind and the second look does not look like itself — the
 * same "clean, not cumulative" property templates already guarantee.
 *
 * `content` is absent, so an authored look restyles and never rewrites.
 */
export function buildCustomPatch(custom: CustomTreatment, clip: Clip): Partial<Clip> {
  const { style, motion, position } = custom

  const patch: Partial<Clip> = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    textAlign: style.textAlign,
    color: style.color,

    backgroundColor: style.backgroundColor,
    backgroundOpacity: style.backgroundOpacity,
    padding: style.padding,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,

    textAnimation: {
      inMotion: motion.in,
      outMotion: motion.out,
      // Against the clip's real length, so a long ramp on a short clip still
      // reaches full opacity — the clamp `resolveTemplateRamp` exists for.
      durationFrames: resolveTemplateRamp(motion.rampFraction, clip.durationFrames),
    },
  }

  if (position) {
    const base: Transform = clip.transform ?? DEFAULT_TEXT_TRANSFORM
    patch.transform = { ...base, y: POSITION_Y[position] }
  }

  return patch
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

/**
 * Reshape the flat object the model returns into a `CustomTreatment`.
 *
 * The model cannot send the nested shape. Strict structured outputs cap schema
 * nesting, and `picks[].custom.style.color` is already five levels down before
 * the property itself — so the wire form is one flat object of scalars
 * (`inOffsetX`, `outEase`, …) and this puts it back together.
 *
 * Reshaping only. Every value still goes through `sanitizeCustomTreatment`,
 * which is where the allowlists and clamps live, so nothing here has to be
 * trusted and a field this function passes through unchanged is not thereby
 * accepted.
 */
export function customFromFlat(value: unknown): CustomTreatment | null {
  if (!value || typeof value !== 'object') return null
  const f = value as Record<string, unknown>

  const end = (prefix: 'in' | 'out') => ({
    opacity: f[`${prefix}Opacity`],
    offsetX: f[`${prefix}OffsetX`],
    offsetY: f[`${prefix}OffsetY`],
    scale: f[`${prefix}Scale`],
    rotation: f[`${prefix}Rotation`],
    ease: f[`${prefix}Ease`],
  })

  return sanitizeCustomTreatment({
    name: f.name,
    position: f.position,
    style: {
      fontFamily: f.fontFamily,
      fontWeight: f.fontWeight,
      fontSize: f.fontSize,
      textAlign: f.textAlign,
      color: f.color,
      backgroundColor: f.backgroundColor,
      backgroundOpacity: f.backgroundOpacity,
      padding: f.padding,
      borderRadius: f.borderRadius,
      borderWidth: f.borderWidth,
      borderColor: f.borderColor,
    },
    motion: {
      in: end('in'),
      out: end('out'),
      rampFraction: f.rampFraction,
    },
  })
}
