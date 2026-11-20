# Fast SSH Remote Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remote directory browsing in Ferry as fast and responsive as terminal navigation (`cd /folder-name`), dropping directory load times from 500ms–2000ms+ down to a single network RTT (~20–50ms) for cold opens and 0ms (instantaneous) for warm/cached opens.

**Architecture:** 
1. **Exec-First Directory Listing Engine (`remoteExecList.ts`)**: On SSH servers supporting remote execution, retrieve canonical paths, directory entries, sizes, timestamps, octal permissions, and symlink targets in a **single remote exec command** (Python 3 / POSIX `ls`), bypassing chatty multi-roundtrip SFTP packets, while retaining seamless SFTP fallback.
2. **In-Memory SWR (Stale-While-Revalidate) Cache (`remoteFs.store.ts`)**: Cache visited directory listings in-memory with a short TTL, serving previously visited folders in 0ms and refreshing them quietly in the background.
3. **Optimistic UI & Hover Prefetching (`FilePane.vue`, `FileRow.vue`, `PathBreadcrumb.vue`)**: Update the path breadcrumb immediately on folder click (<16ms feedback) and prefetch directory listings on folder row hover.

**Tech Stack:** TypeScript, Vue 3, Pinia, Electron, Node.js (`ssh2`), Vitest.

**Spec:** Option 2 design as agreed during planning discussion.

---

## Global Constraints
- **Universal Fallback**: Must never fail if Python 3 or GNU tools are missing; fallback to standard SFTP `listRemote` must be automatic and transparent.
- **Strict Typing**: All file entries must strictly adhere to `FileEntry` (`src/shared/contract.ts`).
- **Cache Invalidation**: Mutations (`mkdir`, `rename`, `delete`, `upload`, `chmod`) must invalidate or patch the relevant directory cache to avoid stale state.
- **Offline / Isolated Unit Tests**: Unit tests must not require a live SSH server; mock `RemoteShell` and test parser/store logic cleanly.
- **Convention**: Maintain Ferry's conventional commit format (`feat:`, `perf:`, `test:`, `fix:`).

## Review Focus
1. **Broken / Cyclic Symlinks**: When an entry is a symlink pointing to a non-existent target or loop, `isSymlink: true`, `isDir: false`, `symlinkBroken: true`, and never crash the parser.
2. **Path Resolution & Trailing Slashes**: Paths like `/var/log/` vs `/var/log` or relative `.` must normalize cleanly so cache keys hit consistently.
3. **Out-of-Order / Cancelled Requests**: Fast-clicking through multiple folders must respect `requestSeq` in `remoteFs.store.ts` so slower background responses never overwrite newer active views.
4. **Restricted SFTP-Only Accounts**: Servers with `ForceCommand internal-sftp` or chroot jails that refuse shell exec must fall back to SFTP silently without throwing uncaught errors.
5. **Cache Staleness on File Operations**: Adding a folder via `mkdir` or uploading a file must immediately be visible in the current view and invalidate cache for that directory.

---

### Task 1: Remote Exec Directory Listing Parser & Command Builder

**Files:**
- Create: `src/main/fs/remoteExecList.ts`
- Create: `src/main/fs/remoteExecList.test.ts`

**Interfaces:**
- Produces:
  - `buildRemoteListCommand(targetPath: string): string`
  - `parseRemoteListOutput(stdout: string): FileListResult | null`
  - Consumed by `RemoteFsService.ts`

- [ ] **Step 1: Write failing unit tests for `remoteExecList`**

