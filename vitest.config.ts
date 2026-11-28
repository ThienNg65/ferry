import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    // GitHub release tooling uses node:test, which Vitest must not collect.
    exclude: [...configDefaults.exclude, '.github/scripts/**/*.test.mjs'],
    // Several suites (RemoteShell/SessionManager/TransferQueue integration
    // tests) share real, disk-backed state across files — KnownHostsStore's
    // known_hosts.json, and the same docker test server/port. Running test
    // files concurrently (vitest's default) races on that shared state; e.g.
    // two files independently trust/forget the same host:port fingerprint at
    // the same time. Sequential file execution trades some wall-clock time
    // for determinism, which matters more here than speed.
    fileParallelism: false,
    setupFiles: ['src/main/host/testHost.setup.ts', 'src/renderer/localStorage.setup.ts']
  }
})
