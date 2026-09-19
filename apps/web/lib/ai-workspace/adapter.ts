import { beginImportUrl, importUrl } from '@elah/editor'
import { proxyGalleryAsset } from '../gallery/proxyAsset'

export interface GeneratedMedia {
  url: string
  width?: number
  height?: number
  catalog?: {
    tags: string[]
    summary: string
    frameCount: number
    topObjects: Array<{ name: string; occurrences: number }>
    durationSec: number
  }
}

/**
 * Register finished media in the editor's library so it's draggable onto the
 * timeline. `beginImportUrl` dedupes on src and returns immediately with a
 * pending asset that grows into its real duration once probed.
 *
 * Everything is proxied for CORS, exactly as the gallery insert paths do —
 * these assets are dragged onto the timeline from the same store, so an
 * unproxied src would render blank.
 *
 * `opts.awaitMetadata` swaps to `importUrl`, which blocks on the same probe
 * instead of backfilling it later — for callers (the agentic compose flow)
 * that place a clip onto the timeline immediately from the returned asset and
 * have no later step that would resize it once the real duration lands.
 */
export async function importGeneratedMedia(
  media: GeneratedMedia,
  outputKind: 'video' | 'image' | 'audio',
  name: string,
  opts?: { awaitMetadata?: boolean },
) {
  const src = proxyGalleryAsset(media.url, outputKind)
  const analysis = media.catalog ?? undefined

  if (opts?.awaitMetadata) {
    try {
      return await importUrl(src, { kind: outputKind, name, analysis })
    } catch (err) {
      console.warn(`[importGeneratedMedia] metadata probe failed for "${name}", falling back to placeholder:`, err)
    }
  }

  return beginImportUrl(src, {
    kind: outputKind,
    name,
    dimensions: media.width && media.height ? { width: media.width, height: media.height } : undefined,
    analysis,
  })
}