```ts
// src/main/fs/remoteExecList.test.ts
import { describe, expect, it } from 'vitest'
import { buildRemoteListCommand, parseRemoteListOutput } from './remoteExecList'

describe('remoteExecList', () => {
  it('generates a command targeting the requested path', () => {
    const cmd = buildRemoteListCommand('/var/log')
    expect(cmd).toContain("'/var/log'")
  })

  it('parses valid JSON output with files, directories, and symlinks', () => {
    const sampleOutput = JSON.stringify({
      path: '/var/log',
      entries: [
        {
          name: 'nginx',
          path: '/var/log/nginx',
          isDir: true,
          size: 0,
          mtimeMs: 1700000000000,
          permissions: '0755',
          isSymlink: false,
          symlinkTarget: null,
          symlinkBroken: false
        },
        {
          name: 'syslog',
          path: '/var/log/syslog',
          isDir: false,
          size: 1024,
          mtimeMs: 1700000005000,
          permissions: '0640',
          isSymlink: false,
          symlinkTarget: null,
          symlinkBroken: false
        },
        {
          name: 'current_log',
          path: '/var/log/current_log',
          isDir: false,
          size: 512,
          mtimeMs: 1700000006000,
          permissions: '0777',
          isSymlink: true,
          symlinkTarget: '/var/log/syslog',
          symlinkBroken: false
        }
      ]
    })
    const result = parseRemoteListOutput(sampleOutput)
    expect(result).not.toBeNull()
    expect(result?.path).toBe('/var/log')
    expect(result?.entries).toHaveLength(3)
    expect(result?.entries[0].isDir).toBe(true)
    expect(result?.entries[2].isSymlink).toBe(true)
    expect(result?.entries[2].symlinkTarget).toBe('/var/log/syslog')
  })

  it('handles broken symlinks without failing', () => {
    const sampleOutput = JSON.stringify({
      path: '/tmp',
      entries: [
        {
          name: 'dead_link',
          path: '/tmp/dead_link',
          isDir: false,
          size: 0,
          mtimeMs: 0,
          permissions: '0777',
          isSymlink: true,
          symlinkTarget: '/non/existent',
          symlinkBroken: true
        }
      ]
    })
    const result = parseRemoteListOutput(sampleOutput)
    expect(result?.entries[0].symlinkBroken).toBe(true)
    expect(result?.entries[0].isDir).toBe(false)
  })

  it('returns null on invalid or non-JSON output', () => {
    expect(parseRemoteListOutput('sh: python3: command not found')).toBeNull()
    expect(parseRemoteListOutput('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/fs/remoteExecList.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `remoteExecList.ts`**

Implement `buildRemoteListCommand` using a compact Python 3 script that uses `os.scandir` to retrieve entries, timestamps, octal modes, and symlink destinations in a single output, with fallback to GNU `ls -la --time-style=+%s` parser. Implement `parseRemoteListOutput` to return typed `FileListResult`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/fs/remoteExecList.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/remoteExecList.ts src/main/fs/remoteExecList.test.ts
git commit -m "perf: add remote exec directory listing parser and command generator"
```

---

### Task 2: Integrate Exec-First Listing with SFTP Fallback in `RemoteFsService.ts`

**Files:**
- Modify: `src/main/fs/RemoteFsService.ts:47-61`
- Test: `src/main/fs/RemoteFsService.test.ts` (create)

**Interfaces:**
- Consumes: `buildRemoteListCommand`, `parseRemoteListOutput` from `src/main/fs/remoteExecList.ts`
- Produces: `listRemote(sessionId: string, dirPath?: string): Promise<FileListResult>`

- [ ] **Step 1: Write failing unit test for `listRemote` exec-first and fallback**

