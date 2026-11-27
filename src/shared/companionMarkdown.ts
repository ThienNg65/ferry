export const IGNORED_RELEASE_SECTIONS = new Set([
  'tests',
  'test',
  'build system',
  'ci',
  'chores',
  'chore',
  'continuous integration'
])

/**
 * Strips commit hashes, PR/issue links, backticks, and bold markers from a
 * release-please / Keep-a-Changelog bullet line for user-facing display.
 */
export function cleanReleaseMarkdownBullet(text: string): string {
  return text
    .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]+\)\)/gi, '')
    .replace(/\s*\(\[#\d+\]\([^)]+\)\)/g, '')
    .replace(/,\s*closes\s+\[#\d+\]\([^)]+\)/gi, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\*+|\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
