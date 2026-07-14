/** One challenge in a keyboard-interactive auth round, as ssh2 hands it to the client event. */
export interface KiPrompt {
  prompt: string
  echo?: boolean
}

/** A prompt that couldn't be auto-answered and needs the user (index preserved from the original `prompts` array). */
export interface UnresolvedPrompt {
  index: number
  prompt: string
  echo: boolean
}

/** Result of splitting a keyboard-interactive round into what we can answer ourselves vs. what needs the user. */
export interface PartitionedPrompts {
  autoAnswered: Map<number, string>
  needsUser: UnresolvedPrompt[]
}

/**
 * Splits a keyboard-interactive prompt round into auto-answerable prompts
 * (anything that just re-asks for the password we already have — the common
 * case, since many servers route plain password auth through
 * keyboard-interactive under PAM) and everything else (a real 2FA/OTP
 * challenge), which the caller must forward to the user instead of blindly
 * replaying the password into it.
 */
export function partitionPrompts(prompts: KiPrompt[], password: string | undefined): PartitionedPrompts {
  const autoAnswered = new Map<number, string>()
  const needsUser: UnresolvedPrompt[] = []
  prompts.forEach((p, index) => {
    if (password !== undefined && /password/i.test(p.prompt)) {
      autoAnswered.set(index, password)
    } else {
      needsUser.push({ index, prompt: p.prompt, echo: p.echo ?? false })
    }
  })
  return { autoAnswered, needsUser }
}

/** Recombines auto-answered and user-supplied answers back into the original prompt order ssh2's `finish()` expects. */
export function mergeAnswers(
  promptCount: number,
  autoAnswered: Map<number, string>,
  needsUser: UnresolvedPrompt[],
  userAnswers: string[]
): string[] {
  const byIndex = new Map(autoAnswered)
  needsUser.forEach((p, i) => byIndex.set(p.index, userAnswers[i] ?? ''))
  return Array.from({ length: promptCount }, (_v, index) => byIndex.get(index) ?? '')
}
