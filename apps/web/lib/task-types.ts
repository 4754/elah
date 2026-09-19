/** Uppercase on the wire — matches the backend's `TaskStatus` enum. */
export type TaskStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED']

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export type Tier = 'fast' | 'balanced' | 'high' | 'max'
export type ImageSize = 'square' | 'portrait_16_9' | 'landscape_16_9'
export type VideoDuration = 5 | 10
export const DEFAULT_VIDEO_DURATION_SECONDS: VideoDuration = 5
export const VIDEO_DURATIONS_SECONDS: readonly VideoDuration[] = [5, 10]
