import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://api.github.com'
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function extractReleasePrBranches({ releasePrsJson = '', openPulls = [], baseBranch = 'main' } = {}) {
  const branches = []
  const trimmed = releasePrsJson.trim()
  if (trimmed) {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      throw new Error('RELEASE_PRS must be a JSON array')
    }
    for (const pr of parsed) {
      if (
        pr &&
        typeof pr.headBranchName === 'string' &&
        pr.headBranchName &&
        (!pr.baseBranchName || pr.baseBranchName === baseBranch)
      ) {
        branches.push(pr.headBranchName)
      }
    }
  }

  const branchPrefix = `release-please--branches--${baseBranch}--`
  for (const pr of openPulls) {
    const headRef = pr?.head?.ref
    const baseRef = pr?.base?.ref
    if (baseRef === baseBranch && typeof headRef === 'string' && headRef.startsWith(branchPrefix)) {
      branches.push(headRef)
    }
  }

  return [...new Set(branches)]
}

export function resolveVersionSync({ packageJsonText, manifestJsonText, versionText = '' }) {
  const pkg = JSON.parse(packageJsonText)
  const targetVersion = pkg?.version
  if (typeof targetVersion !== 'string' || !SEMVER_RE.test(targetVersion)) {
    throw new Error(`Invalid package.json version: ${JSON.stringify(targetVersion)}`)
  }

  if (manifestJsonText !== undefined) {
    const manifest = JSON.parse(manifestJsonText)
    if (manifest?.['.'] !== targetVersion) {
      throw new Error(
        `.release-please-manifest.json version (${JSON.stringify(manifest?.['.'])}) does not match package.json (${targetVersion})`
      )
    }
  }

  const currentVersion = versionText.trim()
  return {
    targetVersion,
    currentVersion,
    changed: currentVersion !== targetVersion,
    nextContent: `${targetVersion}\n`
  }
}

async function githubRequest(path, token, options = {}, fetchImpl = fetch) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ferry-release-version-sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  }

  const response = await fetchImpl(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  })
  const raw = await response.text()
  const data = raw ? JSON.parse(raw) : {}
  if (!response.ok) {
    const error = new Error(`GitHub API returned ${response.status} for ${path}: ${data.message ?? 'unknown error'}`)
    error.status = response.status
    throw error
  }
  return data
}

async function fetchRepoTextFile(repo, filePath, ref, token, { optional = false, fetchImpl = fetch } = {}) {
  try {
    const file = await githubRequest(
      `/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
      token,
      {},
      fetchImpl
    )
    if (file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error(`Unexpected encoding for ${filePath} on ${ref}: ${file.encoding}`)
    }
    return {
      text: Buffer.from(file.content, 'base64').toString('utf8'),
      sha: file.sha
    }
  } catch (error) {
    if (optional && error.status === 404) {
      return null
    }
    throw error
  }
}

export async function syncReleasePrVersion({
  repo,
  token = '',
  baseBranch = 'main',
  releasePrsJson = '',
  dryRun = false,
  fetchImpl = fetch,
  log = console.log
} = {}) {
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${JSON.stringify(repo)}`)
  }
  if (!dryRun && !token) {
    throw new Error('RELEASE_SYNC_TOKEN is required')
  }

  const openPulls = await githubRequest(
    `/repos/${repo}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`,
    token,
    {},
    fetchImpl
  )
  const branches = extractReleasePrBranches({ releasePrsJson, openPulls, baseBranch })

  if (branches.length === 0) {
    log('No open Release Please PRs found; nothing to sync.')
    return []
  }

  const results = []
  for (const branch of branches) {
    const [pkgFile, manifestFile, versionFile] = await Promise.all([
      fetchRepoTextFile(repo, 'package.json', branch, token, { fetchImpl }),
      fetchRepoTextFile(repo, '.release-please-manifest.json', branch, token, { fetchImpl }),
      fetchRepoTextFile(repo, 'VERSION', branch, token, { optional: true, fetchImpl })
    ])

    const sync = resolveVersionSync({
      packageJsonText: pkgFile.text,
      manifestJsonText: manifestFile.text,
      versionText: versionFile?.text ?? ''
    })

    if (!sync.changed) {
      log(`VERSION on ${branch} is already ${sync.targetVersion}; skipping update.`)
      results.push({ branch, targetVersion: sync.targetVersion, updated: false })
      continue
    }

    if (dryRun) {
      log(`[dry-run] Would update VERSION on ${branch} from ${sync.currentVersion || '<missing>'} to ${sync.targetVersion}`)
      results.push({ branch, targetVersion: sync.targetVersion, updated: false, dryRun: true })
      continue
    }

    const updated = await githubRequest(
      `/repos/${repo}/contents/VERSION`,
      token,
      {
        method: 'PUT',
        body: {
          message: `chore(release): sync VERSION to ${sync.targetVersion}`,
          content: Buffer.from(sync.nextContent, 'utf8').toString('base64'),
          branch,
          ...(versionFile?.sha ? { sha: versionFile.sha } : {})
        }
      },
      fetchImpl
    )

    const commitSha = updated?.commit?.sha ?? null
    log(`Updated VERSION on ${branch} to ${sync.targetVersion}${commitSha ? ` (${commitSha})` : ''}`)
    results.push({ branch, targetVersion: sync.targetVersion, updated: true, commitSha })
  }

  return results
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const dryRun = process.argv.includes('--dry-run')
  await syncReleasePrVersion({
    repo: process.env.GITHUB_REPOSITORY || 'ThienNg65/ferry',
    token: process.env.RELEASE_SYNC_TOKEN || '',
    baseBranch: process.env.BASE_BRANCH || 'main',
    releasePrsJson: process.env.RELEASE_PRS || '',
    dryRun
  })
}
