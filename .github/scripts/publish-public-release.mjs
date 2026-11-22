import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const API = 'https://api.github.com'
const GRAPHQL = `${API}/graphql`
const PUBLIC_README_TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'public-release-template', 'README.md')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const normalizeLf = (text) => (text ?? '').replace(/\r\n/g, '\n')

function assertNoPrivateSourceLinks(text, sourceRepo, label) {
  const sourceUrl = `https://github.com/${sourceRepo}`
  const escapedUrl = escapeRegExp(sourceUrl)
  // Fail closed if a template or release-please note introduces a private repository URL.
  if (new RegExp(`${escapedUrl}(?!-release)(?:[/\\s)]|$)`, 'i').test(text) ||
      new RegExp(`api\\.github\\.com/repos/${escapeRegExp(sourceRepo)}(?:[/\\s]|$)`, 'i').test(text)) {
    throw new Error(`${label} contains a private source link`)
  }
}

export function sanitizeReleaseNotes(body, version, sourceRepo) {
  if (!body || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Release notes and a valid version are required')
  }
  const sourceUrl = `https://github.com/${sourceRepo}`
  const escapedUrl = escapeRegExp(sourceUrl)
  const original = body.trim()
  if (!/^##\s+/.test(original)) {
    throw new Error('Expected a release-please Markdown version heading')
  }
  const date = original.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1]
  if (!date) {
    throw new Error('Release notes are missing a release date')
  }

  const notes = original
    .replace(/^##[^\n]*/, `## ${version} (${date})`)
    // Remove private PR and commit references while preserving the change description.
    .replace(new RegExp(`\\s*\\(\\[[^\\]]+\\]\\(${escapedUrl}(?:\\/[^\\s)]*)?\\)\\)`, 'g'), '')
    // Preserve friendly labels for any other links into the private source repository.
    .replace(new RegExp(`\\[([^\\]]+)\\]\\(${escapedUrl}(?:\\/[^\\s)]*)?\\)`, 'g'), '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  assertNoPrivateSourceLinks(notes, sourceRepo, 'Sanitized release notes')
  if (!/^###\s+/m.test(notes)) {
    throw new Error('Expected at least one release-note category (Features, Bug Fixes, etc.)')
  }
  return notes
}

export function validatePublicReadme(readme, sourceRepo) {
  if (!readme || !readme.trim() || !sourceRepo) {
    throw new Error('Public README content and source repository are required')
  }
  const normalized = normalizeLf(readme)
  assertNoPrivateSourceLinks(normalized, sourceRepo, 'Public README')
  return normalized
}

export function formatPublicReleaseBody(notes, version) {
  if (!notes || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Release notes and a valid version are required')
  }
  return [
    notes.trim(),
    '',
    '### Download',
    '',
    '- **Microsoft Store (Recommended):** [Get Ferry from Microsoft Store](https://apps.microsoft.com/detail/9PJPWK568P53) (signed, automatic Store updates)',
    `- **Windows Installer:** \`Ferry-Setup-${version}.exe\` under **Assets** (Windows 10/11 x64)`,
    `- **Portable ZIP:** \`Ferry-Portable-${version}-win-x64.zip\` under **Assets** (zero-install)`,
    ''
  ].join('\n')
}

export function prependChangelog(existing, notes, version) {
  const escapedVersion = escapeRegExp(version)
  if (new RegExp(`^##\\s+v?${escapedVersion}(?=\\s|$)`, 'm').test(existing)) {
    return { content: existing, changed: false }
  }
  const index = existing.search(/^##\s+/m)
  if (index === -1) {
    throw new Error('Public CHANGELOG.md must already have a version section')
  }
  const header = existing.slice(0, index).trimEnd()
  const previous = existing.slice(index).trimStart()
  return { content: `${header}\n\n${notes}\n\n${previous}`.replace(/\n*$/, '\n'), changed: true }
}

export function buildPublicFileAdditions({ currentChangelog, nextChangelog, currentReadme, nextReadme }) {
  const additions = []
  if (nextChangelog !== undefined && normalizeLf(currentChangelog) !== normalizeLf(nextChangelog)) {
    additions.push({
      path: 'CHANGELOG.md',
      contents: Buffer.from(normalizeLf(nextChangelog), 'utf8').toString('base64')
    })
  }
  if (nextReadme !== undefined && normalizeLf(currentReadme) !== normalizeLf(nextReadme)) {
    additions.push({
      path: 'README.md',
      contents: Buffer.from(normalizeLf(nextReadme), 'utf8').toString('base64')
    })
  }
  return additions
}

async function github(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ferry-public-release',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(`GitHub API returned ${response.status} for ${path}: ${data.message ?? 'unknown error'}`)
    error.status = response.status
    throw error
  }
  return data
}

async function fetchRepoTextFile(repo, filePath, token, { optional = false } = {}) {
  try {
    const file = await github(`/repos/${repo}/contents/${filePath}?ref=main`, token)
    if (file.encoding !== 'base64') throw new Error(`Unexpected ${filePath} encoding`)
    return Buffer.from(file.content.replace(/\s+/g, ''), 'base64').toString('utf8')
  } catch (error) {
    if (optional && error.status === 404) return null
    throw error
  }
}

async function signedCommit(publicRepo, token, expectedHeadOid, additions, headline) {
  if (!additions.length) {
    throw new Error('Cannot create an empty public commit')
  }
  const body = {
    query: `mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: publicRepo, branchName: 'main' },
        expectedHeadOid,
        message: { headline },
        fileChanges: { additions }
      }
    }
  }
  const response = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ferry-public-release'
    },
    body: JSON.stringify(body)
  })
  const result = await response.json()
  if (!response.ok || result.errors?.length) {
    throw new Error(`Signed commit creation failed: ${result.errors?.map(e => e.message).join('; ') ?? response.status}`)
  }
  const sha = result.data?.createCommitOnBranch?.commit?.oid
  if (!sha) throw new Error('GitHub did not return the new public commit SHA')
  return sha
}

async function commitAndVerifyFiles(publicRepo, token, additions, headline) {
  const ref = await github(`/repos/${publicRepo}/git/ref/heads/main`, token)
  if (ref.object?.type !== 'commit') throw new Error('Public main does not reference a commit')
  const sha = await signedCommit(publicRepo, token, ref.object.sha, additions, headline)
  const commit = await github(`/repos/${publicRepo}/commits/${sha}`, token)
  if (commit.commit?.verification?.verified !== true) {
    throw new Error(`Public release commit ${sha} is not verified; refusing to publish`)
  }
  return sha
}

export async function syncPublicReadmeOnly({
  sourceRepo = process.env.GITHUB_REPOSITORY,
  publicRepo = process.env.PUBLIC_REPO,
  publicToken = process.env.PUBLIC_RELEASE_TOKEN,
  readmePath = PUBLIC_README_TEMPLATE
} = {}) {
  if (!sourceRepo || !publicRepo || !publicToken) {
    throw new Error('Missing source/public repository or publishing token')
  }
  if (publicRepo === sourceRepo) throw new Error('Refusing to publish into the private source repo')
  const nextReadme = validatePublicReadme(await readFile(readmePath, 'utf8'), sourceRepo)
  const currentReadme = await fetchRepoTextFile(publicRepo, 'README.md', publicToken, { optional: true })
  const additions = buildPublicFileAdditions({ currentReadme, nextReadme })
  if (!additions.length) {
    console.log('Public README.md is already in sync')
    return { changed: false, sha: null }
  }
  const sha = await commitAndVerifyFiles(publicRepo, publicToken, additions, 'docs: sync public README')
  console.log(`Verified public README commit: ${sha}`)
  return { changed: true, sha }
}

async function main() {
  const sourceRepo = process.env.GITHUB_REPOSITORY
  const publicRepo = process.env.PUBLIC_REPO
  const tag = process.env.RELEASE_TAG
  const version = process.env.RELEASE_VERSION
  const sourceToken = process.env.SOURCE_RELEASE_TOKEN
  const publicToken = process.env.PUBLIC_RELEASE_TOKEN
  if (!sourceRepo || !publicRepo || !tag || !version || !sourceToken || !publicToken) {
    throw new Error('Missing source/public repository, tag, version, or publishing token')
  }
  if (tag !== `ferry-v${version}`) throw new Error(`Unexpected release tag ${tag}`)
  if (publicRepo === sourceRepo) throw new Error('Refusing to publish into the private source repo')

  const sourceRelease = await github(`/repos/${sourceRepo}/releases/tags/${encodeURIComponent(tag)}`, sourceToken)
  const notes = sanitizeReleaseNotes(sourceRelease.body, version, sourceRepo)
  const body = formatPublicReleaseBody(notes, version)
  const nextReadme = validatePublicReadme(await readFile(PUBLIC_README_TEMPLATE, 'utf8'), sourceRepo)
  const current = await fetchRepoTextFile(publicRepo, 'CHANGELOG.md', publicToken)
  const currentReadme = await fetchRepoTextFile(publicRepo, 'README.md', publicToken, { optional: true })
  const { content, changed } = prependChangelog(current, notes, version)
  let sha
  if (changed) {
    const additions = buildPublicFileAdditions({
      currentChangelog: current,
      nextChangelog: content,
      currentReadme,
      nextReadme
    })
    sha = await commitAndVerifyFiles(publicRepo, publicToken, additions, `docs: publish Ferry ${version} changelog`)
  } else {
    // Preserve an existing tag. If a run failed after signing but before
    // creating the release, recover its verified changelog commit on rerun.
    const response = await fetch(`${API}/repos/${publicRepo}/git/ref/tags/${encodeURIComponent(tag)}`, {
      headers: { Authorization: `Bearer ${publicToken}`, Accept: 'application/vnd.github+json' }
    })
    if (response.ok) {
      const tagRef = await response.json()
      if (tagRef.object?.type !== 'commit') throw new Error('Expected a lightweight public release tag')
      sha = tagRef.object.sha
    } else if (response.status === 404) {
      const commits = await github(`/repos/${publicRepo}/commits?path=CHANGELOG.md&per_page=30`, publicToken)
      const found = commits.find(commit => commit.commit?.message === `docs: publish Ferry ${version} changelog`)
      if (!found) throw new Error('Existing changelog entry has no identifiable signed commit')
      sha = found.sha
    } else {
      throw new Error(`Cannot check existing public tag (HTTP ${response.status})`)
    }
    const commit = await github(`/repos/${publicRepo}/commits/${sha}`, publicToken)
    if (commit.commit?.verification?.verified !== true) {
      throw new Error(`Public release commit ${sha} is not verified; refusing to publish`)
    }
  }
  const path = join(process.env.RUNNER_TEMP ?? '.', 'public-release-notes.md')
  await writeFile(path, body, 'utf8')
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `commit_sha=${sha}\nnotes_file=${path}\n`, 'utf8')
  }
  console.log(`Verified public release commit: ${sha}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const syncReadme = process.argv.includes('--sync-readme')
  const runner = syncReadme ? () => syncPublicReadmeOnly() : () => main()
  runner().catch(error => { console.error(error.message); process.exitCode = 1 })
}
