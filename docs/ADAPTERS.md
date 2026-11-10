# Adapters — wiring JARVIS Deck to your agent

The deck's frontend is dumb: it polls JSON routes under `/api/plugins/agentos/*`
and renders. The bundled backend (`dashboard/plugin_api.py`) implements those
routes for a Hermes-Agent-style setup. To wire **your** agent, either:

1. **Swap the route bodies** — keep the JSON shapes, replace the internals, or
2. **Proxy** — point the Vite proxy (`vite.config.js`) at your own server that
   serves the shapes below.

Everything personal lives in `~/.hermes/agentos/agentos.yaml` (or your own
config path — see `_agentos_config()`). The repo itself contains no topology.

## Route contracts

| Route | Method | Returns |
| --- | --- | --- |
| `/health` | GET | `{ok, date, time}` |
| `/status` | GET | `{services: [{name, url, up, ms, detail, note}], apps: {...}}` |
| `/metrics` | GET | `{leads_week, jobs_week, revenue_mtd, jobs_today, by_status: {...}}` |
| `/todos` | GET | `{tasks: [{id, title, status, priority, assignee}]}` — open items |
| `/todos/create` | POST | `{title}` → creates a task |
| `/goals` | GET/POST | markdown goals text |
| `/brief/today` | GET | `{date, text, at}` |
| `/brief/generate` | POST | renders the daily brief from metrics/goals |
| `/brief/broadcast` | POST | delivers the brief (e.g. Telegram) |
| `/advisor` | GET | `{recs: [{id, title, detail, due, status}]}` — accountability loop |
| `/advisor/generate` | POST | LLM-generated top-3 actions for today |
| `/advisor/action` | POST | `{id, action: "done"\|"kill"}` |
| `/command` | POST | `{query}` → `{reply}` — the console's chat pipe |
| `/memory` | GET | galaxy nodes: `{count, nodes: [{id, source, cluster, label, status, detail, at, ts, color_key}]}` |
| `/agents_activity` | GET | `{date, cron: [{name, status, at, outcome, error}], tasks: [...]}` |
| `/releases` | GET | `{repos: [{label, repo, release: {tag, name, at}, ci: {status, conclusion, name, at}, pushed}]}` |
| `/money/summary` | GET | payments summary (Stripe etc.) |
| `/quotes` | GET | `?symbols=SPY,BTC-USD` → `{quotes: [{symbol, price, change_pct}]}` |
| `/tools` | GET | `{plugins: [...], mcps: [...]}` |
| `/connectors` | GET/POST | app connections for the orbit ring |

## Data sources the bundled backend reads

- **Kanban tasks** — `kanban/boards/<board>/kanban.db` (sqlite) under the
  detected agent home (`~/.hermes` or the desktop app's data dir).
- **Cron** — `cron/jobs.json` (definitions) + `cron/executions.db` (history).
- **Services** — plain HTTP pings from `agentos.yaml → services`.
- **Releases** — GitHub via the `gh` CLI (authenticated), repos from
  `agentos.yaml → release_repos`.
- **Quotes** — Yahoo chart API (stocks) + Binance (crypto), no login.

## What to change for a different agent

- `_run_hermes_prompt()` / `/command` — replace the `hermes chat -Q` shell-out
  with your agent's dispatch (HTTP, websocket, queue…). Keep it returning
  `{reply: string}`.
- `todos` / `todos_create` — swap the `hermes kanban` CLI for your task store.
- `/memory` — return any nodes you want visualized. `color_key` picks the star
  color (`task_open` uses the UI accent; everything else is in
  `GALAXY_RGB` in the frontend). `ts` must be **epoch seconds**.
- `/metrics` / `/money` — your own numbers; the cards render whatever comes back.

## Frontend notes

- `src/hermes-plugin-sdk.js` is a tiny stub so the same `desktop/plugin.js`
  runs standalone (vite alias) and inside the Hermes desktop app as a plugin.
- REST helper tries the real backend first, falls back to `src/demo-data.js`
  mocks when it's down — so the UI is always presentable.
- The orb exposes its state machine at `window.__orbBus` (`set('listening' |
  'thinking' | 'speaking' | 'idle')`) for integrations and demos.
- Voice: browser Web Speech API for input (click ● or hold **SPACE**),
  `speechSynthesis` for replies (rate configurable). Swap either side freely.
