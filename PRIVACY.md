# Privacy Policy for Ferry

**Effective Date:** 2026-11-28  
**Policy Version:** 1.2  
**Maintainer / Data Controller:** ThienNg65  
**Contact:** [GitHub Issues](https://github.com/ThienNg65/ferry/issues) · [GitHub Security Advisories](https://github.com/ThienNg65/ferry/security)

Ferry is a free, open-source (MIT-licensed), local-first desktop SFTP/SSH client for Windows and macOS. By default, Ferry operates entirely locally without user accounts, analytics, or advertising networks.

## 1. Data We Do Not Collect

Ferry does **not**:
- Collect, transmit, or sell personal data, usage telemetry, crash reports, or behavioral analytics.
- Use HTTP cookies, advertising identifiers, or third-party tracking SDKs. (The application UI enforces a strict `default-src 'self'` Content Security Policy.)
- Require user accounts, collect emails, or send marketing communications.
- Send any user data, credentials, or files for AI model training.
- Knowingly collect personal information from anyone, including children under 13 (or the applicable age of digital consent).

## 2. Data Stored Locally on Your Device

All Ferry configuration and state is stored **exclusively on your local machine** under your OS user data directory and WebView `localStorage`. On Windows this is `%APPDATA%\Ferry`. On macOS (including the Mac App Store build, which runs in the App Sandbox) it is the app's `Application Support` folder inside its sandbox container (`~/Library/Containers/js.ferry.app/Data/Library/Application Support/Ferry`):

| Data | Storage Location | Purpose | Protection |
|---|---|---|---|
| Saved Sites, Proxy & Companion AI Settings | `sites.json`, `app-settings.json` | Store hostnames, ports, usernames, key paths, preferences, and optional Companion AI provider configuration | Passwords, key passphrases, and optional Companion AI API keys/tokens are encrypted at rest using a master key protected by Windows DPAPI (`CryptProtectData`) on Windows or the macOS Keychain on macOS, and never leave the local backend process decrypted |
| Transfer & Operation History | `history.json` | Show recent transfers/operations in History | Capped at 2,000 entries and subject to your configured retention limit (default: 90 days) |
| Trusted SSH Host Keys | `known_hosts.json` | Trust-on-first-use SSH host-key verification | Local SHA-256 fingerprints; manageable/deletable in Settings |
| Directory Bookmarks | `bookmarks.json` | Quick navigation to saved folders | Local JSON |
| UI & Window Preferences | WebView `localStorage` | Theme, accent color, column layout, pane width, window bounds, local Companion snippets/history | Local browser storage only |
| Runtime Diagnostic Log | `neutralinojs.log` | Local Neutralino shell diagnostics | Written locally only |
| Temporary Staging / Edit Files | OS temp directory | Staging OS drag-and-drop uploads and external file edits | Cleaned up after transfer or edit session close |

## 3. Network Connections

Ferry initiates outbound network connections only in the following situations:
1. **Your SSH / SFTP / Proxy Connections:** When you connect to a server, Ferry connects directly to the hostnames, jump hosts, or proxies you configure.
2. **Application Update & Release Notes Checks (Optional, Windows direct download only):** Builds distributed through the Microsoft Store or the Mac App Store do not check GitHub for updates; the store delivers them. When **Automatically check for updates** is enabled (or when you explicitly click **Check for updates** or **Refresh** in Companion's What's New tab), Ferry fetches update metadata (`latest.yml`) and release notes from `https://github.com/ThienNg65/ferry-release` and `https://api.github.com/repos/ThienNg65/ferry-release/releases`. GitHub's standard server logs and [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement) apply to those HTTP requests. You can disable automatic update checks at any time in **Settings → Updates & About**.
3. **Optional BYO Google Gemini API (Opt-In):** Companion AI is disabled (`Off`) by default. If you choose **Google Gemini (BYO Key)** in **Settings → Appearance → Ferry Companion**, prompts and bounded workspace diagnostic context are redacted locally on your device (stripping passwords, tokens, private keys, and IP addresses) before being sent directly from your machine to your configured Google Gemini API endpoint with `store: false` requested. Google's API terms and privacy policy govern requests sent with your own API key.
4. **Optional Ferry Pro Managed Proxy (Opt-In):** If you choose **Ferry Pro Managed AI** and configure a Ferry Pro proxy URL and license token, locally redacted Companion prompts are routed through that proxy endpoint to fulfill your request. No prompt data is sent unless you explicitly opt in and submit a Companion query.

## 4. Data Retention, Access & Deletion

Because all data is stored locally on your device, you have direct control at all times:
- **Retention Limits:** In **Settings → Privacy & Legal**, you can set the transfer/operation history retention window (`30 days`, `90 days`, `1 year`, or `Unlimited`). Expired entries are pruned automatically.
- **Data Access (Export):** Use **Settings → Privacy & Legal → Export My Data** to export a JSON file containing your local settings, site metadata (excluding passwords/passphrases), bookmarks, known hosts, and history.
- **Data Deletion:** Use **Settings → Privacy & Legal → Delete All Local Data** to permanently erase all saved sites, encrypted credentials, bookmarks, history, known hosts, settings, and UI preferences, or manually delete `%APPDATA%\Ferry` (Windows) or the `Ferry` folder in the app's `Application Support` container (macOS).

### macOS sandbox note
The Mac App Store build runs in the App Sandbox. Ferry can read or write local folders and SSH key files only after you select them in a system file dialog; it does not scan your disk or `~/.ssh` in the background.

## 5. Changes to This Policy

Updates to this Privacy Policy will be published in `PRIVACY.md` with a new Policy Version and Effective Date. Material changes will re-prompt acceptance in the application.
