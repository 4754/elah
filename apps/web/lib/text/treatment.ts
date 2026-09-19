/**
 * Turning "bold title that snaps in for a sale reel" into a text clip that
 * looks like one.
 *
 * Two halves, and the split is the whole design:
 *
 *  1. `shortlistTemplates` — deterministic, no network. Scores all fourteen
 *     shipped templates against the words the user typed and the clip they
 *     typed them at. Always returns something.
 *  2. A model re-ranks that shortlist and may nudge a small set of bounded
 *     knobs (`TreatmentOverrides`). It cannot reach past them.
 *
 * The reason for the split is the same one `lib/motion/suggest.ts` gives for
 * its own deterministic pass: the panel needs an answer the instant it opens,
 * and it needs one when there is no API key, when the model times out, and
 * when it returns something unusable. A suggestion feature whose failure mode
 * is an error message is worse than the grid it replaced.
 *
 * ---------------------------------------------------------------------------
 * What the model is allowed to decide
 * ---------------------------------------------------------------------------
 * `lib/motion/overlay.ts` states the existing boundary: the model writes copy,
 * never look, because "two runs of the copywriter can differ in words and never
 * in whether the result is usable". This module widens that boundary
 * deliberately and by a measured amount — the model now picks the look too, and
 * may adjust its motion — so the same guarantee has to be re-established a
 * different way.
 *
 * It is re-established by construction rather than by trust:
 *
 *   - The template is chosen from an enum of ids that were sent to the model.
 *     It cannot name one that does not exist (see the route's response schema).
 *   - Every override is a scalar with a hard range, clamped HERE rather than
 *     where it is read, so an out-of-range value from any caller — model,
 *     future UI, a replayed request — lands in the same legal space.
 *   - Nothing in `TreatmentOverrides` can express a colour, a font family, or
 *     an arbitrary curve. `intensity` scales motion the template already has;
 *     it cannot introduce motion the template does not have.
 *
 * So the worst a bad model response can do is pick a less apt template and set
 * its ramp slightly wrong. It cannot produce a clip that fails to render, sits
 * off-stage, or never reaches full opacity.
 */

import { buildCustomPatch, type CustomTreatment } from './customTreatment'
import {
  BUILT_IN_TEXT_TEMPLATES,
  DEFAULT_TEXT_TRANSFORM,
  applyTextTemplate,
  resolveTemplateRamp,
  type Clip,
  type MotionSpec,
  type TextAnimationEasing,
  type TextTemplate,
  type Transform,
} from '@elah/editor'

// ---------------------------------------------------------------------------
// What the caller tells us about the clip
// ---------------------------------------------------------------------------

/**
 * The clip facts that change which template fits — not the clip itself.
 *
 * A structural type rather than `Clip` because the shortlist is also computed
 * server-side, where there is no editor document to hand. It is the same four
 * numbers either way, and keeping them explicit means the scoring rules below
 * can be read without knowing what a `Clip` is.
 */
export interface TreatmentClipContext {
  durationFrames: number
  fps: number
  /** Newline-separated lines in the clip's text. A stack of words wants a different look than one line. */
  lineCount: number
  /** Total characters. Long copy rules out display type at 96px. */
  charCount: number
}

/** Seconds the clip is on screen. The scoring rules are written in seconds, not frames. */
export function clipSeconds(ctx: TreatmentClipContext): number {
  const fps = Number.isFinite(ctx.fps) && ctx.fps > 0 ? ctx.fps : 30
  const frames = Number.isFinite(ctx.durationFrames) ? Math.max(0, ctx.durationFrames) : 0
  return frames / fps
}

/** Build a context from a real clip. The editor-side entry point. */
export function contextFromClip(clip: Clip, fps: number): TreatmentClipContext {
  const content = typeof clip.content === 'string' ? clip.content : ''
  return {
    durationFrames: clip.durationFrames,
    fps,
    lineCount: content.split('\n').filter((line) => line.trim().length > 0).length || 1,
    charCount: content.length,
  }
}

// ---------------------------------------------------------------------------
// The tag table
// ---------------------------------------------------------------------------

/**
 * Words that should pull a template up the list, per template.
 *
 * Hand-authored rather than derived from `template.description`, for two
 * reasons. The descriptions are written to be read by a human hovering a card
 * ("Editorial." "Interviews.") and are too terse to match against — "sale",
 * "punchy" and "loud" all mean Brand Drop and none of them appear in its text.
 * And a description is UI copy: rewording it for clarity would silently
 * re-rank suggestions, which is a surprising thing for a copy edit to do.
 *
 * Matching is on whole words after lowercasing, so "titles" matches "title"
 * via the stemming in `matchesTag` but "subtitle" does not match "title".
 */
