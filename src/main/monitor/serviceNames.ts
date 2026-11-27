export const CMDLINE_MAX_CHARS = 16384
export const CMDLINE_UI_MAX_CHARS = 180
export const ENRICH_COMMS: readonly string[] = ['java']
export const CMDLINE_ENRICH_MAX = 20

export const GENERIC_JAR_BASENAMES: readonly string[] = ['quarkus-run', 'app', 'application', 'main', 'server']
export const SERVICE_NAME_VERSION_CUT = /-\d.*$/
export const SECRET_WORDS: readonly string[] = ['password', 'passwd', 'secret', 'token', 'key']

export interface ServiceRule {
  description: string
  pattern: RegExp
  stripVersion?: boolean
}

const EXPLICIT_NAME_KEYS = ['SERVICE_NAME', 'quarkus\\.application\\.name', 'spring\\.application\\.name', 'service\\.name', 'app\\.name']
const GENERIC_JARS = GENERIC_JAR_BASENAMES.join('|')
const END = '(?:\\s|$)'
const CLASS_NAME = '(?:[\\w$]+\\.)*([\\w$]+)'

export const DEFAULT_SERVICE_RULES: readonly ServiceRule[] = [
  { description: 'explicit name property', pattern: new RegExp(`\\s-D(?:${EXPLICIT_NAME_KEYS.join('|')})=(\\S+)`) },
  { description: 'service.properties parent dir', pattern: /\s-Dservice\.properties=\S*\/([^/\s]+)\/service\.properties/, stripVersion: true },
  { description: '-jar basename', pattern: new RegExp(`\\s-jar\\s+(?:\\S*/)?(?!(?:${GENERIC_JARS})\\.jar${END})([^/\\s]+)\\.jar${END}`), stripVersion: true },
  { description: '-jar parent dir (generic basename)', pattern: new RegExp(`\\s-jar\\s+\\S*/([^/\\s]+)/[^/\\s]+\\.jar${END}`), stripVersion: true },
  { description: '-m module/Class', pattern: new RegExp(`\\s-m\\s+\\S+/${CLASS_NAME}${END}`) },
  { description: 'main class after -cp', pattern: new RegExp(`\\s-(?:cp|classpath)\\s+\\S+\\s+${CLASS_NAME}${END}`) }
]

const JAVA_COMMAND = /^(?:\S*\/)?java(?:\s|$)/

export function deriveServiceName(cmdline: string, rules: readonly ServiceRule[] = DEFAULT_SERVICE_RULES): string | null {
  if (!JAVA_COMMAND.test(cmdline)) {
    return null
  }
  for (const rule of rules) {
    const raw = rule.pattern.exec(cmdline)?.[1]
    const name = raw && rule.stripVersion ? raw.replace(SERVICE_NAME_VERSION_CUT, '') : raw
    if (name) {
      return name
    }
  }
  return null
}

const OPTION_WITH_VALUE = /(?<=^|\s)(-D|--)([^=\s]+)=\S+/g
const KEY_WORD_BOUNDARY = /[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/

function isSecretKey(key: string): boolean {
  return key.split(KEY_WORD_BOUNDARY).some((word) => SECRET_WORDS.includes(word.toLowerCase()))
}

export function redactCmdline(cmdline: string): string {
  return cmdline.replace(OPTION_WITH_VALUE, (option: string, prefix: string, key: string) =>
    isSecretKey(key) ? `${prefix}${key}=***` : option
  )
}
