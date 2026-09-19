/**
 * Vocabulary of one agentic run: prompt → creative blueprint → shot plan →
 * generation jobs → composed timeline → subtitles.
 */
import type { TaskStatus } from '../task-types'

export type BrandSlot = 'logo' | 'product'

// ---------------------------------------------------------------------------
// Creative Blueprint — the planner's single reasoning output
// ---------------------------------------------------------------------------

export interface BlueprintScene {
  id: string
  purpose: string
  kind: 'still' | 'motion'
  prompt: string
  durationSec: number
  cameraDirection: string
  animationStyle: string
  productPlacement: 'hero' | 'background' | 'none'
  logoUsage: boolean
  hasHumans: boolean
  captionText?: string
}

export interface ProductIdentity {
  identified: boolean
  description: string
}

export interface CreativeBlueprint {
  title: string
  productIdentity: ProductIdentity
  campaignSummary: string
  marketingGoal: string
  targetAudience: string
  brandTone: string
  storyStructure: string
  scenes: BlueprintScene[]
  callToAction: string
  generationRequirements: {
    hasHumans: boolean
  }
}

// ---------------------------------------------------------------------------
// Clarification — the planner's dynamic follow-up questions
// ---------------------------------------------------------------------------

export interface ClarificationOption {
  label: string
  value: string
}

export interface ClarificationQuestion {
  id: string
  field: string
  question: string
  type: 'single_select' | 'multi_select' | 'text'
  options: ClarificationOption[] | null
}

export interface ClarificationAnswer {
  questionId: string
  field: string
  answer: string
}

export const MAX_CLARIFICATION_ROUNDS = 3

export type PlanResponse =
  | { status: 'clarify'; questions: ClarificationQuestion[] }
  | { status: 'ready'; blueprint: CreativeBlueprint }

// ---------------------------------------------------------------------------
// Shot plan — the execution-facing shape
// ---------------------------------------------------------------------------

export const STILL_DURATION_RANGE = { min: 3, max: 5 } as const

export interface Shot {
  id: string
  kind: 'still' | 'motion'
  prompt: string
  durationSec: number
  uses: BrandSlot[]
  caption?: string
}

export interface ShotPlan {
  title: string
  shots: Shot[]
}

export function planDurationSec(plan: ShotPlan): number {
  return plan.shots.reduce((total, s) => total + s.durationSec, 0)
}

export function planCounts(plan: ShotPlan): { images: number; videos: number } {
  let images = 0
  let videos = 0
  for (const shot of plan.shots) {
    if (shot.kind === 'still') {
      images += 1
    } else {
      videos += 1
      images += 1
    }
  }
  return { images, videos }
}

// ---------------------------------------------------------------------------
// Jobs — one paid task each
// ---------------------------------------------------------------------------

export type JobKind = 'still' | 'seed' | 'motion'

export type JobStatus = 'WAITING' | TaskStatus | 'DONE' | 'ERROR'

export interface Job {
  id: string
  shotId: string
  kind: JobKind
  prompt: string
  status: JobStatus
  startedAt: number | null
  estimatedMs: number
  outputUrl?: string
  assetId?: string
  width?: number
  height?: number
  error?: string
}

export function isJobTerminal(status: JobStatus): boolean {
  return status === 'DONE' || status === 'ERROR'
}

// ---------------------------------------------------------------------------
// Run state machine
// ---------------------------------------------------------------------------

export type RunPhase =
  | 'idle'
  | 'planning'
  | 'clarifying'
  | 'review'
  | 'generating'
  | 'composing'
  | 'ready'
  | 'subtitling'
  | 'done'
  | 'error'
  | 'cancelled'

export type RunEvent =
  | { type: 'phase'; phase: RunPhase }
  | { type: 'clarify'; questions: ClarificationQuestion[] }
  | { type: 'blueprint'; blueprint: CreativeBlueprint }
  | { type: 'plan'; plan: ShotPlan }
  | { type: 'jobs'; jobs: Job[] }
  | { type: 'result'; succeeded: number; failed: number; messages: string[]; assetIds: string[] }
  | { type: 'error'; message: string }

export type RunListener = (event: RunEvent) => void
