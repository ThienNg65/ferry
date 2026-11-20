export interface NavHistory {
  back: string[]
  fwd: string[]
}

const MAX_HISTORY = 100

export function emptyHistory(): NavHistory {
  return { back: [], fwd: [] }
}

export function recordVisit(history: NavHistory, from: string): NavHistory {
  return { back: [...history.back, from].slice(-MAX_HISTORY), fwd: [] }
}

export function stepBack(history: NavHistory, current: string): { target: string; next: NavHistory } | null {
  const target = history.back[history.back.length - 1]
  if (target === undefined) {
    return null
  }
  return { target, next: { back: history.back.slice(0, -1), fwd: [...history.fwd, current] } }
}

export function stepForward(history: NavHistory, current: string): { target: string; next: NavHistory } | null {
  const target = history.fwd[history.fwd.length - 1]
  if (target === undefined) {
    return null
  }
  return { target, next: { back: [...history.back, current], fwd: history.fwd.slice(0, -1) } }
}
