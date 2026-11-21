# Ferry Companion

**Ferry Companion** (*"A little friend who knows your workspace"*) is an optional, lazy-loaded in-app guide that explains new releases, helps you discover features, assists with troubleshooting, and drafts privacy-checked issue reports without leaving Ferry.

## Opening & Placement

- **Top Bar:** Click the Ferry Companion icon next to `Search (Ctrl+K)` in the top bar (always available whether connected or on the Site Manager screen).
- **Dock Companion:** When connected to a server, a matching Companion avatar also appears in the bottom/right dock header and collapsed right rail. You can hide the dock avatar anytime while keeping the top-bar icon.
- **Keyboard Shortcut:** Press `Ctrl+Space` (ignored inside the embedded terminal and text inputs) or open Command Palette (`Ctrl+K`) → **Open Ferry Companion**. Press `Esc` to close and return focus to your previous task.

## What Works Completely Offline (No AI Required)

1. **Conversational What's New:** After a genuine version upgrade, Ferry Companion shows a single non-blocking notice with highlights from the official `ThienNg65/ferry-release` channel (and falls back cleanly to bundled release notes when offline). Same-version relaunches and rollbacks never trigger false update notices.
2. **Guided 4-Step Tour & Feature Shortcuts:** Walk through Site Manager, File Visibility Filters, Transfers/Log Tail/Terminal, and Command Palette with safe, non-destructive navigation buttons.
3. **Smarter Error Troubleshooting:** Optional, rate-limited help when a transfer fails, classifying common SFTP/SSH errors (permissions, disk space, timeouts, host-key mismatch, broken symlinks, auth) into non-destructive diagnostic checklists.
4. **Guided Issue & Feedback Reporting:** Draft Bug Reports, Feature Suggestions, or Feedback with automatic redaction of private keys, tokens, passwords, `user@host`, IPv4/IPv6 addresses, and local user profile paths. Every draft goes through a **Privacy Review** preview before opening a prefilled issue on `ThienNg65/ferry-release` in your browser (no write tokens are shipped in Ferry).

## Controls & Quiet Mode

Manage preferences from the slider button inside the Companion header or in **Settings → Appearance → Ferry Companion**:

- **Quiet Mode:** Mutes all proactive bubbles, daily greetings, and transfer-error tips while keeping Companion available on click.
- **Show Companion in dock:** Toggles the dock avatar independently of the top-bar icon.
- **Release announcements:** Toggles one-time post-update What's New notices.
- **Contextual tips:** Toggles once-per-day greetings and optional transfer-error help.

## Optional AI Provider (Off by Default)

Ferry Companion never sends chat messages to an external AI service unless you explicitly configure a provider under **Settings → Appearance → Ferry Companion → Optional AI provider**:

- Supports **Ollama (Local)** (`http://localhost` / loopback or `https://`) and **OpenAI-compatible** (`https://` or loopback).
- API keys are encrypted at rest via the OS secret store (`AppSettingsStore`) and are never returned in plaintext to the UI.
- Before sending any fallback prompt to a configured provider, Ferry automatically redacts sensitive patterns and includes only minimal non-sensitive app context (app version, connected status, theme) — **never** file contents, credentials, hostnames, or terminal output.
- Companion never executes remote shell commands or mutates files on your behalf.
