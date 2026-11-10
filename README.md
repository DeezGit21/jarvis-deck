# JARVIS Deck

An open-source, standalone **control deck for your personal agent** — a single
dark dashboard with a plasma neural orb, a 3D memory galaxy of everything your
agent is working on, and a voice console you can talk to.

Built as a local-first companion for a [Hermes Agent](https://github.com/NousResearch/hermes-agent)
style setup, but any backend that serves the same simple JSON routes works.

## What's on the deck

| Widget | What it shows |
| --- | --- |
| Neural orb | WebGL plasma core (fbm convection shader) under an always-on neural network whose web lights up and pulses with assistant state (idle / listening / thinking / speaking) |
| Memory galaxy | 3D star cloud of kanban tasks, cron jobs and monitored services — clustered by status, drag to rotate, wheel to zoom, click a star for details |
| Today / Brief / Advisor | Daily brief, top-3 actions, accountability loop |
| Status | Live service pings with latency |
| Agent activity | Cron runs + board task feed for the last 48h |
| Release board | GitHub releases + CI status for your watched repos |
| Tickers | Live quotes (Yahoo/Binance, no login) |
| Console | Talk or type to your agent; hold **SPACE** anywhere for push-to-talk, voice replies via browser TTS |

## Quickstart

```bash
npm install

# backend (FastAPI, localhost only) — pick your python
python -m uvicorn standalone:app --app-dir dashboard --host 127.0.0.1 --port 8785

# frontend
npx vite preview --port 4527 --strictPort   # serves dist/ (run `npm run build` first)
# or during development:
npx vite --port 4527
```

Open `http://localhost:4527`. The Vite server proxies `/api/plugins/agentos/*`
to `127.0.0.1:8785`; when the backend isn't running the UI falls back to demo data.

## Configuration

All personal topology lives **outside the repo** in
`~/.hermes/agentos/agentos.yaml` (or the equivalent agent home on your machine).
Every key is optional:

```yaml
persona: "you"                      # how the advisor addresses you
hub_url: "http://localhost:3003"    # your business app / CRM
tz_offset_hours: -7

db:                                 # metrics via ssh + psql
  ssh_host: my-db-host
  psql_user: postgres
  psql_db: mydb

services:                           # status-card pings
  - name: My App
    url: http://localhost:3000

release_repos:                      # release board (owner/repo, gh CLI)
  - label: My App
    repo: you/my-app
```

The backend auto-detects the agent data home (`~/.hermes` for CLI setups,
`%LOCALAPPDATA%/hermes` when the desktop app owns it) and reads kanban boards
(`kanban/boards/*/kanban.db`) and cron history (`cron/jobs.json`,
`cron/executions.db`) from there.

## Stack

React 19 + Vite + TypeScript-style JSX · Tailwind 4 · plain 2D-canvas and WebGL
(no heavy 3D deps) · FastAPI backend (stdlib + PyYAML) · react-query-style
polling through a tiny SDK stub (`src/hermes-plugin-sdk.js`), so the frontend
also runs inside the Hermes desktop app as a plugin unmodified.

## Status & roadmap

- [x] Neural orb (state-driven plasma core + neural web)
- [x] Memory galaxy
- [x] Push-to-talk voice + TTS replies
- [x] Config-driven backend (no personal data in the repo)
- [ ] Demo GIF
- [ ] Generic agent-adapter docs

## License

MIT — see [LICENSE](LICENSE).
