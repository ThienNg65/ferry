# Changelog

All notable changes to Ferry are documented in this file, in Keep a Changelog style.

## Unreleased

### Added

- Local-first **Privacy Policy** (`PRIVACY.md`), **Terms of Service** (`TERMS.md`), and **Third-Party Licenses** (`THIRD_PARTY_LICENSES.txt` + `npm run licenses:generate`), all bundled into packaged/NSIS distributions.
- First-run **Terms & Privacy** acceptance modal (`LegalConsentDialog`) recording `{ version, acceptedAt }`, with an `autoCheckUpdates` toggle and deferred startup update checks until accepted.
- **Privacy & Legal** tab in Settings with policy/license viewers, configurable transfer/operation history retention (`30 days`, `90 days` default, `1 year`, `Unlimited`), **Export My Data** (JSON excluding passwords/passphrases), **Delete All Data**, and **Trusted SSH Hosts** management.
- `Home`, `End`, `PageUp`, and `PageDown` (with `Shift+` range selection) keyboard navigation in file panes.

### Changed

- Switched Ferry to a genuine native OS window frame on Neutralinojs `6.10.0` (`borderless: false`, `hidden: true`), removing the custom `TitleBar` and `WindowResizeHandles` components and consolidating header controls into `SiteTabBar`.
- Synced Windows 10/11 dark/light framing (`DWMWA_USE_IMMUTABLE_DARK_MODE`) and Windows 11 caption color (`DWMWA_CAPTION_COLOR`) to `SiteTabBar` before first paint, added multi-monitor `Screen.AllScreens` startup clamping, `Alt+F4` / close bounds persistence, and `F11` fullscreen toggle.
- Prevented dual-pane toolbar and breadcrumb clipping on narrow split panes by collapsing `Filter (Ctrl+F)` into an expandable search button and hiding idle breadcrumb action buttons from layout flow.
- The file lists now take most of the window: the bottom panel starts collapsed and opens when a transfer starts, the active pane is highlighted, and there is a Compact row-density setting.
- File lists are easier to scan: shorter dates, aligned size and date columns, sentence-case headers, and a title bar and site tabs that read as one band.
- Upgraded readable low-contrast `text-dimmed` UI labels to `text-muted` across dialogs, title bar, bottom dock, monitor, and log viewers.

### Security

- Added secret-redacted JSON-line security logging (`security.log`, 1 MB rotation) for SSH host key events, failed connections, updater rejections, blocked paths, and invalid IPC payloads.
- Enforced `https://` and origin allowlisting in the sidecar auto-updater for packaged builds, and rejected control characters (`\r`, `\n`, `\0`) in HTTP `CONNECT` proxy headers.
- Hardened remote-edit temp file naming against path traversal and Windows reserved device names, capped drag-and-drop staging to 1,000 entries, and added runtime validation across IPC handlers (including a 5 MB limit on `sitesImportJson`).
- Protected log tail regex search against ReDoS (256-char limit, nested/brace quantifier rejection, and per-line length/match caps).
- Disabled Neutralino production file logging, ignored `.tmp/` and `*.tmp` in `.gitignore`, removed unused `@codemirror/*` direct dependencies, and resolved production dependency vulnerabilities via `npm audit fix`.

## [1.3.1](https://github.com/ThienNg65/ferry/compare/ferry-v1.3.0...ferry-v1.3.1) (2026-11-21)


### Bug Fixes

