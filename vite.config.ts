import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

/**
 * Signed in to Cloudflare on this computer (`npx wrangler login`, or a CLOUDFLARE_API_TOKEN)? The free Workers AI
 * model always runs on Cloudflare, even in local development, so without a login `npm run dev` leaves it out
 * instead of failing to start: everything else works, and AI runs on the API keys of the account or of .env.
 */
function cloudflareLogin(): boolean {
  if (process.env.CLOUDFLARE_API_TOKEN) return true
  // Where wrangler keeps its login: ~/.wrangler when that folder exists, else the system's config folder.
  const home = os.homedir()
  const configDir =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'xdg.config')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Preferences')
        : path.join(home, '.config'))
  return [home, configDir].some((dir) => existsSync(path.join(dir, '.wrangler', 'config', 'default.toml')))
}

export default defineConfig(({ command, isPreview }) => {
  // Only the dev server; a build keeps every binding for the deployed Worker.
  const dev = command === 'serve' && !isPreview
  const offline = dev && !cloudflareLogin()
  if (offline) console.log('\n  Not signed in to Cloudflare: the free Workers AI model is off (npx wrangler login turns it on).\n')
  // PDFs and the one-page fit run in a local Chrome that wrangler downloads (Chrome 126). On Windows its sandbox
  // keeps it from printing (Page.printToPDF never answers); wrangler starts it without the sandbox when CI is set.
  // It only ever opens this app's own print page.
  if (dev && process.platform === 'win32') process.env.CI ??= '1'
  return {
    plugins: [
      react(),
      tailwindcss(),
      cloudflare(
        offline
          ? {
              remoteBindings: false,
              config: (config) => {
                delete config.ai
              },
            }
          : undefined,
      ),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        '@shared': path.resolve(import.meta.dirname, './shared'),
      },
    },
  }
})
