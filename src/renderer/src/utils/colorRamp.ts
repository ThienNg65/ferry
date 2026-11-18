/**
 * Generates an 11-step accent color ramp (Nuxt UI's shade scale) from a
 * single user-picked hex color.
 *
 * Holds hue and saturation constant (taken from the picked color) and solves
 * HSL lightness per shade step to hit fixed WCAG relative-luminance targets,
 * so bright hues (such as green, yellow, or cyan) still guarantee >= 4.5:1
 * contrast for `--ui-primary` (shade 600 on white, shade 400 on dark surfaces).
 */
export type ShadeKey = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950
export type ShadeRamp = Record<ShadeKey, string>

const SHADE_KEYS: ShadeKey[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

/** Target WCAG relative luminance (0–1) per shade step. */
const SHADE_LUMINANCE: Record<ShadeKey, number> = {
  50: 0.94,
  100: 0.85,
  200: 0.7,
  300: 0.52,
  400: 0.34,
  500: 0.23,
  600: 0.155,
  700: 0.105,
  800: 0.07,
  900: 0.045,
  950: 0.024
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (channel: number): number => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const [ra, ga, ba] = hexToRgb(hexA)
  const [rb, gb, bb] = hexToRgb(hexB)
  const la = relativeLuminance(ra, ga, ba)
  const lb = relativeLuminance(rb, gb, bb)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

/** Returns hue in [0, 360) and saturation in [0, 1] — lightness is deliberately discarded (the caller supplies its own per shade). */
function rgbToHueSaturation(r: number, g: number, b: number): { h: number; s: number } {
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  if (max === min) {
    return { h: 0, s: 0 }
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rf:
      h = (gf - bf) / d + (gf < bf ? 6 : 0)
      break
    case gf:
      h = (bf - rf) / d + 2
      break
    default:
      h = (rf - gf) / d + 4
  }
  return { h: h * 60, s }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hk = h / 360
  const r = hue2rgb(p, q, hk + 1 / 3)
  const g = hue2rgb(p, q, hk)
  const b = hue2rgb(p, q, hk - 1 / 3)
  return [r * 255, g * 255, b * 255]
}

function findLightnessForLuminance(h: number, s: number, targetLum: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const [r, g, b] = hslToRgb(h, s, mid)
    if (relativeLuminance(r, g, b) < targetLum) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}

export function generateShadeRamp(baseHex: string): ShadeRamp {
  const [r, g, b] = hexToRgb(baseHex)
  const { h, s } = rgbToHueSaturation(r, g, b)
  const ramp = {} as ShadeRamp
  for (const shade of SHADE_KEYS) {
    const l = findLightnessForLuminance(h, s, SHADE_LUMINANCE[shade])
    const [rr, gg, bb] = hslToRgb(h, s, l)
    ramp[shade] = rgbToHex(rr, gg, bb)
  }
  return ramp
}