```ts
// src/main/fs/RemoteFsService.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listRemote } from './RemoteFsService'
import { SessionManager } from '../ssh/SessionManager'

vi.mock('../ssh/SessionManager')

describe('RemoteFsService.listRemote', () => {
  const mockShell = {
    exec: vi.fn(),
    realpath: vi.fn(),
    readdir: vi.fn(),
    readlink: vi.fn(),
    stat: vi.fn()
  }

  const mockManager = {
    cwd: vi.fn(() => '/home/user'),
    shell: vi.fn(() => mockShell),
    setCwd: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(SessionManager.getInstance).mockReturnValue(mockManager as any)
  })

  it('uses exec result when exec command succeeds with valid json', async () => {
    mockShell.exec.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        path: '/var/log',
        entries: [{ name: 'test.log', path: '/var/log/test.log', isDir: false, size: 10, mtimeMs: 1000, permissions: '0644' }]
      }),
      stderr: ''
    })

    const result = await listRemote('sess-1', '/var/log')
    expect(mockShell.exec).toHaveBeenCalled()
    expect(mockShell.readdir).not.toHaveBeenCalled()
    expect(result.path).toBe('/var/log')
    expect(result.entries).toHaveLength(1)
    expect(mockManager.setCwd).toHaveBeenCalledWith('sess-1', '/var/log')
  })

  it('falls back to SFTP readdir when exec fails with non-zero exit code', async () => {
    mockShell.exec.mockResolvedValueOnce({ code: 127, stdout: '', stderr: 'command not found' })
    mockShell.realpath.mockResolvedValueOnce('/var/log')
    mockShell.readdir.mockResolvedValueOnce([
      { filename: 'fallback.txt', isDirectory: false, isSymlink: false, size: 20, mtimeMs: 2000, permissions: '0644' }
    ])

    const result = await listRemote('sess-1', '/var/log')
    expect(mockShell.exec).toHaveBeenCalled()
    expect(mockShell.readdir).toHaveBeenCalledWith('/var/log')
    expect(result.entries[0].name).toBe('fallback.txt')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/fs/RemoteFsService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Exec-First with SFTP Fallback in `RemoteFsService.ts`**

Update `listRemote` in `src/main/fs/RemoteFsService.ts`:
1. Call `listRemoteExec(shell, rawPath)`. If code is 0 and `parseRemoteListOutput` produces valid entries, update CWD and return.
2. If exec fails or output is null, call `listRemoteSftp(shell, rawPath)` which performs the standard SFTP flow.
3. Optimize `listRemoteSftp`: if `rawPath` is already absolute and does not contain `.` or `..`, skip the redundant `realpath` network call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/fs/RemoteFsService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/RemoteFsService.ts src/main/fs/RemoteFsService.test.ts
git commit -m "perf: implement exec-first directory listing with SFTP fallback"
```

---

### Task 3: In-Memory SWR Directory Cache & Optimistic Navigation in `remoteFs.store.ts`

**Files:**
- Modify: `src/renderer/src/stores/remoteFs.store.ts`
- Create: `src/renderer/src/stores/remoteFs.store.test.ts`

**Interfaces:**
- Produces:
  - `loadForSession(sessionId: string, dirPath?: string, options?: { forceRefresh?: boolean })`
  - `prefetchDir(dirPath: string): Promise<void>`
  - Cache auto-invalidation on `mkdir`, `remove`, `removeMany`, `rename`, `chmod`

- [ ] **Step 1: Write failing unit test for `remoteFs.store` caching and optimistic updates**

```ts
// src/renderer/src/stores/remoteFs.store.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRemoteFsStore } from './remoteFs.store'
import * as api from '../api'

vi.mock('../api', () => ({
  invoke: vi.fn()
}))

vi.mock('./sessions.store', () => ({
  useSessionsStore: () => ({ activeSessionId: 'sess-1' })
}))

describe('remoteFs.store with SWR cache', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('serves cached directory instantly on second visit without waiting for network', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    // First load (cold)
    await store.loadForSession('sess-1', '/var/log')
    expect(store.entries).toHaveLength(1)
    expect(api.invoke).toHaveBeenCalledTimes(1)

    // Second load (warm)
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    const loadPromise = store.loadForSession('sess-1', '/var/log')
    // Immediately available in state before promise resolves
    expect(store.entries).toHaveLength(1)
    await loadPromise
  })

  it('bypasses cache when forceRefresh is true', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValue({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    await store.loadForSession('sess-1', '/var/log', { forceRefresh: true })
    expect(api.invoke).toHaveBeenCalledTimes(2)
  })

  it('invalidates directory cache when mkdir or remove occurs', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValue({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    await store.mkdir('subfolder')
    // Next load should fetch again because cache was invalidated
    await store.loadForSession('sess-1', '/var/log')
    expect(api.invoke).toHaveBeenCalledWith('fs:remote:mkdir', 'sess-1', '/var/log/subfolder')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/stores/remoteFs.store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement SWR directory cache & optimistic updates in `remoteFs.store.ts`**

1. Define `DirCacheEntry` with `{ path, entries, timestamp }` and add `dirCache: Map<string, DirCacheEntry>` inside `PerSessionFs`.
2. In `loadForSession`:
   - If target path is in `dirCache` and not expired (`TTL = 60s`) and not `forceRefresh`:
     - Instantly assign `entry.currentPath = targetPath` and `entry.entries = cached.entries`.
     - Set `entry.loading = false`.
     - Fire asynchronous background revalidation via `invoke('fs:remote:list', ...)`. Update `dirCache` when completed.
   - If target path is not in cache:
     - Optimistically set `entry.currentPath = targetPath` so breadcrumb updates immediately.
     - Set `entry.loading = true` and `entry.entries = []`.
     - Fetch, update cache, and set `entry.entries`.
3. Add `prefetchDir(dirPath: string)` to populate cache quietly.
4. Clear or invalidate target path in `dirCache` in `mkdir`, `remove`, `removeMany`, `rename`, `chmod`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/stores/remoteFs.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/remoteFs.store.ts src/renderer/src/stores/remoteFs.store.test.ts
git commit -m "perf: add in-memory SWR directory caching and optimistic navigation"
```

