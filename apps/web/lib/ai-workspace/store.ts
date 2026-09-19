import { create } from 'zustand'

export type ComposerMode = 'generate' | 'agentic'
export type ComposerTab = 'image' | 'video' | 'lipsync' | 'text'

export type AgenticCardKind =
  | 'clarify'
  | 'plan'
  | 'progress'
  | 'result'
  | 'subtitles'

export type ChatCardKind = AgenticCardKind | 'text-treatment'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  assetIds?: string[]
  pending?: boolean
  mode?: ComposerMode
  card?: ChatCardKind
  treatmentId?: string
}

interface AIWorkspaceState {
  chatCollapsed: boolean
  composerMode: ComposerMode
  composerTab: ComposerTab
  prompt: string
  messages: ChatMessage[]
  error: string | null
  captionTrackIds: string[]
}

interface AIWorkspaceActions {
  setChatCollapsed: (collapsed: boolean) => void
  setComposerMode: (mode: ComposerMode) => void
  setComposerTab: (tab: ComposerTab) => void
  setPrompt: (prompt: string) => void
  appendMessage: (message: ChatMessage) => void
  clearCards: () => void
  resolvePendingMessage: (id: string, patch: Partial<ChatMessage>) => void
  setError: (error: string | null) => void
  setCaptionTrackIds: (ids: string[]) => void
  reset: () => void
}

export const useAIWorkspaceStore = create<AIWorkspaceState & AIWorkspaceActions>((set) => ({
  chatCollapsed: false,
  composerMode: 'generate',
  composerTab: 'text',
  prompt: '',
  messages: [],
  error: null,
  captionTrackIds: [],

  setChatCollapsed: (chatCollapsed) => set({ chatCollapsed }),
  setComposerMode: (composerMode) => set({ composerMode }),
  setComposerTab: (composerTab) => set({ composerTab }),
  setPrompt: (prompt) => set({ prompt }),
  appendMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  clearCards: () =>
    set((s) => ({ messages: s.messages.filter((m) => !m.card || m.card === 'text-treatment') })),
  resolvePendingMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch, pending: false } : m)),
    })),
  setError: (error) => set({ error }),
  setCaptionTrackIds: (captionTrackIds) => set({ captionTrackIds }),
  reset: () =>
    set({
      chatCollapsed: false,
      composerMode: 'generate',
      composerTab: 'text',
      prompt: '',
      messages: [],
      error: null,
      captionTrackIds: [],
    }),
}))
