import { describe, expect, it } from 'vitest'
import { parseProcessCmdlines } from './procParse'
import { CMDLINE_MAX_CHARS, deriveServiceName, redactCmdline } from './serviceNames'

const JAVA = '/usr/lib/jvm/jdk-25/bin/java'
const MANY_JARS = '/libs/x.jar:'.repeat(1000)

const CASES: Array<[string, string, string | null]> = [
  ['SERVICE_NAME wins and keeps its value verbatim', `${JAVA} -Xmx512m -DSERVICE_NAME=ch-ui -jar /opt/x/ch-ui-2.6.13.jar -p 40000`, 'ch-ui'],
  ['empty SERVICE_NAME falls through to the jar', `${JAVA} -DSERVICE_NAME= -jar /x/y-1.jar`, 'y'],
  ['quarkus.application.name beats the jar', `${JAVA} -Dquarkus.application.name=billing -jar /opt/apps/x-1.0.jar`, 'billing'],
  ['spring.application.name beats the jar', `${JAVA} -Dspring.application.name=orders -jar /opt/apps/x-1.0.jar`, 'orders'],
  ['service.name beats the jar', `${JAVA} -Dservice.name=pay -jar /opt/apps/x-1.0.jar`, 'pay'],
  ['app.name beats the jar', `${JAVA} -Dapp.name=ledger -jar /opt/apps/x-1.0.jar`, 'ledger'],
  [
    'service.properties parent dir names a quarkus service',
    `${JAVA} -Dservice.properties=/opt/x/fi-bank-service-1.2.26/service.properties -jar /opt/x/fi-bank-service-1.2.26/quarkus-run.jar`,
    'fi-bank-service'
  ],
  ['generic quarkus-run.jar falls back to the parent dir', `${JAVA} -Xmx1g -jar /opt/x/fi-bank-service-1.2.26/quarkus-run.jar`, 'fi-bank-service'],
  ['generic app.jar falls back to the parent dir', `${JAVA} -jar /opt/apps/app.jar`, 'apps'],
  [
    'relative jar path, version and SNAPSHOT cut',
    `${JAVA} -Dlogback.configurationFile=temp/ch-app-2.48.15-SNAPSHOT/logback.xml -jar temp/ch-app-2.48.15-SNAPSHOT/ch-app-2.48.15-SNAPSHOT.jar --external-resources`,
    'ch-app'
  ],
  ['jar without a version', `${JAVA} -jar /opt/apps/billing.jar`, 'billing'],
  ['main class after -cp', `${JAVA} -cp /lib/a.jar:/lib/b.jar com.acme.orders.OrderMain arg`, 'OrderMain'],
  ['10 KB classpath still finds the main class', `${JAVA} -Xmx1G -cp ${MANY_JARS} kafka.Kafka /etc/server.properties`, 'Kafka'],
  ['module launch', `${JAVA} -m org.elasticsearch.server/org.elasticsearch.bootstrap.Elasticsearch`, 'Elasticsearch'],
  ['non-java process', 'nginx: master process /usr/sbin/nginx', null],
  ['-jar as last token', `${JAVA} -jar`, null],
  ['jar path with spaces gives no garbage name', `${JAVA} -jar /opt/my apps/x-1.0.jar`, null],
  ['non-java process that mentions -jar', 'python run.py -jar /x/y-1.jar', null]
]

describe('deriveServiceName', () => {
  it.each(CASES)('%s', (_description, cmdline, expected) => {
    expect(deriveServiceName(cmdline)).toBe(expected)
  })

  it('uses only the rules it is given (no names built into the engine)', () => {
    expect(deriveServiceName(`${JAVA} -Dfoo=bar`, [{ description: 'test', pattern: /\s-Dfoo=(\S+)/ }])).toBe('bar')
    expect(deriveServiceName(`${JAVA} -DSERVICE_NAME=ch-ui`, [])).toBeNull()
  })
})

const SECRET_OPTIONS = [
  '-Dfoo.password=abc',
  '-Dclient.secret=x',
  '-DFP_APP_KEY=zzz',
  '-Dpassword=hunter2',
  '-DPASSWORD=x',
  '-Dtoken=abc',
  '-Dsecret=x',
  '-Dkey=x',
  '-Djavax.net.ssl.keyStorePassword=changeit',
  '-Djavax.net.ssl.trustStorePassword=changeit',
  '-DdbPassword=abc',
  '-DapiKey=abc',
  '-Daws.secretKey=AKIA',
  '--spring.datasource.password=s'
]

const PLAIN_OPTIONS = [
  '-Dquarkus.http.port=80',
  '-Dkeycloak.client.access.user-name=kcadmin',
  '-Dmonkey.name=bobo',
  '-cp /libs/jackson-databind-2.21.7.jar:/libs/x.jar'
]

describe('redactCmdline', () => {
  it.each(SECRET_OPTIONS)('masks the value of %s', (option) => {
    const key = option.slice(0, option.indexOf('=') + 1)
    expect(redactCmdline(`java ${option} -Dquarkus.http.port=80`)).toBe(`java ${key}*** -Dquarkus.http.port=80`)
  })

  it.each(PLAIN_OPTIONS)('leaves %s untouched', (option) => {
    expect(redactCmdline(`java ${option}`)).toBe(`java ${option}`)
  })

  it('redacts a 12 KB classpath line quickly', () => {
    const line = `java -cp ${'/libs/jackson-databind-2.21.7.jar:'.repeat(350)} kafka.Kafka`
    const start = performance.now()
    for (let i = 0; i < 300; i++) {
      redactCmdline(line)
    }
    expect(performance.now() - start).toBeLessThan(300)
  })
})

describe('parseProcessCmdlines limit', () => {
  it('keeps up to CMDLINE_MAX_CHARS characters per record', () => {
    const parsed = parseProcessCmdlines(`@C@5\t${'a'.repeat(CMDLINE_MAX_CHARS + 500)}`)
    expect(parsed.get(5)?.length).toBe(CMDLINE_MAX_CHARS)
  })
})
