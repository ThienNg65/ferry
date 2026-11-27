import { describe, expect, it } from 'vitest'
import {
  defaultSnippetParamValues,
  extractSnippetParams,
  interpolateSnippetCommand
} from './snippetParams'

describe('snippetParams', () => {
  it('extracts unique placeholders in order of appearance', () => {
    expect(extractSnippetParams('journalctl -u {{service}} -n 50 && systemctl status {{ service }}')).toEqual([
      'service'
    ])
    expect(extractSnippetParams('tail -n 100 {{path}} | grep {{pattern}}')).toEqual(['path', 'pattern'])
    expect(extractSnippetParams('df -h')).toEqual([])
  })

  it('auto-fills common placeholder defaults from SFTP and session context', () => {
    const defaults = defaultSnippetParamValues(['path', 'file', 'dir', 'host', 'service'], {
      remoteCwd: '/var/log/nginx',
      selectedPath: '/var/log/nginx/error.log',
      selectedName: 'error.log',
      siteName: 'prod-web-01'
    })
    expect(defaults).toEqual({
      path: '/var/log/nginx/error.log',
      file: 'error.log',
      dir: '/var/log/nginx',
      host: 'prod-web-01',
      service: ''
    })
  })

  it('interpolates values and strips embedded newlines/control sequences', () => {
    const cmd = interpolateSnippetCommand('tail -n 50 {{path}}', {
      path: '/var/log/app.log\r\nrm -rf /'
    })
    expect(cmd).not.toContain('\n')
    expect(cmd).not.toContain('\r')
    expect(cmd).toContain('/var/log/app.log')
  })
})
