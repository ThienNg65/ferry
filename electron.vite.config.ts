import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    entry: resolve(__dirname, 'src/main/index.ts'),
    build: {
      rollupOptions: {
        external: ['ssh2', 'archiver', 'electron-store']
      }
    }
  },
  preload: {
    input: resolve(__dirname, 'src/preload/index.ts'),
    build: {
      rollupOptions: {
        external: ['electron']
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      vue(),
      ui({ ui: { colors: { primary: 'brand', neutral: 'zinc' } } })
    ],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
