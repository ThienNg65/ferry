/** Single-quotes a value for safe interpolation into a remote (POSIX) shell command. */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
