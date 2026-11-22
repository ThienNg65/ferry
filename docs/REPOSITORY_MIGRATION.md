# Ferry private-source / public-release migration

## Target repositories

- `ThienNg65/ferry` — existing source repository, **private after bridge verification**. Keep all history, PRs, development CI, Release Please, and existing release records.
- `ThienNg65/ferry-release` — new **public** distribution repository with README, sanitized changelog, screenshots, issues, and binary releases.

## Required one-time GitHub operations (performed by the owner)

1. Create **public** `ThienNg65/ferry-release` with a normal `main` branch (do not copy the application's source tree or Git history). Copy files from `docs/public-release-template/` into its root. Copy existing image files from `ferry/public/` into `ferry-release/assets/`; do not copy secrets or development files.
2. Add a fine-grained token as the **`PUBLIC_RELEASE_TOKEN`** Actions secret in `ferry`. Scope it to `ThienNg65/ferry-release` with **Contents: Read and write**. Prefer a dedicated GitHub App token if available. Do not commit tokens, and do not use public release repository workflow credentials to access private source.
3. Keep the existing `RELEASE_TOKEN` (if configured) used for Release Please and the legacy repo. Preserve any SignPath secrets and variables. The release job preflights public repository access before building.
4. Merge the migration PR while `ferry` is still public. Build an initial **bridge version newer than v0.18.0**, e.g. `ferry-v0.18.1`, using Release Please. Until the repository variable `PUBLISH_LEGACY_FERRY` is exactly `false`, the pipeline uploads the identical installer and metadata to both repositories.
5. Verify **both** releases have `Ferry-Setup-*.exe`, `*.blockmap`, and `latest.yml`; ensure installer sha256 digests match. Install the previous public version on a test Windows machine, check that it discovers the bridge release via `ThienNg65/ferry`, updates, then that the updated app retrieves future updates via `ThienNg65/ferry-release`. Validate generated `resources/app-update.yml` in the packaged application names `ferry-release`.
6. Publish a subsequent release **only to `ferry-release`** to test the new feed, by setting the source repository Actions variable `PUBLISH_LEGACY_FERRY=false`. **Do not disable the legacy feed until existing clients have had time to update.** If needed, keep dual publishing longer.
7. Only after the bridge has been published and tested and old clients have been given an update window, change `ThienNg65/ferry` visibility to private under GitHub Settings → General → Danger Zone. This operation is intentionally excluded from automation. Existing installations that missed the bridge will need a manual installer from the public repo.
8. Edit `docs/public-release-template/README.md` in `ferry` when updating public documentation. On every push to `main` (via the `sync-public-readme` job running `.github/scripts/publish-public-release.mjs --sync-readme`) and on every release (bundled into the verified release commit alongside `CHANGELOG.md`), GitHub Actions automatically validates that no private `ferry` URLs remain and syncs `README.md` to `ThienNg65/ferry-release`.
9. *(Optional)* Add a `VERCEL_DEPLOY_HOOK_URL` Actions secret in `ferry` so `publish-assets` triggers a `ferry-website` prerender rebuild automatically whenever a public release is published.

## Rollback

Before the source repository is made private, restore the previous publishing target and release workflow through a new commit if the dual-publish pipeline fails. Keep `ferry` public while investigating. Avoid deleting public releases, tags, or installers. Once `ferry` becomes private, the old update endpoint is inaccessible to unauthenticated clients; changing it back to public is a separate deliberate owner action.

## Scope and security

- This migration **does not rewrite or delete Git history**. Earlier publicly published code could still exist in clones, forks, or cached source archives.
- Release Please creates private-source release records and changelog entries. The publication job copies sanitized release categories to the public release body and `CHANGELOG.md`, stripping private commit/PR links and rejecting unrecognized private URLs (and applies the same private-URL check to `docs/public-release-template/README.md` before syncing `README.md`).
- The publication job uses GitHub GraphQL `createCommitOnBranch` to create a GitHub-signed public commit for `CHANGELOG.md` (and `README.md` when changed), verifies its signature, and creates the release tag pointing to it. This supplies the **Verified** badge beside the public release commit without distributing private signing keys. The tag itself is lightweight and unsigned; Windows installer code signing is a separate feature.
- Existing `ferry-v0.18.1` remains attached to its original unsigned commit. Published tags are not moved; the Verified public-commit workflow applies to subsequent versions.
- The old `v0.18.0` binaries continue to check `ThienNg65/ferry`; the bridge release is mandatory before switching repository visibility.
- The publicly published compiled app contains client-side JS that can be extracted or reverse engineered. A private repository prevents easy source browsing but does not make shipped client code a secret.
- `ferry-release` should not run a build from private code or expose a private checkout token.
- Do not manually make `ferry` private or remove access to its releases until the bridge update is confirmed working.
