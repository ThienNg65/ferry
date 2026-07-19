/**
 * Pre-flight probe of an SSH agent's reachability and loaded-identity count.
 *
 * Uses `ssh2`'s own exported `createAgent(path)` — the exact same dispatch
 * (`pageant` literal -> `PageantAgent`, a non-pipe path on Windows ->
 * `CygwinAgent`, otherwise `OpenSSHAgent`) that `Client.connect({ agent })`
 * uses internally — so a passing probe here reflects the real agent Ferry
 * will connect through, not a parallel reimplementation that could drift.
 *
 * Dynamically imports `ssh2` (a heavy module with a native optional dep) so
 * this file doesn't pull it onto the app-startup path — same reasoning as
 * `SessionManager.connect()`'s own lazy `import('ssh2')`.
 */
export async function probeAgent(agentPath: string): Promise<{ identityCount: number }> {
  const { createAgent } = await import('ssh2')
  return new Promise((resolve, reject) => {
    let agent
    try {
      agent = createAgent(agentPath as string | 'pageant')
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    agent.getIdentities((err, keys) => {
      if (err) {
        reject(err)
        return
      }
      resolve({ identityCount: keys?.length ?? 0 })
    })
  })
}

const GENERIC_AUTH_FAILURE = /all configured authentication methods failed/i

/**
 * Rewrites ssh2's generic "all auth methods failed" message into an
 * actionable one when the failing method was agent auth — otherwise this
 * failure is indistinguishable from a wrong password or bad key file.
 */
export function rewriteAgentAuthError(message: string, identityCount: number): string {
  if (!GENERIC_AUTH_FAILURE.test(message)) {
    return message
  }
  return (
    `The SSH agent offered ${identityCount} key${identityCount === 1 ? '' : 's'} but the ` +
    'server rejected all of them — is the matching public key in the server\'s authorized_keys?'
  )
}
