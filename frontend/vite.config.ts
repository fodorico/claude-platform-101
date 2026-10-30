import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** Writes version.json with an id unique to each build; open pages poll it to reload themselves. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: Date.now().toString(36) }),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  server: {
    // In development the API runs on its own port; nginx does this proxying in production.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Playwright owns e2e/.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
