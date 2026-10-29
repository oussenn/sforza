import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Without the Cloudflare and React plugins of vite.config.ts: the tests cover plain functions.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, './shared'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
