# Rust migration spike: Phase 0 report (in progress)

Plan: [ferry-tauri-sidecar-migration-plan.md](../plan/ferry-tauri-sidecar-migration-plan.md), Tasks 1–2.
Spike code: `spikes/russh-spike/` (standalone; not part of the app build).
Date: 2026-11-10.

## Verdict so far

| Gate | Result |
|---|---|
| Task 2: Legacy secret decryption (blocks Phase 1) | **PASS.** Auto-migration of saved passwords is viable |
| Task 1: russh capability (informs milestone 2, does not block Phase 1) | **NOT RUN.** Blocked, see below |
| Task 1: HTML5 DnD under Tauri `dragDropEnabled: true` (decides Task 12) | **NOT RUN.** Blocked, see below |

**Go/no-go for Phase 1:** go. The one hard gate (secret decryption) passed.
**Go/no-go for russh (milestone 2):** pending.

## Task 2: Legacy secret decryption: PASS

- userData folder: `%APPDATA%\ferry` (lowercase on disk; Windows paths are case-insensitive, so `%APPDATA%\Ferry` resolves to the same folder).
- `Local State` → `os_crypt.encrypted_key` is base64 of `"DPAPI"` + a DPAPI blob. `CryptUnprotectData` (CurrentUser) returns a **32-byte** AES key.
- Every saved secret in `sites.json` has the prefix **`v10`** (no app-bound `v20`). Layout confirmed as `v10` | 12-byte nonce | AES-256-GCM ciphertext | 16-byte tag.
- Result on the real user data (plaintext never printed):

```
key: 32 bytes after DPAPI unwrap
site#0 secretPassword: prefix v10, ok, 10 bytes
site#1 secretPassword: prefix v10, ok, 10 bytes
site#2 secretPassword: prefix v10, ok, 12 bytes
site#3 secretPassword: prefix v10, ok, 17 bytes
decrypted 4, failed 0
```

- How it was run: `unwrap-key.ps1` (PowerShell, `ProtectedData.Unprotect` = DPAPI) piped into `decrypt-legacy.mjs` (Node `aes-256-gcm`). This is the exact algorithm the plan's Task 5 (`secretBox.ts`, Node) and Task 9 (`secret_key.rs`, Rust DPAPI unwrap) implement. The Rust version of the same code is in `spikes/russh-spike/src/main.rs` (`decrypt-legacy` subcommand) but couldn't be linked on this machine (see Blockers).
- Not covered: `secretPassphrase` (no saved site uses one) and `app-settings.json` `defaultProxy` (none saved). Both use the same `encrypt()` helper, so the same format applies.

## Task 1: russh scenarios: NOT RUN

The code for every scenario is written and type-checked against the russh 0.65.1 / russh-sftp 3.0.1 sources
(`spikes/russh-spike/src/main.rs`: `password`, `kbdint`, `key`, `agent pageant|pipe`, `jump` (2 hops via
`channel_open_direct_tcpip` + `connect_stream`), `sftp` (readdir + timed download), `tail` (`exec tail -F` streaming)).
API findings from the sources:

| Capability | russh 0.65.1 support |
|---|---|
| Password, public key (ed25519/RSA with SHA-2 negotiation) | `authenticate_password`, `authenticate_publickey` + `best_supported_rsa_hash` |
| Keyboard-interactive, N prompts × N rounds | `authenticate_keyboard_interactive_start/_respond` returning `InfoRequest { prompts }`. Maps 1:1 onto `keyboardInteractive.ts`'s partition/merge flow |
| Pageant | `AgentClient::connect_pageant()` (Windows-only `pageant` dependency) |
| Windows OpenSSH agent | `AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")` |
| Jump chain | `channel_open_direct_tcpip` → `Channel::into_stream()` → `client::connect_stream` (any hop count) |
| Proxy (SOCKS5/HTTP CONNECT) for hop 0 | `connect_stream` accepts any `AsyncRead + AsyncWrite` stream, so the existing proxy logic ports as a stream adapter |
| exec / shell / PTY | `Channel::exec`, `request_pty`, `request_shell`, `ChannelMsg::{Data, ExitStatus}` |
| SFTP | `russh_sftp::client::SftpSession` over `request_subsystem("sftp")` |

These are API findings, not runtime evidence. The go/no-go needs the runs.

## Blockers

1. **No MSVC Build Tools on this machine.** `rustup` has `stable-x86_64-pc-windows-msvc`, but there is no `link.exe` or Windows SDK (no Visual Studio install, no `vswhere`). No Rust crate links, including the Tauri app in Phase 1C. **Fix:** install "Visual Studio 2022 Build Tools" with the *Desktop development with C++* workload (needs admin). The GitHub `windows-latest` runner already has it, so CI isn't affected.
2. **Docker daemon stopped mid-spike.** Rancher Desktop was running, the test container `ferry-test-sftp` was created from `linuxserver/openssh-server`, then the daemon went away (`//./pipe/docker_engine` missing). **Fix:** start Rancher Desktop. The container then needs only `docker start ferry-test-sftp` plus the prep below.

## To finish the spike (once both blockers are cleared)

```bash
# container prep (key auth, 100 MB file, tail target)
ssh-keygen -q -t ed25519 -N "" -f spikes/russh-spike/spike_ed25519 -C spike
docker cp spikes/russh-spike/spike_ed25519.pub ferry-test-sftp:/tmp/k.pub
docker exec ferry-test-sftp sh -c "mkdir -p /config/ferry-test /config/.ssh && cat /tmp/k.pub >> /config/.ssh/authorized_keys && head -c 104857600 /dev/urandom > /config/ferry-test/big.bin && touch /config/ferry-test/spike.log && chown -R ferrytest:users /config/ferry-test /config/.ssh && chmod 600 /config/.ssh/authorized_keys"

# scenarios
cd spikes/russh-spike && cargo build --release
target/release/russh-spike password
target/release/russh-spike kbdint
target/release/russh-spike key spike_ed25519
target/release/russh-spike agent pipe     # or: agent pageant (manual: start the agent and load the key first)
target/release/russh-spike jump
target/release/russh-spike sftp /config/ferry-test/big.bin big.bin
target/release/russh-spike tail
target/release/russh-spike decrypt-legacy "%APPDATA%\ferry"
```

Still to do after that: the `ssh2` baseline timing of the same 100 MB download, and the 30-line Tauri app for the HTML5 drag-and-drop check (needs blocker 1 cleared and a human to perform the drag).
