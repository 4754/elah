import { describe, expect, it } from 'vitest'
import type { Clip } from '@elah/editor'
import {
  ALLOWED_FONTS,
  CUSTOM_BOUNDS,
  buildCustomPatch,
  customFromFlat,
  sanitizeCustomTreatment,
} from './customTreatment'

const clip = (over: Partial<Clip> = {}): Clip =>
  ({ id: 'c1', type: 'text', content: 'HELLO', startFrame: 0, durationFrames: 150, ...over }) as Clip

/** The smallest response that should be accepted. */
const minimal = {
  name: 'Neon Slam',
  style: { fontFamily: 'Impact', fontSize: 96, color: '#ffffff' },
  motion: { in: { opacity: 0, offsetX: -0.3 }, rampFraction: 0.12 },
}

describe('sanitizeCustomTreatment — rejection', () => {
  it('rejects junk outright', () => {
    expect(sanitizeCustomTreatment(null)).toBeNull()
    expect(sanitizeCustomTreatment('nope')).toBeNull()
    expect(sanitizeCustomTreatment({})).toBeNull()
  })

  it('rejects rather than half-applies when a required field is missing', () => {
    for (const missing of ['fontFamily', 'fontSize', 'color']) {
      const style: Record<string, unknown> = { ...minimal.style }
      delete style[missing]
      expect(sanitizeCustomTreatment({ ...minimal, style })).toBeNull()
    }
  })

  it('rejects a font that is not on the allowlist', () => {
    // The renderer falls back silently, so an invented family is a clip that
    // quietly looks wrong rather than an error anyone would notice.
    expect(sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, fontFamily: 'Papyrus' } })).toBeNull()
  })

  it('rejects a colour that is not hex', () => {
    for (const color of ['red', 'transparent', 'inherit', 'rgb(255,0,0)', '#ff', 'notacolor']) {
      expect(sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, color } })).toBeNull()
    }
  })
})

describe('sanitizeCustomTreatment — acceptance', () => {
  it('accepts the minimal look', () => {
    const out = sanitizeCustomTreatment(minimal)!
    expect(out.name).toBe('Neon Slam')
    expect(out.style.fontFamily).toBe('Impact')
    expect(out.motion.in).toEqual({ opacity: 0, offsetX: -0.3 })
  })

  it('matches a font case-insensitively and returns the allowlist spelling', () => {
    const out = sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, fontFamily: 'trebuchet ms' } })!
    expect(out.style.fontFamily).toBe('Trebuchet MS')
    expect(ALLOWED_FONTS).toContain(out.style.fontFamily as (typeof ALLOWED_FONTS)[number])
  })

  it('names an unnamed look rather than leaving the card blank', () => {
    const { name, ...unnamed } = minimal
    void name
    expect(sanitizeCustomTreatment(unnamed)!.name).toBe('Custom look')
  })

  it('defaults weight and alignment instead of rejecting on them', () => {
    const out = sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, fontWeight: 'heavy', textAlign: 'justify' } })!
    expect(out.style.fontWeight).toBe('normal')
    expect(out.style.textAlign).toBe('center')
  })

  it('clamps every numeric into a range that stays on stage', () => {
    const out = sanitizeCustomTreatment({
      ...minimal,
      style: { ...minimal.style, fontSize: 9999 },
      motion: { in: { offsetX: -50, scale: 0, rotation: 1000, opacity: 5 }, rampFraction: 10 },
    })!
    expect(out.style.fontSize).toBe(CUSTOM_BOUNDS.fontSize.max)
    expect(out.motion.in!.offsetX).toBe(CUSTOM_BOUNDS.offset.min)
    expect(out.motion.in!.scale).toBe(CUSTOM_BOUNDS.scale.min)
    expect(out.motion.in!.rotation).toBe(CUSTOM_BOUNDS.rotation.max)
    // opacity 5 clamps to 1, which IS rest — so it is dropped rather than kept
    // as a fade from full to full. See the rest-channel tests below.
    expect(out.motion.in!.opacity).toBeUndefined()
    expect(out.motion.rampFraction).toBe(CUSTOM_BOUNDS.rampFraction.max)
  })

  it('drops a motion end that animates nothing', () => {
    const out = sanitizeCustomTreatment({ ...minimal, motion: { in: { ease: 'linear' }, out: {}, rampFraction: 0.1 } })!
    // `ease` alone drives no channel, but it is a recognised field, so `in`
    // survives; `out` is empty and must not become a ramp with no effect.
    expect(out.motion.out).toBeUndefined()
  })

  it('rejects an unknown easing without rejecting the look', () => {
    const out = sanitizeCustomTreatment({ ...minimal, motion: { in: { opacity: 0, ease: 'warp-speed' }, rampFraction: 0.1 } })!
    expect(out.motion.in!.ease).toBeUndefined()
    expect(out.motion.in!.opacity).toBe(0)
  })

  it('fills the box defaults once a background colour is given', () => {
    const out = sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, backgroundColor: '#000000' } })!
    expect(out.style.backgroundOpacity).toBe(1)
    expect(out.style.padding).toBe(16)
  })

  it('ignores a border with only half of what it needs to draw', () => {
    const widthOnly = sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, borderWidth: 4 } })!
    expect(widthOnly.style.borderWidth).toBeUndefined()

    const colorOnly = sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, borderColor: '#ff0000' } })!
    expect(colorOnly.style.borderWidth).toBeUndefined()

    const both = sanitizeCustomTreatment({ ...minimal, style: { ...minimal.style, borderWidth: 4, borderColor: '#ff0000' } })!
    expect(both.style.borderWidth).toBe(4)
    expect(both.style.borderColor).toBe('#ff0000')
  })

  it('keeps a known position and drops an invented one', () => {
    expect(sanitizeCustomTreatment({ ...minimal, position: 'lower-third' })!.position).toBe('lower-third')
    expect(sanitizeCustomTreatment({ ...minimal, position: 'diagonally' })!.position).toBeUndefined()
  })
})

