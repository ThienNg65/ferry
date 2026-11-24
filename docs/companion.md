# Ferry Companion

**Ferry Companion** (*"A little friend who knows your workspace"*) is an optional, lazy-loaded in-app guide and workspace assistant that explains releases, manages local shell snippets, generates risk-badged commands, diagnoses live logs and resource spikes, and drafts privacy-checked issue reports without leaving Ferry.

## Opening & Placement

- **Top Bar:** Click the Ferry Companion icon next to `Search (Ctrl+K)` in the top bar (always available whether connected or on the Site Manager screen).
- **Dock Companion:** When connected to a server, a matching Companion avatar also appears in the bottom/right dock header and collapsed right rail. You can hide the dock avatar anytime while keeping the top-bar icon.
- **Keyboard Shortcut:** Press `Ctrl+Space` (ignored inside the embedded terminal and text inputs) or open Command Palette (`Ctrl+K`) -> **Open Ferry Companion**. Press `Esc` to close and return focus to your previous task.

## Ferry Starter (Free)

Everything in Starter works completely locally with zero subscription:

1. **Conversational What's New:** After a genuine version upgrade, Ferry Companion shows a single non-blocking notice with highlights from the official `ThienNg65/ferry-release` channel (and falls back cleanly to bundled release notes when offline).
2. **Guided 4-Step Tour & Feature Shortcuts:** Walk through Site Manager, File Visibility Filters, Transfers/Log Tail/Terminal, and Command Palette with safe, non-destructive navigation buttons.
3. **Unlimited Local Snippets & Command History:** Save custom shell snippets or run built-in DevOps commands from the **Snippets** tab with deterministic risk badges (`Read-only`, `Mutating`, `Destructive`) and recent execution history.
4. **Plain-English -> Command Cards:** Ask for a Linux/POSIX command in plain English; Companion returns risk-badged **Command Cards** with explicit **Run in Terminal** confirmation before anything is sent to your SSH PTY.
5. **Unlimited BYO Google Gemini API Key:** Configure your own Google AI Studio Gemini API key under **Settings -> Appearance -> Ferry Companion** (defaulting to `gemini-4-hydrogen` via the zero-retention Gemini Interactions API with `store: false`). Keys are encrypted at rest via the OS secret store (`AppSettingsStore`).
6. **Guided Issue & Feedback Reporting:** Draft Bug Reports, Feature Suggestions, or Feedback with automatic redaction of private keys, common provider tokens, natural-language credentials, hostnames, IP addresses, and absolute paths (`companionPrivacy.ts`), followed by a mandatory **Privacy Review** preview before opening `ThienNg65/ferry-release`.

## Ferry Pro Workspace Features

1. **Managed Ferry Pro AI Proxy:** Connect to a Ferry Pro Proxy endpoint using a DPAPI-encrypted Pro token (company Gemini API keys are never shipped in the desktop binary).
2. **Structured Action Cards (Gemini JSON Schema):** Responses can include risk-badged **Command Cards** and 1-click **UI Action Cards** (`Open in Editor`, `Tail Log`, `Apply File Filter`).
3. **Explain This Log:** Click the sparkle button in the Live Log Tail (`tail -F`) row hover controls or Line Inspector header to automatically redact secrets/IPs/paths and diagnose the log entry.
4. **Diagnose Spike:** Click **Diagnose Spike** in the Resource Monitor toolbar to triage high CPU, memory, swap, load, or disk pressure alongside top processes.
5. **Pre-Flight Safety Guardrails:** Non-blocking safety warnings before uploading sensitive secret files (`.env`, private SSH keys, `.pem`, `.key`, `credentials.json`), uploading to a >= 95% full or insufficient disk, or running a Folder Sync with destination deletions.

> **Ultra, Team, and Enterprise tiers** remain under construction and are not active in this build.

## Controls & Quiet Mode

Manage preferences from the slider button inside the Companion header or in **Settings -> Appearance -> Ferry Companion**:

- **Quiet Mode:** Mutes all proactive bubbles, daily greetings, transfer-error tips, and upload pre-flight prompts while keeping Companion available on click.
- **Show Companion in dock:** Toggles the dock avatar independently of the top-bar icon.
- **Release announcements:** Toggles one-time post-update What's New notices.
- **Contextual tips:** Toggles once-per-day greetings and optional transfer-error help.

## Privacy & Execution Safety

- Before sending any prompt, log snippet, or resource summary to Gemini or Ferry Pro AI, Ferry redacts private keys, common provider tokens, credentials (including natural-language forms), hostnames, IPv4/IPv6 addresses, and absolute paths via `companionPrivacy.ts`.
- Gemini requests explicitly set `store: false` so prompts are not retained in cloud conversation storage.
- Every Command Card undergoes deterministic risk classification (`classifyCommandRisk`), and clicking **Run in Terminal** always requires explicit user confirmation in a modal showing the exact command and target server.
