// Standalone preview entry: mounts the real desktop/plugin.js UI against the
// real plugin backend (Vite proxies /api/plugins/agentos to the standalone
// uvicorn runner). No demo/mock data anywhere — if the backend is down the UI
// shows the real error instead of fake tasks.
import { createRoot } from 'react-dom/client'
import plugin from '../desktop/plugin.js'
import { ROUTES_AREA } from './hermes-plugin-sdk.js'
import './theme.css'

const routes = []
plugin.register({
  rest: async (path, opts) => {
    const r = await fetch('/api/plugins/agentos' + path, {
      method: (opts && opts.method) || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!r.ok) throw new Error('backend ' + r.status + ' on ' + path + ' — is the agentos backend running?')
    return await r.json()
  },
  os: { openExternal: url => window.open(url, '_blank', 'noopener') },
  registerMany: defs => { for (const d of defs) routes.push(d) },
})

const page = routes.find(d => d.area === ROUTES_AREA)
if (!page) throw new Error('plugin did not register a page route')
// SDK contract: the route def carries render() at its top level, not in data.
createRoot(document.getElementById('root')).render(page.render())
