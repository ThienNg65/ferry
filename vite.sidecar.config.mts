import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  ssr: {
    noExternal: true,
    external: ['cpu-features']
  },
  build: {
    ssr: 'src/sidecar/index.ts',
    outDir: 'out/sidecar',
    emptyOutDir: true,
    target: 'node22',
    minify: 'esbuild',
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true }
    }
  }
})
