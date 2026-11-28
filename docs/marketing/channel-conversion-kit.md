# Ferry Channel Conversion & Copy Overhaul Kit

**Target Product Version:** `v1.3.2`  
**Microsoft Store ID:** [`9PJPWK568P53`](https://apps.microsoft.com/detail/9PJPWK568P53) (`ms-windows-store://pdp/?productid=9PJPWK568P53`)  
**Public Releases Repo:** [`ThienNg65/ferry-release`](https://github.com/ThienNg65/ferry-release)  
**Official Website:** [`www.ferryssh.com`](https://www.ferryssh.com)

This kit has ready-to-paste copy and implementation specs to fix the conversion leaks in Ferry's Microsoft Store listing and landing page (`ferry-website`).

---

## 1. Microsoft Store Listing Overhaul (`9PJPWK568P53`)

### Why the current listing underperforms
- The current title, `Ferry File Client`, leaves out the highest-volume developer search keywords (`SSH`, `SFTP`, `Terminal`, `Server Monitor`).
- The feature list leaves out two differentiators: the built-in Server Resource Monitor (CPU, RAM, disk, top processes) and 1-click session import from WinSCP, PuTTY, and `~/.ssh/config`.

### Ready-to-paste Store metadata

**App Title (48 chars):**
```text
Ferry — SSH, SFTP, Terminal & Server Monitor
```
*(If Partner Center enforces a shorter limit in your category or you prefer a tighter title: `Ferry: SSH, SFTP & Terminal` — 27 chars.)*

**Short Description (Partner Center summary / subtitle, 148 chars):**
```text
Dual-pane SFTP, GPU-accelerated SSH terminal, live tail -F logs, and CPU/RAM server monitor in one fast, local-first Windows workspace.
```

**Full Description (Paste into Partner Center):**
```text
Stop juggling separate SFTP clients, SSH terminals, log viewers, and server monitors.

Ferry is a fast, lightweight (~23 MB) Windows desktop workspace built for developers, sysadmins, and DevOps engineers who work with Linux servers every day. Launch in seconds, import your existing WinSCP, PuTTY, or ~/.ssh/config sites in one click, and manage files, commands, live logs, and server health over a single SSH connection.

WHY DEVELOPERS CHOOSE FERRY

• 1-Click Import from WinSCP, PuTTY & ~/.ssh/config
  Switch in 30 seconds. Bring your saved hosts, usernames, and key paths straight into colour-coded Production, Staging, and Development tabs (passwords are never imported).

• Dual-Pane SFTP & Folder Sync
  Browse local and remote directories side by side with OS drag-and-drop, a live transfer queue with retries and bandwidth caps, per-connection file visibility filters, and one-way folder sync with preview.

• Built-In GPU-Accelerated SSH Terminal
  Jump straight into an interactive terminal (@xterm/xterm with WebGL rendering) inside the exact same server tab as your files — no separate PuTTY or SSH window needed.

• Live Remote Log Tailing (tail -F)
  Stream and inspect server logs as they are written with level filtering, keyword highlighting, and instant search.

• Real-Time Server Resource Monitor
  Watch live CPU, memory, load averages, disk usage, and top running processes over the same SSH connection — without installing any agent on your server.

• Integrated Code Editor & Archive Tools
  Edit remote config files directly in a built-in CodeMirror editor, preview files, and compress or extract server archives in place.

• Enterprise-Ready SSH Connectivity
  Connect via password, private key, SSH agent, SSH jump hosts (bastions), and SOCKS/HTTP proxies, with trust-on-first-use host-key verification and real 2FA / keyboard-interactive prompts.

• Local-First & Private by Design
  Zero accounts, zero telemetry, zero cloud lock-in. Passwords and key passphrases stay on your Windows machine, encrypted at rest with Windows DPAPI (CryptProtectData).
```

### 7 high-intent Store search keywords
Partner Center limits search terms to 7 entries. Use these:
1. `ssh client`
2. `sftp`
3. `winscp`
4. `terminal`
5. `putty`
6. `server monitor`
7. `log viewer`

### 5-slide annotated screenshot storyboard
Upload 16:9 (1920×1080 or 2560×1440) captures of the `v1.3.2` Modern Glass UI, each with a one-line headline banner at the top:

| Slide | UI Screen to Capture | Top Banner Headline | Supporting Callout |
|---|---|---|---|
| **1 (Hero)** | Dual-pane SFTP + bottom SSH Terminal split on a Production tab | **Files, Terminal & Logs in One Window** | *One SSH connection. Zero window switching.* |
| **2** | Live `tail -F` panel filtering `ERROR` / `WARN` lines alongside files | **Follow Server Logs Live (`tail -F`)** | *Filter levels, highlight keywords, and jump straight to fixes.* |
| **3** | Resource Monitor tab showing CPU/RAM/Disk + Top Processes table | **Live Server Monitor — No Agent Needed** | *Watch CPU, memory, disk, and processes over SSH.* |
| **4** | Connections home screen with Import dialog (`WinSCP / PuTTY / ~/.ssh/config`) & colour-coded env badges | **Switch in 30 Seconds** | *1-click import from WinSCP, PuTTY & `~/.ssh/config`.* |
| **5** | Integrated CodeMirror editor editing a remote `.conf`/`.env` + Folder Sync preview | **Edit Remote Configs & Sync Safely** | *Preview one-way folder syncs and extract archives remotely.* |

---

## 2. Landing Page (`ferry-website`) Conversion Fixes

### Bugs to fix
1. **Stale version (`0.28.1` vs `1.3.2`):** The page hardcodes `Ferry-Setup-0.28.1.exe` (Nov 16, 2026) while live releases are at `v1.3.2` (Nov 21, 2026).
2. **No Microsoft Store CTA:** Directly beneath the primary download button, visitors read *"The installer is currently unsigned, so Windows may show a SmartScreen warning"*, which sends them away. Ferry is already live and signed on the Microsoft Store (`9PJPWK568P53`).
3. **"MIT / View Source" contradiction:** Hero badges say `Free · MIT licensed` and the footer CTA says `Ferry on GitHub — View source & releases`, which links to `ThienNg65/ferry-release` (binary releases only, no source tree).
4. **No Termius comparison:** Ferry's pricing and local-first model compete directly with Termius ($120/yr subscription), yet the comparison table only lists WinSCP and MobaXterm.

### A. Hero section copy and CTA hierarchy

**Eyebrow / Trust Pill:**
```text
Windows 10 & 11 (64-bit) · ~23 MB · Local-First (Windows DPAPI)
```

**H1 headline (short and concrete):**
```text
Files, terminal, logs and monitor. One window.
```

**Subheadline:**
```text
Ferry is a lightweight Windows app for your Linux servers. Move files side by side, run commands, tail live logs, and inspect CPU, memory, and disk — all over one SSH connection with zero telemetry or cloud accounts.
```

**Primary & Secondary CTAs (Replace single unsigned `.exe` button):**
- **Primary CTA (High-contrast filled button):**
  - Label: **`Get it from Microsoft Store`**
  - Sub-label / microcopy: `Trusted 1-click install · No SmartScreen warning · Auto-updates`
  - URL: `https://apps.microsoft.com/detail/9PJPWK568P53`
- **Secondary CTA (Outlined button):**
  - Label: **`Direct Installer (v{{ latestVersion }})`** + compact link **`Portable .zip`**
  - URLs: Dynamically read from `https://api.github.com/repos/ThienNg65/ferry-release/releases/latest` (or `latest.yml`) at build/SSR time, falling back to `https://github.com/ThienNg65/ferry-release/releases/latest`. **Never hardcode `0.28.1` again.**
- **Hero Trust & Migration Strip (directly under CTAs):**
  - `Imports WinSCP, PuTTY & ~/.ssh/config in 1 click` · `Zero cloud account required` · `Credentials encrypted with Windows DPAPI`
  - Move the SmartScreen warning *out of the hero*. Keep it only under the **Direct Installer (`.exe`)** details drawer inside `#download`.

### B. Fix the "MIT / View Source" contradiction across the site

Replace every misleading source or license badge with accurate copy about security and licensing:

| Location | Old Copy (Remove) | New Copy (Use This) |
|---|---|---|
| Hero badge | `Free · MIT licensed · No account required` | `Free · Verified on Microsoft Store · No account required` |
| Feature pill strip | `MIT licence` | `DPAPI encrypted locally` |
| Download section card | `Ready to install — Free & MIT` | `Free for Windows · Store or Portable` |
| Download FAQ (`Is Ferry free?`) | `Yes. Ferry is released under the MIT licence...` | `Yes. Ferry is free to download and use on Windows via the Microsoft Store or GitHub Releases, with no mandatory account or telemetry. See LICENSE in the release repository for historical source terms.` |
| Footer GitHub button | `Ferry on GitHub — View source & releases` | `Ferry on GitHub — Releases & issue tracker` |
| Footer copyright line | `© 2026 Ferry. Released under the MIT licence.` | `© 2026 Ferry. Local-first Windows SSH/SFTP workspace.` *(with a subtle `Release notes & Terms` link)* |

### C. Updated 4-column comparison table (add Termius)

Update `#compare` to include **Termius** alongside Ferry, WinSCP, and MobaXterm. Use only verified facts and keep the comparison fair:

| Feature | **Ferry** | **WinSCP 6.7** | **MobaXterm Home / Pro** | **Termius (Free / Pro)** |
|---|---|---|---|---|
| **Local & remote side by side** | **Yes, dual-pane** | Yes (Commander UI) | No (sidebar browser only) | Split view in SFTP tab |
| **Interactive SSH terminal in same window** | **Yes, per server tab** | No (launches PuTTY) | Yes | Yes (terminal-first) |
| **Follow a log live (`tail -F`), filter by level** | **Yes, dedicated tab** | No | Only tail in terminal | Only tail in terminal |
| **Server monitor (CPU, RAM, disk, processes)** | **Yes, with process table** | No | Experimental status bar (off by default) | No |
| **Folder sync with preview** | **Yes, one-way** | Yes, several modes | No (`rsync` in terminal) | No |
| **Extract / compress server archives** | **Yes, built-in** | No built-in action | No built-in action | No |
| **1-click import from WinSCP / PuTTY / `~/.ssh/config`** | **Yes** | PuTTY import | Session import | `~/.ssh/config` import |
| **Account & cloud lock-in** | **None (local DPAPI storage)** | None | None | **Account required** for Pro sync/vault |
| **Protocols** | SSH & SFTP only | SFTP, SCP, FTP/FTPS, WebDAV, S3 | SSH, SFTP, FTP, RDP, VNC, X11, Telnet | SSH, SFTP, Mosh, Telnet |
| **Price** | **Free** | Free | Home free (12 sessions); Pro $69 | Free (limited); **Pro ~$10/mo (~$120/yr)** |

**Updated "When another tool fits better" blurb:**
> Need FTP, WebDAV, S3, or scripted transfers? Use **WinSCP**. Need RDP, VNC, or an X11 server? **MobaXterm** covers them. Need cross-platform mobile + team cloud sync? **Termius** fits well. **Ferry** is for Windows developers who want fast SFTP, terminal, live `tail -F` logs, and server monitoring in one local-first window, without paying $120/year.

### D. Custom domain migration checklist (`www.ferryssh.com`)

Moving off the `*-gamma.vercel.app` staging URL onto `https://www.ferryssh.com` should build developer trust. Track each surface below:

- [x] **1. Register domain:** `ferryssh.com` registered on Hostinger.
- [x] **2. Bind domain in Vercel:** `ferryssh.com` and `www.ferryssh.com` bound in Vercel with SSL.
- [x] **3. Update Nuxt runtime config:** Set `siteUrl: 'https://www.ferryssh.com'` in `ferry-website` (`nuxt.config.ts`) so `<link rel="canonical">` and Open Graph `og:url` / `og:image` tags resolve to `https://www.ferryssh.com`.
- [ ] **4. Update GitHub `ferry-release` metadata:** Set the repository **Website / Homepage** URL in GitHub Settings to `https://www.ferryssh.com`.
- [ ] **5. Update Microsoft Partner Center:** Set Website URL and Support/Privacy Policy URLs on listing `9PJPWK568P53` to `https://www.ferryssh.com`.
- [ ] **6. Update WinGet manifest template:** Add/update `PackageUrl` in `scripts/generate-winget-manifest.mjs` if desired on the next release.
