# Changelog

All notable changes to Ferry are documented in this file, in Keep a Changelog style.

## Unreleased

### Changed

- The file lists now take most of the window: the bottom panel starts collapsed and opens when a transfer starts, the active pane is highlighted, and there is a Compact row-density setting.
- File lists are easier to scan: shorter dates, aligned size and date columns, sentence-case headers, and a title bar and site tabs that read as one band.

## [0.18.3](https://github.com/ThienNg65/ferry/compare/ferry-v0.18.2...ferry-v0.18.3) (2026-11-11)


### Bug Fixes

* exclude Node release tests from Vitest ([#23](https://github.com/ThienNg65/ferry/issues/23)) ([0c15083](https://github.com/ThienNg65/ferry/commit/0c15083bbf6b2b6da04f5b8883204981119b0f8b))
* use GraphQL branchName when signing public releases ([#25](https://github.com/ThienNg65/ferry/issues/25)) ([b5d1b93](https://github.com/ThienNg65/ferry/commit/b5d1b93236fadf1ddecd0e7ac14d6ea637274520))

## [0.18.2](https://github.com/ThienNg65/ferry/compare/ferry-v0.18.1...ferry-v0.18.2) (2026-11-11)


### Bug Fixes

* synchronize and verify public Ferry releases ([#21](https://github.com/ThienNg65/ferry/issues/21)) ([a6b4cbe](https://github.com/ThienNg65/ferry/commit/a6b4cbee3251c337e01bab9ed1c5661a1eeaee30))

## [0.18.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.18.0...ferry-v0.18.1) (2026-11-11)


### Bug Fixes

* migrate Ferry auto-update feed to public release repository ([#19](https://github.com/ThienNg65/ferry/issues/19)) ([d4bd577](https://github.com/ThienNg65/ferry/commit/d4bd5770a629c02c09c389dd63d0a80d9acd3902))

## [0.18.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.17.0...ferry-v0.18.0) (2026-11-11)


### Features

* confirm host key fingerprint on first connect ([5713f85](https://github.com/ThienNg65/ferry/commit/5713f853a5819d87e89783ddf6822e4e33b69f7f))
* richer transfer conflict dialog and F5 copy ([0934643](https://github.com/ThienNg65/ferry/commit/0934643f2ba00afd409fda2bb73891c549a91a73))


### Bug Fixes

* accessibility baseline (labels, contrast, reduced motion) ([0257370](https://github.com/ThienNg65/ferry/commit/0257370134d0e80c82e0f0127bcd383b57732641))
* address review findings (host-key bypass, prompt timeout, safe edit saves, conflict rename) ([3dcf1cf](https://github.com/ThienNg65/ferry/commit/3dcf1cf4112f39283ee7e6afdbdb06e810b8da14))
* confirm single-file delete, cancel rename and path edit on blur ([05ed33e](https://github.com/ThienNg65/ferry/commit/05ed33eca4f9e31898d1fe7850884b4d806cb6d6))
* detect remote changes and save edits atomically ([af83769](https://github.com/ThienNg65/ferry/commit/af8376933c204a6ba36ada3edac4f363807c74b4))
* file list readable at any pane width ([8ad1482](https://github.com/ThienNg65/ferry/commit/8ad1482df3bf75ee265a5d8f0c323d1f73e285b4))
* keyboard focus and selection visibility in file panes ([f27498c](https://github.com/ThienNg65/ferry/commit/f27498c1da4ed685195e0364a9f032e1334dac28))
* plain-language connection errors and persistent error toasts ([5da4e1e](https://github.com/ThienNg65/ferry/commit/5da4e1e9eeb791ca93f9c5d636ddb4bea0ecb073))


### Documentation

* add UX audit and record new conventions in PROJECT_MAP ([0c771ea](https://github.com/ThienNg65/ferry/commit/0c771ea0b3036d94b853306a011e9cd2dfb85bf0))

## [0.17.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.16.1...ferry-v0.17.0) (2026-11-11)


### Features

* add terminal font and color scheme selection ([32cd21c](https://github.com/ThienNg65/ferry/commit/32cd21c79f71b1dc2c07459efe4263db1fb8c52b))
* add terminal font and color scheme selection ([c1accee](https://github.com/ThienNg65/ferry/commit/c1accee42cf0ce89be5e7d19f8d70c79a900510a))

## [0.16.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.16.0...ferry-v0.16.1) (2026-11-11)


### Bug Fixes

* abort in-flight connection when the user cancels or closes the tab ([83e2831](https://github.com/ThienNg65/ferry/commit/83e2831e8b2c1e99c33dcfba4937b926eee729e9))
* close proxy socket and early-cancel leaks, validate terminal send payloads ([4e364b6](https://github.com/ThienNg65/ferry/commit/4e364b6b34f7d48e4c9360fc92cde74b2296a6af))


### Performance Improvements

* add watermark flow control so shell floods no longer queue in IPC ([6f9b9a5](https://github.com/ThienNg65/ferry/commit/6f9b9a5f3b8d2bcb0d4b0be96df202af8727fbf1))
* render terminal with WebGL and coalesce output into one IPC message per frame ([5d4fa7e](https://github.com/ThienNg65/ferry/commit/5d4fa7e5dbaec1413a41d7e90bf55018742ceb46))
* send terminal input and resize fire-and-forget, debounce resize, add ssh keepalive ([1ae43a4](https://github.com/ThienNg65/ferry/commit/1ae43a43a39008177ffdb474ea2b9058de3e6181))


### Documentation

* document abortable connect and batched terminal output in PROJECT_MAP ([f246658](https://github.com/ThienNg65/ferry/commit/f246658013958bf6003b578204632a1050f704a9))

## [0.16.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.15.1...ferry-v0.16.0) (2026-11-10)


### Features

* calm file list with short dates, row density, and joined title/tab bars ([e5e7ea6](https://github.com/ThienNg65/ferry/commit/e5e7ea64e7cb628f2979c6f16f291d8519e4ce85))
* files-first layout with collapsed dock and active pane highlight ([1e6405b](https://github.com/ThienNg65/ferry/commit/1e6405b2d38ffb31de1c7576c80a30992ab592de))

## [0.15.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.15.0...ferry-v0.15.1) (2026-11-10)


### Bug Fixes

* address code review findings for fast remote browsing ([3308808](https://github.com/ThienNg65/ferry/commit/3308808b820019344205969492654db78472aefb))


### Performance Improvements

* add in-memory SWR directory caching and optimistic navigation ([619be6e](https://github.com/ThienNg65/ferry/commit/619be6e6179188973ebe250b38cca1337ceed4c8))
* add remote exec directory listing parser and command generator ([7f65b94](https://github.com/ThienNg65/ferry/commit/7f65b9469da6b0b22d6f200a40886e7b867dc83e))
* implement exec-first directory listing with SFTP fallback ([5cadf5f](https://github.com/ThienNg65/ferry/commit/5cadf5f95d9a3ca3f3382c6c12e31047bc7f8ef7))
* wire hover prefetching and force refresh for remote directory navigation ([9267cba](https://github.com/ThienNg65/ferry/commit/9267cba1ed703dfb9916fae606606e441a0d49a6))


### Documentation

* add fast ssh remote browsing implementation plan ([7cc361a](https://github.com/ThienNg65/ferry/commit/7cc361a791511db378ab1c7613dde07101d07f59))

## [0.15.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.14.15...ferry-v0.15.0) (2026-11-10)


### Features

* Activity dock tab — live progress for every long-running operation ([1c0e46b](https://github.com/ThienNg65/ferry/commit/1c0e46b765a14b0a514391b8987bc42d9246cd2b))
* add zebra striping and directory bolding to file browser rows ([b0048e2](https://github.com/ThienNg65/ferry/commit/b0048e2a392ede9aa98a27a9cd691470531562bc))
* add zebra striping to process monitor rows ([d31609b](https://github.com/ThienNg65/ferry/commit/d31609b0502eb57cc811f8fc5f95cb00280e3739))
* built-in editor improvements, pane resizing, and ui polishing ([9a5ecd2](https://github.com/ThienNg65/ferry/commit/9a5ecd25d6057f9160b7cd078a39bfded460f218))
* connection progress dialog & Happy Eyeballs speed enhancement ([881061c](https://github.com/ThienNg65/ferry/commit/881061c6e110e8b39e15bf7456aeb04e7ed6d906))
* download to active workspace and prevent silent overwrites ([b5f1a86](https://github.com/ThienNg65/ferry/commit/b5f1a866b985210abcdd2b46556c79434c66dcb5))
* **files:** confirm before deleting folders (and file trash-button/context-menu deletes) ([a01363c](https://github.com/ThienNg65/ferry/commit/a01363c3e2fa6a2df0b49a53098e84de4a6a5d49))
* hide jump host and proxy fields behind progressive disclosure in Add Site dialog ([6f8064c](https://github.com/ThienNg65/ferry/commit/6f8064cb3753b9ee89579fb419180f72bb57ab33))
* **logs:** enhance tail log viewer with virtual scrolling, color tracking, and in-log search ([073c82f](https://github.com/ThienNg65/ferry/commit/073c82fb9544e425f113cf3a422fe799fcf10280))
* Monitor dock tab — remote CPU/memory/load resource monitor ([da940af](https://github.com/ThienNg65/ferry/commit/da940af4973e96bae3f4c8f845fbfb8465eca042))
* **monitor:** storage usage, top-processes table, resizable dock ([09795f0](https://github.com/ThienNg65/ferry/commit/09795f0b0d89d2ebb41f05f40df753ef5288a998))
* **security:** harden main-process against Electron checklist gaps ([3739bda](https://github.com/ThienNg65/ferry/commit/3739bda0ef0a9111c271eced21b4f23b206e2053))
* **sites:** add bulk select and delete for saved sites ([71dac70](https://github.com/ThienNg65/ferry/commit/71dac7083e8ed15787f13e5012680963a9162c1e))
* **tail:** enhance UI/UX, formatting, contrast, and controls for live log tail ([4b9db7e](https://github.com/ThienNg65/ferry/commit/4b9db7eca9aa172279b8413481dff81029e1df52))
* **ui:** enhance UI/UX across session manager, shell chrome, file browser, and bottom dock ([2df0306](https://github.com/ThienNg65/ferry/commit/2df03069339a8c5ee2468c95ce64a0c00da70feb))
* **update:** enhance auto-update with manual checks, progress tracking, and settings ([1d8c6e6](https://github.com/ThienNg65/ferry/commit/1d8c6e654c90419f16ffafe4da2e1977619fe7b7))
* **ux:** multi-agent UX polish, site export, port validation, and deletion safety ([10dd62c](https://github.com/ThienNg65/ferry/commit/10dd62c517794ebbf64c1029152f9ce1e1022eb2))
* v0.9.0 — compress-to-zip, bandwidth limit, tab persistence, theme, command palette ([885322e](https://github.com/ThienNg65/ferry/commit/885322e5d92a2a1a27a97eecfe986acd36dfb0cb))
* WinSCP-parity gap review — 13 features (v0.13.0) ([b52d2c6](https://github.com/ThienNg65/ferry/commit/b52d2c60f68a376ba0d677d3b3d71478c9ddc069))


### Bug Fixes

* address final review findings on ui-polish branch ([4d1f049](https://github.com/ThienNg65/ferry/commit/4d1f049f64e9ff6829175a7b8c842674b6b725ce))
* **build:** point auto-update feed at real GitHub repo ([cf0bd77](https://github.com/ThienNg65/ferry/commit/cf0bd77c5edcfd84c3430f22fd7e4c9f9d41223c))
* **dnd:** resolve dropped-file paths via webUtils for Electron 43 ([4f67ec8](https://github.com/ThienNg65/ferry/commit/4f67ec831fefc4bb2fb697366e5eeb745c677fc6))
* Live tail log navigation and immediate output (Ticket [#2](https://github.com/ThienNg65/ferry/issues/2)) ([31abdcb](https://github.com/ThienNg65/ferry/commit/31abdcb17d8f4aa9391cc4c49d33541e42d1e62e))
* Milestone 2 pilot-hardening — bug fixes, test coverage, Open Edits UI ([de2f5ee](https://github.com/ThienNg65/ferry/commit/de2f5ee309809203790dec7e2ecfa97ae2a580db))
* prevent app crash on unhandled ssh client error events ([f59811e](https://github.com/ThienNg65/ferry/commit/f59811e6704cf347d4920c818c1aa5c141c1387e))
* prevent remote command injection in compress/extract via crafted filenames ([4353311](https://github.com/ThienNg65/ferry/commit/4353311ed2b1b10fa501636023dd411c559a0226))
* publish latest.yml so auto-update actually works, prep dormant SignPath signing ([e1bfcf2](https://github.com/ThienNg65/ferry/commit/e1bfcf2bd40a82d51d542c5d2e7c98db6c17ed97))
* **release:** auto-publish releases with generated changelog notes ([c2a85f2](https://github.com/ThienNg65/ferry/commit/c2a85f27f9747ab3e14158fee4b4407f3c000e2c))
* **release:** push git tag before electron-builder publish ([0f032a2](https://github.com/ThienNg65/ferry/commit/0f032a2e6a8177ef5bc0b4e74f340be0b1c963ad))
* resolve critical and high-priority code review findings ([ca4e7ce](https://github.com/ThienNg65/ferry/commit/ca4e7cefcf2adbc91705f186f05481088098ffa1))
* **security:** allow clipboard-write through the permission handler ([7b71803](https://github.com/ThienNg65/ferry/commit/7b71803ba27949d1ea5cc378544b49468b00242b))
* **sites:** batch import into one refetch and avoid duplicate re-creates ([cdb718e](https://github.com/ThienNg65/ferry/commit/cdb718ea99591a0aa50093592a625eabc432b556))
* **sites:** stop WinSCP import self-recursion producing duplicated names ([7be8ae2](https://github.com/ThienNg65/ferry/commit/7be8ae28c8ad974ff27e701cf190c13b02177bb0))
* **tail:** fail fast on permanent errors instead of retrying ([d7c3dee](https://github.com/ThienNg65/ferry/commit/d7c3dee7cbb9b335e66f4fb5b38615647274c957))
* terminal keyboard interaction — focus, copy/paste, right-click ([e2f5692](https://github.com/ThienNg65/ferry/commit/e2f56920a81585b6ea224910dc7b50536df3e394))
* type check ([1f9c1f6](https://github.com/ThienNg65/ferry/commit/1f9c1f6c896b005b3981947557f26842ba7c8dec))
* **update:** resolve electron-updater CJS interop for autoUpdater export ([e801a00](https://github.com/ThienNg65/ferry/commit/e801a005e51f7a4862386800b8520564338265fc))


### Performance Improvements

* **main:** lazy-load ssh2 and archiver off the startup path ([80e4cee](https://github.com/ThienNg65/ferry/commit/80e4cee57bbaefefc4e33688d80116e15a7d7457))
* optimize app startup time ([f032202](https://github.com/ThienNg65/ferry/commit/f0322023dc3d4c82c87c145ed19c9cad95641d5c))
* **renderer:** virtualize FileList with @tanstack/vue-virtual ([80f323d](https://github.com/ThienNg65/ferry/commit/80f323dd206a9000a3467a8864076bb0d2ba3cdd))


### Documentation

* add 0.8.0 changelog entry for the file-op perf pass and injection fix ([1d7e36a](https://github.com/ThienNg65/ferry/commit/1d7e36acc33f26be681f7538df4956f6a132624c))
* add changelog entries for UI polish work ([e8cab5c](https://github.com/ThienNg65/ferry/commit/e8cab5c903d114833d1c9c6503af8f706bcb5d31))
* add changelog entry for 0.11.0 security & performance hardening ([e26f3b9](https://github.com/ThienNg65/ferry/commit/e26f3b95adb2b676ff4515cb7d4fe54e56c2126c))
* add CI/CD release engineering guide and architecture diagram ([06d9525](https://github.com/ThienNg65/ferry/commit/06d9525be21304c04113eead661c45e7064fc832))
* add LICENSE, README, and package release metadata ([5241e74](https://github.com/ThienNg65/ferry/commit/5241e74f2c4abb2b8a916de0b8a2a9a746e84759))
* add real app screenshots to README ([1a0e579](https://github.com/ThienNg65/ferry/commit/1a0e5799a18b901cf8da33e013ca07cfdf4b14ab))
* **changelog:** release v0.14.5 ([6a2177c](https://github.com/ThienNg65/ferry/commit/6a2177c7f341ed1e0c6972d0237d09c1732492b2))
* correct PROJECT_MAP gotchas on the WinSCP import self-recursion bug ([ac1effe](https://github.com/ThienNg65/ferry/commit/ac1effe6dd82996d3f08b6b921f035a97f539282))
* correct PROJECT_MAP's permission-handler description, add clipboard gotcha ([a033d34](https://github.com/ThienNg65/ferry/commit/a033d3468b5477191c2879b3deaa7ef3a449b3cb))
* finalize v0.14.5 changelog ([102b70a](https://github.com/ThienNg65/ferry/commit/102b70a9fba5c3d6b52e687dd39b334ec240b876))
* finalize v0.14.6 changelog ([c337175](https://github.com/ThienNg65/ferry/commit/c337175590923cc4b862c226de6bb42804164881))
* finalize v0.14.6 changelog ([e44aa2f](https://github.com/ThienNg65/ferry/commit/e44aa2f9dd1af12f9d12ab7eaef1e25e8152c686))
* finalize v0.14.7 changelog ([1fb00b6](https://github.com/ThienNg65/ferry/commit/1fb00b69a61b59eca683d6d4d78a712ef403b10e))
* finalize v0.14.8 changelog ([e798a48](https://github.com/ThienNg65/ferry/commit/e798a48e97ec7a837218e16be4ee467fda4253b9))
* finalize v0.14.9 changelog ([c500d1c](https://github.com/ThienNg65/ferry/commit/c500d1cde67964d609ef4a46b330a91bc672c5de))
* update changelog for perf improvements ([5e9c1ad](https://github.com/ThienNg65/ferry/commit/5e9c1ad3130bd1256283fd90c4bd231d769bd594))
* update changelog for ssh client error fix ([39e1baf](https://github.com/ThienNg65/ferry/commit/39e1baffa51b94d37dc170b2d41ea7000df19e31))
* update PROJECT_MAP for round-6 (Activity/Monitor dock, terminal fix, UI pass) ([28b0af6](https://github.com/ThienNg65/ferry/commit/28b0af6493939f47e91b2f004add03f16d9ba886))
* write handoff.md for the security & performance hardening session ([f30bf75](https://github.com/ThienNg65/ferry/commit/f30bf759283fd67879f17c5d95d406b0a24d30dd))


### Styles

* visual hierarchy pass — separate chrome from content, sharpen selection ([98958d8](https://github.com/ThienNg65/ferry/commit/98958d8ca08d9cdf2f68eb462d0925d548483f2a))


### Miscellaneous Chores

* bump version to 0.14.6 ([750a94b](https://github.com/ThienNg65/ferry/commit/750a94b2160c2367db379ddb5427d6f56ed86671))
* **deps:** upgrade Electron v30 -&gt; v43 and modernize build toolchain ([c4f421a](https://github.com/ThienNg65/ferry/commit/c4f421af14d0085d4740e8113b052f85c9b0279c))
* **release:** bump to 0.14.11 and guard CD pipeline against existing tags ([dab59ea](https://github.com/ThienNg65/ferry/commit/dab59ea8f1fd1b737df564dc55c745523e8e00b2))
* **release:** bump version to 0.14.2 [skip ci] ([4534275](https://github.com/ThienNg65/ferry/commit/45342752b21b99b81f79a629fea7ffb07b01f988))
* **release:** bump version to 0.14.3 [skip ci] ([e1408bd](https://github.com/ThienNg65/ferry/commit/e1408bd205ce66b88ec5de1f602351837abceb55))
* **release:** bump version to 0.14.4 [skip ci] ([127836c](https://github.com/ThienNg65/ferry/commit/127836cb3ee2d77b466029d10e6dc9ac0fb8159b))
* **release:** bump version to 0.14.5 [skip ci] ([37988d0](https://github.com/ThienNg65/ferry/commit/37988d031daa0ccf3493bfb22aa6398bcce73746))
* **release:** bump version to 0.14.6 [skip ci] ([7e20a81](https://github.com/ThienNg65/ferry/commit/7e20a81cec53fa86340fad0dcb1b1004073e5bba))
* start next development cycle ([c8f4147](https://github.com/ThienNg65/ferry/commit/c8f414705e4dd37545be8beac5c13e8592b435ba))
* start next development cycle ([6fdf920](https://github.com/ThienNg65/ferry/commit/6fdf920b601986c0f90798f9edc3e90efd61de26))
* start next development cycle ([531d8cd](https://github.com/ThienNg65/ferry/commit/531d8cdedd4649392fb58145b4d582c934219770))
* start next development cycle ([66f058b](https://github.com/ThienNg65/ferry/commit/66f058b9900211ab6a082632e9782b118c34f66b))
* start next development cycle ([8b859c1](https://github.com/ThienNg65/ferry/commit/8b859c1f88e8f6c1c34c7175c448416e8507ae64))
* start next development cycle ([a5901d7](https://github.com/ThienNg65/ferry/commit/a5901d73d7121635ba0c50f8912bb19cf0a6ed89))
* start next development cycle ([e238d48](https://github.com/ThienNg65/ferry/commit/e238d48eddb81c6c206444e11cdf59591c6f79e9))


### Build System

* stop bundling renderer-only deps into packaged app ([3d7680c](https://github.com/ThienNg65/ferry/commit/3d7680c4b7c02d9c520fe6cb5c6e6fae5fd63f1b))


### Continuous Integration

* add typecheck/test CI and tag-triggered release workflow ([4fedacd](https://github.com/ThienNg65/ferry/commit/4fedacd49ad4af38679cd2337b19a83874aa552c))
* adopt release-please workflow and sync version to 0.14.15 ([6066865](https://github.com/ThienNg65/ferry/commit/60668656689dcec32f6967e7116f5754f4f511c2))
* auto-tag on main and grant release job write perms ([0a127e4](https://github.com/ThienNg65/ferry/commit/0a127e4d775e838382d6420d391b73168636920e))
* enhance github actions workflow for atomic releases ([6ffab8d](https://github.com/ThienNg65/ferry/commit/6ffab8dc71edbd844a59b7243e8fc79ad10ef59e))
* explicitly push lightweight tag ([ac1f6e8](https://github.com/ThienNg65/ferry/commit/ac1f6e83760072833728eca03ea68aaf8791badf))
* fix github release 422 error by deferring api calls until after git push ([b6efbcc](https://github.com/ThienNg65/ferry/commit/b6efbcce9bb2fa73bbb6cf6848fd04e385089897))
* fix npm exit-handler crash on windows runners ([5081344](https://github.com/ThienNg65/ferry/commit/50813444914a7bd55afb7ae5fb7483cd21d32075))
* handle protected branch on main with PR fallback and tag resilience ([ee09e83](https://github.com/ThienNg65/ferry/commit/ee09e83df9bef4e2411a95b16780e297c5995c6a))
* harden electron-builder packaging with cache, retry, and prebuilt ico ([c68e3bb](https://github.com/ThienNg65/ferry/commit/c68e3bb3c6f28ec02a0aa74bfb855fb2952eb4b2))

## 0.14.14 - 2026-11-10

### Added
- **Site Export & Backup**: Added `sites:export` IPC channel and a dedicated "Export sites" button in the Sites card header, generating a formatted JSON backup (`ferry-sites-backup.json`) with DPAPI secrets securely excluded.
- **Root Filesystem Deletion Guard**: Added defensive path validation to `LocalFsService.remove()` and `RemoteShell.deleteRecursive()` preventing accidental deletion of root paths (`/`, `C:\`, `C:/`, or empty target).
- **CDP Automation Client**: Added `scripts/cdp-client.js` for Chrome DevTools Protocol automation, DOM inspection, and screenshot verification.
- Enhanced Auto Update lifecycle management, discoverability, and UX:
  - **Manual Update Checks**: Added an interactive "Check for updates" action in the Settings dialog and Command Palette (`Ctrl+K`) with live status feedback.
  - **Real-Time Download Progress**: Added a download progress bar in Settings showing transfer percentage and current download speed (`MB/s` or `KB/s`).
  - **State Machine & Awareness**: Implemented in-memory update state tracking (`idle`, `checking`, `downloading`, `downloaded`, `not-available`, `error`, `disabled`) with reactive push events to all renderer windows.
  - **User Preferences & Periodic Checks**: Added an "Automatically check for updates" toggle in Settings (persisted in `AppSettingsStore`) and a background 6-hour periodic check timer.
  - **TitleBar Update Indicator**: Added an "Update ready" badge button in the TitleBar when an update is downloaded for one-click restart.
  - **Dev Mode Guard**: Unpackaged development mode safely reports `disabled` status without throwing uncaught electron-updater errors.
- Tail Log UI/UX, format, contrast, and productivity overhaul:
  - **Grep Filter Mode**: Added a filter toggle (`Alt+F` / filter icon in search bar) to isolate matching lines in real time alongside standard match navigation.
  - **Stream Status & Control**: Added an interactive `● LIVE` / `⏸ PAUSED (+N)` status pill with click-to-resume auto-scrolling, a sleek floating jump-to-latest button, and a one-click "Export log to file" download action.
  - **Font Size & Wrap Preferences**: Added a font-size cycler (`sm` 10px, `md` 11px, `lg` 13px) and persistent line-wrapping stored across sessions.
  - **Dock Maximize**: Added a one-click dock maximize toggle (`i-lucide-maximize-2` / `i-lucide-minimize-2`) to expand the bottom dock to 85% window height for inspecting long stack traces.
  - **Tail Tabs Polish**: Redesigned tail tabs with file icons, path tooltips, high-contrast active state, and a "Close other tabs" action.
- Comprehensive UI/UX enhancements across Session Manager, Shell Chrome, File Browser, and Bottom Dock:
  - **Session Manager & Connection UX**: Upgraded Session Manager to a responsive two-column layout with a scrollable saved-sites list alongside Quick Connect, a prominent reconnect/connect top banner for disconnected site tabs, Enter-to-submit form ergonomics, and side-by-side Host/Port fields.
  - **Title Bar & Command Palette Discoverability**: Added a clickable `Search / Commands (Ctrl+K)` trigger pill and a `History` icon button in the title bar, plus dock-switching commands (`Terminal`, `Log Tail`, `Resource Monitor`, `Transfers`) in the Command Palette.
  - **Interactive Path Breadcrumbs**: Path segments in both Local (Windows/POSIX) and Remote panes are now individually clickable to jump to any ancestor folder, with click-to-edit on the current segment/spacer and a hover `Copy path` button.
  - **File Browser Keyboard & Status Ergonomics**: Added `ArrowUp`/`ArrowDown` (with `Shift` range selection and virtual-scroll tracking), `Enter` to open, `Ctrl+F` to focus the filter input, `Escape` to clear filter/selection, quick hover Upload/Download row actions, a bottom status bar showing folder/file counts and selected size, and a clickable vertical rail when the Local pane is collapsed.
  - **Transfer Queue & Monitor Polish**: Added a "Clear finished" action in the Transfer Queue, basename-first transfer labels with live throughput (`B/s`) and percentage readouts, threshold-colored (`primary`/`warning`/`error`) storage/memory/CPU bars in the Resource Monitor, and an `Unsaved` badge + theme-aware CodeMirror styling in the built-in Editor.

### Changed
- **Quick Connect Onboarding Polish**: Updated Username placeholder from `"root"` to `"e.g. root"` to eliminate false affordances of a pre-filled default.
- **Settings Bandwidth Affordance**: Added visible disabled styling (`opacity-50 cursor-not-allowed`) to the bandwidth limit input when "Unlimited" is checked, and bounded the proxy options with scrollable overflow.
- **Batch Deletion Safety**: Disabled the "Delete" button in the Sites toolbar when 0 sites are selected, preventing destructive "Delete 0 sites" confirmation prompts.
- **Multi-File Keyboard Deletion Safety**: Enforced confirmation dialogs in `FilePane.vue` whenever multiple files are selected for keyboard deletion (`Delete` key), preventing silent mass deletion of plain files.
- Remapped `Backspace` in the file browser to navigate up to the parent directory (`goUp()`) instead of deleting selected files; destructive file deletion remains on `Delete`.
- Clicking the already-active tab in the bottom dock (or double-clicking the dock header) now collapses the dock; site tabs now support middle-click to close and show live connection status dots.
- Elevated log tail color contrast across error, warning, debug, line-number gutter, and search highlights to meet WCAG 2.2 AA standards in both light and dark themes.
- Formatted leading timestamps in log lines with a subtle dimmed monospace tone for effortless visual message scanning.

### Fixed
- **Command Palette Modal Stacking**: Fixed dual-modal rendering and text overlap collisions when triggering dialogs (e.g. Settings, History) from the Command Palette (`Ctrl+K`) by synchronously closing the palette before invoking action handlers and stopping Enter key propagation.
- **Port Boundary Validation**: Enforced integer range constraints (`1..65535`) in Quick Connect, SiteFormDialog, and `SessionManager.connect()`, preventing out-of-range ports (`-1`, `0`, `70000`, `NaN`) and replacing raw Node `RangeError` alerts with clean validation feedback.
- **Settings Save Error Handling**: Sanitized empty bandwidth inputs and wrapped `SettingsDialog.save()` with `try/catch` and toast notifications, preventing unhandled promise rejections.
- **Vue Transition Console Warnings**: Removed conflicting `<Transition>` wrappers around `<UTooltip>` in `TitleBar.vue`.
- Removed the 40px blank indentation gap on unclassified log lines so lines align cleanly adjacent to the line-number gutter.
- Added keyboard `:focus-visible` outlines and focus-within visibility across custom chrome buttons, tabs, and file-row action controls.
- Distinguished loading, filtered-empty (with a one-click "Clear filter" button), and genuinely empty directory states in the file list.

## 0.14.10 - 2026-11-09

### Added
- Live log tail feature overhaul:
  - **Virtual Scrolling & 60fps Performance**: Replaced unbounded DOM rendering with `@tanstack/vue-virtual`, allowing seamless 60fps scrolling and instant responsiveness even on high-throughput 5,000+ line streams.
  - **Syntax & Log Level Highlighting**: Automatic classification and color coding of log entries (`ERROR`, `WARN`, `INFO`, `DEBUG`, stack traces, and internal notices) with left-border indicators, text tints, and badges.
  - **In-Log Find (`Ctrl+F`)**: Integrated interactive search bar supporting match counting (`X of Y`), next/previous navigation (`Enter` / `Shift+Enter`), match case (`Aa`), regular expressions (`.*`), in-line `<mark>` highlights with active match emphasis, and automatic virtual scrolling to matching lines.
  - **Enhanced UI/UX**: Top toolbar with pulsating live status indicator dot, line count badge, log level filters (`All`, `Errors`, `Warnings+`, `Info+`, `Debug`), wrap/nowrap toggle, clear view, copy button, and floating "Jump to latest (+N)" button with smooth entrance animation.
  - **Dock Tabs Enhancements**: Per-tab live status indicators, unread line count badges (`+N`) on background tabs, middle-click to close, "Close all" button, and active tail count chip on the dock's "Log Tail" button.

### Changed

### Fixed

## 0.14.9 - 2026-08-02

### Added
- Live log tail feature overhaul:
  - **Virtual Scrolling & 60fps Performance**: Replaced unbounded DOM rendering with `@tanstack/vue-virtual`, allowing seamless 60fps scrolling and instant responsiveness even on high-throughput 5,000+ line streams.
  - **Syntax & Log Level Highlighting**: Automatic classification and color coding of log entries (`ERROR`, `WARN`, `INFO`, `DEBUG`, stack traces, and internal notices) with left-border indicators, text tints, and badges.
  - **In-Log Find (`Ctrl+F`)**: Integrated interactive search bar supporting match counting (`X of Y`), next/previous navigation (`Enter` / `Shift+Enter`), match case (`Aa`), regular expressions (`.*`), in-line `<mark>` highlights with active match emphasis, and automatic virtual scrolling to matching lines.
  - **Enhanced UI/UX**: Top toolbar with pulsating live status indicator dot, line count badge, log level filters (`All`, `Errors`, `Warnings+`, `Info+`, `Debug`), wrap/nowrap toggle, clear view, copy button, and floating "Jump to latest (+N)" button with smooth entrance animation.
  - **Dock Tabs Enhancements**: Per-tab live status indicators, unread line count badges (`+N`) on background tabs, middle-click to close, "Close all" button, and active tail count chip on the dock's "Log Tail" button.
- Open Edits dock tab: shows every file you currently have open for editing, across all sessions, with a live sync-status dot (synced / unsaved changes / session closed) and a one-click close button — previously there was no way to see or release an open edit without quitting the app.

### Changed
- File browser and process monitor rows now alternate with a subtle background tint for easier scanning of long lists, and directory names render bolder than file names.
- Add Site dialog's jump host and proxy fields are now tucked behind a collapsible "Advanced connection options" section, expanded automatically when editing a site that already has one of them configured.

### Fixed
- Auto-update: the release pipeline was silently failing to publish the update-feed metadata file, so installed builds could never detect a newer release was available — fixed.
- File browser: pressing Escape to cancel a rename could still silently rename the file to the discarded text, because the input's cancel handler didn't reset the pending edit before the field lost focus.
- File browser: the path breadcrumb now correctly highlights folder segments on Windows local paths (previously only remote, forward-slash paths rendered with dimmed/bold segments), and pressing Escape while editing a path now cancels the edit.
- Command palette: opening it with Ctrl+K no longer yanks focus away from whatever text field you were typing in (e.g. inside Settings or the site form).
- Process monitor: switching sessions in quick succession no longer risks leaving a background poller running for a session you've already left.
- Site editor: saving a site with a custom proxy now correctly requires a proxy host to be filled in.
- History: "Clear" now asks for confirmation before permanently wiping saved history, matching the same safeguard already used elsewhere in the app.
- Two-factor/multi-prompt logins: pressing Enter after the first prompt (e.g. password) no longer submits the whole login early with later prompts (e.g. the one-time code) left blank — Enter now advances to the next field, and only submits from the last one.
- Bottom dock: dragging the resize handle no longer lets the dock visually balloon or collapse mid-drag.
- SSH connections: closing a session tab while it was still connecting could leave the underlying connection open in the background and later have it misreport itself as "connected" after being closed — fixed.
- Permission changes (chmod) and remote file preview reads now validate their inputs and no longer risk silently coercing invalid values.
- Live log tail: reopening the same tail while a dropped connection was retrying in the background could start a second, duplicate stream against the same remote file — fixed.
- In-place file editing: saving a file from certain editors (which save via write-then-rename) could stop being detected after the first save, silently missing subsequent re-uploads — fixed by watching the file's containing folder instead of the file itself.
- File transfers, and remote sync/compress/extract operations, no longer leak file handles or leave partial archive files behind on mid-operation errors.
- Sync: a transient failure while listing the remote side during a push could previously be silently treated as "remote is empty," queuing every file for re-upload — it now fails loudly and safely instead.
- Fixed a handful of background races where a stale response (from a slow session connect, transfer, folder listing, or history search) could overwrite more recent, correct state on screen.

## 0.14.8 - 2026-07-30

### Added
- Adjustable split-pane layout: freely drag the vertical divider between the Local and Remote file lists to customize your view.
- Large file editor warnings: prompts for confirmation before attempting to download and open excessively large files or archives in the built-in text editor.
- Fallback editor logic: the built-in editor will automatically fall back to launching the system's external default editor if a file read was truncated.

### Changed
- Unified drag handle styling: refined the horizontal and vertical pane resizers for better visibility and a consistent dragging experience.
- Adjusted default pane ratio to 1/3 Local and 2/3 Remote.

### Fixed
- Terminal resizing: the integrated terminal grid now correctly scales and updates its layout when the bottom dock is resized.
- Built-in text editor UX: resolved missing scrollbars, theming glitches, and added robust `Cmd/Ctrl+S` manual save support.
- Edit cancellation: aborted long-running file downloads (e.g. clicking Edit then cancelling) now correctly sever the underlying SSH/SFTP streams immediately.

## 0.14.7 - 2026-07-24

### Changed
- Massively improved app startup time (to <500ms) by lazy-loading stores, adding DevTools extension guards, enabling V8 bytecode caching, and implementing renderer bundle splitting.

## 0.14.5 - 2026-07-23
### Added
- Detailed connection progress dialog matching WinSCP UX and "Happy Eyeballs" socket implementation for faster connection speeds.

### Changed
- Shrink the packaged installer by ~21% (118MB -> 93.5MB) by no longer bundling renderer-only packages' (and their build-tool dependency trees) raw source into the app, and by dropping unused Chro[...]
- File transfers from remote to local now intuitively target the active local directory rather than the OS Downloads folder, complete with a new conflict resolution modal to prevent silent overwri[...]

### Fixed
- Prevent app crash on unhandled ssh client error events
- Live Tail log panel navigation and immediate output: Clicking "Live Tail" now immediately navigates to the log panel, and the log state is managed globally so initial history is never missed.
- Prevent remote-to-local path traversal vulnerabilities by enforcing strict filename sanitization prior to enqueuing transfers.

## 0.14.4 - 2026-07-20
### Added
- Confirm before deleting a folder (hover trash button, context menu, or the keyboard Delete/Backspace shortcut); file deletes via the trash button or context menu now confirm too, while the keybo[...]

## 0.14.3 - 2026-07-20
### Added
- Add bulk select and delete for saved sites.

### Fixed
- Fail fast on permanent errors instead of retrying.
- Stop WinSCP import self-recursion producing duplicated names.
- Batch import into one refetch and avoid duplicate re-creates.

## 0.14.2 - 2026-07-20
### Fixed
- FilePane.vue: scope keydown shortcuts away from text inputs (fixes data-loss on Delete/Ctrl+A while typing), fix Ctrl+A vs active filter, stuck rename state, and multi-select-aware row delete.
- RemoteShell: reject unsafe SFTP entry names (path traversal) and destroy the exec/execLines stream on abort instead of leaking it.
- TransferQueue/SyncService: defense-in-depth root-boundary check on joinLocal.
- SessionManager: scope host-key-mismatch trust to the exact hop/target that was confirmed, instead of force-trusting every hop on retry; fix proxy socket leak on failed connect.
- EditSessionManager: add closeEdit() + edit:close IPC channel.
- tailStreams/sessions store: dedup tails per-session, close them on tab close, and await an in-flight connect before detaching a closing tab.
- CompressService: guard remote zip source arg against option injection.
- SiteStore/AppSettingsStore: guard decrypt() against unavailable/failed OS encryption.
- TerminalView/App.vue: fix stale-session reattach races and avoid double term.open() by keeping the connected view mounted via v-show.

## 0.14.0 — Release first version

## 0.13.0 — WinSCP-parity gap review: 13 features across file browsing, connections, and sync

A feature/UX gap review against WinSCP (as a daily-driver user) produced an 11-item punch list, phased into four rounds and built essentially back to back: file-browser basics, connection/auth dep[...]

**New features:**
- **Edit in external editor** — double-click (or right-click → Edit) any file, local or remote, to open it in the OS's default app; a remote file downloads in full first (unlike the existing c[...]
- **One-way directory sync (mirror)** — push (local → remote) or pull (remote → local) a whole folder tree, diffing by size and a tolerant mtime comparison (SFTP's whole-second precision vs.[...]
- **Multi-hop jump-host (bastion) chaining** — a saved site can now tunnel through an ordered chain of jump hosts instead of just one, with per-hop host-key verification kept correctly isolated [...]
- **SSH key generation** — generate a new ed25519 keypair from the site form, preferring the system `ssh-keygen` (supports a passphrase) and falling back to a pure-JS `openssh-key-v1` encoder wh[...]
- **SOCKS5 / HTTP CONNECT proxy support** — a global default proxy (Settings) or a per-site override (inherit/none/custom), for connecting through a corporate proxy with no bastion host availabl[...]
- **Persisted transfer/operation history** — a searchable, filterable log of every completed transfer and long-running operation (previously only visible live in the Activity dock), with a debou[...]
- **Directory bookmarks** — quick-jump bookmarks per local/remote folder, independent of saved-site groups; cascade-deleted when their site is deleted.
- **In-listing search/filter** — type-to-filter within either pane's file listing, entirely client-side.
- **Custom accent color** — curated presets or a full color picker in Settings, replacing the fixed brand blue.

**Bug fixes (found doing the gap review, not new-feature regressions):**
- Remote symlinked directories showed up as plain files (SFTP `readdir` reports lstat-style attrs); local broken symlinks were silently dropped from the listing instead of shown with a broken indi[...]
- WinSCP/PuTTY session import only scanned the top level of the registry, silently dropping every session organized into a folder group. Fixed with a recursive walk — which in turn uncovered and[...]
- SSH-agent/Pageant authentication shipped previously without ever being verified end-to-end; it now pre-flight-checks the agent is reachable and has identities loaded, with actionable error messa[...]

**Hardening (from this release's own code review):**
- Edit-in-editor's temp directory and downloaded file are now created with restrictive permissions (`0700`/`0600`) — previously default-permissioned, which would have been world-readable on a sh[...]
- Quick-connect can now bypass a configured app-wide default proxy — previously it had no opt-out and always inherited it, unlike saved sites' inherit/none/custom choice.
- `ssh-keygen`'s passphrase-via-argv exposure (visible to other local processes for the tool's brief lifetime) is now a documented, deliberate limitation rather than a silent gap — there's no fi[...]

**Not code — decisions for a maintainer:**
- Auto-update's build/publish config was already fixed in a prior release; what's left is a real code-signing certificate and cutting an actual first `v*` release tag, neither of which this sessio[...]

## 0.12.0 — Monitor dashboard overhaul: storage, top processes, resizable dock

Customer feedback on the 0.10.0 Monitor dock tab was that it was "useless" in practice — no way to see the connected server's total storage, and no way to see *what* was actually consuming its C[...]

**New features:**
- **Root filesystem storage usage** — a "used / total" bar (e.g. "98 GB / 100 GB") for the connected server's `/` filesystem, polled alongside the existing CPU/memory/load stats via the same tic[...]
- **Top-processes table** — a live table of the server's processes by resource usage (Name, PID, RAM, CPU%), sortable by clicking any column header (default: CPU% descending), virtualized via `@[...]
- **Resizable dock** — drag the bottom dock's top edge to make it taller, persisted across restarts, so the process table (and every other dock tab — Transfers, Activity, Terminal) gets real r[...]

**Under the hood:**
- Process/disk collection extends the existing tick-based `/proc` polling model (`MonitorManager`) rather than introducing a new streaming mechanism or shelling out to `ps` (whose flag dialects di[...]

## 0.11.0 — Electron security & performance hardening, Electron 43 upgrade

An audit against Electron's own official security and performance checklists — fundamentals (context isolation, sandbox, no Node integration, bundled build, CSP, no default menu) were already in[...]

**Security hardening:**
- All renderer permission requests (camera, mic, geolocation, notifications) are now explicitly denied — the app never needs any of them.
- Top-level page navigation is now blocked outright; there's no in-app router, so any navigation attempt is illegitimate.
- External links (`shell.openExternal`) are now restricted to `http`/`https` — a maliciously crafted filename or log line from a remote server could previously have triggered an arbitrary OS sch[...]
- The Content-Security-Policy now explicitly scopes `img-src`/`connect-src` to the app itself.
- Electron Fuses are now locked down in the packaged build (disables `runAsNode` and Node CLI/env-var escape hatches, enables cookie encryption and asar integrity validation) — verified against [...]

**Performance:**
- The SSH (`ssh2`) and zip-archive (`archiver`) libraries now load on first use instead of at app startup, shortening cold start.
- The file list now virtualizes long directory listings (via `@tanstack/vue-virtual`, previously an unused dependency) instead of mounting one DOM row per file — large remote/local folders scrol[...]
- Reading a private key for SSH authentication no longer blocks the main process while the file loads.

**Dependency upgrade:**
- Electron bumped from 30 (end-of-life) to 43 (current stable), with electron-builder and electron-vite brought forward to match. Verified: the app boots under the new Electron both in dev and as[...]
- Fixed OS drag-and-drop uploads (Explorer → remote pane), which the Electron 43 upgrade would otherwise have silently broken — Electron 32 removed the DOM API this relied on to read a droppe[...]

## 0.10.0 — UX & visibility pass: visual hierarchy, live operation progress, terminal keyboard fix, remote resource monitor

Customer feedback on 0.9.0 raised four issues, all addressed this round: the UI was "modern, minimal, but hard to distinguish the content"; only file transfers reported progress, so remote extrac[...]

**New features:**
- **Activity dock tab** — remote extract/compress, local compress, and recursive deletes now show real progress and elapsed time instead of running silently. Multi-select delete is now one oper[...]
- **Monitor dock tab** — live CPU% (aggregate + per-core sparkline), memory/swap, load averages, and uptime for the connected remote server, polled every 2s over the existing SSH connection via[...]

**Bug fixes:**
- **Terminal keyboard** — Ctrl+C (copy selection or SIGINT), Ctrl+Shift+C, Ctrl+V/Ctrl+Shift+V/Shift+Insert (paste), and right-click copy-or-paste now all work. Root cause was the terminal neve[...]

**Visual hierarchy:**
- Chrome regions (title bar, site tab bar, pane headers, dock header) now sit on a distinct `bg-muted` surface with borders at region boundaries, instead of one flat background shared with conten[...]
- Selected rows use an unmistakable `bg-primary/10` tint instead of two nearly-identical zinc shades previously shared with hover.
- Per-file-type icon colors (archives amber, images violet, video rose, audio pink, spreadsheets emerald, code/json teal) and three-tier text contrast (headers vs. size/date/permissions metadata)[...]

## 0.9.0 — WinSCP-parity Phase 4 continued: compress, bandwidth limit, tab persistence, theme, command palette

The remaining WinSCP-parity Phase 4 items land: an inverse to the existing "Extract here" action, an app-wide transfer speed cap, tabs that survive a restart, a light/dark toggle, and a Ctrl/Cmd+[...]

**New features:**
- **Compress to .zip** — the inverse of "Extract here", available from every file/folder's right-click menu. Zips in place: locally via the streamed `archiver` package (no memory blow-up on lar[...]
- **Transfer bandwidth limit** — a new Settings dialog (gear icon in the title bar, or via the command palette) caps all transfers combined to a configurable KB/s ceiling, applied app-wide via [...]
- **Site tabs are restored across app restarts** — as picker tabs only, never auto-connected: the app remembers which saved sites had open tabs at last shutdown, but you still click to connect,[...]
- **Light/dark theme toggle** — a sun/moon button in the title bar, defaulting to the OS's own preference on first run, persisted across restarts.
- **Command palette (Ctrl/Cmd+K)** — quick actions (new tab, toggle theme, toggle the Local pane, open Settings) plus jump-to-site search, so connecting to a saved site no longer requires leavi[...]
- **Auto-update scaffolding** — packaged builds check GitHub Releases on launch and prompt to restart-and-install once a new version has finished downloading in the background. This is genuinel[...]

## 0.8.0 — File-op performance pass, and a shell-injection fix found in review

User feedback that Ferry felt much slower than WinSCP (and than a plain terminal) for delete/rename/chmod/navigate led to a focused performance pass tracking down the actual causes rather than co[...]

**Performance:**
- Remote recursive delete now runs a single `rm -rf` over the already-open SSH connection instead of walking the tree one SFTP round-trip at a time — deleting a folder with hundreds of files is[...]
- Delete/rename/chmod (both local and remote panes) patch the in-memory file list directly instead of doing a full directory reload after every mutation.
- Multi-select delete fires every delete concurrently and patches the list once, instead of N sequential delete-then-reload round-trips.
- Local directory listing stats entries in parallel instead of one at a time — speeds up opening local folders with many files.

**Security fix (found in this release's own review):**
- Remote Extract built its shell command by wrapping already-escaped paths in a hand-written double-quoted `sh -c "..."` string. Because `$(...)`/backticks are still live inside double quotes, a [...]

## 0.7.0 — Bug fixes, WinSCP-parity Phase 4 (partial), and a security/performance review

Two real bugs reported from manual testing, fixed; three of Phase 4's six items landed; and a dedicated security + performance review of the existing Phase 1/2 work, with the findings acted on ra[...]

**Bug fixes:**
- Right-click → Rename no longer opens the inline edit box and instantly closes it again — the context menu was stealing focus back a moment after the rename input appeared.
- The per-row action-button column is back to a single Delete button — tail/extract/transfer's hover icons were redundant now that the right-click context menu covers them.

**WinSCP-parity Phase 4 (partial):**
- Saved sites can be grouped (a free-text tag, e.g. "Work"), searched, and duplicated.
- Per-file-type icons — images, video, audio, code, archives, spreadsheets, and documents each get their own icon instead of one generic file icon.
- Import existing WinSCP and PuTTY sessions from this machine's saved sessions (Windows registry scan). Passwords are deliberately never imported — neither client stores one in a form Ferry can[...]

**Security fixes (found in this release's own review):**
- A site's stored password could keep getting silently replayed into keyboard-interactive prompts even after switching that site to key- or agent-based auth. Switching a site's auth method now cl[...]
- The remote log-tail feature's history-line count was passed into a remote shell command without validation — a possible injection point if the app's renderer process were ever compromised. No[...]

**Performance fix (found in this release's own review):**
- Uploading/downloading a whole folder moved one file at a time, even on a high-latency connection. Up to 4 files now transfer concurrently within a single folder transfer.

## 0.6.0 — WinSCP-parity Phase 2: security & auth, plus the first real-server test suite

Closes Phase 2 of `.claude/plan/ferry-winscp-parity-roadmap.md` — the trust/security gaps flagged in the original gap analysis as "would concern a security-conscious WinSCP user." This is also [...]

**Security & auth parity:**
- Host-key verification (trust-on-first-use, pinned per host:port) — a changed key now blocks the connection with a clear warning and an explicit "trust and continue" instead of connecting sile[...]
- Real keyboard-interactive/2FA — a genuine OTP/verification-code prompt is now shown to the user instead of the password being blindly replayed into it (which just failed).
- SSH-agent authentication (Windows OpenSSH Agent / Pageant / `$SSH_AUTH_SOCK`, with an optional per-site path override).
- Jump-host (bastion) support — tunnel a connection through an intermediate SSH host.
- Editable permissions — a WinSCP-style chmod dialog (owner/group/other × read/write/execute) on the permissions column, replacing the old read-only display.
- Transfer retry — a retry button on any failed or cancelled transfer, instead of only being able to cancel.

## 0.5.0 — Round 5 UX/perf polish + WinSCP-parity Phase 1

An honest gap analysis against WinSCP (see `.claude/plan/ferry-winscp-parity-roadmap.md`) found several table-stakes file-manager basics missing entirely. This release closes Phase 1 of that road[...]

**WinSCP-parity Phase 1:**
- Recursive directory transfer — upload/download whole folder trees, not just single files.
- Rename wired into the UI (F2 or right-click) — the backend already supported it, nothing called it.
- Click-to-sort file-list columns (name/size/modified), ascending/descending.
- Real Explorer-style multi-select: plain click, Ctrl+click, Shift+click range-select, Ctrl+A.
- Right-click context menu per file row (transfer, tail, extract, rename, copy path, delete).
- OS drag-and-drop: drop files/folders from Explorer straight onto the remote pane to upload; local rows can now be dragged out to Explorer/other apps via a native OS drag.
- Toolbar "Upload/Download N selected" button for bulk transfer of a multi-selection.

**Round 5 (UX/perf polish + real-device bug fixes):**
- Deferred the full Lucide icon-set load past first paint for a faster cold start, and fixed a CSP-violation regression that fix introduced.
- Broadened text-preview and archive support (`.jar`/`.war`/`.ear`, more tar variants).
- Bigger file preview dialog.
- A generic busy indicator — an in-flight IPC counter — now drives a titlebar dot, a wait cursor, and a click-blocking overlay across virtually every operation, not just transfers.
- Fixed the Local-pane collapse animation (a previous attempt silently didn't animate).
- App version now visible in the UI; LOCAL/REMOTE pane labels made more prominent.
- The Terminal now opens at the site's configured remote start path.
- The refresh icon spins while refreshing.
- Extracting an archive now creates a same-named subfolder, prompting on conflict, instead of dumping into the current directory.

## 0.4.0 — Round 4: UX feedback

- Centered the "Ferry" title in the title bar.
- Removed the Activity feature entirely (dock tab, backend ring buffer, IPC channel, store, component).
- Moved the hide-Local-pane toggle from the Local pane's own header into the site tab bar, pinned to the right end.
- Connecting to a saved site that already has an open tab now switches to that tab instead of opening a duplicate connection.
- The SSH terminal now opens automatically in the background as soon as a site connects, labeled `username@host`, instead of waiting for the Terminal dock tab to be clicked.
- Added a remote-only file-permissions column, with a toggle between a friendly plain-English label and the classic technical `rwxr-xr-x` string.
- Custom scrollbar styling matching the app's neutral color palette, in both light and dark mode.
- Added tooltips to every icon-only button across the app.
- Added a Ctrl+R shortcut to refresh the focused pane's directory listing.
- Shipped the app's icon/favicon assets (installer, taskbar/window icon, renderer favicon).

## 0.3.0 — Round 3: site tabs, SSH terminal, named sessions

- Browser-like site tabs — open multiple sites at once, switch between them instantly, each with its own live SSH session.
- Interactive SSH Terminal dock tab per site tab, backed by `ssh2`'s PTY shell and `@xterm/xterm`.
- Entering a saved site shows `Session {name}` instead of a raw session UUID.
- The hide-Local toggle moved into the Local pane's own header row.
- Removed the redundant "Disconnect" button/bar (closing a tab already disconnects its session).

(commit `5b67425`)

## 0.2.0 — Round 2: saved sites, preview, and polish

- Saved sites (add/edit/delete), quick-connect, and file preview/tail dialog.
- Hide-Local-pane toggle, custom frameless titlebar, download/toast polish.

(commit `b372122`)

## 0.1.0 — Initial scaffold

- Ferry's initial SFTP client scaffold: dual-pane browser, transfer queue, and live remote log tailing.

(commit `5aa908b`)