const TEMPLATE_TAGS: Record<string, readonly string[]> = {
  'template-title-card': ['title', 'heading', 'header', 'opener', 'open', 'intro', 'section', 'card', 'chapter'],
  'template-elegant-reveal': ['elegant', 'editorial', 'serif', 'refined', 'slow', 'graceful', 'luxury', 'premium', 'calm', 'gentle'],
  'template-kinetic-pop': ['kinetic', 'pop', 'punchy', 'energetic', 'snappy', 'social', 'tiktok', 'reel', 'fast', 'playful', 'fun', 'bouncy'],
  'template-quote': ['quote', 'quotation', 'testimonial', 'review', 'pullquote', 'saying', 'panel'],
  'template-lower-third': ['lower', 'third', 'name', 'nametag', 'speaker', 'interview', 'guest', 'credit', 'introduce', 'bar'],
  'template-subtitle': ['subtitle', 'caption', 'captions', 'dialogue', 'transcript', 'translation', 'still', 'legible', 'readable'],
  'template-callout': ['callout', 'stat', 'statistic', 'fact', 'number', 'highlight', 'badge', 'chip', 'note', 'annotation'],
  'template-ticker': ['ticker', 'scroll', 'crawl', 'credits', 'marquee', 'drift', 'news'],
  'template-editorial-stamp': ['stamp', 'masthead', 'magazine', 'caps', 'tracked', 'fashion', 'label', 'kicker', 'top'],
  'template-brand-drop': ['brand', 'drop', 'bold', 'heavy', 'loud', 'impact', 'sale', 'hook', 'slogan', 'tagline', 'snap', 'stack', 'shout'],
  'template-runway-ticker': ['runway', 'crawl', 'season', 'date', 'drop', 'credits', 'bottom', 'small'],
  'template-price-chip': ['price', 'pricing', 'cost', 'offer', 'deal', 'discount', 'size', 'pill', 'chip', 'tag'],
  'template-split-title': ['split', 'statement', 'meet', 'converge', 'two', 'halves', 'dramatic', 'cinematic'],
  'template-period-title': ['period', 'film', 'cinema', 'cinematic', 'warm', 'vintage', 'dissolve', 'movie', 'era', 'documentary'],
}

/**
 * Templates whose identity is being *still*, and which therefore should not win
 * on a request that asks for motion.
 *
 * A Subtitle that snaps is not a subtitle. Keeping this as a set rather than a
 * tag means "still" can score positively for them (someone asking for a calm
 * caption should get one) while "snappy" scores against them.
 */
const STILL_TEMPLATES = new Set(['template-subtitle', 'template-lower-third'])

/** Words that mean "give me motion", used only to fine the still templates above. */
const MOTION_WORDS = new Set([
  'snap', 'snappy', 'punchy', 'bouncy', 'bounce', 'kinetic', 'pop', 'energetic',
  'dramatic', 'dynamic', 'lively', 'animated', 'moving', 'spring',
])

/** Templates that scroll continuously. Meaningless on a clip too short to travel. */
const SCROLLING_TEMPLATES = new Set(['template-ticker', 'template-runway-ticker'])

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Weight of one matched tag. The dominant term — the user's own words lead. */
const TAG_WEIGHT = 3

/** Weight of a fit bonus or penalty. Deliberately below `TAG_WEIGHT`: fit breaks ties, it does not overrule intent. */
const FIT_WEIGHT = 1

/** Below this many seconds a scrolling template cannot travel far enough to read as a scroll. */
const MIN_SCROLL_SECONDS = 4

/** Above this many characters, display type at the template's size will not fit the stage. */
const LONG_COPY_CHARS = 90

/** Templates whose type is large enough that long copy breaks them. */
const DISPLAY_TEMPLATES = new Set([
  'template-brand-drop',
  'template-kinetic-pop',
  'template-title-card',
  'template-split-title',
])

const WORD_SPLIT = /[^a-z0-9]+/

/** Lowercased words of the description, empties dropped. */
function words(description: string): string[] {
  return description.toLowerCase().split(WORD_SPLIT).filter(Boolean)
}

