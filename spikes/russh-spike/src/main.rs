//! Throwaway spike for .claude/plan/ferry-tauri-sidecar-migration-plan.md Phase 0.
//! Each subcommand proves one capability against the Docker test container
//! (see src/main/ssh/RemoteShell.integration.test.ts header). Not part of the app.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use russh::client::{self, AuthResult, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::agent::client::AgentClient;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::ChannelMsg;
use russh_sftp::client::SftpSession;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 2299;
const INNER_PORT: u32 = 2222; // the container's own sshd, only reachable from inside it
const USER: &str = "ferrytest";
const PASS: &str = "ferrytest123";

struct Accept;
impl client::Handler for Accept {
    type Error = russh::Error;
    // shortcut: trusts every host key; the real port keeps KnownHostsStore TOFU.
    async fn check_server_key(&mut self, _k: &PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn config() -> Arc<client::Config> {
    Arc::new(client::Config { inactivity_timeout: Some(Duration::from_secs(30)), ..Default::default() })
}

async fn connect() -> Result<Handle<Accept>> {
    Ok(client::connect(config(), (HOST, PORT), Accept).await?)
}

fn ok(r: AuthResult) -> Result<()> {
    match r {
        AuthResult::Success => Ok(()),
        AuthResult::Failure { remaining_methods, .. } => bail!("auth failed, server offers {remaining_methods:?}"),
    }
}

async fn password(h: &mut Handle<Accept>) -> Result<()> {
    ok(h.authenticate_password(USER, PASS).await?)
}

/// Answers every prompt of every round, the same shape as keyboardInteractive.ts's loop.
async fn kbdint(h: &mut Handle<Accept>) -> Result<usize> {
    let mut resp = h.authenticate_keyboard_interactive_start(USER, None).await?;
    let mut rounds = 0;
    loop {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(rounds),
            KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. } => {
                bail!("kbd-int failed after {rounds} rounds, server offers {remaining_methods:?}")
            }
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                rounds += 1;
                println!("  round {rounds}: {} prompt(s) {:?}", prompts.len(), prompts.iter().map(|p| &p.prompt).collect::<Vec<_>>());
                let answers = prompts.iter().map(|_| PASS.to_string()).collect();
                resp = h.authenticate_keyboard_interactive_respond(answers).await?;
            }
        }
    }
}

async fn key(h: &mut Handle<Accept>, path: &str) -> Result<()> {
    let k = load_secret_key(path, None).context("load key")?;
    let hash = h.best_supported_rsa_hash().await?.flatten();
    ok(h.authenticate_publickey(USER, PrivateKeyWithHashAlg::new(Arc::new(k), hash)).await?)
}

async fn agent(h: &mut Handle<Accept>, which: &str) -> Result<()> {
    let mut a = match which {
        "pageant" => AgentClient::connect_pageant().await?.dynamic(),
        _ => AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await?.dynamic(),
    };
    let ids = a.request_identities().await?;
    println!("  agent has {} identities", ids.len());
    for id in ids {
        let pk = id.public_key().into_owned();
        if let AuthResult::Success = h.authenticate_publickey_with(USER, pk, None, &mut a).await? {
            return Ok(());
        }
    }
    bail!("no agent identity accepted")
}

async fn exec(h: &Handle<Accept>, cmd: &str) -> Result<(String, u32)> {
    let mut ch = h.channel_open_session().await?;
    ch.exec(true, cmd).await?;
    let (mut out, mut code) = (Vec::new(), 0);
    while let Some(m) = ch.wait().await {
        match m {
            ChannelMsg::Data { data } => out.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => code = exit_status,
            _ => {}
        }
    }
    Ok((String::from_utf8_lossy(&out).into_owned(), code))
}

/// Opens a second SSH session through `via` to the container's inner sshd.
async fn hop(via: &Handle<Accept>) -> Result<Handle<Accept>> {
    let ch = via.channel_open_direct_tcpip("127.0.0.1", INNER_PORT, "127.0.0.1", 0).await?;
    let mut h = client::connect_stream(config(), ch.into_stream(), Accept).await?;
    password(&mut h).await?;
    Ok(h)
}

async fn sftp(h: &Handle<Accept>, remote: &str, local: &str) -> Result<()> {
    let ch = h.channel_open_session().await?;
    ch.request_subsystem(true, "sftp").await?;
    let s = SftpSession::new(ch.into_stream()).await?;
    let n = s.read_dir("/config/ferry-test").await?.count();
    println!("  readdir /config/ferry-test: {n} entries");
    let t = Instant::now();
    let mut f = s.open(remote).await?;
    let mut out = tokio::fs::File::create(local).await?;
    let bytes = tokio::io::copy(&mut f, &mut out).await?;
    let secs = t.elapsed().as_secs_f64();
    println!("  download {bytes} bytes in {secs:.2}s = {:.1} MB/s", bytes as f64 / secs / 1e6);
    Ok(())
}

