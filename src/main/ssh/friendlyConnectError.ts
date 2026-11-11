const RULES: Array<[RegExp, (host: string, port: number) => string]> = [
  [/All configured authentication methods failed|Authentication failed/i, () => 'Wrong username, password or key'],
  [/ECONNREFUSED/, (h, p) => `Nothing is listening on ${h}:${p}`],
  [/ENOTFOUND|EAI_AGAIN/, (h) => `Host not found: ${h}`],
  [/EHOSTUNREACH|ENETUNREACH/, (h) => `${h} is unreachable`],
  [/ETIMEDOUT|Timed out while waiting for handshake/i, (h, p) => `Connection to ${h}:${p} timed out`]
]

export function friendlyConnectError(message: string, host: string, port: number): string {
  const rule = RULES.find(([re]) => re.test(message))
  return rule ? `${rule[1](host, port)} (${message})` : message
}
