import { describe, expect, it } from 'vitest'
import { BUILT_IN_TEXT_TEMPLATES, findTextTemplate, type Clip } from '@elah/editor'
import {
  MAX_CLIP_TEXT,
  OVERRIDE_BOUNDS,
  PICK_COUNT,
  POSITION_Y,
  buildTreatmentPatch,
  contextFromClip,
  deterministicSuggestions,
  sanitizeClipContext,
  sanitizeOverrides,
  shortlistTemplates,
  type TreatmentClipContext,
} from './treatment'

const ctx = (over: Partial<TreatmentClipContext> = {}): TreatmentClipContext => ({
  durationFrames: 150,
  fps: 30,
  lineCount: 1,
  charCount: 20,
  ...over,
})

/** Minimal text clip. Only the fields `applyTextTemplate` and the overrides read. */
const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: 'clip-1',
    type: 'text',
    content: 'SUMMER SALE',
    startFrame: 0,
    durationFrames: 150,
    ...over,
  }) as Clip

const topId = (description: string, context = ctx()) => shortlistTemplates(description, context)[0].template.id

describe('shortlistTemplates', () => {
  it('ranks by the user’s own words', () => {
    expect(topId('bold heavy brand slogan that snaps')).toBe('template-brand-drop')
    expect(topId('subtitle caption for dialogue')).toBe('template-subtitle')
    expect(topId('speaker name bar for an interview')).toBe('template-lower-third')
    expect(topId('pull quote testimonial')).toBe('template-quote')
    expect(topId('a stat callout highlighting a number')).toBe('template-callout')
  })

  it('returns every template, so the caller always has a fallback tail', () => {
    expect(shortlistTemplates('anything', ctx())).toHaveLength(BUILT_IN_TEXT_TEMPLATES.length)
  })

  it('falls back to catalogue order when nothing matches', () => {
    const ranked = shortlistTemplates('', ctx())
    expect(ranked.map((r) => r.template.id)).toEqual(BUILT_IN_TEXT_TEMPLATES.map((t) => t.id))
  })

  it('reports which words earned the match, for the reason line', () => {
    const [best] = shortlistTemplates('bold sale hook', ctx())
    expect(best.template.id).toBe('template-brand-drop')
    expect(best.matched.sort()).toEqual(['bold', 'hook', 'sale'])
  })

  it('counts a repeated word once', () => {
    const [best] = shortlistTemplates('bold bold bold', ctx())
    expect(best.matched).toEqual(['bold'])
  })

  it('matches a simple plural but not a longer word that contains the tag', () => {
    expect(shortlistTemplates('titles', ctx())[0].template.id).toBe('template-title-card')
    // "subtitle" contains "title" — it must not rank the Title Card.
    expect(topId('subtitle')).toBe('template-subtitle')
  })

  it('does not hand a still template to a request that asks for motion', () => {
    // "caption" tags Subtitle, but the user asked for a snap.
    const ranked = shortlistTemplates('snappy punchy caption', ctx())
    const subtitle = ranked.findIndex((r) => r.template.id === 'template-subtitle')
    const kinetic = ranked.findIndex((r) => r.template.id === 'template-kinetic-pop')
    expect(kinetic).toBeLessThan(subtitle)
  })

  const scoreOf = (list: ReturnType<typeof shortlistTemplates>, id: string) =>
    list.find((r) => r.template.id === id)!.score

  it('demotes a scrolling template on a clip too short to travel', () => {
    const long = shortlistTemplates('credits', ctx({ durationFrames: 300 }))
    const short = shortlistTemplates('credits', ctx({ durationFrames: 45 }))
    expect(scoreOf(short, 'template-ticker')).toBeLessThan(scoreOf(long, 'template-ticker'))
  })

  it('still honours an explicit ask, because fit breaks ties rather than overruling intent', () => {
    // Naming the ticker on a 1.5s clip is a worse clip, but it is what was asked
    // for — the penalty must not be large enough to substitute a different look.
    expect(topId('ticker credits', ctx({ durationFrames: 45 }))).toBe('template-ticker')
  })

  it('demotes display type when the copy is long', () => {
    const shortCopy = shortlistTemplates('bold', ctx({ charCount: 12 }))
    const longCopy = shortlistTemplates('bold', ctx({ charCount: 200 }))
    // Against a template the length penalty does not touch, the gap closes.
    const gap = (list: ReturnType<typeof shortlistTemplates>) =>
      scoreOf(list, 'template-brand-drop') - scoreOf(list, 'template-subtitle')
    expect(gap(longCopy)).toBeLessThan(gap(shortCopy))
  })
})

