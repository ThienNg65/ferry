import './stdoutGuard'
import { startSidecar } from './sidecar'

startSidecar(process.stdin, (line) => process.stdout.write(`${line}\n`), (code) => process.exit(code))
