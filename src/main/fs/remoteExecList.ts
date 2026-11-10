import type { FileEntry, FileListResult } from '../../shared/contract'
import { shellEscape } from '../ssh/shellEscape'

/**
 * Compact Python 3 script that executes on the remote server to inspect
 * a directory via `os.scandir`, resolving entries, file sizes, mtimes,
 * octal permissions, and symlink targets in a single local kernel pass.
 */
const PYTHON_DIR_SCRIPT = `import json, os, sys
p = os.path.realpath(sys.argv[1])
entries = []
try:
  with os.scandir(p) as it:
    for e in it:
      try:
        is_sym = e.is_symlink()
        st = e.stat(follow_symlinks=False)
        try:
          is_dir = e.is_dir(follow_symlinks=True) if is_sym else e.is_dir()
        except OSError:
          is_dir = False
        target = os.readlink(e.path) if is_sym else None
        broken = is_sym and not os.path.exists(e.path)
        mtime = int(st.st_mtime * 1000)
        mode = oct(st.st_mode & 0o7777)[2:].zfill(4)
        entries.append({
          'name': e.name,
          'path': os.path.join(p, e.name),
          'isDir': is_dir,
          'size': 0 if is_dir else st.st_size,
          'mtimeMs': mtime if mtime > 0 else 0,
          'permissions': mode,
          'isSymlink': is_sym,
          'symlinkTarget': target,
          'symlinkBroken': broken
        })
      except OSError:
        continue
  print(json.dumps({'path': p, 'entries': entries}))
except Exception:
  sys.exit(2)
`

/**
 * Builds a single remote command that retrieves a complete directory listing
 * in one network round trip via Python 3.
 */
export function buildRemoteListCommand(targetPath: string): string {
  const escapedScript = shellEscape(PYTHON_DIR_SCRIPT)
  const escapedPath = shellEscape(targetPath)
  return `python3 -c ${escapedScript} ${escapedPath}`
}

interface RawExecEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  mtimeMs?: number
  permissions?: string
  isSymlink?: boolean
  symlinkTarget?: string | null
  symlinkBroken?: boolean
}

interface RawExecOutput {
  path: string
  entries: RawExecEntry[]
}

/**
 * Parses the raw stdout from the remote listing command into a typed `FileListResult`.
 * Returns `null` if the output is not valid JSON or does not match the expected schema.
 */
export function parseRemoteListOutput(stdout: string): FileListResult | null {
  const firstBrace = stdout.indexOf('{')
  const lastBrace = stdout.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null
  }

  const trimmed = stdout.slice(firstBrace, lastBrace + 1)

  try {
    const parsed = JSON.parse(trimmed) as Partial<RawExecOutput>
    if (typeof parsed.path !== 'string' || !Array.isArray(parsed.entries)) {
      return null
    }

    const entries: FileEntry[] = []
    for (const item of parsed.entries) {
      if (!item || typeof item.name !== 'string' || typeof item.path !== 'string') {
        continue
      }
      const mtimeMs = typeof item.mtimeMs === 'number' && item.mtimeMs > 0 ? item.mtimeMs : 0
      entries.push({
        name: item.name,
        path: item.path,
        isDir: Boolean(item.isDir),
        size: typeof item.size === 'number' ? item.size : 0,
        modifiedAt: mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null,
        permissions: typeof item.permissions === 'string' ? item.permissions : undefined,
        isSymlink: Boolean(item.isSymlink),
        symlinkTarget: typeof item.symlinkTarget === 'string' ? item.symlinkTarget : undefined,
        symlinkBroken: item.symlinkBroken ? true : undefined
      })
    }

    return {
      path: parsed.path,
      entries
    }
  } catch {
    return null
  }
}