describe('contextFromClip', () => {
  it('counts non-empty lines and falls back to one', () => {
    expect(contextFromClip(clip({ content: 'a\n\nb' }), 30).lineCount).toBe(2)
    expect(contextFromClip(clip({ content: '' }), 30).lineCount).toBe(1)
  })
})

describe('sanitizeOverrides', () => {
  it('drops unknown keys and unrecognised enum values', () => {
    expect(
      sanitizeOverrides({ color: '#ff0000', fontFamily: 'Comic Sans MS', align: 'justify', ease: 'warp', position: 'sideways' }),
    ).toEqual({})
  })

  it('clamps every numeric to its bounds', () => {
    const over = sanitizeOverrides({ fontScale: 99, intensity: -5, rampFraction: 10 })
    expect(over.fontScale).toBe(OVERRIDE_BOUNDS.fontScale.max)
    expect(over.intensity).toBe(OVERRIDE_BOUNDS.intensity.min)
    expect(over.rampFraction).toBe(OVERRIDE_BOUNDS.rampFraction.max)
  })

  it('rejects non-finite numbers rather than clamping them', () => {
    expect(sanitizeOverrides({ fontScale: NaN, intensity: Infinity })).toEqual({})
  })

  it('keeps legal values untouched', () => {
    const input = { fontScale: 1.2, intensity: 0.5, rampFraction: 0.2, align: 'left', position: 'top', ease: 'back-out' }
    expect(sanitizeOverrides(input)).toEqual(input)
  })

  it('survives junk input', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides('nope')).toEqual({})
  })
})

