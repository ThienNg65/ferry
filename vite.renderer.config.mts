import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }

export default defineConfig({
  define: {
    __FERRY_APP_VERSION__: JSON.stringify(String(pkg.version || '0.0.0'))
  },
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    vue(),
    ui({
      router: false,
      ui: {
        colors: { primary: 'brand', neutral: 'zinc' },
        checkbox: { slots: { base: 'rounded-[3px]' } }
      }
    })
  ],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true
  }
})
