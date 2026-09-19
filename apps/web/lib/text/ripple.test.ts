import { describe, expect, it } from 'vitest'
import { parkFrame, resolveInsertFrame, rippleShifts } from './ripple'

// Three clips back to back, 90 frames each, plus the freshly inserted one that
// `insertElement` could only place past the end — the exact shape a few "add
// text" turns produces, and the one where gap-based placement always lands at
// the end.
const packed = [
  { id: 'a', startFrame: 0, durationFrames: 90 },
  { id: 'b', startFrame: 90, durationFrames: 90 },
  { id: 'c', startFrame: 180, durationFrames: 90 },
  { id: 'new', startFrame: 270, durationFrames: 90 },
]

describe('rippleShifts', () => {
  it('moves everything from the insertion point onward', () => {
    // Inserting after 'b' means opening a slot at 180.
    expect(rippleShifts(packed, 180, 'new', 90)).toEqual([
      { id: 'new', startFrame: 360 },
      { id: 'c', startFrame: 270 },
    ].filter((s) => s.id !== 'new'))
  })

  it('never shifts the clip it is making room for', () => {
    const shifts = rippleShifts(packed, 180, 'new', 90)
    expect(shifts.map((s) => s.id)).not.toContain('new')
  })

  it('leaves clips before the insertion point alone', () => {
    const shifts = rippleShifts(packed, 180, 'new', 90)
    expect(shifts.map((s) => s.id)).toEqual(['c'])
  })

  it('returns rightmost first, so applying them never overlaps', () => {
    const shifts = rippleShifts(packed, 0, 'new', 90)
    expect(shifts.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('shifts a clip that starts exactly at the insertion point', () => {
    // The boundary case: 'b' starts at 90 and inserting at 90 must move it,
    // or the new clip lands on top of it.
    expect(rippleShifts(packed, 90, 'new', 90)).toContainEqual({ id: 'b', startFrame: 180 })
  })

  it('moves nothing when inserting past everything', () => {
    expect(rippleShifts(packed, 9999, 'new', 90)).toEqual([])
  })

  it('moves nothing for a zero or negative duration', () => {
    expect(rippleShifts(packed, 0, 'new', 0)).toEqual([])
    expect(rippleShifts(packed, 0, 'new', -30)).toEqual([])
  })

  it('preserves the gaps between clips it moves', () => {
    const gapped = [
      { id: 'a', startFrame: 0, durationFrames: 90 },
      { id: 'b', startFrame: 200, durationFrames: 90 },
      { id: 'new', startFrame: 500, durationFrames: 90 },
    ]
    const shifts = rippleShifts(gapped, 0, 'new', 90)
    const moved = Object.fromEntries(shifts.map((s) => [s.id, s.startFrame]))
    expect(moved.b - moved.a).toBe(200)
  })
})

describe('parkFrame', () => {
  it('clears every clip on the track', () => {
    // 'new' ends at 360, so anything at or past 360 is free.
    expect(parkFrame(packed, 90)).toBeGreaterThanOrEqual(360)
  })

  it('leaves room for the shifts that follow', () => {
    // Every shifted clip moves right by `durationFrames`. The furthest of them,
    // 'c' at 180, ends up at 270 + 90 = 360 — which must not reach the park.
    const park = parkFrame(packed, 90)
    const shifted = rippleShifts(packed, 0, 'new', 90)
    for (const s of shifted) {
      const clip = packed.find((c) => c.id === s.id)!
      expect(s.startFrame + clip.durationFrames).toBeLessThanOrEqual(park)
    }
  })

  it('is past the end even on an empty track', () => {
    expect(parkFrame([], 90)).toBeGreaterThan(0)
  })

  it('never returns the same frame for a zero-length clip', () => {
    // Guards the degenerate case: a park equal to the end would still overlap.
    expect(parkFrame(packed, 0)).toBeGreaterThan(360)
  })
})

describe('resolveInsertFrame', () => {
  // One long clip, and the freshly inserted one past the end of it.
  const straddled = [
    { id: 'long', startFrame: 0, durationFrames: 300 },
    { id: 'new', startFrame: 300, durationFrames: 90 },
  ]

  it('moves the insertion point clear of a clip it falls inside', () => {
    // Without this the caller places 'new' at 150, inside 0-300, and the engine
    // rejects the overlap.
    expect(resolveInsertFrame(straddled, 150, 'new')).toBe(300)
  })

  it('leaves a point that lands in open space alone', () => {
    expect(resolveInsertFrame(straddled, 400, 'new')).toBe(400)
  })

  it('treats a clip boundary as open, not as straddling', () => {
    // 300 is where 'long' ends. Nothing covers it, so "after the 2nd element" —
    // which is always an end frame — is never rewritten.
    expect(resolveInsertFrame(straddled, 300, 'new')).toBe(300)
    expect(resolveInsertFrame(straddled, 0, 'new')).toBe(0)
  })

  it('ignores the clip being placed', () => {
    // 'new' covers 300-390, but it is the one moving and must not push itself.
    expect(resolveInsertFrame(straddled, 350, 'new')).toBe(350)
  })

  it('clears the furthest end when clips overlap each other', () => {
    const overlapping = [
      { id: 'a', startFrame: 0, durationFrames: 300 },
      { id: 'b', startFrame: 100, durationFrames: 400 },
    ]
    expect(resolveInsertFrame(overlapping, 150, 'new')).toBe(500)
  })

  it('is a no-op on an empty track', () => {
    expect(resolveInsertFrame([], 150, 'new')).toBe(150)
  })
})
