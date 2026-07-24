const rendererStartTime = performance.now()
const rendererTimeOrigin = performance.timeOrigin
if (typeof window !== 'undefined') {
  ;(window as unknown as { __FERRY_RENDERER_TIME__?: { start: number; timeOrigin: number } }).__FERRY_RENDERER_TIME__ = {
    start: rendererStartTime,
    timeOrigin: rendererTimeOrigin
  }
}

import './assets/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { addCollection, setCustomIconLoader } from '@iconify/vue'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { startupIcons } from './startupIcons'

// Pre-register essential startup icons to prevent setCustomIconLoader from
// intercepting and triggering heavy icons.json import during initial Vue mount.
addCollection(startupIcons)


// Full Lucide set (554KB/6135 icons) is registered AFTER first paint via a
// dynamic import, not a static one — a static `import ... from '...json'`
// would still be hoisted and parsed before `mount()` below runs, blocking
// cold-start regardless of where the import statement sits in this file.
// Memoized so both the idle-scheduled call below AND the custom loader (see
// setCustomIconLoader call) share the exact same in-flight/settled promise
// rather than importing the JSON twice.
let lucideLoad: Promise<void> | null = null
function ensureLucideLoaded(): Promise<void> {
  if (!lucideLoad) {
    lucideLoad = import('@iconify-json/lucide/icons.json').then((mod) => {
      addCollection(mod.default)
    })
  }
  return lucideLoad
}

// Icons requested before the load above resolves (e.g. the title bar/tab
// bar/sites list rendered in the very first frame) must NOT fall back to
// Iconify's default behavior of fetching from api.iconify.design/
// api.unisvg.com/api.simplesvg.com — blocked by our CSP (`default-src
// 'self'`) and previously surfaced as console errors. Registering this
// custom loader for the `lucide` prefix intercepts that fallback: instead of
// hitting the network, it awaits the SAME `ensureLucideLoaded()` promise,
// so once the deferred load finishes, Iconify's own storage/callback system
// re-checks and wakes up every icon that was waiting — not just new ones.
// (A loader that never resolves would instead strand those icons blank
// forever, since Iconify only re-notifies waiting instances when a load
// attempt actually settles.) `@nuxt/ui`'s own icon component imports the
// same `@iconify/vue` module, so this covers its internal default icons too.
setCustomIconLoader(async () => {
  await ensureLucideLoaded()
  return null
}, 'lucide')

createApp(App).use(createPinia()).use(ui).mount('#app')

function scheduleIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb())
  } else {
    window.setTimeout(cb, 0)
  }
}

scheduleIdle(ensureLucideLoaded)
