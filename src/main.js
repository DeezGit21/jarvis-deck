// Standalone preview entry: mounts the real desktop/plugin.js UI with a
// stubbed SDK and mocked data. No Hermes runtime required.
import { createRoot } from 'react-dom/client'
import plugin from '../desktop/plugin.js'
import { ROUTES_AREA } from './hermes-plugin-sdk.js'
import { mockRest } from './demo-data.js'
import './theme.css'

const routes = []
plugin.register({
  rest: async (path, opts) => {
    // Real plugin backend first (Vite proxies /api/plugins/agentos to the
    // standalone uvicorn runner); fall back to demo mocks when it's down.
    try {
      const r = await fetch('/api/plugins/agentos' + path, {
        method: (opts && opts.method) || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
      })
      if (r.ok) return await r.json()
    } catch { /* backend not running — use mocks */ }
    return mockRest(path, opts)
  },
  os: { openExternal: url => window.open(url, '_blank', 'noopener') },
  registerMany: defs => { for (const d of defs) routes.push(d) },
})

const page = routes.find(d => d.area === ROUTES_AREA)
if (!page) throw new Error('plugin did not register a page route')
// SDK contract: the route def carries render() at its top level, not in data.
createRoot(document.getElementById('root')).render(page.render())