* address tab-close review findings and guard SSH teardown ([77d8f34](https://github.com/ThienNg65/ferry/commit/77d8f34f7a038ea80834c6ab3bffc546acf3129a))
* preserve graceful SSH shutdown with forced fallback on error ([d81c533](https://github.com/ThienNg65/ferry/commit/d81c5336deb9654e74d925e85059d469a75e37e9))
* preserve terminal Ctrl+W word deletion ([1866c96](https://github.com/ThienNg65/ferry/commit/1866c9617efbc0c59636019ae7103a67bcb5a043))
* restore Site Management after closing tabs with Ctrl+W or middle-click ([95f4039](https://github.com/ThienNg65/ferry/commit/95f4039f29510e61474f8b583416ef3cf999cd4b))
* restore site picker immediately on every tab close ([0cfb014](https://github.com/ThienNg65/ferry/commit/0cfb014a6d016490ef695e23930e11111e069f45))


### Tests

* align tab close verification with strict TypeScript patterns ([434e929](https://github.com/ThienNg65/ferry/commit/434e929a499e132114ad0849138c838259e97a5c))
* await file pane imports before teardown ([6a8ac99](https://github.com/ThienNg65/ferry/commit/6a8ac993809a0f4b283e2dd2a920a5c97fff0e76))
* format tab close regression coverage ([f372930](https://github.com/ThienNg65/ferry/commit/f37293033ffd89a3f3bdf46b9098c85d2c21d2f2))
* wait for file pane imports before teardown ([34a9e30](https://github.com/ThienNg65/ferry/commit/34a9e30a60e86259bbfa55c5aaacf081834689f2))

## [1.3.0](https://github.com/ThienNg65/ferry/compare/ferry-v1.2.3...ferry-v1.3.0) (2026-11-21)


### Features

* **distribution:** prepare WinGet community package for Ferry ([#134](https://github.com/ThienNg65/ferry/issues/134)) ([#135](https://github.com/ThienNg65/ferry/issues/135)) ([1759fa5](https://github.com/ThienNg65/ferry/commit/1759fa532c82859d25d2cbd5cdb8ec1fb595ce68))


### Bug Fixes

* **a11y:** restore file grid ownership and virtual row positions ([#141](https://github.com/ThienNg65/ferry/issues/141)) ([c22f429](https://github.com/ThienNg65/ferry/commit/c22f429f8254913f8caa81bc3080e15930339165))
* **ci:** verify exact release commit before publishing ([#139](https://github.com/ThienNg65/ferry/issues/139)) ([d9478c7](https://github.com/ThienNg65/ferry/commit/d9478c7b08e246f775f1f48d5e9d13ec3db23ead)), closes [#136](https://github.com/ThienNg65/ferry/issues/136)
* isolate Quick Connect bookmarks by SSH port ([#124](https://github.com/ThienNg65/ferry/issues/124)) ([7949c49](https://github.com/ThienNg65/ferry/commit/7949c4905ea93ef0f3f396520a5e1fd3e4150ba9)), closes [#108](https://github.com/ThienNg65/ferry/issues/108)
* preserve OpenSSH wildcard defaults during session import ([#121](https://github.com/ThienNg65/ferry/issues/121)) ([8f29ea8](https://github.com/ThienNg65/ferry/commit/8f29ea82f5e52978f22068bddda7cb441dc9ebda)), closes [#120](https://github.com/ThienNg65/ferry/issues/120)
* preserve remote ZIP archives on compression failure ([#123](https://github.com/ThienNg65/ferry/issues/123)) ([a657100](https://github.com/ThienNg65/ferry/commit/a65710091ff83f0688b9c1d938d4595d9b666965)), closes [#113](https://github.com/ThienNg65/ferry/issues/113)
* **security:** harden sidecar RPC and patch vulnerable dependencies ([292be60](https://github.com/ThienNg65/ferry/commit/292be6078a071a44293b0f0b4a5f9af51d0116ec))
* **security:** harden sidecar RPC and patch vulnerable dependencies ([949df97](https://github.com/ThienNg65/ferry/commit/949df97740d1b7bb48fc7b3146aca5f889a2e8dd))
* validate portable ZIP before replacing release artifact ([#138](https://github.com/ThienNg65/ferry/issues/138)) ([8965c2b](https://github.com/ThienNg65/ferry/commit/8965c2be2c4228769d34c3529e3897e88181d1d4)), closes [#137](https://github.com/ThienNg65/ferry/issues/137)


### Documentation

* add Ferry security policy ([#143](https://github.com/ThienNg65/ferry/issues/143)) ([7368f88](https://github.com/ThienNg65/ferry/commit/7368f88df6981689c0b3c71dc0bfc6606646a193))


### Build System

* **deps-dev:** update Vite and Vitest together ([#5](https://github.com/ThienNg65/ferry/issues/5)) ([47dd034](https://github.com/ThienNg65/ferry/commit/47dd0349fe3952ed0359acfc6a1e6c7da515b4a5))

## [1.2.3](https://github.com/ThienNg65/ferry/compare/ferry-v1.2.2...ferry-v1.2.3) (2026-11-20)


### Bug Fixes

* close SFTP editor uploads after finish ([baa34b8](https://github.com/ThienNg65/ferry/commit/baa34b876258d55539f6c26fc994fa478f2b3123))
* compare numeric updater versions without rounding ([f8a3041](https://github.com/ThienNg65/ferry/commit/f8a3041d511008f728f4924edbbbae6258ffeb20), [c5fa882](https://github.com/ThienNg65/ferry/commit/c5fa882d5951a22cedf59855f51a7ff1599543a7))
* fall back to SFTP on remote listing metadata errors ([5016a6a](https://github.com/ThienNg65/ferry/commit/5016a6a3d7f5d724cb38d8a7212a4bf4f0595aa5))
* fall back to SFTP when remote entry metadata fails ([457af6d](https://github.com/ThienNg65/ferry/commit/457af6d48a000c1a2df15e58f14e1984001bf10e))
* isolate local ZIP staging from its input tree ([48c067a](https://github.com/ThienNg65/ferry/commit/48c067aeb63e064ccb74385929b946855ba9fa83))
* keep quiet live log tails connected ([21a1d6e](https://github.com/ThienNg65/ferry/commit/21a1d6e9f717cd1a8fb77e30677e3569b362d091), [6259499](https://github.com/ThienNg65/ferry/commit/6259499afc1f76020be048357e1e2680d3d4c232))
* preserve an existing MSIX when packing fails ([95b14b9](https://github.com/ThienNg65/ferry/commit/95b14b99396dd74b793db65969816fc014af7578))
* preserve editor changes during asynchronous saves ([f0f028b](https://github.com/ThienNg65/ferry/commit/f0f028b7b009f12a77a9fcfcde16a6fc8a09afed))
* preserve edits during delayed discard and editor handoff ([a392d43](https://github.com/ThienNg65/ferry/commit/a392d430c5339241e5bc33fdc1284eb6bda4d524))
* preserve existing local ZIP on compression failure ([f35e6c6](https://github.com/ThienNg65/ferry/commit/f35e6c6be5a682a1039a9c23cce3f91eb4f8e5cd))
* preserve MSIX package context during sidecar startup ([fdb2e15](https://github.com/ThienNg65/ferry/commit/fdb2e15edea7fcfed3774f180c14b04177f67d1d), [9f0fd7b](https://github.com/ThienNg65/ferry/commit/9f0fd7ba2acf2201d88671a2f698fb1b29fb78c7))
* preserve the original when remote editor staging is denied ([c1cd473](https://github.com/ThienNg65/ferry/commit/c1cd47373d4604d7a90e64985dca1ca3c894202c), [2fa2c26](https://github.com/ThienNg65/ferry/commit/2fa2c263140f6efb545912de46aa9b6a3df601d0))
* preserve unsynced editor copies across timestamp changes ([45d393d](https://github.com/ThienNg65/ferry/commit/45d393d600b4cb58c4c2fa23f346de67674618f7))
* reject premature local ZIP stream closure ([5b6b046](https://github.com/ThienNg65/ferry/commit/5b6b0461384c558b6ad5e893730e0b3c2c2d2c51), [65f88d4](https://github.com/ThienNg65/ferry/commit/65f88d411be895701839d8237522735225e40035))
* reject premature SFTP editor upload closure ([a730ef2](https://github.com/ThienNg65/ferry/commit/a730ef287a6454e90494a08f8c51898b70b0df11))
* resume paused SFTP transfers after reconnecting ([95bcad0](https://github.com/ThienNg65/ferry/commit/95bcad070bba80fdc1e516717ecdf6cc24b9f8d2), [fcb3088](https://github.com/ThienNg65/ferry/commit/fcb3088aa563cf44c78f3c5dff609671a2ee2eb8))
* stage local ZIP before replacing destination ([1a6aedb](https://github.com/ThienNg65/ferry/commit/1a6aedbaca1eebb70f4dbf94cc062a069222c54e))
* verify renderer IPC in the MSIX startup smoke test ([40568eb](https://github.com/ThienNg65/ferry/commit/40568eb21ef182820fba890ce3e67e25cf792150))


### Documentation

* align Ferry architecture guidance with Neutralino ([b3cc2da](https://github.com/ThienNg65/ferry/commit/b3cc2daef6c14eee0c209d5eb42903af6781921f), [fba1ed7](https://github.com/ThienNg65/ferry/commit/fba1ed7177bd9c1099840cbc27b5a8a0a10d14be))


### Code Refactoring

* simplify staging cleanup ([818ff4d](https://github.com/ThienNg65/ferry/commit/818ff4d2c43a18f4688ce5a1c24a29a73118a085))


### Tests

* cover existing ZIP preservation and atomic replacement ([8c492c0](https://github.com/ThienNg65/ferry/commit/8c492c0721596a9788b0cbdad725122c0828efec))
* exercise remote directory metadata failure in Python ([be029c7](https://github.com/ThienNg65/ferry/commit/be029c7dd15d449531c9e230c4a72e14dc492144))
* fault-inject local ZIP early close, disk errors and abort ([7f763f1](https://github.com/ThienNg65/ferry/commit/7f763f133c2e74afa440bc1631b024b9c70e2017))
* guard against partial fast remote listings ([442df8f](https://github.com/ThienNg65/ferry/commit/442df8f1b3696f5a8b02785cc669b96d5828faa0))
* pause reconnect fixtures before completion ([7f431e6](https://github.com/ThienNg65/ferry/commit/7f431e6fba5de8c4e5fa075817c2cfa4f8a4eb4b))
* preserve real ZIP writer between fault-injection cases ([ddb4c9b](https://github.com/ThienNg65/ferry/commit/ddb4c9bc083f0153ad0ce39a3cc34e348023d31d))
* stop terminal fixture timers between tests ([55d7037](https://github.com/ThienNg65/ferry/commit/55d7037069b9f495ac1af2763a3f79f6530c3f9b), [554b9da](https://github.com/ThienNg65/ferry/commit/554b9dae38f67279450ab17804cb0a5e39bffbde))
* supply connected session state to transfer fixture ([cb2e063](https://github.com/ThienNg65/ferry/commit/cb2e0635c6375ed47611f5a493f48386056c7767))

## [1.2.2](https://github.com/ThienNg65/ferry/compare/ferry-v1.2.1...ferry-v1.2.2) (2026-11-20)


### Continuous Integration

* validate Ferry MSIX packages before Store upload ([#115](https://github.com/ThienNg65/ferry/issues/115)) ([e3adfd5](https://github.com/ThienNg65/ferry/commit/e3adfd50557d39218d4d150a8da78a5c5b5a5dcd))

## [1.2.1](https://github.com/ThienNg65/ferry/compare/ferry-v1.2.0...ferry-v1.2.1) (2026-11-19)


### Bug Fixes

* **ui:** fix footer wrapping, connect preload race, middle-click, and glass menu blur ([239e5ce](https://github.com/ThienNg65/ferry/commit/239e5ce7389763598b2e90ec51b7cb7e07737714))
* **ui:** fix footer wrapping, connect preload race, middle-click, and glass menu blur ([641fea0](https://github.com/ThienNg65/ferry/commit/641fea01c1438f461918ccf578bdd33c61dee1f1))

## [1.2.0](https://github.com/ThienNg65/ferry/compare/ferry-v1.1.0...ferry-v1.2.0) (2026-11-19)


### Features

* **branding:** refresh the Ferry app icon ([1188929](https://github.com/ThienNg65/ferry/commit/1188929bfe155bbc04d5ea378208383f496b6c4b))
* **branding:** refresh the Ferry app icon ([8c6eee8](https://github.com/ThienNg65/ferry/commit/8c6eee847204de249b8196aaed06808f8143b2f4))
* **branding:** render the Ferry icon in frosted glass ([f0026c7](https://github.com/ThienNg65/ferry/commit/f0026c72ee1f4b612d207ac54b7ebdeafc02a672))


### Code Refactoring

* **branding:** slim the Ferry mast crossbar ([bb43dfb](https://github.com/ThienNg65/ferry/commit/bb43dfbf9baf583b505a75fb9fceffc649616c2e))

## [1.1.0](https://github.com/ThienNg65/ferry/compare/ferry-v1.0.1...ferry-v1.1.0) (2026-11-19)


### Features

* add Arc UI motion system, responsive container polish, and glass skeleton shimmer ([cf3a778](https://github.com/ThienNg65/ferry/commit/cf3a7788a098f6aa6229c1eeb07fb674c51cfb18))
* add Arc UI motion system, responsive container polish, and glass skeleton shimmer ([97d1952](https://github.com/ThienNg65/ferry/commit/97d19527066d666e18e06b04d646c06888bc4a9b))


### Bug Fixes

* address security, reliability, and UI edge cases from repo audit ([94393e6](https://github.com/ThienNg65/ferry/commit/94393e6a91f297758fc3174059a0199845928a95))
* address security, reliability, and UI edge cases from repo audit ([9ba4cfb](https://github.com/ThienNg65/ferry/commit/9ba4cfb5ed6d2ab24269ed6b9d05289690038247))
* protect file workflow targets and recover waiting states ([69e2936](https://github.com/ThienNg65/ferry/commit/69e29369bf0332eb635fdcd7f6ab895a539fbaae))
* protect file workflow targets and recover waiting states ([4328b00](https://github.com/ThienNg65/ferry/commit/4328b0062cc2bba617816736a6dc1abc62548372))
* revalidate resume stamps and preserve strict file permissions ([47c9d9d](https://github.com/ThienNg65/ferry/commit/47c9d9d26592e7a9b0d4c729fca3d379e1e2c3b4))
* review symlink deletions in mirror sync ([05f49cb](https://github.com/ThienNg65/ferry/commit/05f49cb2243c473ded69ab245f78fe03cd2b4678))
* show confirmed paths after interrupted sync ([eac6bbf](https://github.com/ThienNg65/ferry/commit/eac6bbf99cfcffe2014a47b072276e87f792ea4e))
* **ui:** preserve horizontal trackpad scrolling in tab strips ([c29105b](https://github.com/ThienNg65/ferry/commit/c29105bb25b65537d9cc6fb94bdf850e2ff17cb4))

## [1.0.1](https://github.com/ThienNg65/ferry/compare/ferry-v1.0.0...ferry-v1.0.1) (2026-11-19)


### Bug Fixes

* isolate Quick Connect visibility filters by SSH port ([2baa888](https://github.com/ThienNg65/ferry/commit/2baa888bac8679a6d8910f58a5c448e657e12c4c))
* preserve fractional bandwidth scheduling credit ([4de4061](https://github.com/ThienNg65/ferry/commit/4de406193aed66fe0180424d4c0b0f59449db925))
* reclaim cancelled bandwidth reservations ([f4d040b](https://github.com/ThienNg65/ferry/commit/f4d040b8e78f9df6abe222ea9f9e148df5b81c7d))
* reclaim cancelled bandwidth reservations with FIFO scheduling ([4e9aaf9](https://github.com/ThienNg65/ferry/commit/4e9aaf9ccb2a215d5586ed093daa1cc6c8a1473a))
* reject premature updater stream closure and test write failures ([eeee0d0](https://github.com/ThienNg65/ferry/commit/eeee0d05a03ad24dac478225fb3f36891f276658))
* reject prematurely closed updater streams and enable write fault injection ([b0362c1](https://github.com/ThienNg65/ferry/commit/b0362c1d605c3279a86b5637b0ec70b3a9cce84d))
* **ui:** persist Glass UI prefs across restarts and refine Glass tab bar ([9ce6894](https://github.com/ThienNg65/ferry/commit/9ce68946c0784914b372ab9a8b9d9c06a0a1003b))
* **ui:** persist Glass UI prefs across restarts and refine Glass tab bar ([3709083](https://github.com/ThienNg65/ferry/commit/370908324c9c22402750b3996112e8a605db124f))
* **ui:** protect newer UI edits from in-flight settings hydration ([d7cb670](https://github.com/ThienNg65/ferry/commit/d7cb670a69036792732ea15fe1051ffa8f873b78))


### Tests

* cover bandwidth cancellation and cap changes ([9f20562](https://github.com/ThienNg65/ferry/commit/9f20562a133c933913279e26072227fd94f1c44d))
* cover updater ENOSPC EACCES backpressure and premature close ([ce0f021](https://github.com/ThienNg65/ferry/commit/ce0f021dd71d7575873be0043cc9d659a91b1a70))
* guard sustained bandwidth throughput and bounded catch-up ([2af4dc6](https://github.com/ThienNg65/ferry/commit/2af4dc6f44fadac6b30980f3e2a49d57842b8a22))

## [1.0.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.32.0...ferry-v1.0.0) (2026-11-18)


### Features

* add Microsoft Store MSIX packaging and CI workflow ([ea206db](https://github.com/ThienNg65/ferry/commit/ea206dbbfd4fbc186494e9f7e31bf64e8c958166))
* add Microsoft Store MSIX packaging and CI workflow ([28d09ec](https://github.com/ThienNg65/ferry/commit/28d09eceb299d93b221505836050fb7838f9fdab))


### Bug Fixes

* enforce non-zero MSIX major version for Store ([e4e5cb1](https://github.com/ThienNg65/ferry/commit/e4e5cb183fd4d38ca029dc63cfcd7e29f9c8bf2a))


### Miscellaneous Chores

* **ci:** remove obsolete Electron-to-Neutralino migration workflow ([e2b488c](https://github.com/ThienNg65/ferry/commit/e2b488cc2b3eeb64d799359d0f6f1bbbee17aef4))

## [0.32.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.31.0...ferry-v0.32.0) (2026-11-18)


### Features

* **ui:** redesign Ferry icon with minimalist Glassmorphism and dynamic favicon sync ([0439f7f](https://github.com/ThienNg65/ferry/commit/0439f7f4e0320fd6bc5009e7c2785da1545c8a11))
* **ui:** redesign Ferry icon with minimalist Glassmorphism and dynamic favicon sync ([e7e4ea6](https://github.com/ThienNg65/ferry/commit/e7e4ea6839ebe38c6159f739faa283e494bd482d))


### Bug Fixes

* harden SFTP close timeout, drop abort sync, and duplicate drop paths ([6481401](https://github.com/ThienNg65/ferry/commit/64814019e966b52a94a7e762a9908e45eacca075))
* stream external drops, pipeline SFTP transfers, and honor local start path ([1ea1de7](https://github.com/ThienNg65/ferry/commit/1ea1de73f5fa6dc7e7b99a101eb988756bbb6bfc))

## [0.31.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.30.1...ferry-v0.31.0) (2026-11-18)


### Features

* Fix/log window readiness & new ui ([1d23d74](https://github.com/ThienNg65/ferry/commit/1d23d745815d9631e3abe7635d53aa28d1c9bf60))
* **ui:** implement Modern Glass UI redesign and enhance dock/pane bars ([22ddbe1](https://github.com/ThienNg65/ferry/commit/22ddbe1e1c831af605cdfba566813ab479de69c5))


### Bug Fixes

* **tail:** harden log window readiness, lifecycle, and dock UI ([8f26eb3](https://github.com/ThienNg65/ferry/commit/8f26eb36cf17ef26c59f848ad318c91e254d16d5))


### Documentation

* add session handoff for Phase 2 glassmorphism UI implementation planning ([340f940](https://github.com/ThienNg65/ferry/commit/340f94045ae8432d2d7ff4b5b63741b30e1bc619))
* **design:** add component patterns, feature switch, and discovery toast spec ([6764f25](https://github.com/ThienNg65/ferry/commit/6764f2532735c09f4c69eb49a6bc2fca8359f8e3))
* **design:** add glassmorphism CSS tokens and Light/Dark recipes ([7277491](https://github.com/ThienNg65/ferry/commit/727749130e86417a02b57dca37a8b78776d4704f))
* **design:** add modern typography system spec with Plus Jakarta Sans and JetBrains Mono ([bf42bb4](https://github.com/ThienNg65/ferry/commit/bf42bb4c15efe7085a0b00d62e182d88cf482c9f))
* **design:** add root DESIGN.md agent entrypoint and design system index ([2f31340](https://github.com/ThienNg65/ferry/commit/2f31340900e82c4151d4110fe4f2bd08cae5f7a8))
* **design:** add visual direction and Gałęziowski glassmorphism study ([ba3d6ac](https://github.com/ThienNg65/ferry/commit/ba3d6ac280cc5b2aa823d6bdcba724a5c327acbb))
* **design:** resolve final review findings across styling, typography, and component patterns ([b041144](https://github.com/ThienNg65/ferry/commit/b0411449a1aed9b7b2d4f839db3d5ec797e41ed3))

## [0.30.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.30.0...ferry-v0.30.1) (2026-11-18)


### Bug Fixes

* **release:** harden NSIS process cleanup, packaging, and update manifest verification ([bab3beb](https://github.com/ThienNg65/ferry/commit/bab3beb2077398eadda36aa6b7b291bf1b534f3a))
* **update-ui:** guard update restarts, surface errors, and harden store state ([190bbc6](https://github.com/ThienNg65/ferry/commit/190bbc6e995176bfff684b08cf89429fca8d3794))
* **update:** harden auto-update lifecycle, UI, and release verification ([d8cc216](https://github.com/ThienNg65/ferry/commit/d8cc2168785d128a16447d2c9c3081c22e71073f))
* **update:** harden sidecar updater lifecycle, security, and shutdown handoff ([7787057](https://github.com/ThienNg65/ferry/commit/778705748f6510ca2ac6c44f662042ab3e9f8040))

## [0.30.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.29.1...ferry-v0.30.0) (2026-11-18)


### Features

* add file visibility filter popover, counts, and pattern helper UI ([6d32708](https://github.com/ThienNg65/ferry/commit/6d32708e5f644ae999df0da4440599b215d758a4))
* add glob visibility filter engine and filename pattern helper ([12b763a](https://github.com/ThienNg65/ferry/commit/12b763a0a8fd7e655f9af97bea24cb920101db13))
* add per-connection file visibility filter store and persistence ([ddd80d4](https://github.com/ThienNg65/ferry/commit/ddd80d443941f7bec56539074e4dbec010d565f2))
* Feat/file visibility filters ([bda768a](https://github.com/ThienNg65/ferry/commit/bda768a7e6052a462a5762a84aa4915caa05cda4))
* Feat/terminal predictive echo ([8c1214b](https://github.com/ThienNg65/ferry/commit/8c1214bdb4c9b0ef02ad4401c344224831b80046))
* **sites:** click selects a saved site, double-click or Enter connects ([9a42299](https://github.com/ThienNg65/ferry/commit/9a42299c0c556e9fb38bffb2244579f3f952e031))
* **sites:** harden connection lifecycle, dialogs, and WCAG 2.2 AA UX ([c77ee62](https://github.com/ThienNg65/ferry/commit/c77ee62cc7082bcb63cf14ac1d754d9870434831))
* **sites:** redesign site details panel and fix connecting indicators ([7e4182a](https://github.com/ThienNg65/ferry/commit/7e4182a51e3c3ccd583c15dca7e1b9fc5fc0155d))
* **terminal:** add buffer reconciliation and password safety gates to TerminalEchoPredictor ([864bff5](https://github.com/ThienNg65/ferry/commit/864bff5c62498d1910c17f7787e9c575c2f72b5c))
* **terminal:** add core TerminalEchoPredictor state machine ([1f3b41f](https://github.com/ThienNg65/ferry/commit/1f3b41f2a7b419a4a023103f39706a5e1275d3da))
* **terminal:** add predictive local echo setting and toggle ([b15936c](https://github.com/ThienNg65/ferry/commit/b15936c31a69d7cb020b14dce57b01f80f15ae14))
* **terminal:** integrate Mosh-style predictive local echo into terminal stream ([7addf2c](https://github.com/ThienNg65/ferry/commit/7addf2c5c19437794cd610c75279ec6ea5995501))


### Bug Fixes

* **files:** replace RegExp glob matcher with bounded-cost iterative matcher ([3fa84f4](https://github.com/ThienNg65/ferry/commit/3fa84f41d48887ad9d3c80994ac4bf0ac55a8c20))
* scope bulk delete and range selection to visible filtered entries ([e7abbee](https://github.com/ThienNg65/ferry/commit/e7abbee775936add7795f69fade05d6fbf588c92))
* scope Command Palette and pane keyboard actions to visible selected entries ([ed4ee2e](https://github.com/ThienNg65/ferry/commit/ed4ee2ed39e2fbed540838391ee4b9606f1d9c97))
* **terminal:** await prediction flush before fit and re-arm early underline timer ([c1ebd24](https://github.com/ThienNg65/ferry/commit/c1ebd249d9ee4929791549be49f2d017fe12645e))
* **terminal:** clear awaitingNewlineConfirm after deferred-wrap command newline ([c2515e7](https://github.com/ThienNg65/ferry/commit/c2515e75ed4b7b4d155a8eabd26f0d208ea71dd1))
* **terminal:** defer predictions mid-escape, restore erased line suffixes, and preserve SGR attributes ([33e454c](https://github.com/ThienNg65/ferry/commit/33e454c855c766dd908107fd5642de0a925e3520))
* **terminal:** guard predictive echo callbacks across disable and shell restart ([0136b81](https://github.com/ThienNg65/ferry/commit/0136b811eb4e34338f7f1415982c7c1b8a4996e6))
* **terminal:** handle combined backspace chunks, chunked enter, and wrap edge cases in TerminalEchoPredictor ([4138478](https://github.com/ThienNg65/ferry/commit/413847893ca2e58b0b3e18890bcd2499c9a82ca3))
* **terminal:** handle saturated scrollback and retyped erased prefixes in predictive echo ([df163a2](https://github.com/ThienNg65/ferry/commit/df163a29cee34c653d27947243a0a71350d65bf1))
* **terminal:** preserve multibyte UTF-8 stream decoding across predictive echo byte chunks ([ac39f98](https://github.com/ThienNg65/ferry/commit/ac39f9879f1b81eca7dc20034deb330d7b56a7b3))


### Documentation

* document file visibility filters and common glob patterns ([8ec358b](https://github.com/ThienNg65/ferry/commit/8ec358b12a62557a1df02f8871c6ef166d5418c8))
* note sites list select-vs-connect convention in PROJECT_MAP ([9db0419](https://github.com/ThienNg65/ferry/commit/9db041914063e73d529c728f97cded80325e0392))
* **terminal:** add predictive local echo design spec and implementation plan ([7a11795](https://github.com/ThienNg65/ferry/commit/7a1179598e12ab0b3f235962b3b9ea05b7e429a2))

## [0.29.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.29.0...ferry-v0.29.1) (2026-11-17)


### Performance Improvements

* **terminal:** reduce keystroke echo latency 3.47x and double bulk throughput ([6e2df94](https://github.com/ThienNg65/ferry/commit/6e2df94bc2182e6db9f85e2d5edb9a4016bde5a3))

## [0.29.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.28.1...ferry-v0.29.0) (2026-11-17)


### Features

* refine UI with minimalist HIG design tokens, dock, explorer, and monitor polish ([d60e1cd](https://github.com/ThienNg65/ferry/commit/d60e1cd43e5500dd16e4a9a3199f0df99b3b59db))
* refine UI with minimalist HIG design tokens, dock, explorer, and monitor polish ([2cf203d](https://github.com/ThienNg65/ferry/commit/2cf203d92ae16cfa0cea4916124ec408f9574a23))

## [0.28.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.28.0...ferry-v0.28.1) (2026-11-16)


### Bug Fixes

* polish right-dock tabs, symlink truncation, breadcrumb a11y, and reconnect banner ([f8d23d5](https://github.com/ThienNg65/ferry/commit/f8d23d531aaaf30559d263066116f30f04dcb801))
* polish right-dock tabs, symlink truncation, breadcrumb a11y, and reconnect banner ([1160276](https://github.com/ThienNg65/ferry/commit/11602768cdf2d10ccdf637a1fb91c6781dfba725))

## [0.28.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.27.1...ferry-v0.28.0) (2026-11-16)


### Features

* add Ctrl+backtick terminal toggle, dock tooltips, and right-split dock layout ([f71df9a](https://github.com/ThienNg65/ferry/commit/f71df9a6210f161687cd1b7806925c75198e366a))
* add session tab context menu with disconnect, reconnect, duplicate, and close others ([625a953](https://github.com/ThienNg65/ferry/commit/625a953673deb9fc1aab09686c9bb0e4864523a6))
* display inline symlink targets and broken badge in file rows ([35851fe](https://github.com/ThienNg65/ferry/commit/35851fed9a01b3de82f73ccdf36d7ca1f7b8833a))
* Feat/p3 power user enhancements ([5b56646](https://github.com/ThienNg65/ferry/commit/5b5664643e1f000b4eae8719dcde60b5830c7123))


### Bug Fixes

* catch tab context menu reconnect rejections and polish review findings ([bde5e58](https://github.com/ThienNg65/ferry/commit/bde5e5852b9a204e5909c8e664d83d97e9461e57))
* focus F2 rename input reliably and add Quick Connect reconnect banner ([ed6a862](https://github.com/ThienNg65/ferry/commit/ed6a86287036382595472b8800beaf1982ee78b0))

## [0.27.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.27.0...ferry-v0.27.1) (2026-11-16)


### Bug Fixes

* default to full location paths with shorten toggle and clean accent picker layout ([992de71](https://github.com/ThienNg65/ferry/commit/992de7100761d3a07291fdacf6bff7fb661ba1cb))
* default to full location paths with shorten toggle and clean accent picker layout ([47a0f24](https://github.com/ThienNg65/ferry/commit/47a0f24f0e0fd7728fc85ce446fc00c59eee4e2f))

## [0.27.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.26.1...ferry-v0.27.0) (2026-11-16)


### Features

* save active Quick Connect session as site and add recent connections dropdown ([8bd76ec](https://github.com/ThienNg65/ferry/commit/8bd76ec96022dbc18cdddb45adb0ca8dab5c47f6))


### Bug Fixes

* add inline port validation and aria-invalid across port fields ([3aff2cb](https://github.com/ThienNg65/ferry/commit/3aff2cb4fad8ff27daced77b3169887624c126fb))
* collapse middle breadcrumb segments and wrap long fingerprint errors ([f107d95](https://github.com/ThienNg65/ferry/commit/f107d95d27f3a0809c75a431e8088f1d44697780))
* disable preview actions on error, loading, and broken symlinks ([b050344](https://github.com/ThienNg65/ferry/commit/b0503448698a0529ef68de9885d3331fd1f59b93))
* Fix/p2 ux polish and a11y ([5858758](https://github.com/ThienNg65/ferry/commit/5858758b5940490062a826954ba285ec25e0a23a))
* improve color picker accessibility, modal close labels, and checkbox shape ([2d92cff](https://github.com/ThienNg65/ferry/commit/2d92cffa00afb1009e3dfd14a173d77776d1c5af))
* offset toaster above bottom dock and suppress benign ResizeObserver loop errors ([8802f67](https://github.com/ThienNg65/ferry/commit/8802f671cf819e5a7a36fbb60b41996f542c81ad))
* polish hex error state, dropdown close focus, and breadcrumb edge cases ([36bd71b](https://github.com/ThienNg65/ferry/commit/36bd71bc1f8aa852d6b213d3d65f1f63ef4730c9))

## [0.26.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.26.0...ferry-v0.26.1) (2026-11-15)


### Bug Fixes

* accept scope on bookmarks:create and enable remote bookmarks for quick connect ([97dd9b2](https://github.com/ThienNg65/ferry/commit/97dd9b24c53a3c10276b278e4872997e462cc6a8))
* auto-refresh destination pane after transfers without losing selection or scroll ([984064f](https://github.com/ThienNg65/ferry/commit/984064f2f06c931852c0bde78293bcdc50d984f4))
* p1 critical blockers ([f66b98e](https://github.com/ThienNg65/ferry/commit/f66b98e0b9e0dd154ac76135079bbc433952a58f))
* raise muted and dimmed text contrast to WCAG AA in light and dark themes ([33a1c72](https://github.com/ThienNg65/ferry/commit/33a1c72e4938ee411da1cc816556f84673870b30))
* render privacy policy and terms markdown as semantic HTML with safe external links ([f2ced37](https://github.com/ThienNg65/ferry/commit/f2ced37aaf05af7bd147d2bb772edd4293266100))
* surface error toast and alert banner on failed mkdir and touch ([aa8097a](https://github.com/ThienNg65/ferry/commit/aa8097a9bfd32db8dcd3a87d98ca10a1c1e3768b))

## [0.26.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.25.0...ferry-v0.26.0) (2026-11-14)


### Features

* Activity dock tab — live progress for every long-running operation ([1c0e46b](https://github.com/ThienNg65/ferry/commit/1c0e46b765a14b0a514391b8987bc42d9246cd2b))
* add log tail overview rail and dock tab controls ([11ce645](https://github.com/ThienNg65/ferry/commit/11ce6458ebaa4c743a946fdb9da49b2f55eb747a))
* add terminal font and color scheme selection ([32cd21c](https://github.com/ThienNg65/ferry/commit/32cd21c79f71b1dc2c07459efe4263db1fb8c52b))
* add terminal font and color scheme selection ([c1accee](https://github.com/ThienNg65/ferry/commit/c1accee42cf0ce89be5e7d19f8d70c79a900510a))
* add zebra striping and directory bolding to file browser rows ([b0048e2](https://github.com/ThienNg65/ferry/commit/b0048e2a392ede9aa98a27a9cd691470531562bc))
* add zebra striping to process monitor rows ([d31609b](https://github.com/ThienNg65/ferry/commit/d31609b0502eb57cc811f8fc5f95cb00280e3739))
* built-in editor improvements, pane resizing, and ui polishing ([9a5ecd2](https://github.com/ThienNg65/ferry/commit/9a5ecd25d6057f9160b7cd078a39bfded460f218))
* calm file list with short dates, row density, and joined title/tab bars ([e5e7ea6](https://github.com/ThienNg65/ferry/commit/e5e7ea64e7cb628f2979c6f16f291d8519e4ce85))
* complete Neutralino cutover and automatic Electron migration ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([4c9ab67](https://github.com/ThienNg65/ferry/commit/4c9ab67124c628bd3ac11c3c1bdff916518fa740))
* complete Neutralino cutover and automatic Electron migration ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([755446c](https://github.com/ThienNg65/ferry/commit/755446cbef08f6823f97db3c82ad538f01b4b12f))
* confirm host key fingerprint on first connect ([5713f85](https://github.com/ThienNg65/ferry/commit/5713f853a5819d87e89783ddf6822e4e33b69f7f))
* connection progress dialog & Happy Eyeballs speed enhancement ([881061c](https://github.com/ThienNg65/ferry/commit/881061c6e110e8b39e15bf7456aeb04e7ed6d906))
* download to active workspace and prevent silent overwrites ([b5f1a86](https://github.com/ThienNg65/ferry/commit/b5f1a866b985210abcdd2b46556c79434c66dcb5))
* Enhancements of monitoring and logs tailing ([d63aef7](https://github.com/ThienNg65/ferry/commit/d63aef7551dffda73d9900b91183ae0068fdf0b0))
* files-first layout with collapsed dock and active pane highlight ([1e6405b](https://github.com/ThienNg65/ferry/commit/1e6405b2d38ffb31de1c7576c80a30992ab592de))
* **files:** confirm before deleting folders (and file trash-button/context-menu deletes) ([a01363c](https://github.com/ThienNg65/ferry/commit/a01363c3e2fa6a2df0b49a53098e84de4a6a5d49))
* hide jump host and proxy fields behind progressive disclosure in Add Site dialog ([6f8064c](https://github.com/ThienNg65/ferry/commit/6f8064cb3753b9ee89579fb419180f72bb57ab33))
* include P2/P3 UX refinements in release notes ([5ee2cde](https://github.com/ThienNg65/ferry/commit/5ee2cde807e8ecf6c9046b2bb55ae0992fa070ef))
* introduce consistent responsive motion for dock and files ([30c4572](https://github.com/ThienNg65/ferry/commit/30c457279ee467ee3e467b8fa451dc7b5f04bc52))
* **logs:** enhance tail log viewer with virtual scrolling, color tracking, and in-log search ([073c82f](https://github.com/ThienNg65/ferry/commit/073c82fb9544e425f113cf3a422fe799fcf10280))
* migrate desktop host to Neutralinojs with Node sidecar ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([b76fc6c](https://github.com/ThienNg65/ferry/commit/b76fc6c8ddca3265d0ba435e97400a184e1bcdee))
* migrate desktop host to Neutralinojs with Node sidecar ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([68ea30b](https://github.com/ThienNg65/ferry/commit/68ea30be67bfa7dcd119536f0d88ff4c66927ccd))
* Monitor dock tab — remote CPU/memory/load resource monitor ([da940af](https://github.com/ThienNg65/ferry/commit/da940af4973e96bae3f4c8f845fbfb8465eca042))
* **monitor:** storage usage, top-processes table, resizable dock ([09795f0](https://github.com/ThienNg65/ferry/commit/09795f0b0d89d2ebb41f05f40df753ef5288a998))
* native OS window frame, Win11 caption sync, and unclipped toolbars ([27ead3b](https://github.com/ThienNg65/ferry/commit/27ead3be05f4e8f748b70e81325a0f0157f463e3))
* native OS window frame, Win11 caption sync, and unclipped toolbars ([eb476a0](https://github.com/ThienNg65/ferry/commit/eb476a0e8ca0f9c87ba4dc2e176347b5baccbdef))
* polished motion for dock, folders, and tabs ([1c2ec68](https://github.com/ThienNg65/ferry/commit/1c2ec68046755183036fe27d47095d1a8021a408))
* redesign settings dialog with sidebar tabs ([8664bc2](https://github.com/ThienNg65/ferry/commit/8664bc2be245a7ec1edf3ef7c8746f241f1dc2d6))
* redesign settings dialog with sidebar tabs ([048ff8e](https://github.com/ThienNg65/ferry/commit/048ff8e35502ae936dff7be1b3ae48d3b08801a5))
* richer transfer conflict dialog and F5 copy ([0934643](https://github.com/ThienNg65/ferry/commit/0934643f2ba00afd409fda2bb73891c549a91a73))
* **security:** harden main-process against Electron checklist gaps ([3739bda](https://github.com/ThienNg65/ferry/commit/3739bda0ef0a9111c271eced21b4f23b206e2053))
* **sites:** add bulk select and delete for saved sites ([71dac70](https://github.com/ThienNg65/ferry/commit/71dac7083e8ed15787f13e5012680963a9162c1e))
* **tail:** enhance UI/UX, formatting, contrast, and controls for live log tail ([4b9db7e](https://github.com/ThienNg65/ferry/commit/4b9db7eca9aa172279b8413481dff81029e1df52))
* **ui:** enhance UI/UX across session manager, shell chrome, file browser, and bottom dock ([2df0306](https://github.com/ThienNg65/ferry/commit/2df03069339a8c5ee2468c95ce64a0c00da70feb))
* **update:** enhance auto-update with manual checks, progress tracking, and settings ([1d8c6e6](https://github.com/ThienNg65/ferry/commit/1d8c6e654c90419f16ffafe4da2e1977619fe7b7))
* **ux:** multi-agent UX polish, site export, port validation, and deletion safety ([10dd62c](https://github.com/ThienNg65/ferry/commit/10dd62c517794ebbf64c1029152f9ce1e1022eb2))
* v0.9.0 — compress-to-zip, bandwidth limit, tab persistence, theme, command palette ([885322e](https://github.com/ThienNg65/ferry/commit/885322e5d92a2a1a27a97eecfe986acd36dfb0cb))
* WinSCP-parity gap review — 13 features (v0.13.0) ([b52d2c6](https://github.com/ThienNg65/ferry/commit/b52d2c60f68a376ba0d677d3b3d71478c9ddc069))


### Bug Fixes

* abort in-flight connection when the user cancels or closes the tab ([83e2831](https://github.com/ThienNg65/ferry/commit/83e2831e8b2c1e99c33dcfba4937b926eee729e9))
* accessibility baseline (labels, contrast, reduced motion) ([0257370](https://github.com/ThienNg65/ferry/commit/0257370134d0e80c82e0f0127bcd383b57732641))
* add transactional NSIS rollback, custom-dir discovery, and PE icon check ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([09b229a](https://github.com/ThienNg65/ferry/commit/09b229a60cc1beed63dac1be26418ce2391aede1))
* address code review findings for fast remote browsing ([3308808](https://github.com/ThienNg65/ferry/commit/3308808b820019344205969492654db78472aefb))
* address final review findings on ui-polish branch ([4d1f049](https://github.com/ThienNg65/ferry/commit/4d1f049f64e9ff6829175a7b8c842674b6b725ce))
* address PR [#45](https://github.com/ThienNg65/ferry/issues/45) review findings for updater, release workflow, drop cleanup, and SSH/SFTP smoke parity ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([7a3451e](https://github.com/ThienNg65/ferry/commit/7a3451e8eb0a217c4e7fbca07208c8135000cbd7))
* address review findings (host-key bypass, prompt timeout, safe edit saves, conflict rename) ([3dcf1cf](https://github.com/ThienNg65/ferry/commit/3dcf1cf4112f39283ee7e6afdbdb06e810b8da14))
* align monitor history getter with compact CPU samples ([47870b9](https://github.com/ThienNg65/ferry/commit/47870b993103c01e2549298596540c55aeb37a4a))
* avoid terminal layout squeeze during dock transitions ([18312dd](https://github.com/ThienNg65/ferry/commit/18312dd786a5e03ed306bfe1125a71ed30b4c9a7))
* **build:** point auto-update feed at real GitHub repo ([cf0bd77](https://github.com/ThienNg65/ferry/commit/cf0bd77c5edcfd84c3430f22fd7e4c9f9d41223c))
* close proxy socket and early-cancel leaks, validate terminal send payloads ([4e364b6](https://github.com/ThienNg65/ferry/commit/4e364b6b34f7d48e4c9360fc92cde74b2296a6af))
* confirm single-file delete, cancel rename and path edit on blur ([05ed33e](https://github.com/ThienNg65/ferry/commit/05ed33eca4f9e31898d1fe7850884b4d806cb6d6))
* correct migration process helper template literals ([481159f](https://github.com/ThienNg65/ferry/commit/481159fa5fe2552828e440d100024ec0545fcc96))
* correctly detect missing public release tags ([#26](https://github.com/ThienNg65/ferry/issues/26)) ([a807394](https://github.com/ThienNg65/ferry/commit/a807394f3be93fa17dcdd6e96b01d911e6f59411))
* detect remote changes and save edits atomically ([af83769](https://github.com/ThienNg65/ferry/commit/af8376933c204a6ba36ada3edac4f363807c74b4))
* **dnd:** resolve dropped-file paths via webUtils for Electron 43 ([4f67ec8](https://github.com/ThienNg65/ferry/commit/4f67ec831fefc4bb2fb697366e5eeb745c677fc6))
* ensure Neutralino installers are built and recover failed releases ([1534ce7](https://github.com/ThienNg65/ferry/commit/1534ce7be16f011c411e7056ffb5028b7e9e89c2))
* ensure Neutralino installers are built and recover failed releases ([b718ca5](https://github.com/ThienNg65/ferry/commit/b718ca5aa9890bc0ac6ad6437bd84f042eb6bdf8))
* exclude Node release tests from Vitest ([#23](https://github.com/ThienNg65/ferry/issues/23)) ([0c15083](https://github.com/ThienNg65/ferry/commit/0c15083bbf6b2b6da04f5b8883204981119b0f8b))
* file list readable at any pane width ([8ad1482](https://github.com/ThienNg65/ferry/commit/8ad1482df3bf75ee265a5d8f0c323d1f73e285b4))
* fix Neutralino window maximize, titlebar drag, and bottom dock resize ([67cb5e8](https://github.com/ThienNg65/ferry/commit/67cb5e89526b81276f04a503ce7d9208ee50ba53))
* fix Neutralino window maximize, titlebar drag, and bottom dock resize ([646a99e](https://github.com/ThienNg65/ferry/commit/646a99ee7575c8dcdf83053e68442c1830c9a0ca))
* fix URL pathname matching and cleanup in E2E migration script ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([5f66412](https://github.com/ThienNg65/ferry/commit/5f66412a5f4a75bc1e61719230b10c19a6435ae5))
* harden crash-safe NSIS rollback, HKLM discovery, and real Electron E2E suite ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([e434b11](https://github.com/ThienNg65/ferry/commit/e434b118dff120c55fda7f1a1a207a28e6396eb2))
* harden window bounds, updater timeouts, async dialogs, and store search perf ([0740621](https://github.com/ThienNg65/ferry/commit/07406216f628d73e8f2c849d460890f4c766ed52))
* harden window bounds, updater timeouts, async dialogs, and store/search perf ([f7febf5](https://github.com/ThienNg65/ferry/commit/f7febf572334dc0feb5c842c7d799d59d42efad4))
* keep migration update server responsive during UI automation ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([c280ec8](https://github.com/ThienNg65/ferry/commit/c280ec862af0af205125ea1aeebfb0102befc264))
* keep terminal search compatible with optional log highlight keywords ([a14a674](https://github.com/ThienNg65/ferry/commit/a14a674cb80e2523816099a0091388de861c119d))
* keyboard focus and selection visibility in file panes ([f27498c](https://github.com/ThienNg65/ferry/commit/f27498c1da4ed685195e0364a9f032e1334dac28))
* Live tail log navigation and immediate output (Ticket [#2](https://github.com/ThienNg65/ferry/issues/2)) ([31abdcb](https://github.com/ThienNg65/ferry/commit/31abdcb17d8f4aa9391cc4c49d33541e42d1e62e))
* measure maximized dock height from parent bounds ([2b7f4f7](https://github.com/ThienNg65/ferry/commit/2b7f4f7e36afbea5b27cbded96eb160a1188826d))
* migrate Ferry auto-update feed to public release repository ([#19](https://github.com/ThienNg65/ferry/issues/19)) ([d4bd577](https://github.com/ThienNg65/ferry/commit/d4bd5770a629c02c09c389dd63d0a80d9acd3902))
* Milestone 2 pilot-hardening — bug fixes, test coverage, Open Edits UI ([de2f5ee](https://github.com/ThienNg65/ferry/commit/de2f5ee309809203790dec7e2ecfa97ae2a580db))
* plain-language connection errors and persistent error toasts ([5da4e1e](https://github.com/ThienNg65/ferry/commit/5da4e1e9eeb791ca93f9c5d636ddb4bea0ecb073))
* preserve rollback backups and gate real Electron migration on isolated Windows runner ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([3483ff2](https://github.com/ThienNg65/ferry/commit/3483ff2daaf5e500f2fa54c7a843b066e90dcad8))
* preserve smooth site-tab exit layout ([23f8a3d](https://github.com/ThienNg65/ferry/commit/23f8a3df3c0cc742cd2388d816eec7e9a40d83e9))
* prevent app crash on unhandled ssh client error events ([f59811e](https://github.com/ThienNg65/ferry/commit/f59811e6704cf347d4920c818c1aa5c141c1387e))
* prevent false-negative Electron migration release failures ([ba7faf1](https://github.com/ThienNg65/ferry/commit/ba7faf17aa0eae67d4e272fb0e834b1f0bafddb0))
* prevent remote command injection in compress/extract via crafted filenames ([4353311](https://github.com/ThienNg65/ferry/commit/4353311ed2b1b10fa501636023dd411c559a0226))
* publish latest.yml so auto-update actually works, prep dormant SignPath signing ([e1bfcf2](https://github.com/ThienNg65/ferry/commit/e1bfcf2bd40a82d51d542c5d2e7c98db6c17ed97))
* recognize Windows 8.3 process paths in migration release gate ([74e32ab](https://github.com/ThienNg65/ferry/commit/74e32abe7ee30c90c8490b5a98f58aa781596a38))
* **release:** auto-publish releases with generated changelog notes ([c2a85f2](https://github.com/ThienNg65/ferry/commit/c2a85f27f9747ab3e14158fee4b4407f3c000e2c))
* **release:** push git tag before electron-builder publish ([0f032a2](https://github.com/ThienNg65/ferry/commit/0f032a2e6a8177ef5bc0b4e74f340be0b1c963ad))
* resolve critical and high-priority code review findings ([ca4e7ce](https://github.com/ThienNg65/ferry/commit/ca4e7cefcf2adbc91705f186f05481088098ffa1))
* resolve PR [#45](https://github.com/ThienNg65/ferry/issues/45) blockers for Neutralino sidecar build, security, updater, drop, and CI smoke ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([ab98e29](https://github.com/ThienNg65/ferry/commit/ab98e29f3360ac6338c05565d99fe3e8f7c9f329))
* **security:** allow clipboard-write through the permission handler ([7b71803](https://github.com/ThienNg65/ferry/commit/7b71803ba27949d1ea5cc378544b49468b00242b))
* show window on load failure and init updater before manual use ([d5a0285](https://github.com/ThienNg65/ferry/commit/d5a028548e8ed06ce9e0e65b061901104c9834b1))
* single instance, no blank-window freeze, safer update install ([5ce924f](https://github.com/ThienNg65/ferry/commit/5ce924fc7ff3d9b0a15521d09df6ed2ff5d0bd0c))
* single instance, no blank-window freeze, safer update install ([a6133b1](https://github.com/ThienNg65/ferry/commit/a6133b1308e7e8d7021a4567484d402da8da78bb))
* **sites:** batch import into one refetch and avoid duplicate re-creates ([cdb718e](https://github.com/ThienNg65/ferry/commit/cdb718ea99591a0aa50093592a625eabc432b556))
* **sites:** stop WinSCP import self-recursion producing duplicated names ([7be8ae2](https://github.com/ThienNg65/ferry/commit/7be8ae28c8ad974ff27e701cf190c13b02177bb0))
* synchronize and verify public Ferry releases ([#21](https://github.com/ThienNg65/ferry/issues/21)) ([a6b4cbe](https://github.com/ThienNg65/ferry/commit/a6b4cbee3251c337e01bab9ed1c5661a1eeaee30))
* **tail:** fail fast on permanent errors instead of retrying ([d7c3dee](https://github.com/ThienNg65/ferry/commit/d7c3dee7cbb9b335e66f4fb5b38615647274c957))
* terminal keyboard interaction — focus, copy/paste, right-click ([e2f5692](https://github.com/ThienNg65/ferry/commit/e2f56920a81585b6ea224910dc7b50536df3e394))
* type check ([1f9c1f6](https://github.com/ThienNg65/ferry/commit/1f9c1f6c896b005b3981947557f26842ba7c8dec))
* **update:** resolve electron-updater CJS interop for autoUpdater export ([e801a00](https://github.com/ThienNg65/ferry/commit/e801a005e51f7a4862386800b8520564338265fc))
* use GraphQL branchName when signing public releases ([#25](https://github.com/ThienNg65/ferry/issues/25)) ([b5d1b93](https://github.com/ThienNg65/ferry/commit/b5d1b93236fadf1ddecd0e7ac14d6ea637274520))


### Performance Improvements

* add in-memory SWR directory caching and optimistic navigation ([619be6e](https://github.com/ThienNg65/ferry/commit/619be6e6179188973ebe250b38cca1337ceed4c8))
* add remote exec directory listing parser and command generator ([7f65b94](https://github.com/ThienNg65/ferry/commit/7f65b9469da6b0b22d6f200a40886e7b867dc83e))
* add watermark flow control so shell floods no longer queue in IPC ([6f9b9a5](https://github.com/ThienNg65/ferry/commit/6f9b9a5f3b8d2bcb0d4b0be96df202af8727fbf1))
* implement exec-first directory listing with SFTP fallback ([5cadf5f](https://github.com/ThienNg65/ferry/commit/5cadf5f95d9a3ca3f3382c6c12e31047bc7f8ef7))
* **main:** lazy-load ssh2 and archiver off the startup path ([80e4cee](https://github.com/ThienNg65/ferry/commit/80e4cee57bbaefefc4e33688d80116e15a7d7457))
* optimize app startup time ([f032202](https://github.com/ThienNg65/ferry/commit/f0322023dc3d4c82c87c145ed19c9cad95641d5c))
* render terminal with WebGL and coalesce output into one IPC message per frame ([5d4fa7e](https://github.com/ThienNg65/ferry/commit/5d4fa7e5dbaec1413a41d7e90bf55018742ceb46))
* **renderer:** virtualize FileList with @tanstack/vue-virtual ([80f323d](https://github.com/ThienNg65/ferry/commit/80f323dd206a9000a3467a8864076bb0d2ba3cdd))
* send terminal input and resize fire-and-forget, debounce resize, add ssh keepalive ([1ae43a4](https://github.com/ThienNg65/ferry/commit/1ae43a43a39008177ffdb474ea2b9058de3e6181))
* smooth live monitoring and log tail interactions ([b1de68a](https://github.com/ThienNg65/ferry/commit/b1de68ae0ad39aa2a071c5748c8da5cd9dd46b12))
* wire hover prefetching and force refresh for remote directory navigation ([9267cba](https://github.com/ThienNg65/ferry/commit/9267cba1ed703dfb9916fae606606e441a0d49a6))


### Documentation

* add 0.8.0 changelog entry for the file-op perf pass and injection fix ([1d7e36a](https://github.com/ThienNg65/ferry/commit/1d7e36acc33f26be681f7538df4956f6a132624c))
* add changelog entries for UI polish work ([e8cab5c](https://github.com/ThienNg65/ferry/commit/e8cab5c903d114833d1c9c6503af8f706bcb5d31))
* add changelog entry for 0.11.0 security & performance hardening ([e26f3b9](https://github.com/ThienNg65/ferry/commit/e26f3b95adb2b676ff4515cb7d4fe54e56c2126c))
* add CI/CD release engineering guide and architecture diagram ([06d9525](https://github.com/ThienNg65/ferry/commit/06d9525be21304c04113eead661c45e7064fc832))
* add fast ssh remote browsing implementation plan ([7cc361a](https://github.com/ThienNg65/ferry/commit/7cc361a791511db378ab1c7613dde07101d07f59))
* add LICENSE, README, and package release metadata ([5241e74](https://github.com/ThienNg65/ferry/commit/5241e74f2c4abb2b8a916de0b8a2a9a746e84759))
* add real app screenshots to README ([1a0e579](https://github.com/ThienNg65/ferry/commit/1a0e5799a18b901cf8da33e013ca07cfdf4b14ab))
* add UX audit and record new conventions in PROJECT_MAP ([0c771ea](https://github.com/ThienNg65/ferry/commit/0c771ea0b3036d94b853306a011e9cd2dfb85bf0))
* **changelog:** release v0.14.5 ([6a2177c](https://github.com/ThienNg65/ferry/commit/6a2177c7f341ed1e0c6972d0237d09c1732492b2))
* correct PROJECT_MAP gotchas on the WinSCP import self-recursion bug ([ac1effe](https://github.com/ThienNg65/ferry/commit/ac1effe6dd82996d3f08b6b921f035a97f539282))
* correct PROJECT_MAP's permission-handler description, add clipboard gotcha ([a033d34](https://github.com/ThienNg65/ferry/commit/a033d3468b5477191c2879b3deaa7ef3a449b3cb))
* document abortable connect and batched terminal output in PROJECT_MAP ([f246658](https://github.com/ThienNg65/ferry/commit/f246658013958bf6003b578204632a1050f704a9))
* document motion invariants and align template formatting ([68d8192](https://github.com/ThienNg65/ferry/commit/68d8192559499c251197cd16a86d9a6be0942640))
* explain Release Please bot PR checks and token setup ([9f12d43](https://github.com/ThienNg65/ferry/commit/9f12d4346bd8d1317e6cba6a4b50f348f5652754))
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
* **main:** release ferry 0.15.0 ([02a5274](https://github.com/ThienNg65/ferry/commit/02a52746161cc9fefb939701c472605621fcd9bf))
* **main:** release ferry 0.15.0 ([f0552d4](https://github.com/ThienNg65/ferry/commit/f0552d46f2a2d077c6e857d6b6880a82808dacf5))
* **main:** release ferry 0.15.1 ([3b9770f](https://github.com/ThienNg65/ferry/commit/3b9770fb6d6ca5d7ddf99b5624fee9c281afc2d4))
* **main:** release ferry 0.15.1 ([5fee2f2](https://github.com/ThienNg65/ferry/commit/5fee2f2fad248794c3ed6f75b78c4adb2fb860a7))
* **main:** release ferry 0.16.0 ([abbb708](https://github.com/ThienNg65/ferry/commit/abbb708a5b0cd3df71f9ebe1f7767bd439a824b3))
* **main:** release ferry 0.16.0 ([d98a975](https://github.com/ThienNg65/ferry/commit/d98a975215ef753bf8724f1379e2cf6c74ce8c83))
* **main:** release ferry 0.16.1 ([de8ab2e](https://github.com/ThienNg65/ferry/commit/de8ab2e0d93b1ff8b7c3784d6f1a1ae580a3baec))
* **main:** release ferry 0.16.1 ([7c63a56](https://github.com/ThienNg65/ferry/commit/7c63a561a1a89c0d0d7787bb04e7931cb960f414))
* **main:** release ferry 0.17.0 ([296d204](https://github.com/ThienNg65/ferry/commit/296d20499adf2e6cde360fcd3fe6c45aedb50586))
* **main:** release ferry 0.17.0 ([d76616f](https://github.com/ThienNg65/ferry/commit/d76616fc82af5edfeb2aa621c1323e7562c6c20a))
* **main:** release ferry 0.18.0 ([17b9d21](https://github.com/ThienNg65/ferry/commit/17b9d219ab168165bf75f41136b8a7054bbeec5b))
* **main:** release ferry 0.18.0 ([fbe51f1](https://github.com/ThienNg65/ferry/commit/fbe51f13837bbebed59ebcaf07b1687b3af3e486))
* **main:** release ferry 0.18.1 ([be2e134](https://github.com/ThienNg65/ferry/commit/be2e134c9135fe77119f1dd2eb69a32d98b0444f))
* **main:** release ferry 0.18.1 ([158ab72](https://github.com/ThienNg65/ferry/commit/158ab727d8a13e5fb8ce55e8c37bff4dac753875))
* **main:** release ferry 0.18.2 ([ad8f18b](https://github.com/ThienNg65/ferry/commit/ad8f18b3c207049efc1b935ac94249c5217950c5))
* **main:** release ferry 0.18.2 ([dad9408](https://github.com/ThienNg65/ferry/commit/dad9408ea7602824584d2a28f6c1cbdafde2507a))
* **main:** release ferry 0.18.3 ([72be5fa](https://github.com/ThienNg65/ferry/commit/72be5fa42b20b3635b0a89db53f8040e32687caf))
* **main:** release ferry 0.18.3 ([8119133](https://github.com/ThienNg65/ferry/commit/81191331c5113d904678d37a0cc449d354f86050))
* **main:** release ferry 0.18.4 ([1e6285b](https://github.com/ThienNg65/ferry/commit/1e6285b5b9658dcb71b9e2c00bcce6dcc096a9ab))
* **main:** release ferry 0.18.4 ([ecf7524](https://github.com/ThienNg65/ferry/commit/ecf7524cc2ff00cc553c5eb480d87438cb593765))
* **main:** release ferry 0.19.0 ([621332b](https://github.com/ThienNg65/ferry/commit/621332ba39703c72dce3ad8bf71fca5ea2d3b31d))
* **main:** release ferry 0.19.1 ([18262be](https://github.com/ThienNg65/ferry/commit/18262be8aadd0c13413c6763b268225210026d31))
* **main:** release ferry 0.19.1 ([2711534](https://github.com/ThienNg65/ferry/commit/27115345dd6aac3234b77dd11fa4ae6476bf86df))
* **main:** release ferry 0.19.2 ([25fa894](https://github.com/ThienNg65/ferry/commit/25fa894de0d990a2e713a2dee58891bbd1067c11))
* **main:** release ferry 0.19.2 ([8535cfb](https://github.com/ThienNg65/ferry/commit/8535cfb17f10044e6aae0f50bd2b311d60f369c4))
* **main:** release ferry 0.20.0 ([0587607](https://github.com/ThienNg65/ferry/commit/0587607fc1f47ab92c5d07068e6b268832f3cb5d))
* **main:** release ferry 0.20.0 ([7c279d5](https://github.com/ThienNg65/ferry/commit/7c279d551d49ef23fd70a2dc0225dde835847425))
* **main:** release ferry 0.21.0 ([c1a145f](https://github.com/ThienNg65/ferry/commit/c1a145fa91e9e69eba016af89c824c862203accf))
* **main:** release ferry 0.21.0 ([185868b](https://github.com/ThienNg65/ferry/commit/185868bb4b39a3754c9465ef85834ff222f17d07))
* **main:** release ferry 0.22.0 ([534c7e3](https://github.com/ThienNg65/ferry/commit/534c7e3f7ec31c3b9ef4d950ec0a7a67644e9d23))
* **main:** release ferry 0.22.0 ([bd46f56](https://github.com/ThienNg65/ferry/commit/bd46f56b1ce286e3015ba54eb4c739637c4b3113))
* **main:** release ferry 0.23.0 ([ac176df](https://github.com/ThienNg65/ferry/commit/ac176df36b5dd6590d21dd9fa2ee977a42dd533c))
* **main:** release ferry 0.23.0 ([ab0104a](https://github.com/ThienNg65/ferry/commit/ab0104a1ae5611c43553c9264e59cb879026ddd9))
* **main:** release ferry 0.23.1 ([99fb6d6](https://github.com/ThienNg65/ferry/commit/99fb6d663ea3ba80ecfbf8567067d80b20bc107d))
* **main:** release ferry 0.23.1 ([4dbfbcd](https://github.com/ThienNg65/ferry/commit/4dbfbcd88d5df970da60dd96f4994e8febc798b0))
* **main:** release ferry 0.24.0 ([93062c9](https://github.com/ThienNg65/ferry/commit/93062c91a98049b032da7e750aa3720152cb4a17))
* **main:** release ferry 0.24.0 ([d09304e](https://github.com/ThienNg65/ferry/commit/d09304e80afe91263b31229d716702678193e5f6))
* **main:** release ferry 0.24.1 ([b7a8d37](https://github.com/ThienNg65/ferry/commit/b7a8d372a55a1e4207469b5221f78179d231c756))
* **main:** release ferry 0.24.1 ([1c0afd2](https://github.com/ThienNg65/ferry/commit/1c0afd24af5fe980de258d9c31d038ed88f109db))
* **main:** release ferry 0.24.2 ([7cf763c](https://github.com/ThienNg65/ferry/commit/7cf763c0d51be59a725e6f262d24bc32c7c46bd5))
* **main:** release ferry 0.24.2 ([507f3bd](https://github.com/ThienNg65/ferry/commit/507f3bd03e0795c3571b4c2d3611119985aebd83))
* **main:** release ferry 0.25.0 ([cfd4fa9](https://github.com/ThienNg65/ferry/commit/cfd4fa9b9ea18d17208324c49728e2f4a273050c))
* **main:** release ferry 0.25.0 ([fe6efc5](https://github.com/ThienNg65/ferry/commit/fe6efc51c6358e8e97184b84171aa640a6865d2d))
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


### Tests

* preserve installer rollback snapshot on restore failure ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([19815ed](https://github.com/ThienNg65/ferry/commit/19815edbb977db7c84f27e4f8554ef096c8a4f3b))
* stop migrated processes before uninstall verification ([e3b2eeb](https://github.com/ThienNg65/ferry/commit/e3b2eebdaea7a4dca31a9aa365f626aa4deb1bbf))
* validate Electron migration E2E script in PR CI ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([c5cd2ac](https://github.com/ThienNg65/ferry/commit/c5cd2ac2b84e7d133f0750a15cde7886c001ede3))


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
* run real Electron-to-Neutralino migration E2E for migration PRs ([3ad84e2](https://github.com/ThienNg65/ferry/commit/3ad84e2cd9f4bdc6acbbc6bf316c9b19e90828a4))

## [0.25.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.24.2...ferry-v0.25.0) (2026-11-14)


### Features

* native OS window frame, Win11 caption sync, and unclipped toolbars ([27ead3b](https://github.com/ThienNg65/ferry/commit/27ead3be05f4e8f748b70e81325a0f0157f463e3))
* native OS window frame, Win11 caption sync, and unclipped toolbars ([eb476a0](https://github.com/ThienNg65/ferry/commit/eb476a0e8ca0f9c87ba4dc2e176347b5baccbdef))


### Bug Fixes

* harden window bounds, updater timeouts, async dialogs, and store search perf ([0740621](https://github.com/ThienNg65/ferry/commit/07406216f628d73e8f2c849d460890f4c766ed52))
* harden window bounds, updater timeouts, async dialogs, and store/search perf ([f7febf5](https://github.com/ThienNg65/ferry/commit/f7febf572334dc0feb5c842c7d799d59d42efad4))

## [0.24.2](https://github.com/ThienNg65/ferry/compare/ferry-v0.24.1...ferry-v0.24.2) (2026-11-14)


### Bug Fixes

* fix Neutralino window maximize, titlebar drag, and bottom dock resize ([67cb5e8](https://github.com/ThienNg65/ferry/commit/67cb5e89526b81276f04a503ce7d9208ee50ba53))
* fix Neutralino window maximize, titlebar drag, and bottom dock resize ([646a99e](https://github.com/ThienNg65/ferry/commit/646a99ee7575c8dcdf83053e68442c1830c9a0ca))

## [0.24.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.24.0...ferry-v0.24.1) (2026-11-14)


### Bug Fixes

* correct migration process helper template literals ([481159f](https://github.com/ThienNg65/ferry/commit/481159fa5fe2552828e440d100024ec0545fcc96))
* prevent false-negative Electron migration release failures ([ba7faf1](https://github.com/ThienNg65/ferry/commit/ba7faf17aa0eae67d4e272fb0e834b1f0bafddb0))
* recognize Windows 8.3 process paths in migration release gate ([74e32ab](https://github.com/ThienNg65/ferry/commit/74e32abe7ee30c90c8490b5a98f58aa781596a38))


### Tests

* stop migrated processes before uninstall verification ([e3b2eeb](https://github.com/ThienNg65/ferry/commit/e3b2eebdaea7a4dca31a9aa365f626aa4deb1bbf))


### Continuous Integration

* run real Electron-to-Neutralino migration E2E for migration PRs ([3ad84e2](https://github.com/ThienNg65/ferry/commit/3ad84e2cd9f4bdc6acbbc6bf316c9b19e90828a4))

## [0.24.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.23.1...ferry-v0.24.0) (2026-11-14)


### Features

* complete Neutralino cutover and automatic Electron migration ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([4c9ab67](https://github.com/ThienNg65/ferry/commit/4c9ab67124c628bd3ac11c3c1bdff916518fa740))
* complete Neutralino cutover and automatic Electron migration ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([755446c](https://github.com/ThienNg65/ferry/commit/755446cbef08f6823f97db3c82ad538f01b4b12f))


### Bug Fixes

* add transactional NSIS rollback, custom-dir discovery, and PE icon check ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([09b229a](https://github.com/ThienNg65/ferry/commit/09b229a60cc1beed63dac1be26418ce2391aede1))
* fix URL pathname matching and cleanup in E2E migration script ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([5f66412](https://github.com/ThienNg65/ferry/commit/5f66412a5f4a75bc1e61719230b10c19a6435ae5))
* harden crash-safe NSIS rollback, HKLM discovery, and real Electron E2E suite ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([e434b11](https://github.com/ThienNg65/ferry/commit/e434b118dff120c55fda7f1a1a207a28e6396eb2))
* keep migration update server responsive during UI automation ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([c280ec8](https://github.com/ThienNg65/ferry/commit/c280ec862af0af205125ea1aeebfb0102befc264))
* preserve rollback backups and gate real Electron migration on isolated Windows runner ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([3483ff2](https://github.com/ThienNg65/ferry/commit/3483ff2daaf5e500f2fa54c7a843b066e90dcad8))


### Tests

* preserve installer rollback snapshot on restore failure ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([19815ed](https://github.com/ThienNg65/ferry/commit/19815edbb977db7c84f27e4f8554ef096c8a4f3b))
* validate Electron migration E2E script in PR CI ([#49](https://github.com/ThienNg65/ferry/issues/49)) ([c5cd2ac](https://github.com/ThienNg65/ferry/commit/c5cd2ac2b84e7d133f0750a15cde7886c001ede3))

## [0.23.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.23.0...ferry-v0.23.1) (2026-11-14)


### Bug Fixes

* ensure Neutralino installers are built and recover failed releases ([1534ce7](https://github.com/ThienNg65/ferry/commit/1534ce7be16f011c411e7056ffb5028b7e9e89c2))
* ensure Neutralino installers are built and recover failed releases ([b718ca5](https://github.com/ThienNg65/ferry/commit/b718ca5aa9890bc0ac6ad6437bd84f042eb6bdf8))

## [0.23.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.22.0...ferry-v0.23.0) (2026-11-14)


### Features

* add log tail overview rail and dock tab controls ([11ce645](https://github.com/ThienNg65/ferry/commit/11ce6458ebaa4c743a946fdb9da49b2f55eb747a))
* migrate desktop host to Neutralinojs with Node sidecar ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([b76fc6c](https://github.com/ThienNg65/ferry/commit/b76fc6c8ddca3265d0ba435e97400a184e1bcdee))
* migrate desktop host to Neutralinojs with Node sidecar ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([68ea30b](https://github.com/ThienNg65/ferry/commit/68ea30be67bfa7dcd119536f0d88ff4c66927ccd))


### Bug Fixes

* address PR [#45](https://github.com/ThienNg65/ferry/issues/45) review findings for updater, release workflow, drop cleanup, and SSH/SFTP smoke parity ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([7a3451e](https://github.com/ThienNg65/ferry/commit/7a3451e8eb0a217c4e7fbca07208c8135000cbd7))
* measure maximized dock height from parent bounds ([2b7f4f7](https://github.com/ThienNg65/ferry/commit/2b7f4f7e36afbea5b27cbded96eb160a1188826d))
* resolve PR [#45](https://github.com/ThienNg65/ferry/issues/45) blockers for Neutralino sidecar build, security, updater, drop, and CI smoke ([#37](https://github.com/ThienNg65/ferry/issues/37)) ([ab98e29](https://github.com/ThienNg65/ferry/commit/ab98e29f3360ac6338c05565d99fe3e8f7c9f329))

## [0.22.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.21.0...ferry-v0.22.0) (2026-11-13)


### Features

* introduce consistent responsive motion for dock and files ([30c4572](https://github.com/ThienNg65/ferry/commit/30c457279ee467ee3e467b8fa451dc7b5f04bc52))
* polished motion for dock, folders, and tabs ([1c2ec68](https://github.com/ThienNg65/ferry/commit/1c2ec68046755183036fe27d47095d1a8021a408))


### Bug Fixes

* avoid terminal layout squeeze during dock transitions ([18312dd](https://github.com/ThienNg65/ferry/commit/18312dd786a5e03ed306bfe1125a71ed30b4c9a7))
* preserve smooth site-tab exit layout ([23f8a3d](https://github.com/ThienNg65/ferry/commit/23f8a3df3c0cc742cd2388d816eec7e9a40d83e9))


### Documentation

* document motion invariants and align template formatting ([68d8192](https://github.com/ThienNg65/ferry/commit/68d8192559499c251197cd16a86d9a6be0942640))

## [0.21.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.20.0...ferry-v0.21.0) (2026-11-13)


### Features

* Enhancements of monitoring and logs tailing ([d63aef7](https://github.com/ThienNg65/ferry/commit/d63aef7551dffda73d9900b91183ae0068fdf0b0))


### Bug Fixes

* align monitor history getter with compact CPU samples ([47870b9](https://github.com/ThienNg65/ferry/commit/47870b993103c01e2549298596540c55aeb37a4a))
* keep terminal search compatible with optional log highlight keywords ([a14a674](https://github.com/ThienNg65/ferry/commit/a14a674cb80e2523816099a0091388de861c119d))


### Performance Improvements

* smooth live monitoring and log tail interactions ([b1de68a](https://github.com/ThienNg65/ferry/commit/b1de68ae0ad39aa2a071c5748c8da5cd9dd46b12))

## [0.20.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.19.2...ferry-v0.20.0) (2026-11-12)


### Features

* redesign settings dialog with sidebar tabs ([8664bc2](https://github.com/ThienNg65/ferry/commit/8664bc2be245a7ec1edf3ef7c8746f241f1dc2d6))
* redesign settings dialog with sidebar tabs ([048ff8e](https://github.com/ThienNg65/ferry/commit/048ff8e35502ae936dff7be1b3ae48d3b08801a5))

## [0.19.2](https://github.com/ThienNg65/ferry/compare/ferry-v0.19.1...ferry-v0.19.2) (2026-11-12)


### Bug Fixes

* show window on load failure and init updater before manual use ([d5a0285](https://github.com/ThienNg65/ferry/commit/d5a028548e8ed06ce9e0e65b061901104c9834b1))
* single instance, no blank-window freeze, safer update install ([5ce924f](https://github.com/ThienNg65/ferry/commit/5ce924fc7ff3d9b0a15521d09df6ed2ff5d0bd0c))
* single instance, no blank-window freeze, safer update install ([a6133b1](https://github.com/ThienNg65/ferry/commit/a6133b1308e7e8d7021a4567484d402da8da78bb))

## [0.19.1](https://github.com/ThienNg65/ferry/compare/ferry-v0.19.0...ferry-v0.19.1) (2026-11-11)


### Documentation

* explain Release Please bot PR checks and token setup ([9f12d43](https://github.com/ThienNg65/ferry/commit/9f12d4346bd8d1317e6cba6a4b50f348f5652754))

## [0.19.0](https://github.com/ThienNg65/ferry/compare/ferry-v0.18.4...ferry-v0.19.0) (2026-11-11)


### Features

* include P2/P3 UX refinements in release notes ([5ee2cde](https://github.com/ThienNg65/ferry/commit/5ee2cde807e8ecf6c9046b2bb55ae0992fa070ef))

## [0.18.4](https://github.com/ThienNg65/ferry/compare/ferry-v0.18.3...ferry-v0.18.4) (2026-11-11)


### Bug Fixes

* correctly detect missing public release tags ([#26](https://github.com/ThienNg65/ferry/issues/26)) ([a807394](https://github.com/ThienNg65/ferry/commit/a807394f3be93fa17dcdd6e96b01d911e6f59411))

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
