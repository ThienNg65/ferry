const SAMPLE = 'mmmmmmmmmmlliWW@#0O'

let ctx: CanvasRenderingContext2D | null | undefined

function width(font: string): number {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d')
  }
  if (!ctx) {
    return 0
  }
  ctx.font = font
  return ctx.measureText(SAMPLE).width
}

export function isFontInstalled(name: string): boolean {
  if (!name) {
    return false
  }
  return ['monospace', 'serif', 'sans-serif'].some((base) => width(`72px '${name}', ${base}`) !== width(`72px ${base}`))
}
