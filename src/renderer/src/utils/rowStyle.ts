/** Tailwind class for a virtualized row at `index`, alternating a faint background so long lists stay easy to scan. */
export function zebraRowClass(index: number): string {
  return index % 2 === 1 ? 'bg-elevated/40' : ''
}
