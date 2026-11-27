import { sanitizeCompanionCommand } from '@shared/contract'

const PARAM_RE = /\{\{\s*([a-zA-Z0-9_-]{1,32})\s*\}\}/g

/** Extracts unique `{{param}}` placeholder names in order of first appearance. */
export function extractSnippetParams(command: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(PARAM_RE.source, 'g')
  while ((match = re.exec(command)) !== null) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export interface SnippetParamContext {
  remoteCwd?: string | null
  selectedPath?: string | null
  selectedName?: string | null
  siteName?: string | null
}

/** Suggests smart default values for common `{{param}}` names from active SFTP/session context. */
export function defaultSnippetParamValues(
  params: readonly string[],
  ctx: SnippetParamContext
): Record<string, string> {
  const defaults: Record<string, string> = {}
  for (const name of params) {
    const lower = name.toLowerCase()
    if (lower === 'path' || lower === 'filepath' || lower === 'target') {
      defaults[name] = ctx.selectedPath || ctx.remoteCwd || ''
    } else if (lower === 'file' || lower === 'filename') {
      defaults[name] = ctx.selectedName || ctx.selectedPath || ''
    } else if (lower === 'dir' || lower === 'cwd' || lower === 'folder') {
      defaults[name] = ctx.remoteCwd || ''
    } else if (lower === 'host' || lower === 'site' || lower === 'server') {
      defaults[name] = ctx.siteName || ''
    } else {
      defaults[name] = ''
    }
  }
  return defaults
}

/** Substitutes `{{param}}` placeholders with sanitized single-line values and sanitizes the final command. */
export function interpolateSnippetCommand(
  template: string,
  values: Record<string, string>
): string {
  const replaced = template.replace(new RegExp(PARAM_RE.source, 'g'), (_full, name: string) => {
    const raw = values[name] ?? ''
    return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  })
  return sanitizeCompanionCommand(replaced)
}
