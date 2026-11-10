// Mock data + REST handler for the standalone preview. Every endpoint the
// plugin backend (dashboard/plugin_api.py) serves, faked with plausible data.

const now = () => new Date().toISOString()

const series = (base, n, drift) =>
  Array.from({ length: n }, (_, i) => Math.round((base + Math.sin(i / 3) * base * 0.03 + i * drift) * 100) / 100)

const brief = `## Top priorities today
1. **WirePro diagram accuracy** — push the beta APK pass before Friday.
2. **Booking pipeline is empty** — 0 leads this week; same-day response goal at risk.
3. **Rapid Dial AI is down** (:8000) — restart or retire it.

## Business
Revenue MTD $18,450. 2 jobs booked this week, 1 scheduled today. Pipeline: 4 scheduled, 2 quoted, 11 completed MTD.

## Projects & apps
Booking page and Hub CRM are healthy; Rapid Dial AI is the only red light.

## Tasks
- Josh Poulsen — refrigerant check (weekly review)
- Philippe Lewis — new wire run; text Benjamin to coordinate
- Ruth — call back while an appointment slot is still open

## Watch list
Webull session needs re-auth; Plaid never connected.`

const mockState = {
  brief,
  goals: '# Q4 goals\n- Ship WirePro beta APK with accurate diagrams\n- 20 bookings/month from the site pipeline\n- TriQuote first 100 installs\n',
  todos: [
    { id: 't1', title: 'WirePro: diagram-accuracy pass on presets', status: 'ready', priority: 5 },
    { id: 't2', title: 'Call Ruth — set appointment if still possible', status: 'todo', priority: 4 },
    { id: 't3', title: 'Text Benjamin about Philippe Lewis wire run', status: 'todo', priority: 3 },
    { id: 't4', title: 'Fix Rapid Dial AI or archive the service', status: 'blocked', priority: 3 },
    { id: 't5', title: 'Review September Stripe payouts vs plan', status: 'todo', priority: 2 },
  ],
  advisor: [
    { id: 'a1', tier: 1, text: 'Booking pipeline has 0 leads this week — audit the booking page funnel today', status: 'open' },
    { id: 'a2', tier: 1, text: 'Rapid Dial AI down since yesterday — restart or pull it off the status board', status: 'open' },
    { id: 'a3', tier: 3, text: 'WirePro diagram accuracy: schedule the 2h focus block this week', status: 'open' },
  ],
  loop: [
    { id: 'r1', text: 'Refresh stocks session (webull_login.py)', tier: 3, age_days: 4, escalated: true },
    { id: 'r2', text: 'Connect Plaid for bank balances', tier: 3, age_days: 2, escalated: false },
  ],
}

const delay = ms => new Promise(r => setTimeout(r, ms))

