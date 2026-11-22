import { promises as fs } from 'fs'
import type { FileHandle } from 'fs/promises'
import * as path from 'path'
import { SshError } from '../ssh/errors'

const UNSAFE_LINK_MESSAGE =
  'symbolic links and reparse points are not allowed beneath the selected folder.'
const MISSING_PARENT_MESSAGE = 'a parent folder is missing or unavailable.'

function unsafeDestination(message = UNSAFE_LINK_MESSAGE): SshError {
  return new SshError('VALIDATION', 'Unsafe download destination: ' + message)
}

function unsafeComponent(target: string, reason = UNSAFE_LINK_MESSAGE): SshError {
  return unsafeDestination('component "' + path.basename(target) + '": ' + reason)
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function relativeTarget(root: string, target: string, allowRoot: boolean): string {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!isWithin(resolvedRoot, resolvedTarget) || (!allowRoot && relative === '')) {
    throw unsafeComponent(target, 'it resolves outside the selected folder.')
  }
  return relative
}

async function verifyRoot(root: string): Promise<void> {
  let info
  try {
    info = await fs.lstat(root)
  } catch {
    throw unsafeDestination(MISSING_PARENT_MESSAGE)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw unsafeComponent(root, 'the selected root is no longer a real directory.')
  }
}

async function verifyRealPathInside(root: string, target: string): Promise<void> {
  let realRoot: string
  let realTarget: string
  try {
    ;[realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)])
  } catch {
    throw unsafeComponent(target, MISSING_PARENT_MESSAGE)
  }
  if (!isWithin(realRoot, realTarget)) {
    throw unsafeComponent(target, 'it resolves outside the selected folder.')
  }
}

async function lstatOrMissing(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Creates the user-selected root and resolves it once. A symlink explicitly
 * selected as the root is supported; all descendants are checked separately.
 */
export async function prepareSafeLocalDownloadRoot(rootPath: string): Promise<string> {
  try {
    const existingRoot = await lstatOrMissing(rootPath)
    if (!existingRoot) {
      await fs.mkdir(rootPath, { recursive: true })
    }
    const rootEntry = await fs.lstat(rootPath)
    const rootChanged = existingRoot
      ? existingRoot.isSymbolicLink() !== rootEntry.isSymbolicLink()
        || existingRoot.dev !== rootEntry.dev
        || (existingRoot.ino !== 0 && rootEntry.ino !== 0 && existingRoot.ino !== rootEntry.ino)
      : rootEntry.isSymbolicLink()
    if (rootChanged) {
      throw unsafeComponent(rootPath, 'it changed while the selected root was being resolved.')
    }
    const resolvedRoot = await fs.realpath(rootPath)
    const info = await fs.lstat(resolvedRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw unsafeComponent(resolvedRoot, 'the selected root is not a directory.')
    }
    return resolvedRoot
  } catch (error) {
    if (error instanceof SshError) throw error
    throw new SshError('UNKNOWN', 'Cannot prepare the selected download folder.')
  }
}

/** Creates a descendant directory without following any existing symlinked parent. */
export async function ensureSafeLocalDownloadDirectory(root: string, target: string): Promise<void> {
  const relative = relativeTarget(root, target, true)
  await verifyRoot(root)
  if (!relative) return

  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    let info = await lstatOrMissing(current)
    if (!info) {
      try {
        await fs.mkdir(current)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      info = await fs.lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw unsafeComponent(current)
    }
    await verifyRealPathInside(root, current)
  }
}

/**
 * Validates every existing component, including the final file when present.
 * A missing final file is allowed because the SFTP pipeline creates it with wx.
 */
export async function assertSafeLocalDownloadPath(root: string, target: string): Promise<void> {
  const relative = relativeTarget(root, target, false)
  await verifyRoot(root)

  const segments = relative.split(path.sep)
  let current = root
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index])
    const info = await lstatOrMissing(current)
    const isFinal = index === segments.length - 1
    if (!info) {
      if (isFinal) return
      throw unsafeComponent(current, MISSING_PARENT_MESSAGE)
    }
    if (info.isSymbolicLink() || (isFinal ? !info.isFile() : !info.isDirectory())) {
      throw unsafeComponent(current)
    }
    await verifyRealPathInside(root, current)
  }
}

/**
 * Rechecks the path after open and compares the file identity before any bytes
 * are written. This detects a parent swap that redirects the opened handle.
 */
export async function assertSafeLocalDownloadHandle(root: string, target: string, handle: FileHandle): Promise<void> {
  await assertSafeLocalDownloadPath(root, target)
  const [opened, current] = await Promise.all([handle.stat(), fs.lstat(target)])
  const hasFileIds = opened.ino !== 0 && current.ino !== 0
  const sameFile = opened.dev === current.dev && (
    hasFileIds
      ? opened.ino === current.ino
      : opened.size === current.size && opened.mtimeMs === current.mtimeMs && opened.birthtimeMs === current.birthtimeMs
  )
  if (current.isSymbolicLink()) {
    throw unsafeComponent(target)
  }
  if (!current.isFile()) {
    throw unsafeComponent(target, 'it is not a regular file.')
  }
  if (!sameFile) {
    throw unsafeComponent(target, 'the opened file no longer matches the validated destination.')
  }
  await assertSafeLocalDownloadPath(root, target)
}
