import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Standalone preview of the agentos desktop plugin. The real plugin runs
// inside the Hermes desktop app; here the SDK is stubbed. REST calls hit the
// real plugin backend (standalone uvicorn on :8785, see
// dashboard/standalone.py) and show the real error when it isn't running.
const PLUGIN_PROXY = {
  '/api/plugins/agentos': { target: 'http://127.0.0.1:8785', changeOrigin: true },
}
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: PLUGIN_PROXY },
  preview: { proxy: PLUGIN_PROXY },
  resolve: {
    alias: {
      '@hermes/plugin-sdk': fileURLToPath(new URL('./src/hermes-plugin-sdk.js', import.meta.url)),
    },
  },
})
