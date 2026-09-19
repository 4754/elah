/**
 * The storyboard's whole vocabulary.
 */

import type { CreativeBlueprint } from '../agentic/types'
import type { MotionAsset } from '../motion/types'

export type SceneKind = 'still' | 'motion'
export type SceneStatus = 'draft' | 'queued' | 'rendering' | 'done' | 'error'

export interface SceneClip {
  batchId: string
  url: string
  posterUrl: string | null
  durationSec: number
}

export interface StoryboardScene {
  id: string
  kind: SceneKind
  purpose: string
  prompt: string
  durationSec: number
  narration?: string
  subjects: MotionAsset[]
  clip?: SceneClip
  status: SceneStatus
  error?: string
  trimInSec?: number
  trimOutSec?: number
}

export interface Storyboard {
  id: string
  title: string
  brief: string
  aspect: '9/16' | '16/9'
  projectId?: string
  scenes: StoryboardScene[]
  blueprint?: CreativeBlueprint
  createdAt: string
  updatedAt: string
}

export function isSceneReady(scene: StoryboardScene): boolean {
  if (scene.kind === 'still') return scene.subjects.length > 0
  return scene.status === 'done' && Boolean(scene.clip?.url)
}

export function needsRender(scene: StoryboardScene): boolean {
  return scene.kind === 'motion' && !isSceneReady(scene)
}

export function sceneRuntimeSec(scene: StoryboardScene): number {
  const measured = scene.clip?.durationSec ?? 0
  if (scene.kind === 'motion' && measured > 0) return Math.min(scene.durationSec, measured)
  return scene.durationSec
}

export function storyboardRuntimeSec(scenes: readonly StoryboardScene[]): number {
  return scenes.reduce((total, scene) => total + sceneRuntimeSec(scene), 0)
}