describe('buildCustomPatch', () => {
  it('never rewrites the clip’s words', () => {
    expect(buildCustomPatch(sanitizeCustomTreatment(minimal)!, clip())).not.toHaveProperty('content')
  })

  it('clears a previous look’s chip rather than accumulating onto it', () => {
    // Same "clean, not cumulative" contract applyTextTemplate documents: every
    // optional box field is present, undefined when unused.
    const patch = buildCustomPatch(sanitizeCustomTreatment(minimal)!, clip())
    for (const key of ['backgroundColor', 'backgroundOpacity', 'padding', 'borderRadius', 'borderWidth', 'borderColor']) {
      expect(key in patch).toBe(true)
      expect(patch[key as keyof typeof patch]).toBeUndefined()
    }
  })

  it('resolves the ramp against the clip, so a short clip cannot get a long one', () => {
    const custom = sanitizeCustomTreatment({ ...minimal, motion: { in: { opacity: 0 }, rampFraction: 0.5 } })!
    expect(buildCustomPatch(custom, clip({ durationFrames: 9 })).textAnimation?.durationFrames).toBe(4)
  })

  it('carries the authored motion through unchanged', () => {
    const custom = sanitizeCustomTreatment(minimal)!
    const patch = buildCustomPatch(custom, clip())
    expect(patch.textAnimation?.inMotion).toEqual({ opacity: 0, offsetX: -0.3 })
  })
})

describe('customFromFlat', () => {
  const flat = {
    name: 'Left Sweep',
    fontFamily: 'Impact',
    fontWeight: 'bold',
    fontSize: 84,
    textAlign: 'center',
    color: '#ffffff',
    inOpacity: 0,
    inOffsetX: -0.35,
    inEase: 'expo-out',
    outOpacity: 0,
    outOffsetX: 0.35,
    rampFraction: 0.12,
  }

  it('reassembles the nested shape the renderer wants', () => {
    const out = customFromFlat(flat)!
    expect(out.name).toBe('Left Sweep')
    expect(out.style.fontSize).toBe(84)
    expect(out.motion.in).toEqual({ opacity: 0, offsetX: -0.35, ease: 'expo-out' })
    expect(out.motion.out).toEqual({ opacity: 0, offsetX: 0.35 })
  })

  it('drops the nulls strict mode forces the model to send', () => {
    const out = customFromFlat({ ...flat, inOffsetY: null, inScale: null, outEase: null, backgroundColor: null })!
    expect(out.motion.in).toEqual({ opacity: 0, offsetX: -0.35, ease: 'expo-out' })
    expect(out.style.backgroundColor).toBeUndefined()
  })

  it('still enforces the allowlists — reshaping is not accepting', () => {
    expect(customFromFlat({ ...flat, fontFamily: 'Papyrus' })).toBeNull()
    expect(customFromFlat({ ...flat, color: 'red' })).toBeNull()
  })

  it('rejects junk', () => {
    expect(customFromFlat(null)).toBeNull()
    expect(customFromFlat({})).toBeNull()
  })
})

describe('rest-valued channels', () => {
  it('drops a channel already at rest, because it animates nothing', () => {
    // Strict mode makes the model send every channel; it fills the ones it does
    // not mean with rest values. A pure spin must not be stored as four no-ops.
    const out = customFromFlat({
      name: 'Spin',
      fontFamily: 'serif',
      fontSize: 48,
      color: '#ffffff',
      inOpacity: 1,
      inOffsetX: 0,
      inOffsetY: 0,
      inScale: 1,
      inRotation: Math.PI * 2,
      inEase: 'cubic-out',
      rampFraction: 0.2,
    })!
    expect(out.motion.in).toEqual({ rotation: Math.PI * 2, ease: 'cubic-out' })
  })

  it('drops the whole end when every channel is at rest', () => {
    const out = customFromFlat({
      name: 'Nothing',
      fontFamily: 'serif',
      fontSize: 48,
      color: '#ffffff',
      inOpacity: 0,
      outOpacity: 1,
      outScale: 1,
      outEase: 'linear',
      rampFraction: 0.2,
    })!
    // An easing with nothing to ease is not motion.
    expect(out.motion.out).toBeUndefined()
    expect(out.motion.in).toEqual({ opacity: 0 })
  })

  it('keeps a real value that happens to be near rest', () => {
    const out = customFromFlat({
      name: 'Subtle',
      fontFamily: 'serif',
      fontSize: 48,
      color: '#ffffff',
      inScale: 0.98,
      rampFraction: 0.2,
    })!
    expect(out.motion.in).toEqual({ scale: 0.98 })
  })
})
