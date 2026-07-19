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

/**
 * Extracts the full paths of a key's direct child subkeys from a plain
 * `reg query "<key>"` (no `/s`) invocation's stdout. Subkey lines are always
 * printed with the fully-qualified hive name (`HKEY_CURRENT_USER\...`)
 * regardless of which alias (`HKCU`/`HKEY_CURRENT_USER`) was used to query.
 *
 * The query's own echoed header line (always the first line) uses whatever
 * form was passed to `reg query` — which, when recursing with an
 * already-fully-qualified subkey path (as WinSCP folder-group recursion
 * does), is ITSELF a full `HKEY_CURRENT_USER\...` string. Matching by the
 * `HKEY_` prefix alone would then mistake that echoed header for one of its
 * own children, causing infinite self-recursion — so the header line is
 * always skipped positionally first, and only the remaining lines are
 * matched against the hive-prefix pattern.
 */
export function listRegSubkeyPaths(output: string): string[] {
  const [, ...rest] = output.split(/\r?\n/)
  return rest.map((line) => line.trim()).filter((line) => /^HKEY_[A-Z_]+\\/i.test(line))
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
