export function renameSelectionEnd(name: string, isDir: boolean): number {
  const dot = name.lastIndexOf('.')
  return !isDir && dot > 0 ? dot : name.length
}
