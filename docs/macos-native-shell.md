# macOS native shell (Mac App Store build)

On macOS Ferry runs as a native Swift app (`macos/`) that hosts the Vue UI in a `WKWebView` and the Node sidecar over stdio. Windows and Linux still use Neutralino. The Mac App Store build is sandboxed, so a few behaviours differ.

## Build and check

```bash
npm run pack:macos      # universal (arm64 + x86_64) Ferry.app in dist/macos, ad-hoc signed
npm run smoke:macos     # structure, signature, entitlements, real launch
node scripts/smoke-macos-package.mjs --arch x86_64   # Intel slice under Rosetta
```

Real signing, the `.pkg` and CI are Phase 3 of the store epic (#211).

## Sandbox behaviour

| Area | Behaviour |
|---|---|
| Folders and files | Only what you pick in a system dialog or drop on the window. Picks are stored as security-scoped bookmarks (`fs-access.json`) and restored at launch, before the sidecar starts, so the sidecar inherits access. |
| SSH private keys | Pick the key file in the site form. Generated keys are written to the app container's `~/.ssh` (the real home is not writable). The built-in generator is used if `ssh-keygen` is unavailable. |
| `~/.ssh/config` import | The sandbox hides the real file. Import sites shows **Choose ~/.ssh/config…**; the picked file is parsed. |
| SSH agent | Not verified in the sandbox. Expect it to be unavailable; use key files. A narrow socket exception can be evaluated later. |
| Finder drag and drop | The shell reads dragged file URLs, keeps access to them, and the page resolves dropped files to real paths, so large files do not hit the 16 MB staging limit. Needs a manual check with a real drag. |
| Updates | Disabled; the store delivers updates. `UpdateState.managedBy` hides the controls. |
| Keychain | Master key lives in the login Keychain under service `js.ferry.app`. |
| Monitor | Needs a Linux `/proc` on the remote host (same as other platforms). |
