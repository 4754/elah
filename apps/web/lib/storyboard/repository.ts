/**
 * Where a storyboard lives.
 */

import type { Storyboard } from './types'

export const STORYBOARDS_KEY = 'myeditor-storyboards'

export type StoryboardStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface StoryboardRepository {
  list(): Storyboard[]
  save(entry: Storyboard): void
  remove(id: string): void
}

export function storyboardStoreOrNull(): StoryboardStore | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isStoryboard(value: unknown): value is Storyboard {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<Storyboard>
  if (typeof entry.id !== 'string' || typeof entry.title !== 'string') return false
  if (typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string') return false
  if (entry.aspect !== '9/16' && entry.aspect !== '16/9') return false
  if (!Array.isArray(entry.scenes)) return false
  return entry.scenes.every((scene) => {
    if (!scene || typeof scene !== 'object') return false
    const s = scene as Partial<Storyboard['scenes'][number]>
    return (
      typeof s.id === 'string' &&
      (s.kind === 'still' || s.kind === 'motion') &&
      typeof s.prompt === 'string' &&
      typeof s.durationSec === 'number' &&
      Array.isArray(s.subjects)
    )
  })
}

function readAll(store: StoryboardStore): Storyboard[] {
  let raw: string | null = null
  try {
    raw = store.getItem(STORYBOARDS_KEY)
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoryboard)
  } catch {
    return []
  }
}

function writeAll(store: StoryboardStore, entries: Storyboard[]): void {
  try {
    store.setItem(STORYBOARDS_KEY, JSON.stringify(entries))
  } catch {
    // A full or blocked storage costs the resume, not the work in front of the
    // user — the session's own state is in the zustand store either way.
  }
}

export function localStoryboardRepository(
  store: StoryboardStore | null = storyboardStoreOrNull(),
): StoryboardRepository {
  if (!store) {
    return { list: () => [], save: () => {}, remove: () => {} }
  }
  return {
    list: () => readAll(store),
    save: (entry) => {
      const rest = readAll(store).filter((other) => other.id !== entry.id)
      writeAll(store, [entry, ...rest])
    },
    remove: (id) => {
      writeAll(
        store,
        readAll(store).filter((entry) => entry.id !== id),
      )
    },
  }
}
