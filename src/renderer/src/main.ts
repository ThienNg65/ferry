import './assets/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { addCollection } from '@iconify/vue'
import ui from '@nuxt/ui/vue-plugin'
import lucideIcons from '@iconify-json/lucide/icons.json'
import App from './App.vue'

// Register the full local Lucide set so every `i-lucide-*` icon — including
// ones bound dynamically (computed props, ternaries) that Vite's static
// icon-bundling can't detect — resolves from memory instead of falling back
// to a runtime fetch against Iconify's public API, which our CSP blocks.
addCollection(lucideIcons)

createApp(App).use(createPinia()).use(ui).mount('#app')
