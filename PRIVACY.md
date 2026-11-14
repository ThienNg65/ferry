# Privacy Policy for Ferry

**Effective Date:** 2026-11-14  
**Policy Version:** 1.0  
**Maintainer / Data Controller:** ThienNg65  
**Contact:** [GitHub Issues](https://github.com/ThienNg65/ferry/issues) · [GitHub Security Advisories](https://github.com/ThienNg65/ferry/security)

Ferry is a free, open-source (MIT-licensed), local-first Windows desktop SFTP/SSH client. We do not operate backend servers, user accounts, analytics, or advertising networks.

## 1. Data We Do Not Collect

Ferry does **not**:
- Collect, transmit, or sell personal data, usage telemetry, crash reports, or behavioral analytics.
- Use HTTP cookies, advertising identifiers, or third-party tracking SDKs. (The application UI enforces a strict `default-src 'self'` Content Security Policy.)
- Require user accounts, collect emails, or send marketing communications.
- Process payments, subscriptions, or financial information.
- Use AI models or send any user data or files for AI training.
- Knowingly collect personal information from anyone, including children under 13 (or the applicable age of digital consent).

## 2. Data Stored Locally on Your Device

All Ferry configuration and state is stored **exclusively on your local Windows machine** under your OS user data directory (`%APPDATA%\Ferry`) and WebView `localStorage`:

| Data | Storage Location | Purpose | Protection |
|---|---|---|---|
| Saved Sites & Proxy Settings | `sites.json`, `app-settings.json` | Store hostnames, ports, usernames, key paths, and preferences | Passwords and key passphrases are encrypted at rest using Windows DPAPI (`CryptProtectData`) and never leave the local backend process decrypted |
| Transfer & Operation History | `history.json` | Show recent transfers/operations in History | Capped at 2,000 entries and subject to your configured retention limit (default: 90 days) |
| Trusted SSH Host Keys | `known_hosts.json` | Trust-on-first-use SSH host-key verification | Local SHA-256 fingerprints; manageable/deletable in Settings |
| Directory Bookmarks | `bookmarks.json` | Quick navigation to saved folders | Local JSON |
| UI & Window Preferences | WebView `localStorage` | Theme, accent color, column layout, pane width, window bounds | Local browser storage only |
| Runtime Diagnostic Log | `neutralinojs.log` | Local Neutralino shell diagnostics | Written locally only |
| Temporary Staging / Edit Files | OS temp directory | Staging OS drag-and-drop uploads and external file edits | Cleaned up after transfer or edit session close |

## 3. Network Connections

Ferry only initiates outbound network connections in two situations:
1. **Your SSH / SFTP / Proxy Connections:** When you connect to a server, Ferry connects directly to the hostnames, jump hosts, or proxies you configure.
2. **Application Update Checks (Optional):** When **Automatically check for updates** is enabled (or when you click **Check for updates**), Ferry fetches `latest.yml` and verified release installers from `https://github.com/ThienNg65/ferry-release/releases/latest/download`. GitHub's standard server logs and [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement) apply to that HTTP request. You can disable automatic update checks at any time in **Settings → Updates & About**.

## 4. Data Retention, Access & Deletion

Because all data is stored locally on your device, you have direct control at all times:
- **Retention Limits:** In **Settings → Privacy & Legal**, you can set the transfer/operation history retention window (`30 days`, `90 days`, `1 year`, or `Unlimited`). Expired entries are pruned automatically.
- **Data Access (Export):** Use **Settings → Privacy & Legal → Export My Data** to export a JSON file containing your local settings, site metadata (excluding passwords/passphrases), bookmarks, known hosts, and history.
- **Data Deletion:** Use **Settings → Privacy & Legal → Delete All Local Data** to permanently erase all saved sites, encrypted credentials, bookmarks, history, known hosts, settings, and UI preferences, or manually delete `%APPDATA%\Ferry`.

## 5. Changes to This Policy

Updates to this Privacy Policy will be published in `PRIVACY.md` with a new Policy Version and Effective Date. Material changes will re-prompt acceptance in the application.
