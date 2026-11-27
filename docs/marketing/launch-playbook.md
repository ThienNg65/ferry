# Ferry 14-Day Go-To-Market & First 1,000 Users Launch Playbook

**Goal:** Turn Ferry's existing product strength (`v1.3.2`) into its first 1,000 active Windows users by fixing high-intent discovery and removing install friction.  
**Primary Conversion Target:** [Microsoft Store (`9PJPWK568P53`)](https://apps.microsoft.com/detail/9PJPWK568P53) · Secondary: `winget install ThienNg65.Ferry` & Portable `.zip`

---

## 1. The 3 positioning wedges

Don't pitch Ferry only as *"a lightweight WinSCP alternative"*. Lead with the specific pain the reader has right now:

| Wedge | Target Audience | Core Pain | Ferry Hook |
|---|---|---|---|
| **1. "The 6 PM Broken Deploy"** | Full-stack, backend & indie devs on Windows | When production breaks, you open 4 tools: WinSCP for files, PuTTY for commands, a terminal for `tail -F`, and `htop` for CPU/RAM. | **"Files, terminal, live `tail -F` logs, and CPU/RAM monitor in one tab, over a single SSH connection."** |
| **2. "Anti-$120/yr Subscription"** | Termius Free/Pro users & solo ops engineers | Termius locks workflows behind a mandatory account and ~$10/mo (~$120/yr) subscription while treating SFTP as a secondary tab. | **"Local-first on Windows with DPAPI encryption, zero cloud accounts, dual-pane SFTP, and live logs — free."** |
| **3. "30-Second WinSCP / PuTTY Upgrade"** | WinSCP, PuTTY, and FileZilla users | Legacy 2000s UI, no integrated terminal in WinSCP, and manual PuTTY window juggling. Nobody wants to re-type 30 saved server configs, though. | **"Keep your dual-pane muscle memory. Import WinSCP, PuTTY, and `~/.ssh/config` sites in one click."** |

---

## 2. 14-Day Staggered Launch Sequence

| Days | Action | Owner Checklist |
|---|---|---|
| **Days 1–2** | **Unify & Seal Funnel Leaks** | Apply [`channel-conversion-kit.md`](channel-conversion-kit.md) to Microsoft Store (`9PJPWK568P53`) and `ferry-website`, push updated `docs/public-release-template/README.md` to `ThienNg65/ferry-release`, and verify `v1.3.2` links. |
| **Days 3–4** | **Submit WinGet PR + AlternativeTo** | Test `packaging/winget/manifests/t/ThienNg65/Ferry/1.3.2/` on Windows Sandbox (`docs/winget-distribution.md`), open PR to `microsoft/winget-pkgs`, and publish Ferry's AlternativeTo.net listing. |
| **Day 5** | **Record 35s Launch Demo** | Record the crisp 1080p screen capture following Section 3.3 below (native MP4/GIF, no background music, dark mode). |
| **Days 6–7** | **`r/selfhosted` & `r/homelab` Launch** | Post native video + workflow story on `r/homelab` (Day 6 morning US ET) and `r/selfhosted` (Day 7 morning US ET). Answer every comment within 15 minutes. |
| **Days 9–10** | **`r/Windows11` & `r/sysadmin` Launch** | Post text + screenshot walkthrough focusing on ~23 MB Neutralinojs footprint, Microsoft Store / Portable ZIP, and DPAPI security. |
| **Day 12** | **Hacker News (`Show HN`)** | Publish the architecture-focused `Show HN` post (8:00–10:00 AM US ET, Tue–Thu) detailing Neutralinojs + Node sidecar + multiplexed `ssh2`. |
| **Days 13–14** | **SEO Comparison Pages & Review Loop** | Ship `/vs/winscp`, `/vs/termius`, `/vs/mobaxterm`, `/vs/filezilla` on `ferry-website` and implement the non-intrusive Microsoft Store rating toast spec. |

---

## 3. Ready-to-paste launch assets

### 3.1 AlternativeTo.net Listing Metadata

- **Name:** `Ferry`
- **Website:** `https://www.ferryssh.com`
- **Download URL:** `https://apps.microsoft.com/detail/9PJPWK568P53`
- **Short Summary (1–2 sentences):**
  > Ferry is a lightweight (~23 MB) Windows desktop SSH/SFTP workspace that combines a dual-pane file browser, GPU-accelerated terminal, live `tail -F` log viewer, and CPU/memory/process monitor in a single server tab over one SSH connection.
- **Platforms:** `Windows`
- **License / Pricing:** `Free` *(personal & commercial freeware / local-first desktop app)*
- **Alternative To (Tag All 7):**
  `WinSCP`, `FileZilla`, `PuTTY`, `MobaXterm`, `Termius`, `Cyberduck`, `Bitvise SSH Client`
- **Feature Tags:**
  `SFTP client`, `SSH client`, `Dual-pane file manager`, `Terminal emulator`, `Log viewer`, `Server monitoring`, `Portable`, `No telemetry`

---

### 3.2 Hacker News (`Show HN`) Post

**Title (79 chars, factual, no hype):**
```text
Show HN: Ferry – 23MB Windows SSH/SFTP workspace (files, terminal, logs, monitor)
```

**Post Body (Text or top-level author comment):**
```text
Hi HN,

I built Ferry because whenever a deploy broke on a Linux box from my Windows machine, I ended up juggling four separate windows: WinSCP for SFTP, PuTTY for systemctl, another terminal for `tail -F`, and htop for CPU/memory spikes.

Ferry puts all four into one tab over a single multiplexed SSH connection (`ssh2`):

- Dual-pane SFTP file browser + one-way folder sync with preview + built-in CodeMirror editor
- GPU-accelerated SSH terminal (`@xterm/xterm` + WebGL) inside the same server tab
- Dedicated live `tail -F` log viewer with level filtering and keyword search
- Real-time CPU, memory, disk, and top-process monitor without installing any agent on the server
- 1-click session import from WinSCP, PuTTY, and `~/.ssh/config`

Why the architecture looks unusual (~23 MB installer):
Instead of Electron (~150–250 MB), Ferry runs Vue 3 inside Neutralinojs (using Windows' native WebView2 runtime) paired with a bundled Node.js v22 sidecar over an authenticated loopback WebSocket. All SSH/SFTP sessions, jump hosts, SOCKS/HTTP proxies, and Windows DPAPI (`CryptProtectData`) credential decryption stay inside the Node sidecar—decrypted passwords never cross IPC to the WebView.

Honest trade-offs:
- Windows 10/11 x64 only for now.
- SSH & SFTP only (no FTP, FTPS, SCP, RDP, or X11—WinSCP and MobaXterm remain better choices if you need those).
- Available via the Microsoft Store (signed MSIX, zero SmartScreen prompt) as well as a direct NSIS installer and portable ZIP on GitHub Releases.

Site: https://www.ferryssh.com
Microsoft Store: https://apps.microsoft.com/detail/9PJPWK568P53
Releases & Issue Tracker: https://github.com/ThienNg65/ferry-release

Would love technical feedback from Windows devs and sysadmins—especially around SSH edge cases (bastions, 2FA prompts, flaky links) and what's missing before you'd switch from WinSCP or Termius.
```

---

### 3.3 Reddit `r/selfhosted` & `r/homelab` Post + 35-Second Video Script

#### 35-Second Screen Recording Shot List (Upload natively to Reddit, not a YouTube link)
*Settings: 1920×1080 or 1600×900, dark mode, font crisp, zero intro logo cards, max 35 seconds:*
- **0:00–0:06 (`Import`):** Open Ferry → click `Import WinSCP / PuTTY` (or `~/.ssh/config`) → 3 homelab servers appear immediately with colour-coded `Production` / `Staging` tags.
- **0:06–0:14 (`Connect & Dual-Pane`):** Double-click `web-prod` → dual-pane local/remote SFTP opens instantly → drag a config/release file across or double-click a config file in the built-in editor.
- **0:14–0:23 (`Logs + Terminal`):** Switch split tab to **Log Tail** (`tail -F` streaming live lines, filter `ERROR`), then click **Terminal** right next to it and run `systemctl restart ...`.
- **0:23–0:32 (`Monitor`):** Click **Monitor** tab → show live CPU, RAM, Disk bars and top processes settling after the restart — all on the exact same server tab.
- **0:32–0:35 (`End Frame`):** Clean card overlay: `Ferry for Windows · ~23 MB · Microsoft Store & Portable ZIP`.

#### Reddit Post Copy (`r/homelab` / `r/selfhosted`)

**Title Options:**
- `r/homelab`: `I got tired of juggling WinSCP + PuTTY + tail -F for my Proxmox VMs, so I built a 23MB Windows app with all 4 in one tab`
- `r/selfhosted`: `Ferry: A lightweight, local-first Windows SSH/SFTP client with built-in terminal, live log tail, and server monitor (no account/telemetry)`

**Body:**
```markdown
If you manage Linux VMs/LXCs or VPS boxes from Windows, your workflow probably looks like mine used to: WinSCP open on the left, PuTTY or Windows Terminal on the right, another window running `tail -F`, and `htop` somewhere behind them.

I built **Ferry** to unify those into one clean, local-first Windows workspace over a single SSH connection:

- **1-Click Import:** Pulls in your saved hosts from **WinSCP, PuTTY, and `~/.ssh/config`** (never touches/imports plaintext passwords).
- **Dual-Pane SFTP + Folder Sync:** Side-by-side browsing, drag-and-drop, one-way folder sync with preview, archive extract/compress, and an inline CodeMirror editor for quick nginx/docker-compose tweaks.
- **Integrated SSH Terminal:** GPU-accelerated xterm right below/beside your files.
- **Live Log Tailing (`tail -F`):** Follow logs in real time with level filtering & search.
- **Zero-Agent Server Monitor:** Live CPU, RAM, disk, and top-process table pulled over the same SSH session—nothing to install on your servers.
- **Local-First & Lightweight:** ~23 MB installer (Neutralinojs + WebView2, not a 200 MB Electron bundle). Zero accounts, zero telemetry, and credentials are encrypted locally with Windows DPAPI.

**Where to get it (Free, Windows 10/11 x64):**
- **Microsoft Store** (1-click signed install, auto-updates): https://apps.microsoft.com/detail/9PJPWK568P53
- **Portable ZIP & Direct Installer:** https://github.com/ThienNg65/ferry-release/releases/latest
- **Interactive Demo & Comparison:** https://www.ferryssh.com

Happy to answer questions or take feature requests for homelab/Docker workflows!
```

---

### 3.4 Reddit `r/Windows11` & `r/sysadmin` Post

**Title:**
- `r/Windows11`: `Built a 23MB native-feeling Windows SSH/SFTP + server monitor app (WebView2/Neutralinojs, DPAPI encrypted, on Microsoft Store)`
- `r/sysadmin`: `Ferry – Lightweight local-first Windows SFTP, SSH terminal, live log tail, and server monitor (imports WinSCP/PuTTY + Portable ZIP)`

**Body:**
```markdown
Sharing **Ferry** (`v1.3.2`), a Windows 10/11 x64 desktop workspace for engineers and sysadmins managing Linux servers.

Instead of bundling another 200+ MB Chromium copy with Electron, Ferry pairs Windows' built-in **WebView2** (via Neutralinojs) with a local Node.js sidecar so the installer stays around **23 MB** and launches quickly.

**Key highlights for Windows admins:**
- **4 tools, 1 SSH connection:** Dual-pane SFTP, `@xterm/xterm` SSH terminal, dedicated `tail -F` log viewer, and live CPU/RAM/disk/process monitor per server tab.
- **Enterprise SSH support:** SSH agent, jump hosts (bastions), SOCKS/HTTP proxies, trust-on-first-use host-key checks, and interactive 2FA prompts.
- **Fast migration:** Imports existing **WinSCP**, **PuTTY**, and **`~/.ssh/config`** profiles in one click.
- **Security & zero telemetry:** Zero accounts, zero analytics/telemetry calls, and saved passwords/passphrases are encrypted locally via **Windows DPAPI (`CryptProtectData`)** inside the backend process.
- **Deployment options:** Available as a signed **Microsoft Store** app (no SmartScreen warnings, ideal for locked-down endpoints) or as a zero-install **Portable `.zip`** for USB drives and jump hosts.

- **Microsoft Store:** https://apps.microsoft.com/detail/9PJPWK568P53
- **Portable ZIP & Release Notes:** https://github.com/ThienNg65/ferry-release/releases/latest
- **Website & WinSCP/MobaXterm Comparison:** https://www.ferryssh.com
```

---

## 4. Bottom-of-Funnel SEO Comparison Page Specs

Create 4 static routes on `ferry-website` for developers who are searching for alternatives. Every page keeps Ferry's honest tone and says outright when the competitor is still the better tool.

| Route | Target Keywords | H1 Headline | Key Comparison Angle | "When to Stick With Competitor" Block | Primary CTA |
|---|---|---|---|---|---|
| **`/vs/winscp`** | `winscp alternative windows 11`, `winscp with built in terminal`, `modern winscp alternative` | **WinSCP vs. Ferry: Keep the Dual-Pane Speed, Drop the Separate PuTTY Window** | Same dual-pane Commander muscle memory + 1-click WinSCP session import, plus embedded terminal, live `tail -F` logs, and server monitor. | Stick with **WinSCP** if you need FTP/FTPS, WebDAV, S3, SCP, or `.NET` / CLI transfer automation scripts. | **Import from WinSCP & Install via Microsoft Store** |
| **`/vs/termius`** | `termius free alternative windows`, `termius vs local ssh client`, `ssh client without subscription` | **Termius vs. Ferry: Full SFTP, Logs & Server Monitoring Without the $120/yr Cloud Lock-In** | Local-first Windows DPAPI encryption, zero account required, true dual-pane SFTP + folder sync + dedicated `tail -F` & process monitor for $0. | Stick with **Termius** if you need iOS/Android/macOS cross-device cloud sync or Mosh support. | **Get Ferry Free on Microsoft Store** |
| **`/vs/mobaxterm`** | `mobaxterm alternative lightweight`, `mobaxterm home session limit alternative` | **MobaXterm vs. Ferry: Focused SSH/SFTP Without Legacy Clutter or Session Caps** | Unlimited saved sites & tabs (vs MobaXterm Home's 12-session cap), clean dual-pane SFTP + one-way folder sync, and full process monitor out of the box. | Stick with **MobaXterm** if you need an X11 server, RDP, VNC, serial console, or SSH port-forwarding tunnels. | **Install Ferry (~23 MB) on Windows** |
| **`/vs/filezilla`** | `filezilla alternative sftp ssh`, `filezilla alternative windows no adware` | **FileZilla Alternative for Linux Servers: Clean SFTP, Built-In Terminal & Live Logs** | Purpose-built for SSH/SFTP (no bundled installer adware), plus inline config editor, GPU SSH terminal, and live `tail -F` log inspection. | Stick with **FileZilla** if you primarily manage plain FTP/FTPS servers rather than SSH/Linux hosts. | **Try Ferry Free via Microsoft Store** |

---

## 5. In-App Microsoft Store Rating Trigger Spec (Future UI PR)

The first **10 to 25 genuine 5-star reviews** on Microsoft Store (`9PJPWK568P53`) should improve organic Store search placement for `SFTP` and `SSH`.

### Trigger rules (keep it unobtrusive)
- **Eligibility Condition:** User has completed **either** `>= 5` successful file transfers **or** `>= 3` successful SSH sessions across at least 2 distinct app launches.
- **Suppression Guards (Never show when):**
  - Any modal dialog, error banner, host-key prompt, or 2FA prompt is open.
  - The current session has an active error or failed transfer.
  - The user already clicked **Rate**, **Already rated**, or **Don't ask again** (persisted in UI `localStorage` / `AppSettingsStore`).
  - The user clicked **Later** within the last 14 days.
- **UI Placement:** Subtle non-blocking bottom-right toast (same toast layer as update notifications), auto-dismissable, never a blocking modal.
- **Copy:**
  - Title: `Finding Ferry useful?`
  - Body: `A quick rating on the Microsoft Store helps other Windows developers discover Ferry.`
  - Actions:
    - Primary button: **`Rate on Microsoft Store`** → opens `ms-windows-store://review/?ProductId=9PJPWK568P53` (fallback to `https://apps.microsoft.com/detail/9PJPWK568P53` if Store protocol fails).
    - Secondary button: **`Later`** (snooze 14 days).
    - Dismiss link: **`Don't ask again`** (permanent opt-out).
