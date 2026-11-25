# Ferry

**Files, terminal, live logs, and server monitoring in one lightweight Windows app — over a single SSH connection.**

Ferry is a fast, local-first Windows SSH/SFTP desktop workspace built for developers, sysadmins, and DevOps engineers. Stop juggling separate WinSCP, PuTTY, log tail, and monitoring windows: connect once and manage remote files, run commands, watch live logs, and inspect server health side by side.

> **Website:** [www.ferryssh.com](https://www.ferryssh.com) · **Install from:** [Microsoft Store](https://apps.microsoft.com/detail/9PJPWK568P53) · [GitHub Releases](../../releases/latest)

## Features

- **1-Click Migration:** Import existing saved sessions from **WinSCP**, **PuTTY**, and **`~/.ssh/config`** (passwords are never imported).
- **Dual-Pane SFTP & Folder Sync:** Side-by-side local/remote file browser with OS drag-and-drop, one-way folder sync with preview, per-connection file visibility filters, archive compress/extract, bandwidth caps, retry queue, and an integrated remote code editor & file preview.
- **Integrated SSH Terminal:** GPU-accelerated `@xterm/xterm` terminal embedded right alongside your files on the same server tab.
- **Live Remote Log Tailing (`tail -F`):** Follow server logs as they are written with level filtering, keyword highlighting, and search.
- **Built-In Server Resource Monitor:** Track live CPU, memory, load averages, disk usage, and top processes over the same SSH connection.
- **Enterprise-Ready SSH & Local-First Privacy:** Supports passwords, SSH keys, SSH agents, jump hosts (bastions), SOCKS/HTTP proxies, trust-on-first-use host-key verification, and real 2FA/keyboard-interactive prompts. Zero telemetry, zero mandatory cloud accounts, and Windows DPAPI (`CryptProtectData`) encryption at rest.
- **Modern Workspace:** Browser-style multi-session tabs, colour-coded environments, directory bookmarks, command palette (`Ctrl+K`), and light/dark mode.

## Screenshots

![Ferry file browser](assets/files.jpg)

![Folder synchronization](assets/sync.jpg)

![Resource monitor](assets/monitor.jpg)

| Connection settings | Appearance settings |
|---|---|
| ![Connections](assets/connection.jpg) | ![Appearance](assets/settings.jpg) |

## Download & Install

Requires **Windows 10 or Windows 11 (64-bit)**. Choose whichever installation channel fits your workflow:

1. **Microsoft Store (Recommended)** — [Get Ferry from Microsoft Store](https://apps.microsoft.com/detail/9PJPWK568P53) (or open directly via [`ms-windows-store://pdp/?productid=9PJPWK568P53`](ms-windows-store://pdp/?productid=9PJPWK568P53))
   - 1-click Store-trusted install with **no Windows SmartScreen warning** and automatic Store updates.
2. **Direct Windows Installer (`Ferry-Setup-*.exe`)** — [Download from GitHub Releases](../../releases/latest)
   - Lightweight (~23 MB) NSIS installer with built-in automatic updates from this repository.
   - *Note:* The direct `.exe` installer is currently unsigned, so Windows SmartScreen may ask you to confirm (`More info` → `Run anyway`) on first run. Prefer the Microsoft Store build if you want a signed install.
3. **Portable ZIP (`Ferry-Portable-*-win-x64.zip`)** — [Download from GitHub Releases](../../releases/latest)
   - Zero-install archive for jump boxes, restricted workstations, or USB drives.

<details>
<summary>Upgrading from legacy versions (v0.18.0 or earlier)</summary>

Updates are delivered through this repository's GitHub Releases (`ThienNg65/ferry-release`). Existing users of `v0.18.0` or earlier should install the latest release from [GitHub Releases](../../releases/latest) or the [Microsoft Store](https://apps.microsoft.com/detail/9PJPWK568P53) so future update checks point to `ferry-release`.

</details>

## Support

Use [GitHub Issues](../../issues) for bugs and feature requests. Do not include passwords, private keys, or sensitive server details in issue reports.

## License

See [LICENSE](LICENSE). Historical source releases were distributed under the MIT License; downloading an installer does not change rights already granted to earlier source releases.

---
Built and maintained by [ThienNg65](https://github.com/ThienNg65).
