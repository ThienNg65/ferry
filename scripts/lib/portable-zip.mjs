import { randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync, renameSync, rmSync } from 'node:fs'
import { finished } from 'node:stream/promises'
import { inflateRawSync } from 'node:zlib'
import { dirname, join, basename } from 'node:path'
import { ZipArchive } from 'archiver'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Validate the central directory, every local entry and its uncompressed CRC. */
export function verifyPortableZip(path, requiredEntries) {
  const data = readFileSync(path)
  const endStart = Math.max(0, data.length - 65557)
  let end = -1
  for (let i = data.length - 22; i >= endStart; i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Portable ZIP has no valid end-of-central-directory record')
  const count = data.readUInt16LE(end + 10)
  const length = data.readUInt32LE(end + 12)
  let cursor = data.readUInt32LE(end + 16)
  if (count === 0 || cursor + length !== end) throw new Error('Portable ZIP central directory is incomplete')
  const names = new Set()
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP central entry')
    const flags = data.readUInt16LE(cursor + 8)
    const method = data.readUInt16LE(cursor + 10)
    const crc = data.readUInt32LE(cursor + 16)
    const compressed = data.readUInt32LE(cursor + 20)
    const uncompressed = data.readUInt32LE(cursor + 24)
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const localOffset = data.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > end || flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported or incomplete ZIP entry')
    const name = data.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    if (names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`)
    names.add(name)
    if (localOffset + 30 > cursor || data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header')
    const localNameLength = data.readUInt16LE(localOffset + 26)
    const localExtraLength = data.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    if (start + compressed > cursor || data.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) !== name) {
      throw new Error(`ZIP entry boundaries are invalid: ${name}`)
    }
    const payload = data.subarray(start, start + compressed)
    const expanded = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: uncompressed + 1 })
    if (expanded.length !== uncompressed || crc32(expanded) !== crc) throw new Error(`ZIP entry checksum mismatch: ${name}`)
    cursor = next
  }
  if (cursor !== end) throw new Error('Portable ZIP has trailing or missing central directory entries')
  for (const name of requiredEntries) if (!names.has(name)) throw new Error(`Portable ZIP missing required entry: ${name}`)
}

/** Never touch the existing artifact until the replacement has been fully written and verified. */
export async function buildPortableZip({ sourceDir, destination, requiredEntries, archiveFactory = () => new ZipArchive({ zlib: { level: 9 } }), outputFactory = createWriteStream, verify = verifyPortableZip }) {
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
  const archive = archiveFactory()
  const output = outputFactory(temporary)
  try {
    const completed = finished(output)
    const archiveError = new Promise((_, reject) => archive.once('error', reject))
    archive.pipe(output)
    archive.directory(sourceDir, false)
    await Promise.race([Promise.all([completed, archive.finalize()]), archiveError])
    verify(temporary, requiredEntries)
    renameSync(temporary, destination)
  } catch (error) {
    archive.abort?.()
    output.destroy()
    // On Windows the stream must release its handle before deleting the temporary file.
    if (!output.closed) await new Promise((resolve) => output.once('close', resolve))
    throw error
  } finally {
    rmSync(temporary, { force: true })
  }
}
