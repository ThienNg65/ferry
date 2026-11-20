import { createServer, type Server } from 'http'
import { existsSync, readFileSync, rmSync } from 'fs'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { beginStageDrop, cleanupStagedDropPath, finishStageDrop } from '../main/fs/LocalFsService'
import { createStageDropHttpHandler } from './wsExtension'

describe('createStageDropHttpHandler', () => {
  const token = 'secret-test-token'
  const nlPort = '45123'
  const stagedRoots: string[] = []
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    const handler = createStageDropHttpHandler(Buffer.from(token, 'utf8'), nlPort)
    server = createServer((req, res) => {
      void handler(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    while (stagedRoots.length > 0) {
      const dir = stagedRoots.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects missing or invalid token and disallowed CORS origins', async () => {
    const badToken = await fetch(`${baseUrl}/stage-drop?stageId=x&relativePath=a.txt`, {
      method: 'POST',
      headers: { 'X-Ferry-Token': 'wrong-token' },
      body: 'hello'
    })
    expect(badToken.status).toBe(403)

    const badOrigin = await fetch(`${baseUrl}/stage-drop?stageId=x&relativePath=a.txt`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' }
    })
    expect(badOrigin.status).toBe(403)
  })

  it('allows Neutralino localhost origin on preflight and streams uploaded bytes to disk', async () => {
    const preflight = await fetch(`${baseUrl}/stage-drop`, {
      method: 'OPTIONS',
      headers: { Origin: `http://localhost:${nlPort}` }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(`http://localhost:${nlPort}`)

    const { stageId } = await beginStageDrop()
    const payload = Buffer.alloc(1024 * 1024, 0x7a)
    const upload = await fetch(`${baseUrl}/stage-drop?stageId=${encodeURIComponent(stageId)}&relativePath=big.bin`, {
      method: 'POST',
      headers: {
        Origin: `http://localhost:${nlPort}`,
        'X-Ferry-Token': token
      },
      body: payload
    })
    expect(upload.status).toBe(200)

    const entries = await finishStageDrop(stageId)
    expect(entries).toHaveLength(1)
    stagedRoots.push(path.dirname(entries[0].path))
    expect(readFileSync(entries[0].path)).toEqual(payload)
    expect(existsSync(entries[0].path)).toBe(true)
    await cleanupStagedDropPath(entries[0].path)
  })
})
