export const FERRY_MOTION_TOKENS = {
  duration: {
    instant: 100,
    fast: 120,
    exit: 140,
    standard: 170,
    panel: 210,
    considered: 360,
    spring: 440
  },
  ease: {
    emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
    standard: 'cubic-bezier(0.22, 1, 0.36, 1)',
    out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    spring:
      'linear(0, 0.0213, 0.0739, 0.1443, 0.2235, 0.305, 0.3849, 0.4606, 0.5305, 0.594, 0.6508, 0.7011, 0.7452, 0.7836, 0.8168, 0.8454, 0.8699, 0.8907, 0.9084, 0.9234, 0.9361, 0.9467, 0.9557, 0.9632, 0.9694, 0.9747, 0.979, 0.9826, 0.9857, 0.9882, 0.9902, 0.992, 0.9934, 0.9946, 0.9955, 0.9963, 1)'
  }
} as const

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
