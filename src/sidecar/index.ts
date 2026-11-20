import './stdoutGuard'
import { existsSync, readFileSync } from 'fs'
import * as path from 'path'
import { createInterface } from 'readline'
import { startSidecar } from './sidecar'
import { startNeutralinoExtension } from './wsExtension'

function argValue(prefix: string): string {
  const match = process.argv.find((a) => a.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

let nlPort = argValue('--nl-port=') || process.env.NL_PORT || ''
let nlToken = argValue('--nl-token=') || process.env.NL_TOKEN || ''
let nlConnectToken = argValue('--nl-connect-token=') || process.env.NL_CONNECT_TOKEN || ''
const extensionId = argValue('--nl-extension-id=') || process.env.NL_EXT_ID || 'js.ferry.sidecar'
const nlMode = process.argv.includes('--nl-mode')

function parseHandshake<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    console.error('sidecar: invalid Neutralino handshake payload')
    process.exit(1)
  }
}

if ((!nlPort || !nlToken) && nlMode) {
  const nlPath = process.env.NL_PATH || process.cwd()
  const authInfoPath = path.join(nlPath, '.nl', 'auth_info.json')
  if (existsSync(authInfoPath)) {
    const info = parseHandshake<{ port?: number | string; nlToken?: string; nlConnectToken?: string }>(
      readFileSync(authInfoPath, 'utf8')
    )
    nlPort = info.port ? String(info.port) : ''
    nlToken = info.nlToken || ''
    nlConnectToken = info.nlConnectToken || ''
  }
}

if (nlPort && nlToken) {
  startNeutralinoExtension({ nlPort, nlToken, nlConnectToken, extensionId })
} else if (nlMode) {
  // Neutralino can also hand extension auth parameters on stdin's first JSON line.
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.once('line', (line) => {
    rl.close()
    const info = parseHandshake<{ nlPort?: number | string; nlToken?: string; nlConnectToken?: string }>(line)
    if (!info.nlPort || !info.nlToken) {
      console.error('sidecar: missing nlPort/nlToken in Neutralino stdin handshake')
      process.exit(1)
    }
    startNeutralinoExtension({
      nlPort: String(info.nlPort),
      nlToken: info.nlToken,
      nlConnectToken: info.nlConnectToken,
      extensionId
    })
  })
} else {
  startSidecar(
    process.stdin,
    (line) => process.stdout.write(`${line}\n`),
    (code) => process.exit(code)
  )
}
