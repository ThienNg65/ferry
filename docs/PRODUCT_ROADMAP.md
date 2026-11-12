# Ferry Product Roadmap (2027-2028)

**Status:** Proposed for review  
**Research snapshot:** 2026-11-12  
**Owner:** The Ferry Project  
**Scope:** Desktop product, experience, engineering, trust, distribution, community, and long-term maintenance  
**Related migration epic:** [#37 - Electron to Neutralinojs](https://github.com/ThienNg65/ferry/issues/37)

> This is a **directional, evidence-informed roadmap**, not a set of promised release dates. Time horizons and targets are proposals. Validate priority and effort with user research and benchmarks, then track delivery as issues in The Ferry Project. Do not consider a feature shipped until the implementation and tests confirm it.

## 1. North star and positioning

**Vision:** The lightweight, trustworthy desktop workspace for developers and infrastructure engineers working with remote servers.

**Promise:** Connect, explore, diagnose, act, and verify with one coherent workflow.

Ferry should not try to replicate every protocol and system-administration feature offered by WinSCP, MobaXterm, Cyberduck, Termius, or XPipe. Win through fast onboarding, exceptional SSH/SFTP fundamentals, useful live diagnostics, local-first privacy, and a polished, focused interface.

**Product principles**

1. **Reliability over breadth:** never sacrifice transfer safety, credential security, or update correctness for another feature.
2. **Local first:** working offline and without sign-in is a baseline; do not collect secrets or remote content.
3. **One connected workspace:** transfer, terminal, log tail, and monitor should understand the active server/session.
4. **Progressive complexity:** common actions are obvious; advanced SSH, tunnels, and diagnostics are discoverable, not always visible.
5. **Lightweight end-to-end:** measure the complete installer, all backend dependencies, cold start, and memory, not just the shell binary.
6. **Safe by default:** previews, clear change scope, explicit destructive-action confirmation, and understandable failure recovery.
7. **Accessible and international:** keyboard-first, strong focus treatment, scalable text, tested color contrast, and later localization.
8. **Evidence before expansion:** prove recurring use cases and obtain user feedback before adding large new surfaces.

**Non-goals for the near term:** compete with all-in-one RDP/VNC/X11 workstations; create a cloud account service; become a full Kubernetes control plane, database IDE, or file-sync daemon; ship autonomous AI shell execution.

## 2. Current baseline and known gaps

Repository review (Ferry v0.20.0, 2026-11-12): [README](../README.md), [architecture map](../.claude/PROJECT_MAP.md), and [package manifest](../package.json).

**Already implemented - maintain, refine, do not duplicate in the backlog**

- Dual-pane SFTP browser, sorting, selection, context actions, permissions, symlinks, OS drag/drop.
- Recursive transfer queue with retry actions and bandwidth limiting; local/remote archive operations.
- Live log tailing, interactive xterm SSH shell, remote CPU/memory/disk/process monitoring.
- Multiple saved SSH sessions/site tabs, bookmarks, transfer/operation history.
- Password, key, SSH-agent, real keyboard-interactive/2FA, verified jump-host chains, SOCKS5/HTTP CONNECT.
- WinSCP/PuTTY session import, external file editing, one-way sync with preview, command palette, theme/settings.
- Electron release pipeline, public binary feed at [ferry-release](https://github.com/ThienNg65/ferry-release), separate [website](https://github.com/ThienNg65/ferry-website).

**Gaps requiring validation/engineering, not assumptions**

- Robust post-interruption transfer **resume and verification** is not established by the current retry-from-scratch implementation.
- One-way sync currently relies on a size/mtime comparison with tolerance; conflict awareness, hash verification, and richer policies require validation.
- OpenSSH configuration discovery/import and ongoing interoperability are not listed as current supported features.
- Standalone SFTP-only servers (no remote shell) require an explicit compatibility test: many Ferry diagnostics and file operations use SSH exec.
- Local/remote source integrity in editing, recoverable operations, and comprehensive real-server E2E coverage need further work.
- The installer is currently unsigned; code-signing and SmartScreen reputation are separate from GitHub verified release commits.
- The Electron-to-Neutralinojs migration is **not** a drop-in swap because Node-powered SSH/SFTP, archive, encrypted storage, and updater code need replacement or a packaged sidecar. Follow [#37](https://github.com/ThienNg65/ferry/issues/37).

## 3. Evidence from the world - why these bets

Research distinguishes **competitor-verified capabilities**, **anecdotal user signals**, and **Ferry hypotheses**. Community posts are not representative demand estimates. No market size, adoption, or revenue estimates have been assumed.

| External signal | What it suggests | Ferry response | Evidence strength |
|---|---|---|---|
| WinSCP documents resume, sync, scripting, portable operation, and broad protocol coverage. | Reliability and automation are mature competitive expectations. | Close correctness/recovery gaps before expanding scope. | Official capability |
| MobaXterm combines SSH, SFTP, terminals, tunnels, and monitoring-style remote workflows. | Engineers value a connected remote workspace. | Keep logs, terminal, monitor, and files integrated. | Official capability |
| Termius advertises snippets, workspaces, SSH/SFTP, and encrypted vault synchronization. | Repeated work and reconnect speed matter. | Local-first snippets, workspaces, command history, import. | Official capability |
| XPipe supports SSH configs, gateways, terminal integrations, containers, Kubernetes, and local vaults. | Modern users mix traditional SSH and container/cloud systems. | Start with SSH-config and port forwarding; assess container read-only integrations later. | Official capability |
| Cyberduck supports many file protocols, external editing, remote-to-remote, and resumable transfers. | Multi-protocol breadth is a real market, but highly competitive. | Remain SSH/SFTP-first; evaluate S3 only through evidence. | Official capability |
| Sysadmin/self-hosted discussions describe sprawling connections and preference for local credential custody. | Findability and privacy are daily concerns. | Groups, tagging/search, safe export/import, no mandatory account. | Anecdotal |
| Other discussions report reliability concerns for large files and sync consistency; some users report no problem. | Correctness matters even where frequency is unclear. | Test multi-GB transfers, interruptions, stale listings, casing, timestamps. | Anecdotal |
| Users praise always-visible remote CPU/RAM/disk status. | Diagnostics can differentiate Ferry from pure file clients. | Optional compact health summary linked to active session. | Anecdotal |
| Microsoft documents SmartScreen reputation and unsigned-installer friction. | Installation trust directly affects adoption. | Signing, verified provenance, clear installer/update guidance. | Official guidance |
| OpenSSH emphasizes post-quantum hybrid key exchange and warns about weak negotiations. | SSH algorithms must evolve with upstream standards. | Maintain supported-algorithm matrix and SSH library update policy. | Official guidance |

**Source links**

- [WinSCP overview](https://winscp.net/eng/docs/introduction), [features](https://winscp.net/eng/docs/feature_index)
- [MobaXterm official features](https://mobaxterm.mobatek.net/features.html)
- [Termius official product](https://termius.com/)
- [XPipe official capabilities](https://xpipe.io/) and [SSH integration](https://docs.xpipe.io/guide/ssh)
- [Cyberduck official features](https://cyberduck.io/) and [SFTP](https://cyberduck.io/sftp/)
- [Reddit: SSH/SFTP sprawl](https://www.reddit.com/r/sysadmin/comments/1jaaq2l/ssh_and_sftp_sprawling_out_of_control_what/)
- [Reddit: multi-host SSH clients](https://www.reddit.com/r/selfhosted/comments/18zd8pt/clientsoftware_for_managing_multiple/)
- [Reddit: remote monitoring preferences](https://www.reddit.com/r/selfhosted/comments/1k1on5j/sshclients_mobaxterm_termius_tabby_xpipe/)
- [Reddit: SFTP reliability discussion](https://www.reddit.com/r/sysadmin/comments/1f3vwus)
- [Reddit: enterprise SSH key practices](https://www.reddit.com/r/sysadmin/comments/1g7a3gp)
- [Microsoft SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [OpenSSH post-quantum guidance](https://www.openssh.org/pq.html)
- [Neutralinojs extensions](https://neutralino.js.org/docs/how-to/extensions-overview/) and [updater limitations](https://neutralino.js.org/docs/how-to/auto-updater/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## 4. Audiences, jobs, and success criteria

| Primary audience | Job to be done | Delight moment | Failure we must prevent |
|---|---|---|---|
| Software engineer | Inspect/change a remote file, follow an app log, run a terminal command. | One connection provides everything; return to last working location. | Stale edit overwrites someone else's change. |
| DevOps / SRE engineer | Diagnose a live incident without switching five tools. | Find host, inspect CPU/memory/logs, jump into terminal instantly. | Misleading stale logs, hidden reconnects, unsafe command targeting. |
| System administrator | Manage many SSH hosts and reliably move/sync files. | Search and connect in seconds; transfers survive interruptions. | Silent transfer corruption, unsafe sync deletion, exposed credentials. |
| Secondary: homelab/learner | Configure first SSH connection and move files safely. | Clear key/auth errors and excellent first-run guidance. | Ambiguous 2FA, host-key, proxy, or permissions errors. |

**Core journey:** discover/create host → verify trust → connect → explore → troubleshoot/transfer → validate result → reconnect later.

## 5. Prioritization and release horizons

**Priority key:** P0 = safety/quality/release blocker; P1 = core user value; P2 = validated expansion; Explore = research only.  
**Horizon key:** Now = late 2026 / early 2027; Next = 2027 H1; Later = 2027 H2; Explore = 2028+.

| ID | Workstream / initiative | Priority | Horizon | Outcome |
|---|---|---|---|---|
| F-01 | Test and release confidence baseline | P0 | Now | Real-server tests, regression matrix, performance measurements |
| F-02 | Installer trust, signatures, provenance and safe auto-updates | P0 | Now | Secure, understandable, repeatable installation and upgrade |
| F-03 | Reliable transfer recovery and integrity | P0 | Now → Next | Recover interrupted transfers without silent data loss |
| F-04 | Safe sync and remote edit conflict protection | P0 | Next | Predictable changes with explicit compare/preview |
| F-05 | User research and product feedback loop | P0 | Now | Priorities supported by observed workflows |
| F-06 | First-run, connection diagnosis, meaningful errors | P1 | Now | Shorter time to first successful connection |
| F-07 | Design system, accessibility, responsive resizing, keyboard UX | P1 | Now → Next | Consistent and comfortable daily use |
| F-08 | SSH config discovery/interoperability | P1 | Next | Reuse existing host aliases, identities, jump rules |
| F-09 | Server health dashboard and contextual diagnostics | P1 | Next | Faster investigation with less switching |
| F-10 | Advanced log viewer: filter/search/time/pause/export | P1 | Next | Find relevant lines in high-volume streams |
| F-11 | Command snippets and saved workspaces | P1 | Next | Faster repeat workflows without cloud dependency |
| F-12 | SSH port-forwarding UI (local/remote/dynamic) | P1 | Later | Reach private dev/test services safely |
| F-13 | Pure SFTP compatibility mode and protocol matrix | P1 | Next | Work with SFTP-only accounts where exec is unavailable |
| F-14 | Neutralinojs feasibility spike and go/no-go | P1 | Now | Make a measured platform decision (existing issue #37) |
| F-15 | Neutralinojs migration, if approved | Conditional P1 | Later | Smaller native distribution, no feature regressions |
| F-16 | Portable/managed Windows distribution options | P2 | Later | Better deployment in locked-down and offline environments |
| F-17 | Signed configuration backup/export; migration safety | P1 | Next | No connection data loss after reinstall or platform swap |
| F-18 | Documentation, localization preparation, support policy | P1 | Now → Later | Maintainable product with clear supported configurations |
| F-19 | Optional diagnostics bundle and opt-in crash telemetry | P2 | Later | Easier issue reproduction, no credential/log leakage |
| F-20 | Remote-to-remote copies, compare/diff, smarter navigation | P2 | Later | Reduce repetitive file work once safety foundations mature |
| F-21 | Read-only container/Kubernetes awareness | Explore | 2028+ | Validate a focused troubleshooting need before building |
| F-22 | S3/object storage or other protocols | Explore | 2028+ | Expand only with sufficient confirmed demand and resource |
| F-23 | Scripting/CLI and safe task templates | Explore | 2028+ | Repeatable operations with scope and auditability |
| F-24 | Optional AI-assisted troubleshooting | Explore | 2028+ | User-controlled diagnostics, no autonomous execution |
| F-25 | Linux/macOS support | Explore | 2028+ | Expand after Windows quality and platform feasibility |

## 6. Detailed delivery plan

### Horizon 0 - Trustworthy foundation (late 2026 through early 2027)

**Expected outcome:** Users can install Ferry, establish a connection, and complete safe transfers confidently.

- **Release and trust:** finish verifiable latest-release links, installer hash validation, signing eligibility/path, honest SmartScreen instructions, human-readable changelogs, updater success/failure reporting, and rollback testing. Do not confuse a GitHub Verified commit/tag with an Authenticode-signed Windows executable.
- **Transfer safety:** capture benchmarks for large files, high latency, mid-stream disconnects, cancel/resume, full disk, permission denied, zero-byte files, symlinks, and casing differences. Document exactly what retry/resume guarantees today.
- **Reliability:** standardize connection timeouts, actionable error taxonomy, SSH log redaction, operation cancellation, resource cleanup, and reconnection states.
- **Developer confidence:** deterministic mock fixtures; Docker SSH/SFTP integration suite required for PRs where practical; Windows smoke tests on packaged builds; explicit compatibility matrix.
- **Experience baseline:** first-run/onboarding and settings information architecture; consistent loading/empty/error/success states; keyboard audit; reduced motion and focus visibility.
- **Neutralino spike:** start the [architecture and SSH/SFTP proof of concept from #37](https://github.com/ThienNg65/ferry/issues/37). It does not authorize a wholesale rewrite before the gate passes.
- **Research:** interview at least 6-10 target users across engineers, SREs, sysadmins; observe three complete journeys; log hypotheses and repeat objections.
- **Website:** accuracy first - actual screenshots, release compatibility, trust, installation steps, limits; avoid unsupported size/security claims.

### Horizon 1 - Best-in-class SSH/SFTP experience (2027 H1)

**Expected outcome:** Stronger than a typical file browser for the everyday connect → transfer → diagnose journey.

- Resumable transfers with controlled partial files, validation, progress accuracy, retry policy, and final atomic replacement where server semantics permit.
- Safer sync: time/size/hash comparison options, case-sensitive warning, clock-skew handling, delete-preview, skip/conflict policies, and dry-run summary.
- Remote editing: modified-since-open detection, explicit conflict choice (compare, overwrite, save as), and bounded watcher behavior.
- SSH config interoperability: read host aliases, ProxyJump, keys, ports, Include rules as supported; clear unsupported directives; never silently rewrite the user's configuration.
- SFTP-only mode: browsing, transfer, rename, permissions if supported; gracefully disable SSH-exec-only actions.
- Saved workspaces: restore host tabs and selected tool panes; searchable, tagged hosts; safe import/export that never exports secrets without user confirmation and encryption.
- Powerful log tail: stream backpressure cap, pause, follow, search, regex filtering with safety limits, highlight, timestamps where parseable, copy/export with sensitive-data warning.
- Server context: optional health chip in active session header, click-through metrics, connection quality/reconnect status, source/time labels.
- Onboarding and accessibility hardening based on usability results.

### Horizon 2 - Productivity, confidence, and native platform (2027 H2)

**Expected outcome:** Faster repeated workflows and a validated lightweight platform without upgrade surprises.

- Saved snippets and runbooks with variable preview, selected-host confirmation, and an explicit warning for destructive commands.
- SSH tunnels through an understandable port-forward UI (local/remote/dynamic), conflict detection, and no implicit non-loopback binding.
- Compare two folders/files, remote-to-remote transfer where practical, productivity shortcuts and navigation polish.
- Optional diagnostics bundle (version, OS, redacted error codes, configuration shape), with preview before export.
- If the Neutralino spike passed: typed backend/platform abstraction; staged feature parity; bench against Electron including packaged sidecars; Windows upgrade bridge; rollback rehearsal; preserve encrypted credentials where technically possible.
- Distribution options: portable release, admin-free install where possible, documented enterprise install switches, and offline installation path.
- Clear stable/preview release channels and upgrade/incompatibility policy.

### Horizon 3 - Selective expansion (2028 onward; discovery only)

- Validate Linux/macOS demand, OS APIs, packaging, secure storage, and support capacity before promising cross-platform binaries.
- Pilot read-only Docker/Kubernetes context (show container logs/paths and open a controlled terminal) only if people repeatedly need it alongside SFTP.
- Explore CLI/script automation with explicit confirmation, allowlisted actions, and no surprise command execution.
- Explore object storage protocols only if usage research justifies sacrificing focus/maintenance budget.
- Explore optional local/bring-your-own-model explanations of user-selected logs, with preview, redaction, and **no model-driven autonomous shell access**.
- Team-sharing, cloud sync, or enterprise policy layers are separate product decisions; never make an account necessary to use core Ferry.

## 7. UX / design system roadmap

**Design target:** quiet, minimal, responsive, Windows-native-feeling interface, not dense admin-console chrome.

- **Information hierarchy:** session identity and connection health first; active file browser central; log/terminal/monitor/transfer tools in a contextual, resizable dock.
- **One clear primary action per state:** connected/unconnected; transfer selected; open/view/edit; recover interrupted operation.
- **Progressive disclosure:** advanced auth, proxy, sync delete, and tunnel rules behind explicit expandable controls with safe defaults.
- **State consistency:** every long operation has a start, progress/cancel, success/error, and retry/recovery outcome. Distinguish stale vs live metrics and disconnected vs connecting vs retrying.
- **Keyboard-first:** predictable traversal, command palette, accessible context actions, screen-reader labels, shortcut discovery, no terminal/shortcut conflicts.
- **Dense-list quality:** virtualize huge directories/logs, readable fixed-width paths, stable selection/scroll position on refresh, clear symlink/permission/state affordances.
- **Accessible:** use WCAG 2.2 AA as a design target where relevant, including focus visibility, contrast, pointer targets, zoom/reflow, error identification and reduced motion.
- **Delight without cost:** subtle motion, fast feedback, theme consistency, never animate huge lists or regress startup.
- **Usability testing:** observe first connection, a failed login, an interrupted transfer, and a safe sync. Use task success and time-to-complete, not subjective beauty alone.

## 8. Technical architecture and non-functional requirements

- **Platform abstraction:** typed UI → capabilities interface → SSH/FS/transfer/OS adapters. Keep contracts independent of Electron/Neutralino.
- **Security:** strict host-key checking; never suppress changed-key warnings. Keep credentials encrypted at rest; use system credential/agent integrations where possible. Do not expose passwords to renderer, logs, or diagnostics bundles.
- **SSH evolution:** compatibility/algorithm matrix, alert on library vulnerabilities, test modern OpenSSH servers, legacy failure messaging; do not turn on obsolete crypto silently.
- **Transfer correctness:** bounded concurrency and memory, explicit filesystem capability detection, safe temporary files, cancellation, idempotent retry, version/conflict checks, checksums where practicable, and clear limits of verification.
- **Sync correctness:** detect server/client timestamp skew and Windows/Linux case mismatch, prevent directory escape, show deletion scope, refuse destructive sync when path identity is uncertain.
- **Streams:** bounded log buffer and rendering, reconnect with gap indication, avoid presenting partial output as complete evidence.
- **Cross-platform preparedness:** isolate OS-specific operations before promising new OS releases; Windows path separators, Unicode, long paths, shell quoting, DPI, monitor scaling.
- **Neutralino specifics:** confirm WebView2 availability, extension IPC authentication and scope, binary execution policy, external sidecar footprint, packaging, signed updates, data migration, and framework-binary update handling. The built-in Neutralino updater handles resource updates, **not native binary replacement**.
- **Test matrix:** Windows 11 baseline; test Windows 10 only under an explicitly stated support policy. SSH/SFTP Docker fixtures with password/key/agent/2FA, jump hosts, proxies, shell-disabled users, slow links, interruptions, and host-key changes.
- **Build supply chain:** pinned workflows/actions, dependency updates, SBOM or dependency inventory, artifact hash publishing, signatures where feasible, release provenance and clean install verification.

## 9. Performance and quality targets (proposed, not measured)

Baseline first, publish test machine/network, then accept or revise targets. These targets apply to the **full packaged product**, not an empty shell prototype.

| Metric | Proposed acceptance target | Measurement |
|---|---|---|
| Installer size after approved migration | At least **50% below** current ~90 MB reference, including sidecars | Build artifact size; dependency inventory |
| Cold startup | Aim for <= 2 s p50 on documented reference Windows machine | 30 repeated cold starts |
| Idle memory | Aim for <= 150 MB total relevant process RSS after opening a standard workspace | Windows process tree measurement |
| Transfer integrity | 100% byte-identical files in controlled test matrix | Hash compare on test fixture |
| Reliable recovery | No silent data loss across disconnect/cancel/restart scenarios | Automated fault-injection suite |
| Upgrade safety | 100% of migration test cases preserve saved sites/settings or provide explicit recoverable fallback | Legacy → new installer matrix |
| Connection onboarding | >= 90% first-connection completion in moderated target-user test after improvements | Observed usability sessions |
| Accessibility | No blocker keyboard/focus/contrast issues in core workflows | Automated and manual audit |
| CI | Every PR passes typecheck, unit, contract, and relevant integration suites | GitHub Actions checks |

These are aspirations, not user-facing claims. Size and RAM targets can conflict with full SSH/PTY functionality; the [#37](https://github.com/ThienNg65/ferry/issues/37) feasibility gate resolves that trade-off.

## 10. Release, support and maintenance policy

**Support model to establish before calling anything LTS:**

1. Maintain a documented supported-OS matrix, tested SSH server versions, supported file systems, and known protocol limitations.
2. Classify releases as Stable / Preview. Treat urgent security fixes separately from feature cadence; avoid promising fixed dates without staffing.
3. Maintain predictable changelogs, upgrade instructions, artifacts, hashes, and support links on [ferry-release](https://github.com/ThienNg65/ferry-release).
4. Publish SECURITY.md, vulnerability reporting contact/process, dependency audit procedure, and a response/triage policy appropriate to available maintainers.
5. Establish last-two-supported-release testing where practical, migration fixtures, and rollback instructions; define sunset windows for breaking changes.
6. Keep technical docs, troubleshooting FAQ, known issues, data migration/backup steps, and architecture decisions current.
7. Do not promise an LTS branch, 24/7 support, or fixed remediation SLA until a maintainer/support budget exists. Define an achievable support window first.
8. Run monthly product + defect triage, periodic dependency upgrades, and quarterly roadmap review. Retire abandoned proposals explicitly.

## 11. Product discovery and evidence loop

**First 30 days**

- Recruit 6-10 volunteer target users including at least two each from software engineering, ops/SRE, and IT admin/homelab.
- Observe genuine workflows: onboarding/import, daily transfer, sync, incident inspection, recovery after disconnection.
- Gather anonymized event-level friction only by direct consent; prefer session observations and issue reports over default telemetry.
- Catalogue requests by persona/job, frequency (observed), severity, substitution/competitor, willingness to switch, and supporting evidence.
- Benchmark a short standardized journey against WinSCP, MobaXterm, Termius, and XPipe on comparable machines.
- Record what Ferry does **better**, **worse**, or **not at all**, with screenshots and measurable task timings.

**Prioritization rule:** protect P0 safety/release work first. Score other items using user impact (1-5), observed frequency (1-5), confidence (Low/Medium/High), and effort (1-5). Reassess after feedback. A high-effort low-evidence idea stays in exploration.

**Product health signals (opt-in or voluntarily reported):** first-connect task success, transfer completion and verified integrity, crash incidence, updater outcome, time-to-find host, time-to-diagnose, repeat usage, and support report trends. Never collect terminal commands, remote file content, private key data, or credentials.

## 12. Backlog and governance

**Source of truth:** this versioned roadmap explains *why and when*. GitHub Issues and **The Ferry Project** track *work and status*. Releases and tags record *what shipped*.

Recommended Project fields:

- **Track:** Product / UX / Quality / Security / Platform / Distribution / Growth & Support
- **Priority:** P0 / P1 / P2 / Explore
- **Horizon:** Now / Next / Later / Explore
- **Stage:** Discovery / Spec Ready / In Progress / Validation / Done / Deferred
- **Evidence:** User Observed / Market Verified / Technical Risk / Hypothesis
- **Target milestone:** a short outcome-focused release or timebox, not an entire two-year promise
- **Dependency:** parent epic or blocking issue

**Issue hierarchy:**
- Portfolio roadmap epic → capability epics (e.g. Transfer Reliability, User Experience, Release Trust) → independently testable implementation issues.
- [#37](https://github.com/ThienNg65/ferry/issues/37) is the existing Electron → Neutralinojs epic: **first deliverable is feasibility**, not an unconditional migration commitment.
- Refer to the separate [Ferry website improvement backlog](https://github.com/ThienNg65/ferry-website/issues/12) for landing-page work; avoid mirroring every website issue in this source repository.
- Each capability epic must state: user problem, evidence, in/out scope, dependencies, acceptance tests, UX constraints, security considerations, and shipping metrics.
- Review progress monthly; revisit horizons quarterly; never mark a phase done because a date has passed.

## 13. Decisions to make after the first research cycle

| Decision | Current recommendation | Go/no-go evidence |
|---|---|---|
| Neutralinojs migration | Proceed with spike, **not yet full rewrite** | SSH/SFTP/PTY parity, sidecar/security/update path, measurable full-package gain |
| Other file protocols | Stay SSH/SFTP-only for now | Repeated high-value jobs lost due to missing protocol |
| S3/object storage | Explore only | Substantial observed overlap with Ferry's target audience |
| Container/Kubernetes | Read-only discovery before implementation | Incident workflows that specifically benefit from integration |
| AI assistance | Defer | Clear safe, consent-driven utility without autonomous actions |
| Mandatory cloud sync | Reject for core product | Strong, validated demand that does not compromise local-first promise |
| Cross-platform | Research after Windows reliability and platform decision | Usable engineering and support capacity with tested OS integration |

## 14. Definition of success

Ferry succeeds when users trust it to handle production-related remote files, can investigate server issues faster than with their current disconnected toolkit, can switch from another client without losing important SSH configurations, and receive reliable and supportable updates - while the product stays lightweight and comprehensible.

**Next action:** Review this proposal, convert the highest-confidence **Now** initiatives into owned and independently testable Project issues, and run the Neutralino feasibility spike in parallel with P0 release/trust and transfer/reliability improvements.
