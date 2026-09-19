export interface MotionAsset {
  id: string
  url: string
  thumbnailUrl?: string | null
  width?: number | null
  height?: number | null
  characterIds?: string[]
  label?: string
}
