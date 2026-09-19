/**
 * The Tab-wrapping rule behind `components/ui/Dialog`.
 */

export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function nextTrapFocus<T>(
  nodes: readonly T[],
  active: T | null,
  backward: boolean,
  panel: T | null = null,
): T | null {
  if (nodes.length === 0) return null
  const first = nodes[0]
  const last = nodes[nodes.length - 1]

  if (!backward) return active === last ? first : null

  return active === first || (panel !== null && active === panel) ? last : null
}
