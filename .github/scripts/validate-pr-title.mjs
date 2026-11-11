import { pathToFileURL } from 'node:url'

/**
 * Match Conventional Commit subjects used by Release Please and common bots.
 * Keep the check on PR titles: with GitHub's "squash commit title = PR title"
 * setting, this is what lands on main and drives release versioning.
 */
const CONVENTIONAL_TITLE = /^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: \S(?:.*\S)?$/

export function isConventionalTitle(title) {
  return typeof title === 'string' && CONVENTIONAL_TITLE.test(title)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const title = process.env.PR_TITLE
  if (!isConventionalTitle(title)) {
    console.error('PR title must use Conventional Commits. Examples:')
    console.error('  feat: improve remote file browsing')
    console.error('  fix(ssh): handle dropped connections')
    console.error('  perf: reduce directory refresh latency')
    console.error('  chore(main): release ferry 0.19.0')
    console.error(`Received: ${JSON.stringify(title ?? '')}`)
    process.exitCode = 1
  } else {
    console.log(`Valid Conventional Commit PR title: ${title}`)
  }
}
