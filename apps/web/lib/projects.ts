import { api } from './api'

export type ProjectKind = 'SOCIAL_POST' | 'PRODUCT_SHOT' | 'PROMO_VIDEO' | 'BLANK'
export type ProjectStatus = 'DRAFT' | 'READY' | 'ARCHIVED'

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface GalleryItem {
  id: string
  url: string
  type: 'video' | 'image' | 'audio'
  prompt: string
  width?: number | null
  height?: number | null
  catalog?: Record<string, unknown> | null
}

export interface GalleryPageFilters {
  taskType?: string
  batchId?: string
  characterId?: string
  mediaType?: string
}

export interface Project {
  id: string
  name: string
  kind: ProjectKind
  status: ProjectStatus
  thumbnailUrl: string | null
  documentVersion: number
  hasDocument: boolean
  workflowDocumentVersion?: number
  workflow?: string | null
  assetCount: number
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectDetail extends Project {
  document: Record<string, unknown> | null
  workflowDocument?: Record<string, unknown> | null
}

export const PROJECTS_PAGE_SIZE = 24
export const PROJECT_ASSETS_PAGE_SIZE = 24

export interface ListProjectsQuery {
  status?: ProjectStatus
  kind?: ProjectKind
  workflow?: string
}

export function listProjects(
  page = 1,
  limit = PROJECTS_PAGE_SIZE,
  query: ListProjectsQuery = {},
): Promise<Paginated<Project>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (query.status) params.set('status', query.status)
  if (query.kind) params.set('kind', query.kind)
  if (query.workflow) params.set('workflow', query.workflow)
  return api<Paginated<Project>>(`/projects?${params}`)
}

export const createProject = (body: {
  name?: string
  kind?: ProjectKind
  workflow?: string
}) => api<ProjectDetail>('/projects', { method: 'POST', body: JSON.stringify(body) })

export const openProject = (id: string) => api<ProjectDetail>(`/projects/${id}`)

export const updateProject = (id: string, body: { name?: string; status?: ProjectStatus }) =>
  api<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const saveProjectDocument = (
  id: string,
  document: Record<string, unknown>,
  documentVersion: number,
) =>
  api<ProjectDetail>(`/projects/${id}/document`, {
    method: 'PUT',
    body: JSON.stringify({ document, documentVersion }),
  })

export const saveWorkflowDocument = (
  id: string,
  workflowDocument: Record<string, unknown>,
  workflowDocumentVersion: number,
) =>
  api<ProjectDetail>(`/projects/${id}/workflow-document`, {
    method: 'PUT',
    body: JSON.stringify({ workflowDocument, workflowDocumentVersion }),
  })

export const deleteProject = (id: string) =>
  api<{ ok: true; deletedAssets: number }>(`/projects/${id}`, { method: 'DELETE' })

export const getProjectAssetsPage = (
  id: string,
  page = 1,
  limit = PROJECT_ASSETS_PAGE_SIZE,
  search = '',
  filters: GalleryPageFilters = {},
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  const term = search.trim().toLowerCase()
  if (term) params.set('search', term)
  if (filters.taskType) params.set('taskType', filters.taskType)
  if (filters.batchId) params.set('batchId', filters.batchId)
  if (filters.characterId) params.set('characterId', filters.characterId)
  if (filters.mediaType) params.set('mediaType', filters.mediaType)
  return api<Paginated<GalleryItem>>(`/projects/${id}/assets?${params}`)
}

// ---------------------------------------------------------------------------
// Pure helpers — no network, no clock
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ProjectKind, string> = {
  SOCIAL_POST: 'Social post',
  PRODUCT_SHOT: 'Product photo',
  PROMO_VIDEO: 'Promo video',
  BLANK: 'Blank',
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as ProjectKind] ?? KIND_LABEL.BLANK
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const elapsed = now - then

  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`
  if (elapsed < 4 * WEEK) return `${Math.floor(elapsed / WEEK)}w ago`

  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function projectDisplayName(name: string): string {
  return name.trim() || 'Untitled project'
}

export const isArchived = (project: Pick<Project, 'status'>): boolean =>
  project.status === 'ARCHIVED'

export const PROJECT_SWITCHER_LIMIT = PROJECTS_PAGE_SIZE

export interface ProjectSwitchOption {
  id: string
  name: string
  current: boolean
  assetCount: number | null
}

export function projectSwitchOptions(
  projects: readonly Pick<Project, 'id' | 'name' | 'status' | 'assetCount'>[],
  current: { id: string; name: string },
  limit = PROJECT_SWITCHER_LIMIT,
): ProjectSwitchOption[] {
  const loaded = projects.find((p) => p.id === current.id)
  const head: ProjectSwitchOption = {
    id: current.id,
    name: projectDisplayName(loaded?.name ?? current.name),
    current: true,
    assetCount: loaded?.assetCount ?? null,
  }

  const rest = projects
    .filter((p) => p.id !== current.id && !isArchived(p))
    .map((p) => ({
      id: p.id,
      name: projectDisplayName(p.name),
      current: false,
      assetCount: p.assetCount,
    }))

  return [head, ...rest].slice(0, Math.max(1, limit))
}

export function searchProjects<T extends Pick<Project, 'name'>>(projects: T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return projects
  return projects.filter((p) => p.name.toLowerCase().includes(needle))
}

export function deleteWarning(assetCount: number | null): string {
  if (assetCount === null) {
    return 'Everything made in this project will be deleted with it. This cannot be undone.'
  }
  if (assetCount === 0) {
    return 'This project is empty, so nothing else is lost. This cannot be undone.'
  }
  const noun = assetCount === 1 ? 'picture or video' : 'pictures and videos'
  return `The ${assetCount} ${noun} in this project will be deleted too. This cannot be undone.`
}

export function assetCountLabel(count: number): string {
  if (count === 0) return 'Nothing yet'
  return `${count} item${count === 1 ? '' : 's'}`
}

export function hasStoredDocument(document: unknown): boolean {
  return document !== null && document !== undefined
}
