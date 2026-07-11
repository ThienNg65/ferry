const TEXT_EXTENSIONS = new Set(['txt', 'log', 'conf', 'cfg', 'json', 'yml', 'yaml', 'ini', 'md'])
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
