import type { SiteEnvironment } from '@shared/contract'

export const ENVIRONMENT_OPTIONS: { label: string; value: SiteEnvironment | 'none' }[] = [
  { label: 'None', value: 'none' },
  { label: 'Production', value: 'prod' },
  { label: 'Staging', value: 'staging' },
  { label: 'Development', value: 'dev' }
]

export const ENVIRONMENT_TAB_BORDER: Record<SiteEnvironment, string> = {
  prod: 'border-error',
  staging: 'border-warning',
  dev: 'border-success'
}

export const ENVIRONMENT_DOT: Record<SiteEnvironment, string> = {
  prod: 'bg-error',
  staging: 'bg-warning',
  dev: 'bg-success'
}
