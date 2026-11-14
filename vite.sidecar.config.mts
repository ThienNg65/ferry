import { readFileSync } from 'fs'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }

const externalNativeAddons: Plugin = {
  name: 'external-native-addons',
  enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('.node') || source === 'cpu-features' || source === 'electron' || source === 'electron-updater') {
      return { id: source, external: true }
    }
    return null
  }
}

export default defineConfig({
  define: {
    __FERRY_APP_VERSION__: JSON.stringify(String(pkg.version || '0.0.0'))
  },
  plugins: [externalNativeAddons],
  publicDir: false,
  ssr: {
    noExternal: true,
    external: ['cpu-features', 'electron', 'electron-updater']
  },
  build: {
    ssr: 'src/sidecar/index.ts',
    outDir: 'out/sidecar',
    emptyOutDir: true,
    target: 'node22',
    minify: 'esbuild',
    commonjsOptions: {
      ignore: (id) => id.endsWith('.node') || id === 'cpu-features' || id === 'electron' || id === 'electron-updater'
    },
    rollupOptions: {
      external: ['cpu-features', 'electron', 'electron-updater', /\.node$/],
      output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true }
    }
  }
})
