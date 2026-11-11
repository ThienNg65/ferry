import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const API = 'https://api.github.com'
const GRAPHQL = `${API}/graphql`

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  // Fail closed if a new release-please format introduces a private link we didn't strip.
  if (new RegExp(`${escapedUrl}(?!-release)(?:[/\\s)]|$)`, 'i').test(notes) ||
      new RegExp(`api\\.github\\.com/repos/${escapeRegExp(sourceRepo)}(?:[/\\s]|$)`, 'i').test(notes)) {
    throw new Error('Sanitized release notes still include a private source link')
  }
  if (!/^###\s+/m.test(notes)) {
    throw new Error('Expected at least one release-note category (Features, Bug Fixes, etc.)')
  }
  return notes
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

async function github(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ferry-public-release'
    },
    ...(options.body ? { body: JSON.stringify(options.body), headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'ferry-public-release'
    } } : {})
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${path}: ${data.message ?? 'unknown error'}`)
  }
  return data
}

async function signedCommit(publicRepo, token, expectedHeadOid, changelog, version) {
  const body = {
    query: `mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: publicRepo, refName: 'refs/heads/main' },
        expectedHeadOid,
        message: { headline: `docs: publish Ferry ${version} changelog` },
        fileChanges: {
          additions: [{ path: 'CHANGELOG.md', contents: Buffer.from(changelog, 'utf8').toString('base64') }]
        }
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
  const body = `${notes}\n\n### Download\n\nDownload \`Ferry-Setup-${version}.exe\` under **Assets** for Windows x64.\n`
  const currentFile = await github(`/repos/${publicRepo}/contents/CHANGELOG.md?ref=main`, publicToken)
  if (currentFile.encoding !== 'base64') throw new Error('Unexpected changelog encoding')
  const current = Buffer.from(currentFile.content.replace(/\s+/g, ''), 'base64').toString('utf8')
  const { content, changed } = prependChangelog(current, notes, version)
  let sha
  if (changed) {
    const ref = await github(`/repos/${publicRepo}/git/ref/heads/main`, publicToken)
    if (ref.object?.type !== 'commit') throw new Error('Public main does not reference a commit')
    sha = await signedCommit(publicRepo, publicToken, ref.object.sha, content, version)
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
  }
  const commit = await github(`/repos/${publicRepo}/commits/${sha}`, publicToken)
  if (commit.commit?.verification?.verified !== true) {
    throw new Error(`Public release commit ${sha} is not verified; refusing to publish`)
  }
  const path = join(process.env.RUNNER_TEMP ?? '.', 'public-release-notes.md')
  await writeFile(path, body, 'utf8')
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `commit_sha=${sha}\nnotes_file=${path}\n`, 'utf8')
  }
  console.log(`Verified public release commit: ${sha}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
