/**
 * A storyboard, in the shape `composeReel` already consumes.
 */

import type { Shot } from '../agentic/types'
import type { StoryboardScene } from './types'

export function sceneToShot(scene: StoryboardScene): Shot {
  return {
    id: scene.id,
    kind: scene.kind,
    prompt: scene.prompt,
    durationSec: scene.durationSec,
    uses: [],
    ...(scene.narration ? { caption: scene.narration } : {}),
  }
}

export function sceneMedia(
  scene: StoryboardScene,
): { url: string; kind: 'video' | 'image'; name: string } | null {
  const name = scene.narration?.trim() || scene.purpose.trim() || scene.id

  if (scene.kind === 'motion') {
    if (!scene.clip?.url) return null
    return { url: scene.clip.url, kind: 'video', name }
  }

  const subject = scene.subjects[0]
  if (!subject?.url) return null
  return { url: subject.url, kind: 'image', name }
}
