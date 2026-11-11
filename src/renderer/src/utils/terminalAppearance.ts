export type AppTheme = 'light' | 'dark'

export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

interface SchemeDef {
  id: string
  name: string
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  ansi: string[]
}

export interface SchemeOption {
  id: string
  name: string
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

const FERRY_DARK: SchemeDef = {
  id: 'ferry-dark', name: 'Ferry', background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78',
  ansi: ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
}

const FERRY_LIGHT: SchemeDef = {
  id: 'ferry-light', name: 'Ferry', background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: '#add6ff',
  ansi: ['#000000', '#cd3131', '#00bc00', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555',
    '#666666', '#cd3131', '#14ce14', '#b5ba00', '#0451a5', '#bc05bc', '#0598bc', '#a5a5a5']
}

const FIXED_SCHEMES: SchemeDef[] = [
  {
    id: 'dracula', name: 'Dracula', background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
    ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']
  },
  {
    id: 'one-dark', name: 'One Dark', background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451',
    ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selectionBackground: '#073642',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']
  },
  {
    id: 'solarized-light', name: 'Solarized Light', background: '#fdf6e3', foreground: '#586e75', cursor: '#586e75', selectionBackground: '#eee8d5',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']
  },
  {
    id: 'nord', name: 'Nord', background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']
  },
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark', background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945',
    ansi: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c',
    ansi: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']
  },
  {
    id: 'github-light', name: 'GitHub Light', background: '#ffffff', foreground: '#24292f', cursor: '#24292f', selectionBackground: '#b6d6f8',
    ansi: ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f']
  }
]

export const DEFAULT_SCHEME_ID = 'ferry'

export const SCHEME_OPTIONS: SchemeOption[] = [
  { id: DEFAULT_SCHEME_ID, name: 'Ferry (follows app theme)' },
  ...FIXED_SCHEMES.map(({ id, name }) => ({ id, name }))
]

export function isSchemeId(id: string): boolean {
  return SCHEME_OPTIONS.some((option) => option.id === id)
}

export function resolveTheme(schemeId: string, appTheme: AppTheme): TerminalTheme {
  const def =
    schemeId === DEFAULT_SCHEME_ID
      ? appTheme === 'dark' ? FERRY_DARK : FERRY_LIGHT
      : FIXED_SCHEMES.find((scheme) => scheme.id === schemeId) ?? (appTheme === 'dark' ? FERRY_DARK : FERRY_LIGHT)
  const theme: Record<string, string> = {
    background: def.background,
    foreground: def.foreground,
    cursor: def.cursor,
    cursorAccent: def.background,
    selectionBackground: def.selectionBackground
  }
  ANSI_KEYS.forEach((key, i) => {
    theme[key] = def.ansi[i]
  })
  return theme as unknown as TerminalTheme
}

export const DEFAULT_FONT_ID = 'default'
export const CUSTOM_FONT_ID = 'custom'
export const DEFAULT_FONT_STACK = "'Cascadia Code', 'SF Mono', Consolas, monospace"

export interface FontPreset {
  id: string
  label: string
  family: string | null
}

export const FONT_PRESETS: FontPreset[] = [
  { id: DEFAULT_FONT_ID, label: 'Default', family: null },
  { id: 'cascadia-code', label: 'Cascadia Code', family: 'Cascadia Code' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono' },
  { id: 'fira-code', label: 'Fira Code', family: 'Fira Code' },
  { id: 'consolas', label: 'Consolas', family: 'Consolas' },
  { id: 'sf-mono', label: 'SF Mono', family: 'SF Mono' },
  { id: 'menlo', label: 'Menlo', family: 'Menlo' },
  { id: 'monospace', label: 'System monospace', family: null }
]

export function isFontId(id: string): boolean {
  return id === CUSTOM_FONT_ID || FONT_PRESETS.some((preset) => preset.id === id)
}

export function sanitizeFontName(name: string): string {
  return name.replace(/["'`;{}\\,]/g, '').trim().slice(0, 60)
}

export function fontFamilyName(fontId: string, custom: string): string | null {
  if (fontId === CUSTOM_FONT_ID) {
    return sanitizeFontName(custom) || null
  }
  return FONT_PRESETS.find((preset) => preset.id === fontId)?.family ?? null
}

export function buildFontFamily(fontId: string, custom: string): string {
  if (fontId === 'monospace') {
    return 'monospace'
  }
  const name = fontFamilyName(fontId, custom)
  return name ? `'${name}', monospace` : DEFAULT_FONT_STACK
}

export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 24
export const DEFAULT_FONT_SIZE = 14
export const MIN_LINE_HEIGHT = 1
export const MAX_LINE_HEIGHT = 1.5
export const DEFAULT_LINE_HEIGHT = 1

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FONT_SIZE
  }
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

export function clampLineHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LINE_HEIGHT
  }
  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, Math.round(value * 20) / 20))
}
