import { describe, expect, it } from 'vitest'
import {
  SCHEME_OPTIONS,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_STACK,
  DEFAULT_LINE_HEIGHT,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  buildFontFamily,
  clampFontSize,
  clampLineHeight,
  isBundledFont,
  resolveTheme,
  sanitizeFontName,
  type AppTheme
} from './terminalAppearance'

function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('resolveTheme', () => {
  it('ferry follows the app theme', () => {
    expect(resolveTheme('ferry', 'dark').background).not.toBe(resolveTheme('ferry', 'light').background)
  })

  it('a fixed scheme ignores the app theme', () => {
    expect(resolveTheme('dracula', 'light')).toEqual(resolveTheme('dracula', 'dark'))
  })

  it('an unknown scheme falls back to ferry', () => {
    expect(resolveTheme('nope', 'dark')).toEqual(resolveTheme('ferry', 'dark'))
  })

  it('fills all 16 ansi colors', () => {
    const theme = resolveTheme('nord', 'dark')
    expect(theme.red).toBe('#bf616a')
    expect(theme.brightWhite).toBe('#eceff4')
  })

  it('uses glass-harmonized opaque backgrounds for the ferry scheme when glassUiEnabled is true', () => {
    const classicDark = resolveTheme('ferry', 'dark', false)
    const glassDark = resolveTheme('ferry', 'dark', true)
    const glassLight = resolveTheme('ferry', 'light', true)

    expect(classicDark.background).toBe('#1e1e1e')
    expect(glassDark.background).toBe('#0b0f19')
    expect(glassLight.background).toBe('#f8fafc')
    expect(contrastRatio(glassDark.foreground, glassDark.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(glassLight.foreground, glassLight.background)).toBeGreaterThanOrEqual(4.5)
    expect(resolveTheme('dracula', 'dark', true)).toEqual(resolveTheme('dracula', 'dark', false))
  })
})

describe('scheme data', () => {
  const cases = SCHEME_OPTIONS.flatMap(({ id }) => (['light', 'dark'] as AppTheme[]).map((t) => [id, t] as const))

  it.each(cases)('%s (%s) has 16 ansi colors and AA text contrast', (id, appTheme) => {
    const theme = resolveTheme(id, appTheme)
    const ansi = Object.entries(theme).filter(([key]) => !['background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground'].includes(key))
    expect(ansi).toHaveLength(16)
    expect(contrastRatio(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('buildFontFamily', () => {
  it('uses the default stack for the default preset', () => {
    expect(buildFontFamily('default', '')).toBe(DEFAULT_FONT_STACK)
  })

  it('quotes a preset and appends monospace fallback', () => {
    expect(buildFontFamily('fira-code', '')).toBe("'Fira Code', monospace")
  })

  it('uses the bundled variable font stack for jetbrains-mono and marks it bundled', () => {
    expect(buildFontFamily('jetbrains-mono', '')).toBe("'JetBrains Mono Variable', 'JetBrains Mono', monospace")
    expect(isBundledFont('jetbrains-mono')).toBe(true)
    expect(isBundledFont('fira-code')).toBe(false)
    expect(isBundledFont('custom')).toBe(false)
  })

  it('uses a sanitized custom name', () => {
    expect(buildFontFamily('custom', "My 'Font'; }")).toBe("'My Font', monospace")
  })

  it('falls back to the default stack for an empty custom name', () => {
    expect(buildFontFamily('custom', '  ')).toBe(DEFAULT_FONT_STACK)
  })

  it('trims surrounding spaces only when building the family', () => {
    expect(buildFontFamily('custom', '  Fira Code ')).toBe("'Fira Code', monospace")
  })

  it('sanitizeFontName strips css-breaking characters', () => {
    expect(sanitizeFontName('a"b,c{d}')).toBe('abcd')
  })
})

describe('clamps', () => {
  it('clamps and rounds font size', () => {
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE)
    expect(clampFontSize(99)).toBe(MAX_FONT_SIZE)
    expect(clampFontSize(13.6)).toBe(14)
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE)
  })

  it('clamps and snaps line height', () => {
    expect(clampLineHeight(0.5)).toBe(1)
    expect(clampLineHeight(3)).toBe(1.5)
    expect(clampLineHeight(1.23)).toBe(1.25)
    expect(clampLineHeight(NaN)).toBe(DEFAULT_LINE_HEIGHT)
  })
})
