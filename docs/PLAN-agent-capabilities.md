# PLAN — Agent Capabilities Build (Nov 2026)

**STATUS: SHIPPED** — all three phases built, verified live, and committed
(3c00e2e backend · 53504b1 cards · b121041 modes+omni-bar · 630cbbe companion).

Goal: close the gap between "can do" and "does do". Three phases, one commit each.

## Phase 1 — Proactive auto-remediation (approval-gated self-healing)

**Backend** (`dashboard/plugin_api.py`):
- `agentos.yaml` gains a `remediation:` block: `enabled`, `scan_minutes` (default 5),
  `cooldown_minutes` (default 30), `max_auto_per_hour` (default 4), and an
  `auto:` map of service-name → restart shell command. Only commands present
  in this map can ever auto-run — nothing else executes without approval.
- Ledger `~/.hermes/agentos/cache/remediation.json`: `{events: [], pending: []}`.
- Scanner: daemon thread, pings every service each cycle.
  - Down + has restart cmd + within cooldown/hourly caps → run it, wait, re-ping,
    record `auto_fixed` / `auto_failed` event, notify Telegram.
  - Down + no restart cmd (or caps exhausted) → `pending` approval card + Telegram notify.
- Endpoints: `GET /remediation`, `POST /remediation/config {enabled}`,
  `POST /remediation/scan`, `POST /remediation/approve {id}`, `POST /remediation/deny {id}`.
- Approved non-allowlisted actions delegate to the Hermes agent (`hermes chat -Q`),
  then re-ping and record the outcome.

**Frontend** (`desktop/plugin.js`):
- `AutomationCard` widget: AUTO-FIX toggle (persisted backend-side), event feed
  (auto-fixed / auto-failed / approved / denied with timestamps), pending
  approvals with APPROVE / DENY buttons. Poll 60s.

## Phase 2 — Persistent cross-session memory

**Backend**:
- Store `~/.hermes/agentos/memory.json`: `{facts: [{id, text, tags, created, source}]}`.
- `GET /memory`, `POST /memory {text, tags?}` (deduped on normalized text),
  `DELETE /memory {id}`.
- `/command` injects a compact memory block (recent facts) into every agent query,
  so JARVIS walks into each session already knowing D's context.
- Fast-path capture: queries starting with `/remember <fact>` or containing
  "remember that …" store a fact directly (no agent call); `/forget <match>` deletes.

**Frontend**: `MemoryCard` widget — add / list / delete facts.

## Phase 3 — Full-viewport modes + omni-bar + HUD companion

- `ModeStore` (`window.__deckMode`): null | brief | console | graph | hud.
  Alt+1..4 toggles, Esc exits, mode cluster in the hero ribbon.
- **Mode 1 Briefing**: full-screen brief, typographic, generate + speak + stop.
- **Mode 2 Console**: split-pane — left: full transcript with command input;
  right rail: services, open todos, recent cron activity.
- **Mode 3 Neural Graph**: full-screen galaxy + orb, hover-linking intact.
- **Mode 4 HUD**: compact transparent glass card (built for the companion shell).
- **Omni-bar**: Spotlight gains a `/` command palette — fuzzy list of commands
  (`/brief`, `/top3`, `/diag`, `/restart <svc>`, `/remember <fact>`, `/mode …`),
  each mapped either to a direct API action or an expanded ConsoleStore.send.
- **HUD companion**: `companion/main.js` (Electron) — frameless, transparent,
  always-on-top, `?mode=hud`, Alt+Space global toggle; `npm run hud`.

## Validation
After every change: `node --check desktop/plugin.js`, `npm run build`,
backend `healthz` re-verified, Playwright check of each new surface at :4527.
