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
