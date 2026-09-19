const MAX_LEN = 40

/**
 * Gallery items are named after the full AI generation prompt, which can run
 * to a paragraph. Anything downstream that displays a clip/asset name (the
 * audio-drop dialog, the properties panel header, clip blocks) shouldn't show
 * that whole paragraph — so every import call site caps it here instead of
 * threading truncation logic through each consumer.
 *
 * Cuts at the first sentence boundary, or a word boundary near `MAX_LEN`
 * characters, whichever is shorter. Falls back to `'Generated'` for an empty
 * or missing prompt.
 */
export function shortAssetName(prompt?: string | null): string {
  const trimmed = prompt?.trim()
  if (!trimmed) return 'Generated'

  const sentenceEnd = trimmed.search(/[.!?](\s|$)/)
  if (sentenceEnd !== -1 && sentenceEnd <= MAX_LEN) {
    return trimmed.slice(0, sentenceEnd + 1)
  }

  if (trimmed.length <= MAX_LEN) return trimmed

  const cut = trimmed.slice(0, MAX_LEN)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`
}