export async function mockRest(path, opts = {}) {
  const [raw, method] = [path, (opts.method || 'GET').toUpperCase()]
  const base = raw.split('?')[0]
  await delay(220 + Math.random() * 380) // let skeletons shimmer a beat

  if (method === 'POST') {
    switch (base) {
      case '/brief/generate':
        await delay(1400)
        mockState.brief = brief
        return { brief, date: now().slice(0, 10) }
      case '/brief/broadcast':
        await delay(900)
        return {
          ok: true,
          speech: "Good afternoon. Today's top priority is the WirePro diagram accuracy pass for the November beta. Second, the booking pipeline is empty this week — that puts the same-day response goal at risk, so the funnel needs a look. Rapid Dial AI is still down; restart it or pull it off the board. Revenue month-to-date is about eighteen and a half thousand dollars, two jobs booked this week, one on the schedule today. Watch list: the stocks session needs re-auth, and the bank connector is still unconnected.",
          followUps: [
            'Restart Rapid Dial AI on the jetson',
            'Create a task to audit the booking funnel',
            'Show overdue planner items',
            'Refresh the stocks session',
          ],
        }
      case '/todos/create': {
        const title = String((opts.body && opts.body.title) || 'New task')
        mockState.todos.unshift({ id: 't' + Date.now(), title, status: 'todo', priority: 2 })
        return { ok: true, title }
      }
      case '/advisor/generate':
        await delay(1200)
        return { ok: true, actions: mockState.advisor.map(a => ({ id: a.id, tier: a.tier, text: a.text })) }
      case '/advisor/action':
        return { ok: true }
      case '/goals':
        mockState.goals = String((opts.body && opts.body.text) || mockState.goals)
        return { ok: true }
      case '/command': {
        await delay(650)
        const q = String((opts.body && opts.body.query) || '').toLowerCase().trim()
        let reply = "At your service. All telemetry systems are operational. How may I assist?"
        if (q.includes('house party')) {
          reply = "Status sweep initiated. All agent routines are deployed and standing by."
        } else if (q.includes('clean slate')) {
          reply = "Clean Slate Protocol armed, sir. Ready to purge non-essential cache buffers and recycle agent memory on your command."
        } else if (q.includes('veronica') || q.includes('hulkbuster')) {
          reply = "Tracking secondary platform. Relaying telemetry to the failover cache. Payload calibrated."
        } else if (q.includes('diagnostic') || q.includes('mark vii') || q.includes('system scan')) {
          reply = "Running full diagnostic pass: neural core at nominal temperature. Gateway latency 0.42ms. 12 connectors synchronized. All systems nominal."
        } else if (q.includes('brief') || q.includes('today') || q.includes('plate')) {
          reply = "Today's priority is the WirePro diagram accuracy pass. We have 1 scheduled job, revenue MTD sits at $18,450, and 7 core services are currently green."
        } else if (q.includes('status') || q.includes('services')) {
          reply = "Hub CRM, Payments API, and Booking are healthy. Rapid Dial AI is offline on port 8000; I recommend scheduling a reboot."
        } else if (q.includes('who are you') || q.includes('jarvis')) {
          reply = "JARVIS online — deck neural core running."
        } else if (q.includes('money') || q.includes('revenue') || q.includes('stripe')) {
          reply = "Revenue month-to-date is $18,450 across 11 completed jobs. Stripe has $1,240.55 available for immediate payout."
        } else {
          reply = `Directive processed, sir: "${opts.body && opts.body.query}". Automated agent routines executed. All telemetry streams are stable.`
        }
        return { ok: true, reply }
      }
      case '/vision/analyze':
        await delay(1200)
        return {
          ok: true,
          spokenSummary: 'HUD Recon scan complete: Interface layout detected with high-density telemetry nodes.',
          detailedAnalysis: 'HUD recon pass: 6 telemetry widgets analyzed, 4 active service streams confirmed online.',
          extractedText: 'STARK_OS // JARVIS v7.4.2 [CORE FLUX: 99.8% NOMINAL]',
          entities: ['Neural Core', 'Neural Bus', 'Hermes Bridge', 'Live Telemetry'],
          suggestedActions: [
            'Run System Diagnostics',
            'Initiate Full Matrix Scan',
            'Vocalize Daily Briefing'
          ]
        }
      case '/connectors/connect':
        return { ok: true, url: 'https://portal.nousresearch.com/connectors' }
      default:
        return { ok: true }
    }
  }

  switch (base) {
    case '/brief/today':
      return { brief: mockState.brief, date: now().slice(0, 10) }
    case '/todos':
      return { tasks: mockState.todos, total_open: mockState.todos.length + 2 }
    case '/planner/today':
      return {
        state: 'ok', date: now().slice(0, 10),
        focus: 'WirePro diagram-accuracy pass — beta APK by Friday',
        habits: { water: true, gym: false, inbox_zero: true, stretch: false },
        planner_tasks: [
          { id: 'p1', text: 'Finish wiring-engine preset diagram', done: false, status: 'in_progress', priority: 'high' },
          { id: 'p2', text: 'Record 3-min demo clip', done: false, status: 'todo', priority: 'medium' },
          { id: 'p3', text: 'Morning review', done: true, status: 'done', priority: 'low' },
        ],
        inbox_today: [
          { id: 'i1', text: 'Reply to the vendor quote', priority: 2 },
          { id: 'i2', text: 'Log the fleet mileage', priority: 1 },
        ],
        inbox_overdue: [
          { id: 'o1', text: 'Renew the trade license upload', due: '2026-11-05', priority: 3 },
        ],
        repeating_today: [
          { id: 'rp1', text: 'Check refrigerant logs', checked_today: false },
          { id: 'rp2', text: 'Inbox sweep', checked_today: true },
        ],
        projects: [
          { name: 'WirePro beta', status: 'active', priority: 'high', deadline: '2026-11-21', open_tasks: 4 },
          { name: 'TriQuote launch', status: 'active', priority: 'high', deadline: '2026-12-01', open_tasks: 7 },
        ],
        week_focus: 'Close out the beta checklist',
        week_key: 'week_2026_45',
      }
    case '/metrics':
      return {
        date: now().slice(0, 10), leads_week: 3, jobs_week: 2, revenue_mtd: 18450, jobs_today: 1,
        jobs_by_status: [
          { status: 'completed', count: 11, total_price: 21400 },
          { status: 'scheduled', count: 4, total_price: 8250 },
          { status: 'quoted', count: 2, total_price: 3900 },
          { status: 'lead', count: 3, total_price: 0 },
        ],
      }
    case '/status': {
      const services = [
        ['Hub CRM', 'http://localhost:3003', true, 42],
        ['Payments API', 'https://api.example.com', true, 88],
        ['Voice dialer', 'http://localhost:8000', false, 0],
        ['Booking page', 'https://booking.example.com', true, 131],
        ['Intake app', 'https://intake.example.com', true, 96],
        ['Reports', 'https://reports.example.com', true, 77],
        ['Ticker broker', 'https://broker.example.com/healthz', true, 51],
      ]
      return {
        date: now().slice(0, 10),
        services: services.map(([name, url, up, ms], i) => ({
          name, url, up, ms: up ? ms : null, detail: up ? 200 : 'connect timeout',
          note: i === 2 ? 'down since yesterday' : '',
          status_note: '', updated: '',
          history: series(ms || 80, 12, 0.5).map(v => ({ ms: Math.round(v), ok: up })),
        })),
      }
    }
    case '/advisor':
      return { date: now().slice(0, 10), actions: mockState.advisor, generated_at: now(), accountability: mockState.loop }
    case '/goals':
      return { text: mockState.goals, missing: false }
    case '/money/summary':
      return {
        date: now().slice(0, 10),
        stripe: { configured: true, state: 'ok', render: 'available:  $1,240.55\npending:    $310.00\nmtd fees:   $96.18' },
        stocks: { configured: true, state: 'reauth_needed', detail: 'Session expired — run webull_login.py in your terminal' },
        banks: { configured: false, state: 'no_creds', detail: 'PLAID_CLIENT_ID/PLAID_SECRET missing from .env' },
      }
    case '/quotes':
      return {
        date: now().slice(0, 10),
        stocks: [
          { symbol: 'SPY', price: 612.44, change_pct: 0.42, series: series(610, 60, 0.08) },
          { symbol: 'QQQ', price: 538.17, change_pct: -0.31, series: series(540, 60, -0.05) },
          { symbol: 'NVDA', price: 178.92, change_pct: 1.84, series: series(174, 60, 0.12) },
          { symbol: 'MSFT', price: 492.05, change_pct: 0.11, series: series(491, 60, 0.02) },
        ],
        crypto: [
          { symbol: 'BTC-USD', price: 98412.5, change_pct: 2.1, series: series(96400, 60, 5.2) },
          { symbol: 'ETH-USD', price: 3712.8, change_pct: -0.7, series: series(3740, 60, -0.6) },
        ],
      }
    case '/connectors':
      return {
        date: now().slice(0, 10),
        portal_url: 'https://portal.nousresearch.com/connectors',
        hosted: [
          { name: 'cloudflare_mcp', connected: true, url: 'https://dash.cloudflare.com' },
          { name: 'higgsfield_mcp', connected: true, url: 'https://higgsfield.ai' },
          { name: 'gmail', connected: false, url: 'https://mail.google.com' },
          { name: 'notion', connected: false, url: 'https://www.notion.so' },
          { name: 'slack', connected: false, url: 'https://app.slack.com' },
          { name: 'linear', connected: false, url: 'https://linear.app' },
          { name: 'airtable', connected: false, url: 'https://airtable.com' },
          { name: 'jira', connected: false, url: 'https://www.atlassian.com/software/jira' },
        ],
        mcps: [
          { name: 'github', enabled: true, url: 'https://github.com' },
          { name: 'postgres', enabled: true, url: 'http://localhost:3003' },
          { name: 'stripe', enabled: true, url: 'https://dashboard.stripe.com' },
          { name: 'twilio-docs', enabled: true, url: 'https://www.twilio.com/docs' },
          { name: 'twelve-data', enabled: true, url: 'https://twelvedata.com' },
          { name: 'context7', enabled: true, url: 'https://context7.com' },
          { name: 'globalping', enabled: true, url: 'https://globalping.io' },
          { name: 'deepwiki', enabled: true, url: 'https://deepwiki.com' },
          { name: 'playwright', enabled: true, url: 'https://playwright.dev' },
          { name: 'magic', enabled: true, url: 'https://21st.dev' },
          { name: 'alpaca', enabled: true, url: 'https://app.alpaca.markets' },
          { name: 'rea', enabled: true, url: null },
          { name: 'mobile-mcp', enabled: false, url: null },
        ],
      }
    case '/vision/last':
      return { ok: false, detail: 'no analysis yet' }
    case '/export':
      return { date: now().slice(0, 10), goals: mockState.goals, recs: [...mockState.advisor, ...mockState.loop], apps: 'demo' }
    case '/tools':
      return { plugins: ['agentos'], mcps: ['github', 'stripe'] }
    default:
      return { ok: true }
  }
}
