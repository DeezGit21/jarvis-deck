# Hyperframes Composition Brief: JARVIS Deck — Remake

## Objective
Remake the launch brag video with the November 13 state of the deck: repacked
layout, updated features, JARVIS's contextual rotating responses, all five tabs.

## Output
- Composition directory: `brag-output-2026-11-13-134501/composition/`
- Rendered video: `brag-output-2026-11-13-134501/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 25.5 seconds

## Source Material
- Project root: `D:/Dev/PROJECTS/jarvis-deck`
- Live captures taken this run (deck at localhost:4527, desktop 1600×950):
  `v2-overview-top/mid/low2.png` (repacked overview), `v2-tab-vision2.png`
  (Vision tab analyzing the deck's own screenshot), `v2-tab-money.png`,
  `v2-tab-goals.png`, `v2-tab-settings.png` (shows the new dashboard-cards
  card), `v2-ack-working/done.png` (automation DIAGNOSE & FIX in-place status),
  `v2-cmd2-working.png` (services drawer restart), `v2-voice-card.png`
  (business-line-first voice card).
- Spoken lines captured from the live ack engine (verbatim captions in-scene):
  "Running diagnostics on Binary Baseline, sir" · "Cycling HVAC Commission Pro
  for you, sir"
- Orb frame sequence + JARVIS reply voice reused from the v1 run
  (`assets/orb/`, `assets/audio/jarvis-reply-v2.mp3`).

## Key UI or visual moment to recreate
1. The repacked 12-column overview (hero → mid cards → telegram/voice/automation
   row) as three Ken-Burns shots.
2. Beat-locked five-tab tour: Vision · Money · Goals · Settings.
3. In-place "JARVIS is diagnosing…" status → ✓ done, captioned with the actual
   spoken acks — "A DIFFERENT ANSWER EVERY TIME."
4. Business-line voice card while the reply voice plays, then orb + waveform.

## Copy that must appear verbatim
- "YOUR AGENT HAS A COCKPIT NOW." (hook, unchanged from v1)
- "EVERY SERVICE. EVERY TASK. ONE DECK."
- "A DIFFERENT ANSWER EVERY TIME."
- "YOUR BUSINESS LINE, FIRST — ((602) 555-0151"
- "JARVIS DECK" · "OPEN-SOURCE · RUNS LOCAL · ONE COMMAND TO BOOT" ·
  "github.com/DeezGit21/jarvis-deck"

## Creative Direction
- Tone preset: cinematic (brand continuity with v1)
- Interpretation: same HUD language (scanlines, 32px grid, chamfered panels),
  new footage, spoken-line chips styled as console output with a cyan LED.
- Avoid: generic SaaS language; abstract filler; staging anything the app
  doesn't actually do.

## Visual Identity
- Background: #020610; cards #090e17; text #f0f6fc / #94a3b8
- Accent: #00f0ff (glow rgba(0,240,255,0.35)); amber #f59e0b for queued states
- Display: Orbitron 700/900; body: Rajdhani; mono: JetBrains Mono

## Audio
- Music: happy-beats-business-moves-vol-12 (same bed as v1), -20 dB under,
  fades 0.4s in / 1.8s out
- Voice: jarvis-reply-v2.mp3 at 15.84s (8.99s), full volume
- SFX: boot click, hook impact, drop/select ticks on every cut, keypress tick,
  heavy bell on the 24.56s logo lockup