/**
 * Whether a typed word means a tag.
 *
 * Equality plus a one-character plural, which covers "titles"/"title" and
 * "captions"/"caption" without pulling in a stemmer. Substring matching was
 * tried and rejected: it makes "subtitle" match the `title` tag, which is
 * exactly backwards.
 */
function matchesTag(word: string, tag: string): boolean {
  return word === tag || (word.length === tag.length + 1 && word.startsWith(tag) && word.endsWith('s'))
}

export interface ScoredTemplate {
  template: TextTemplate
  score: number
  /** Which of the user's words earned it. Shown as the reason under a suggestion. */
  matched: string[]
}

/**
 * Rank every shipped template against a description and a clip.
 *
 * Returns all fourteen, best first — the caller slices. Ties resolve by
 * catalogue order, which is already "general looks first, positional and
 * decorative after", so an empty description degrades to the picker's own
 * order rather than to something arbitrary.
 */
export function shortlistTemplates(
  description: string,
  ctx: TreatmentClipContext,
  templates: readonly TextTemplate[] = BUILT_IN_TEXT_TEMPLATES,
): ScoredTemplate[] {
  const typed = words(description)
  const wantsMotion = typed.some((word) => MOTION_WORDS.has(word))
  const seconds = clipSeconds(ctx)

  return templates
    .map((template, index) => {
      const tags = TEMPLATE_TAGS[template.id] ?? []
      const matched = typed.filter((word) => tags.some((tag) => matchesTag(word, tag)))
      // Distinct words: typing "bold bold bold" is emphasis, not evidence.
      const distinct = Array.from(new Set(matched))

      let score = distinct.length * TAG_WEIGHT

      if (wantsMotion && STILL_TEMPLATES.has(template.id)) score -= FIT_WEIGHT * 2
      if (SCROLLING_TEMPLATES.has(template.id) && seconds < MIN_SCROLL_SECONDS) score -= FIT_WEIGHT * 2
      if (ctx.charCount > LONG_COPY_CHARS && DISPLAY_TEMPLATES.has(template.id)) score -= FIT_WEIGHT * 2
      // A stagger splits the clip's copy into rows; with one short line there is
      // nothing to stagger and the look is wasted, not wrong.
      if (template.stagger && template.stagger.by !== 'block' && ctx.lineCount <= 1 && ctx.charCount < 12) {
        score -= FIT_WEIGHT
      }

      return { template, score, matched: distinct, index }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ template, score, matched }) => ({ template, score, matched }))
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/**
 * Named vertical positions, as stage-normalized y of the text block's CENTRE.
 *
 * The values are read off the templates that already own each position —
 * Subtitle sits at 0.86, Editorial Stamp at 0.13 — so asking for "lower third"
 * lands where the Lower Third template would have put it rather than at a
 * number invented here.
 */
export const POSITION_Y = {
  top: 0.15,
  middle: 0.5,
  'lower-third': 0.78,
  bottom: 0.88,
} as const

export type TreatmentPosition = keyof typeof POSITION_Y

/** Bounds for every numeric override. Exported so the route and the tests share one definition. */
export const OVERRIDE_BOUNDS = {
  /** Multiplies the template's `fontSize`. Wide enough to matter, narrow enough that display type stays on stage. */
  fontScale: { min: 0.6, max: 1.6, default: 1 },
  /**
   * Multiplies the template's motion extremes — offset, scale deviation and
   * rotation. 0 is a still version of the look; 2 is twice the throw.
   *
   * Opacity is deliberately NOT scaled: a fade from 0.5 instead of 0 is not a
   * gentler entry, it is a clip that never fully arrives, and at intensity 0 it
   * would be a fade that does not fade.
   */
  intensity: { min: 0, max: 2, default: 1 },
  /** Replaces the template's `rampFraction` before `resolveTemplateRamp` clamps it against the clip. */
  rampFraction: { min: 0.02, max: 0.5, default: undefined },
} as const

export interface TreatmentOverrides {
  fontScale?: number
  align?: 'left' | 'center' | 'right'
  position?: TreatmentPosition
  intensity?: number
  rampFraction?: number
  /** Curve for the geometric channels. Constrained to the shipped easing union. */
  ease?: TextAnimationEasing
}

const ALIGNMENTS = new Set(['left', 'center', 'right'])

const EASINGS = new Set<TextAnimationEasing>([
  'linear', 'quad-in', 'quad-out', 'quad-in-out', 'cubic-out',
  'expo-out', 'back-in', 'back-out', 'elastic-out', 'bounce-out',
])