describe('buildTreatmentPatch', () => {
  const brandDrop = findTextTemplate('template-brand-drop')!

  it('with no overrides, matches the plain template application', () => {
    const patch = buildTreatmentPatch(brandDrop, clip())
    expect(patch.fontFamily).toBe('Impact')
    expect(patch.fontSize).toBe(96)
    expect(patch.textAnimation?.inMotion).toEqual(brandDrop.animation.in)
  })

  it('never rewrites the clip’s words', () => {
    expect(buildTreatmentPatch(brandDrop, clip())).not.toHaveProperty('content')
  })

  it('scales font size and rounds to a whole pixel', () => {
    expect(buildTreatmentPatch(brandDrop, clip(), { fontScale: 0.75 }).fontSize).toBe(72)
  })

  it('scales offset and rotation linearly, but scale around its rest of 1', () => {
    const patch = buildTreatmentPatch(brandDrop, clip(), { intensity: 0.5 })
    // Template: offsetY 0.05, scale 0.78.
    expect(patch.textAnimation?.inMotion?.offsetY).toBeCloseTo(0.025)
    expect(patch.textAnimation?.inMotion?.scale).toBeCloseTo(0.89)
  })

  it('at intensity 0 leaves a still version of the look, fade intact', () => {
    const patch = buildTreatmentPatch(brandDrop, clip(), { intensity: 0 })
    expect(patch.textAnimation?.inMotion?.offsetY).toBe(0)
    expect(patch.textAnimation?.inMotion?.scale).toBe(1)
    // Opacity is deliberately not scaled — an entry that does not fade in is not gentler.
    expect(patch.textAnimation?.inMotion?.opacity).toBe(0)
  })

  it('replaces the easing on both ends when asked', () => {
    const patch = buildTreatmentPatch(brandDrop, clip(), { ease: 'linear' })
    expect(patch.textAnimation?.inMotion?.ease).toBe('linear')
    expect(patch.textAnimation?.outMotion?.ease).toBe('linear')
  })

  it('re-resolves the ramp against the clip, so a short clip cannot get a long one', () => {
    const short = buildTreatmentPatch(brandDrop, clip({ durationFrames: 9 }), { rampFraction: 0.5 })
    // Half of a 9-frame clip is 4 — the cap that keeps the text reaching full opacity.
    expect(short.textAnimation?.durationFrames).toBe(4)
  })

  it('moves the block vertically while keeping the rest of the transform', () => {
    const patch = buildTreatmentPatch(brandDrop, clip(), { position: 'lower-third' })
    expect(patch.transform?.y).toBe(POSITION_Y['lower-third'])
    expect(patch.transform?.x).toBe(brandDrop.placement?.x)
  })

  it('clamps a hostile override rather than trusting it', () => {
    const patch = buildTreatmentPatch(brandDrop, clip(), { fontScale: 1000, intensity: -99 } as never)
    expect(patch.fontSize).toBe(Math.round(96 * OVERRIDE_BOUNDS.fontScale.max))
    expect(patch.textAnimation?.inMotion?.offsetY).toBe(0)
  })

  it('applies cleanly to every shipped template', () => {
    for (const template of BUILT_IN_TEXT_TEMPLATES) {
      const patch = buildTreatmentPatch(template, clip(), { intensity: 1.5, fontScale: 1.1 })
      expect(patch.fontSize).toBeGreaterThan(0)
      expect(patch.textAnimation?.durationFrames).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('sanitizeClipContext', () => {
  it('is total — junk in, usable context out', () => {
    const ctx = sanitizeClipContext(null)
    expect(ctx.durationFrames).toBe(150)
    expect(ctx.fps).toBe(30)
    expect(ctx.lineCount).toBe(1)
  })

  it('derives line and character counts from the text when not given', () => {
    const ctx = sanitizeClipContext({ text: 'one\ntwo\n\nthree' })
    expect(ctx.lineCount).toBe(3)
    expect(ctx.charCount).toBe(14)
  })

  it('truncates clip text rather than rejecting it', () => {
    expect(sanitizeClipContext({ text: 'x'.repeat(9999) }).text).toHaveLength(MAX_CLIP_TEXT)
  })

  it('replaces a nonsense fps rather than dividing by it', () => {
    expect(sanitizeClipContext({ fps: 0 }).fps).toBe(30)
    expect(sanitizeClipContext({ fps: -5 }).fps).toBe(30)
    expect(sanitizeClipContext({ fps: NaN }).fps).toBe(30)
  })
})

describe('deterministicSuggestions', () => {
  it('always returns suggestions, which is what makes the route fail-soft', () => {
    expect(deterministicSuggestions('', ctx())).toHaveLength(PICK_COUNT)
    expect(deterministicSuggestions('%%%%', ctx())).toHaveLength(PICK_COUNT)
  })

  it('only ever picks templates — authoring a look needs a model', () => {
    for (const s of deterministicSuggestions('bold snappy title', ctx())) {
      expect(s.kind).toBe('template')
      // Narrowed by the assertion above; the cast keeps the test honest about why.
      expect((s as Extract<typeof s, { kind: 'template' }>).overrides).toEqual({})
    }
  })

  it('explains itself with the words that actually matched', () => {
    expect(deterministicSuggestions('bold sale', ctx())[0].reason).toBe('Matches “bold”, “sale”.')
  })

  it('falls back to the template’s own blurb when nothing matched', () => {
    const [first] = deterministicSuggestions('', ctx())
    expect(first.reason).toBe(findTextTemplate(first.id)!.description)
  })

  it('names a template that really exists, so the client can always resolve it', () => {
    for (const s of deterministicSuggestions('anything at all', ctx())) {
      expect(findTextTemplate(s.id)).toBeDefined()
      expect(s.name).toBe(findTextTemplate(s.id)!.name)
    }
  })
})
