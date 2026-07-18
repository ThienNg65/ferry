import { isArchive } from '@shared/archive'

export { isArchive, archiveKind, archiveBaseName, type ArchiveKind } from '@shared/archive'

const TEXT_EXTENSIONS = new Set([
  // existing
  'txt', 'log', 'conf', 'cfg', 'json', 'yml', 'yaml', 'ini', 'md',
  // structured data / config
  'xml', 'csv', 'tsv', 'env', 'properties', 'toml', 'gitignore', 'editorconfig', 'htaccess', 'service',
  // shell / scripting
  'sh', 'bash', 'zsh', 'py', 'rb', 'php', 'pl',
  // web front-end
  'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte',
  // JS/TS ecosystem
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  // compiled/systems languages
  'c', 'h', 'cpp', 'cc', 'hpp', 'java', 'go', 'rs',
  // misc dev / build
  'sql', 'gradle', 'dockerfile'
])
const LOG_EXTENSIONS = new Set(['log', 'txt'])

function ext(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

/** Whether double-clicking this file should attempt a text preview (vs. offering a download). */
export function isTextPreviewable(name: string): boolean {
  return TEXT_EXTENSIONS.has(ext(name))
}

/** Whether this file should show a "tail" affordance in the preview dialog. */
export function isLogFile(name: string): boolean {
  return LOG_EXTENSIONS.has(ext(name))
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif', 'heic', 'avif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'])
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'ods'])
const DOCUMENT_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'conf', 'cfg', 'ini', 'env', 'properties', 'toml', 'pdf', 'doc', 'docx'
])
const CODE_EXTENSIONS = new Set([
  'json', 'yml', 'yaml', 'xml', 'gitignore', 'editorconfig', 'htaccess', 'service',
  'sh', 'bash', 'zsh', 'py', 'rb', 'php', 'pl',
  'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'c', 'h', 'cpp', 'cc', 'hpp', 'java', 'go', 'rs',
  'sql', 'gradle', 'dockerfile'
])

/** Icon name (Lucide, via Nuxt UI's `i-lucide-*` set) to render for a file-pane row. */
export function iconForFile(name: string, isDir: boolean): string {
  if (isDir) {
    return 'i-lucide-folder'
  }
  if (isArchive(name)) {
    return 'i-lucide-file-archive'
  }
  const extension = ext(name)
  if (extension === 'json') {
    return 'i-lucide-file-json'
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-image'
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-video'
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-audio'
  }
  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-spreadsheet'
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-code'
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-text'
  }
  return 'i-lucide-file'
}

/**
 * Muted-but-distinct color class per file-type bucket — a deliberate,
 * commented exception to "semantic colors only" (the 7 semantic slots can't
 * express per-type identity). Full literal strings (never built dynamically)
 * so Tailwind's source scanner picks them up; the 600/400 light/dark pairing
 * mirrors main.css's own --ui-primary convention. Document types stay a
 * quiet text-muted on purpose — the .txt/.log/.conf long tail shouldn't turn
 * the file list into a fruit salad.
 */
export function colorForFile(name: string, isDir: boolean): string {
  if (isDir) {
    return 'text-primary'
  }
  if (isArchive(name)) {
    return 'text-amber-600 dark:text-amber-400'
  }
  const extension = ext(name)
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'text-violet-600 dark:text-violet-400'
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'text-rose-600 dark:text-rose-400'
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'text-pink-600 dark:text-pink-400'
  }
  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (extension === 'json' || CODE_EXTENSIONS.has(extension)) {
    return 'text-teal-600 dark:text-teal-400'
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return 'text-muted'
  }
  return 'text-dimmed'
}
