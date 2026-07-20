/**
 * Pure parsing helpers for `reg query` output — kept separate from
 * {@link SessionImporter} so the actual registry-format parsing can be unit
 * tested against hand-authored fixtures without ever shelling out to `reg.exe`.
 */

/** Parses one `reg query "<key>"` invocation's stdout into that key's own value entries (name -> raw string). */
export function parseRegValues(output: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+(REG_\S+)\s+(.*)$/.exec(line)
    if (m) {
      values.set(m[1], m[3].trim())
    }
  }
  return values
}

/** Short hive aliases `reg query` accepts, mapped to the fully-qualified form its OWN output always uses for subkey paths. */
const HIVE_ALIASES: Record<string, string> = {
  HKCU: 'HKEY_CURRENT_USER',
  HKLM: 'HKEY_LOCAL_MACHINE',
  HKCR: 'HKEY_CLASSES_ROOT',
  HKU: 'HKEY_USERS',
  HKCC: 'HKEY_CURRENT_CONFIG'
}

/** Rewrites a key's leading hive alias (if any) to its fully-qualified form, so it can be compared against `reg query`'s always-fully-qualified subkey lines. */
function toFullyQualified(key: string): string {
  const [first, ...rest] = key.split('\\')
  return [HIVE_ALIASES[first.toUpperCase()] ?? first, ...rest].join('\\')
}

/**
 * Extracts the full paths of a key's direct child subkeys from a plain
 * `reg query "<key>"` (no `/s`) invocation's stdout. Subkey lines are always
 * printed with the fully-qualified hive name (`HKEY_CURRENT_USER\...`)
 * regardless of which alias (`HKCU`/`HKEY_CURRENT_USER`) was used to query.
 *
 * `reg.exe`'s real output does NOT reliably put the queried key's own echoed
 * header at a fixed line position — confirmed empirically (`execFile('reg',
 * ['query', key])`) to start with a BLANK line, with the header (if the key
 * has any values of its own) only appearing on the line after that, and
 * omitted entirely when the key has no values. A positional "skip the first
 * line" (as this function used to do) therefore skips the wrong line on real
 * output, leaving the actual header — which, when recursing with an
 * already-fully-qualified subkey path, is itself a full
 * `HKEY_CURRENT_USER\...` string — to match its own `HKEY_` prefix filter
 * and get misidentified as a child of itself, causing self-recursion (each
 * level appending its own name again). So instead of relying on position at
 * all, this takes the exact key that was queried and explicitly excludes any
 * candidate line that IS that key (normalized to its fully-qualified form),
 * leaving only genuine children.
 */
export function listRegSubkeyPaths(output: string, queriedKey: string): string[] {
  const queriedFullyQualified = toFullyQualified(queriedKey).toLowerCase()
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^HKEY_[A-Z_]+\\/i.test(line))
    .filter((line) => line.toLowerCase() !== queriedFullyQualified)
}

/** Percent-decodes a registry-safe session-key name back to its original form; falls back to the raw name if it's not validly encoded. */
export function decodeSessionName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/** Parses a `REG_DWORD` value as `reg query` prints it (hex, optionally `0x`-prefixed) — falls back if missing/invalid/non-positive. */
export function parseDword(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback
  }
  const n = parseInt(raw.replace(/^0x/i, ''), 16)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