async fn tail(h: &Handle<Accept>) -> Result<()> {
    let mut ch = h.channel_open_session().await?;
    ch.exec(true, "tail -n 0 -F /config/ferry-test/spike.log").await?;
    let writer = connect_auth().await?;
    tokio::spawn(async move {
        for i in 1..=3 {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = exec(&writer, &format!("echo line-{i} >> /config/ferry-test/spike.log")).await;
        }
    });
    let mut got = String::new();
    let deadline = tokio::time::sleep(Duration::from_secs(5));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            m = ch.wait() => match m {
                Some(ChannelMsg::Data { data }) => {
                    got.push_str(&String::from_utf8_lossy(&data));
                    if got.contains("line-3") { break; }
                }
                None => break,
                _ => {}
            }
        }
    }
    ch.close().await.ok();
    println!("  streamed: {:?}", got.lines().collect::<Vec<_>>());
    if !got.contains("line-3") {
        bail!("did not receive all 3 lines");
    }
    Ok(())
}

async fn connect_auth() -> Result<Handle<Accept>> {
    let mut h = connect().await?;
    password(&mut h).await?;
    Ok(h)
}

/// Chromium os_crypt (Windows): Local State os_crypt.encrypted_key = base64("DPAPI" + DPAPI blob of a
/// 32-byte AES key); each secret = base64("v10" + 12-byte nonce + AES-256-GCM ciphertext + 16-byte tag).
fn decrypt_legacy(dir: &str) -> Result<()> {
    use aes_gcm::aead::{Aead, KeyInit};
    use base64::{engine::general_purpose::STANDARD as B64, Engine};

    let state: serde_json::Value = serde_json::from_slice(&std::fs::read(format!("{dir}\\Local State"))?)?;
    let wrapped = B64.decode(state["os_crypt"]["encrypted_key"].as_str().ok_or(anyhow!("no os_crypt.encrypted_key"))?)?;
    let blob = wrapped.strip_prefix(b"DPAPI").ok_or(anyhow!("encrypted_key lacks DPAPI prefix"))?;
    let key = dpapi_unprotect(blob)?;
    println!("  key: {} bytes after DPAPI unwrap", key.len());
    let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key).map_err(|e| anyhow!("{e}"))?;

    let sites: serde_json::Value = serde_json::from_slice(&std::fs::read(format!("{dir}\\sites.json"))?)?;
    let (mut good, mut bad) = (0, 0);
    for (i, s) in sites["sites"].as_array().into_iter().flatten().enumerate() {
        for field in ["secretPassword", "secretPassphrase"] {
            let Some(c) = s[field].as_str() else { continue };
            let raw = B64.decode(c)?;
            let prefix = String::from_utf8_lossy(&raw[..3]).into_owned();
            let res = raw
                .strip_prefix(b"v10")
                .ok_or(anyhow!("prefix {prefix}"))
                .and_then(|r| cipher.decrypt(r[..12].into(), &r[12..]).map_err(|_| anyhow!("GCM tag mismatch")));
            // Never print the plaintext: length + ok only.
            match res {
                Ok(p) => { good += 1; println!("  site#{i} {field}: prefix {prefix}, ok, {} chars", p.len()) }
                Err(e) => { bad += 1; println!("  site#{i} {field}: prefix {prefix}, FAILED: {e}") }
            }
        }
    }
    println!("  decrypted {good}, failed {bad}");
    if good == 0 || bad > 0 {
        bail!("legacy decryption not fully working");
    }
    Ok(())
}

fn dpapi_unprotect(blob: &[u8]) -> Result<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: blob.len() as u32, pbData: blob.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut out)?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        Ok(v)
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
    match arg(0).as_str() {
        "password" => {
            let h = connect_auth().await?;
            println!("  exec: {:?}", exec(&h, "echo hello-from-russh").await?);
        }
        "kbdint" => {
            let mut h = connect().await?;
            println!("  rounds: {}", kbdint(&mut h).await?);
        }
        "key" => {
            let mut h = connect().await?;
            key(&mut h, &arg(1)).await?;
            println!("  exec: {:?}", exec(&h, "whoami").await?);
        }
        "agent" => {
            let mut h = connect().await?;
            agent(&mut h, &arg(1)).await?;
        }
        "jump" => {
            let hop1 = connect_auth().await?;
            let hop2 = hop(&hop1).await?;
            let target = hop(&hop2).await?;
            println!("  exec via 2 hops: {:?}", exec(&target, "echo via-two-hops").await?);
        }
        "sftp" => sftp(&connect_auth().await?, &arg(1), &arg(2)).await?,
        "tail" => tail(&connect_auth().await?).await?,
        "decrypt-legacy" => decrypt_legacy(&arg(1))?,
        other => bail!("unknown scenario {other:?}"),
    }
    println!("PASS");
    Ok(())
}
