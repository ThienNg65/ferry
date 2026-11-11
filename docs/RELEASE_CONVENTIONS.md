# Release and pull request conventions

Ferry uses Release Please to create version-bump PRs from commits merged into `main`. **Release Please needs Conventional Commit subjects** to determine version changes.

## Pull requests

Use one of these title forms:

- `feat: describe a user-facing feature` (minor release, e.g. 0.18.4 -> 0.19.0)
- `fix: describe a bug fix` (patch release, e.g. 0.18.4 -> 0.18.5)
- `perf: describe a performance improvement`
- `refactor(scope): describe an internal refactor`
- `docs:`, `test:`, `ci:`, `chore:`, `build:` for maintenance changes

A PR-title workflow checks the title when a PR is opened or edited. It must be made a **required** status check; without branch protection, it only reports failures.

## Merge settings (owner action in GitHub)

In **Settings -> General -> Pull Requests**:

1. Keep **Allow squash merging** enabled.
2. Set **Default commit message for squash merging** to **Pull request title**.
3. Disable regular merge commits and rebase merging if you want one consistent merge strategy.
4. For **Release Please-generated PRs**, squash merging is supported; the title `chore(main): release ferry x.y.z` is valid.

In **Settings -> Branches -> Branch protection** (or repository rulesets), protect `main`:

- Require a pull request before merging.
- Require status check **conventional-title** from the **PR title** workflow.
- Also require existing CI **verify** if appropriate.
- Do not rely on the default squash commit message without setting it to the PR title.

GitHub repository settings and branch protection must be configured by an owner with administration rights.

## Release Please bot PR checks

The release workflow uses \`secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN\`.
If \`RELEASE_TOKEN\` is not configured, Release Please creates version PRs using GitHub's built-in token. GitHub then holds PR-triggered CI workflows for approval; the resulting checks may show as failed or action-required **without running any jobs**.

To make the mandatory title/CI checks work smoothly for automated version PRs, configure a **separate** fine-grained personal access token in the **private source repository**:

1. Restrict repository access to \`ThienNg65/ferry\` only.
2. Grant **Contents: Read and write**, **Pull requests: Read and write** (Metadata read is automatic).
3. Add it to \`ferry\` -> Settings -> Secrets and variables -> Actions as **\`RELEASE_TOKEN\`**.
4. Keep the existing **\`PUBLIC_RELEASE_TOKEN\`** scoped to \`ferry-release\`; do not reuse or broaden it.

Alternatively, approve workflows manually on each Release Please PR before merging. **Do not require \`conventional-title\` on \`main\` until you have one of these approval paths working**, or automated version PRs may be blocked by branch protection.

Reference: [GitHub Actions: triggering workflows with GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## Recovery for PR #28

PR #28 (`Feat/ux feedback p2 p3`) was squash-merged as a commit whose subject started with `Merge pull request #28`. Release Please successfully ran but skipped that non-Conventional-Commit message.

The recovery PR adds no repeated application changes. Squash merge its PR with the subject `feat: include P2/P3 UX refinements in release notes` to record the previously missed feature and trigger the next minor release. **Do not edit or rewrite the published v0.18.4 tag.**