function clampNumber(value: unknown, bounds: { min: number; max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

/**
 * Drop anything unrecognised, clamp everything numeric.
 *
 * Runs on both sides — the route calls it on the model's response, the editor
 * calls it again before applying — because the cost is a few comparisons and
 * the alternative is trusting that the only path into `buildTreatmentPatch` is
 * the one that sanitizes.
 */
export function sanitizeOverrides(value: unknown): TreatmentOverrides {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const out: TreatmentOverrides = {}

  const fontScale = clampNumber(raw.fontScale, OVERRIDE_BOUNDS.fontScale)
  if (fontScale !== undefined) out.fontScale = fontScale

  const intensity = clampNumber(raw.intensity, OVERRIDE_BOUNDS.intensity)
  if (intensity !== undefined) out.intensity = intensity

  const rampFraction = clampNumber(raw.rampFraction, OVERRIDE_BOUNDS.rampFraction)
  if (rampFraction !== undefined) out.rampFraction = rampFraction

  if (typeof raw.align === 'string' && ALIGNMENTS.has(raw.align)) {
    out.align = raw.align as TreatmentOverrides['align']
  }
  if (typeof raw.position === 'string' && raw.position in POSITION_Y) {
    out.position = raw.position as TreatmentPosition
  }
  if (typeof raw.ease === 'string' && EASINGS.has(raw.ease as TextAnimationEasing)) {
    out.ease = raw.ease as TextAnimationEasing
  }

  return out
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Scale the geometric channels of one motion end.
 *
 * `opacity` and `opacityEase` pass through untouched — see the note on
 * `OVERRIDE_BOUNDS.intensity`. A spec that animates nothing geometric is
 * returned as-is, so intensity on a pure cross-fade is a no-op rather than an
 * error.
 */
function scaleMotion(spec: MotionSpec | undefined, intensity: number, ease?: TextAnimationEasing): MotionSpec | undefined {
  if (!spec) return undefined
  const out: MotionSpec = { ...spec }

  if (spec.offsetX !== undefined) out.offsetX = spec.offsetX * intensity
  if (spec.offsetY !== undefined) out.offsetY = spec.offsetY * intensity
  if (spec.rotation !== undefined) out.rotation = spec.rotation * intensity
  // Scale is a MULTIPLIER whose rest is 1, so it scales around 1, not around 0.
  // Halving the intensity of `scale: 0.78` must give 0.89 — closer to rest —
  // not 0.39, which is a bigger pop than the template asked for.
  if (spec.scale !== undefined) out.scale = 1 + (spec.scale - 1) * intensity

  if (ease) out.ease = ease

  return out
}

/**
 * The patch that applies a template plus overrides to a clip.
 *
 * Delegates to `applyTextTemplate` for the template itself and then adjusts,
 * rather than reimplementing it — so the "switching templates is clean, not
 * cumulative" behaviour documented there (every optional box field present,
 * `undefined` when unused) is inherited rather than re-derived, and a template
 * change upstream reaches this path for free.
 *
 * The result is one `Partial<Clip>` for a single `engine.updateClip`, which is
 * what keeps an applied suggestion a single undo step.
 */
export function buildTreatmentPatch(
  template: TextTemplate,
  clip: Clip,
  overrides: TreatmentOverrides = {},
): Partial<Clip> {
  const patch = applyTextTemplate(template, clip)
  const safe = sanitizeOverrides(overrides)

  if (safe.fontScale !== undefined && typeof patch.fontSize === 'number') {
    patch.fontSize = Math.round(patch.fontSize * safe.fontScale)
  }

  if (safe.align) patch.textAlign = safe.align

  if (safe.position) {
    // Same merge rule as `applyTextTemplate`'s placement handling: override y,
    // keep the author's scale/rotation/anchor. `patch.transform` is already the
    // merged result when the template set a placement, so read through it first.
    const base: Transform = patch.transform ?? clip.transform ?? DEFAULT_TEXT_TRANSFORM
    patch.transform = { ...base, y: POSITION_Y[safe.position] }
  }

  const wantsMotionEdit = safe.intensity !== undefined || safe.ease !== undefined || safe.rampFraction !== undefined
  if (wantsMotionEdit && patch.textAnimation) {
    const intensity = safe.intensity ?? OVERRIDE_BOUNDS.intensity.default
    patch.textAnimation = {
      ...patch.textAnimation,
      inMotion: scaleMotion(patch.textAnimation.inMotion, intensity, safe.ease),
      outMotion: scaleMotion(patch.textAnimation.outMotion, intensity, safe.ease),
      durationFrames:
        safe.rampFraction !== undefined
          ? resolveTemplateRamp(safe.rampFraction, clip.durationFrames)
          : patch.textAnimation.durationFrames,
    }
  }

  return patch
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

/** Upper bound on the clip text echoed to the model. It is context, not content — the model never rewrites it. */
export const MAX_CLIP_TEXT = 400

/** How many suggestions the panel shows. Three fits without scrolling and is enough to choose between. */
export const PICK_COUNT = 3

/**
 * Coerce whatever arrived over the wire into a usable clip context.
 *
 * Total rather than validating: every field has a defensible default, and a
 * caller that omits the clip entirely still gets ranked suggestions. Nothing
 * here can fail, which is what lets the route have exactly one 4xx (a body that
 * is not JSON, or a missing description) instead of a validation surface.
 */
export function sanitizeClipContext(value: unknown): TreatmentClipContext & { text: string } {
  const raw = (value ?? {}) as Record<string, unknown>
  const num = (v: unknown, fallback: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : fallback

  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_CLIP_TEXT) : ''
  const lines = text.split('\n').filter((line) => line.trim().length > 0).length || 1

  return {
    // 150 frames at 30fps — five seconds, a middling clip. Used when the field
    // is absent, not as a correction of a bad value.
    durationFrames: num(raw.durationFrames, 150, 60 * 60 * 60),
    fps: num(raw.fps, 30, 240) || 30,
    lineCount: Math.max(1, Math.round(num(raw.lineCount, lines, 100))),
    charCount: Math.round(num(raw.charCount, text.length, MAX_CLIP_TEXT)),
    text,
  }
}

/**
 * One suggestion as the client consumes it.
 *
 * A union because a picked template and an authored look are genuinely
 * different things, not one thing with optional fields. A pick names something
 * shipped and tuned, and carries only adjustments to it; an authored look
 * carries the whole look and has no id to resolve. Collapsing them into one
 * optional-heavy shape would put a `templateId?` on the card and let a caller
 * forget which kind it was holding.
 */
interface TreatmentSuggestionBase {
  /**
   * Stable within one request. The card keys on it, and the store records it as
   * the applied one — so it has to exist for authored looks too, which have no
   * template id of their own.
   */
  id: string
  name: string
  /** One line of plain English. From the model when it answered, from the matched words when it did not. */
  reason: string
}

export type TreatmentSuggestion =
  | (TreatmentSuggestionBase & { kind: 'template'; templateId: string; overrides: TreatmentOverrides })
  | (TreatmentSuggestionBase & { kind: 'custom'; custom: CustomTreatment })

/**
 * The answer when the model is unavailable, slow, or unusable.
 *
 * The reason line is built from the words that actually earned the match, so it
 * is honest about why a template is there rather than a generic blurb — and
 * when nothing matched it falls back to the template's own description, which
 * is the same string the picker already shows as a tooltip.
 *
 * This is the reason the route has no failure mode. See its header.
 */
export function deterministicSuggestions(
  description: string,
  ctx: TreatmentClipContext,
  count: number = PICK_COUNT,
): TreatmentSuggestion[] {
  return shortlistTemplates(description, ctx)
    .slice(0, count)
    .map(({ template, matched }) => ({
      kind: 'template' as const,
      id: template.id,
      templateId: template.id,
      name: template.name,
      reason: matched.length > 0 ? `Matches “${matched.join('”, “')}”.` : template.description,
      overrides: {},
    }))
}

/**
 * The patch for any suggestion, picked or authored.
 *
 * The one place that knows how to turn a `TreatmentSuggestion` into a clip
 * patch. Both callers — the card's click handler and the automatic apply in
 * `useTextTreatment` — go through it, so they cannot drift about what a
 * suggestion means.
 *
 * Returns null only when a picked template's id no longer resolves, which needs
 * the catalogue to have shrunk under a suggestion already on screen.
 */
export function patchForSuggestion(suggestion: TreatmentSuggestion, clip: Clip): Partial<Clip> | null {
  if (suggestion.kind === 'custom') return buildCustomPatch(suggestion.custom, clip)
  const template = BUILT_IN_TEXT_TEMPLATES.find((t) => t.id === suggestion.templateId)
  return template ? buildTreatmentPatch(template, clip, suggestion.overrides) : null
}