---

### Task 4: UI Hover Prefetching & Force Refresh Wiring

**Files:**
- Modify: `src/renderer/src/components/files/FileRow.vue`
- Modify: `src/renderer/src/components/files/FileList.vue`
- Modify: `src/renderer/src/components/files/FilePane.vue`

**Interfaces:**
- `FileRow.vue` emits `@hover-dir` when cursor hovers on a directory row in remote pane.
- `FilePane.vue` handles `@hover-dir` by calling `remoteFs.prefetchDir(path)`.
- Toolbar refresh button & Ctrl+R pass `{ forceRefresh: true }` to bypass cache.

- [ ] **Step 1: Update `FileRow.vue` to emit `hover-dir`**

Add `@mouseenter="entry.isDir && side === 'remote' && emit('hover-dir', entry.path)"` and declare `hover-dir: [path: string]` in `defineEmits`.

- [ ] **Step 2: Forward event in `FileList.vue`**

Add `@hover-dir="emit('hover-dir', $event)"` and declare `hover-dir: [path: string]` in `defineEmits`.

- [ ] **Step 3: Wire prefetch and force refresh in `FilePane.vue`**

In `FilePane.vue`:
1. Listen to `@hover-dir="(path) => store.prefetchDir?.(path)"` on `FileList`.
2. Update `@refresh="store.load(undefined, { forceRefresh: true })"` on `FileToolbar` and in the `Ctrl+R` shortcut handler.

- [ ] **Step 4: Run typecheck and existing tests to verify zero regressions**

Run: `npm run typecheck`
Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/files/FileRow.vue src/renderer/src/components/files/FileList.vue src/renderer/src/components/files/FilePane.vue
git commit -m "perf: wire hover prefetching and force refresh for remote directory navigation"
```

---

## Verification Plan

### Automated Tests
1. Unit tests for parser and command builder:
   `npx vitest run src/main/fs/remoteExecList.test.ts`
2. Unit tests for `RemoteFsService` exec-first & fallback:
   `npx vitest run src/main/fs/RemoteFsService.test.ts`
3. Unit tests for SWR cache store:
   `npx vitest run src/renderer/src/stores/remoteFs.store.test.ts`
4. Full verification suite:
   `npm run typecheck`
   `npm test`

### Manual Verification
1. **Cold Navigation Speed**:
   - Connect to a remote Linux SSH server.
   - Double-click into a folder (e.g., `/var/log` or `/usr`).
   - Confirm breadcrumb updates immediately (<16ms) and contents load in ~20–50ms (1 RTT) via remote exec.
2. **Warm Navigation Speed (Instant SWR)**:
   - Navigate into a child folder, then click Back (or parent segment in breadcrumb).
   - Confirm parent folder renders with 0ms perceptible delay.
3. **Hover Prefetching**:
   - Hover cursor over a subfolder for ~200ms.
   - Double-click folder; confirm it opens instantly (0ms) because it was already warmed into cache.
4. **Symlink Display**:
   - Navigate to `/lib` or `/usr/bin` (or a folder with symlinks).
   - Confirm symlink badges, target names, and folder indicators display correctly.
5. **Cache Invalidation**:
   - Create a new directory (`mkdir`) or delete a file.
   - Confirm changes reflect immediately in the view without stale cached items.
6. **Force Refresh**:
   - Press `Ctrl+R` or click the Refresh toolbar button. Confirm it issues a real remote fetch and updates the listing.
