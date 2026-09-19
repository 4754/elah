import type { GalleryItem } from '../projects'

/**
 * Rewrites an AI-gallery media URL to go through our own `/api/gallery/asset`
 * proxy, which injects the `Access-Control-Allow-Origin` header the timeline
 * renderer requires (see the route for the full rationale).
 *
 * Unlike the provider helpers (`proxyPixabayImage` etc.), this does no host
 * check before rewriting: gallery URLs point at our backend for `hosted: true`
 * items and at an arbitrary provider CDN for `hosted: false` ones, so the client
 * can't tell what belongs to the gallery. The route's allow-list is the security
 * boundary regardless — the provider helpers' host regex is only a "should I
 * bother rewriting this" test, never a guard.
 *
 * Non-http(s) URLs (blob:/data:/object URLs) are returned unchanged so this is
 * safe to apply blanketly to any src.
 *
 * `kind` selects the proxy's transfer strategy — video streams through rather
 * than being buffered server-side. Pass `item.type` at every call site.
 */
export function proxyGalleryAsset(
  src: string | null | undefined,
  kind?: GalleryItem['type'],
): string {
  if (!src) return ''
  if (!/^https?:\/\//i.test(src)) return src
  const suffix = kind === 'video' ? '&kind=video' : ''
  return `${GALLERY_PROXY_PATH}?url=${encodeURIComponent(src)}${suffix}`
}

const GALLERY_PROXY_PATH = '/api/gallery/asset'

/**
 * True for a src this module produced — i.e. a library asset that was imported
 * from the backend gallery. Lets a surface that already lists gallery items
 * skip the library copies of those same items instead of showing both.
 */
export function isProxiedGalleryAsset(src: string): boolean {
  return src.startsWith(`${GALLERY_PROXY_PATH}?`)
}
