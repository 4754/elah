/**
 * The storyboard waiting to be laid onto a timeline.
 */

export const PENDING_STORYBOARD_KEY = 'myeditor-pending-storyboard'
export const PENDING_STORYBOARD_MAX_AGE_MS = 60 * 60_000

export type HandoffStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface PendingStoryboardRecord {
  storyboardId: string
  projectId: string
  updatedAt: number
}

export function handoffStoreOrNull(): HandoffStore | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is PendingStoryboardRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PendingStoryboardRecord>
  return (
    typeof record.storyboardId === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.updatedAt === 'number'
  )
}

export function readPendingStoryboard(
  store: HandoffStore | null = handoffStoreOrNull(),
  now: number = Date.now(),
): PendingStoryboardRecord | null {
  if (!store) return null
  let raw: string | null = null
  try {
    raw = store.getItem(PENDING_STORYBOARD_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearPendingStoryboard(store)
    return null
  }

  if (!isRecord(parsed) || now - parsed.updatedAt > PENDING_STORYBOARD_MAX_AGE_MS) {
    clearPendingStoryboard(store)
    return null
  }
  return parsed
}

export function writePendingStoryboard(
  record: Omit<PendingStoryboardRecord, 'updatedAt'>,
  store: HandoffStore | null = handoffStoreOrNull(),
  now: number = Date.now(),
): PendingStoryboardRecord {
  const stamped: PendingStoryboardRecord = { ...record, updatedAt: now }
  if (!store) return stamped
  try {
    store.setItem(PENDING_STORYBOARD_KEY, JSON.stringify(stamped))
  } catch {
    // A full or blocked storage costs the handoff, not the storyboard.
  }
  return stamped
}

export function clearPendingStoryboard(
  store: HandoffStore | null = handoffStoreOrNull(),
): void {
  if (!store) return
  try {
    store.removeItem(PENDING_STORYBOARD_KEY)
  } catch {
    // Nothing the caller can do, and nothing that breaks if it fails.
  }
}
