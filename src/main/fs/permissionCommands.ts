import { SshError } from '../ssh/errors'
import { shellEscape } from '../ssh/shellEscape'

const MODE_PATTERN = /^[0-7]{3,4}$/
const NAME_PATTERN = /^([a-z_][a-z0-9_.-]*|\d+)$/i

export function buildChmodCommand(targetPath: string, mode: string, recursive: boolean): string {
  if (!MODE_PATTERN.test(mode)) {
    throw new SshError('VALIDATION', `Invalid permission mode "${mode}" - expected an octal string like "755"`)
  }
  return `chmod ${recursive ? '-R ' : ''}${mode} -- ${shellEscape(targetPath)}`
}

export function buildChownCommand(targetPath: string, owner: string, group: string, recursive: boolean): string {
  if ((owner && !NAME_PATTERN.test(owner)) || (group && !NAME_PATTERN.test(group))) {
    throw new SshError('VALIDATION', 'Invalid owner or group name')
  }
  if (!owner && !group) {
    throw new SshError('VALIDATION', 'Enter an owner, a group, or both')
  }
  return `chown ${recursive ? '-R ' : ''}${group ? `${owner}:${group}` : owner} -- ${shellEscape(targetPath)}`
}
