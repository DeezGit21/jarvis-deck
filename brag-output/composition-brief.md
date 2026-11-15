# Hyperframes Composition Brief: JARVIS Deck

## Objective
Create a short launch-style brag video for JARVIS Deck, an open-source local control deck for personal AI agents.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `D:/Dev/PROJECTS/jarvis-deck`
- Primary files read: `index.html`, `src/theme.css`, `README.md`, `package.json`, `desktop/plugin.js` (grep of real UI copy)
- Product name: JARVIS Deck
- Tagline / strongest claim: "An open-source, standalone control deck for your personal agent — a single dark dashboard with a plasma neural orb, a 3D memory galaxy of everything your agent is working on, and a voice console you can talk to."
- Key UI or visual moment to recreate: the plasma neural orb (cyan core + neural web) and the HUD dock (Today / Memory / Status / Tickers) with "Today's top 3 actions"
- Copy that must appear verbatim:
  - "Today's top 3 actions"
  - "Hold SPACE to talk" (real feature: hold SPACE anywhere for push-to-talk)
  - Dock labels: Today, Memory, Status, Tickers
  - "JARVIS DECK"

## Creative Direction
- Tone preset: cinematic
- Creative direction: "your personal JARVIS, booted" — trailer-scale reveals with product-clean restraint
- Interpretation: wide dark frames, big Orbitron type, dramatic but unhurried reveals; HUD chrome does the drama, SFX stay sparse and motion-matched
- Angle: chat boxes are how you talk to your agent; this is what it looks like when it gets a cockpit — a screen that shows it thinking, a galaxy of its work, a voice channel. The sci-fi fantasy is the product demo. The punchline: real, open source, one command to boot.
- Hook: black → HUD boot flicker → the orb ignites; "YOUR AGENT HAS A COCKPIT NOW." slams in
- Outro / punchline: JARVIS DECK logo over the orb at full pulse — "OPEN-SOURCE · RUNS LOCAL · ONE COMMAND TO BOOT" — repo URL
- Avoid: generic SaaS language; abstract filler visuals; unrelated visual redesign

## Visual Identity
- Background: #020610 (near-black navy; cards #090e17, tertiary bg #050b14)
- Text: #f0f6fc primary, #94a3b8 secondary, #475569 tertiary
- Accent: #00f0ff cyan (glow rgba(0,240,255,0.35)); amber #f59e0b allowed for "queued/listening" states; slate #64748b for "done" stars
- Display font: Orbitron (needs @font-face into assets/fonts/ — NOT a bundled family)
- Body font: Rajdhani (needs @font-face); mono: JetBrains Mono (bundled)
- Visual references from the project: HUD scanlines (3px repeating), 32px cyber grid, chamfered glass panels with 1px cyan-16% borders and tactical corner brackets, radial glow gradients (never full-screen linear gradients on the dark ground — banding risk)

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Boot / Hook — 3s — HUD flicker, orb ignites, "YOUR AGENT HAS A COCKPIT NOW."
2. The deck — 4.5s — dock rail (Today/Memory/Status/Tickers), "Today's top 3 actions" rows arrive one by one, status bar "8/16 SERVICES UP · ALL LOCAL"
3. Memory galaxy — 4.5s — 3D star cloud in three status clusters, "EVERY TASK. EVERY JOB. EVERY SERVICE.", simulated drag → "DRAG TO ROTATE"
4. Push-to-talk — 4.5s — "HOLD SPACE TO TALK" keycap, waveform rises, orb goes listening→speaking, typed reply holds readable
5. Outro — 3.5s — orb full-frame, JARVIS DECK lockup, "OPEN-SOURCE · RUNS LOCAL · ONE COMMAND TO BOOT", github.com/DeezGit21/jarvis-deck

## Audio
- Audio role: cinematic support
- Audio arc: fade in under boot flicker → swell on hook slam → low through deck/galaxy with a swell on the drag → drop low under the voice scene → one heavy hit on the outro logo, fade out
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (bundled, cinematic per brag audio table), volume ~0.3
- Music cue guidance: preset at `C:/Users/D/AppData/Local/hermes/skills/creative/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (tempo 109.96 BPM). Strong cues in the 20s window: 8.74s, 13.11s, 17.47s, 18.56s, 22.93s. Suggested locks (±0.15s): hook text slam near a cue ~2.2s equivalent window position, galaxy reveal, outro logo. Beat grid ~0.55s apart at this tempo — sequential TEXT reveals (top-3 rows) snap to every OTHER beat so lines stay readable; non-text accents may hit every beat.
- Audio-reactive treatment: subtle — orb core glow and dock panel presence breathe with music RMS/bass; no waveform/equalizer visuals except the in-story voice waveform in Scene 4 (that one is diegetic, driven by the animation, not music)
- Audio-coupled moments:
  - Scene 1 hook text slam — impactSoft_medium / soft impact
  - Scene 2 top-3 rows — interface click/drop per row (first + last accented)
  - Scene 3 drag grab — mouseclick + faint whoosh feel; galaxy reveal on strong cue
  - Scene 4 typing — randomized keyboard/keypress-*.wav per few characters
  - Scene 5 logo — impactBell_heavy_000 or _003
- SFX selection guidance: cinematic tone → 2-3 big cues (bell hits), interface clicks for UI, keyboard set for typing. Prefer low high-frequency-risk files for repeated moments.
- SFX analysis guidance: `C:/Users/D/AppData/Local/hermes/skills/creative/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, volume from the staged assets after the animation exists.
- Audio files staged: music + sfx/impact (bell 000/003, soft medium 000), sfx/interface (drop_001, click_001, select_008, bong_001), sfx/ui (mouseclick1), sfx/keyboard (keypress-001/005/009/013/017/021/025.wav)

## Hyperframes Instructions
Load `hyperframes` (contract, format, motion, look — already read), `hyperframes-registry` (query catalog before hand-writing reusable effects), `media-use` (audio-reactive extraction via its own skill dir helper) and `hyperframes-cli` (lint/check/render). Skip hyperframes storyline/types/story/SPEC steps — the brag plan + this brief replace them. Skip hyperframes usage/history/feedback/REVIEW.md steps; `check` is the gate.

Requirements:
- At least one real UI/copy/visual element from the project (dock labels, "Today's top 3 actions", push-to-talk, HUD panel language, orb)
- All on-screen service names / action rows / console reply are fictional stand-ins — no real hostnames, IPs, or personal data from the developer's live deck
- Keep all text readable (hold floors per brag-plan reading times)
- Total 15-25s; target 20s
- Fonts: Orbitron + Rajdhani are NOT bundled — download .woff2 into assets/fonts/ with @font-face, or fall back to closest bundled family and say so in the composition
- `npx hyperframes check` must pass with zero errors before render
- Keep creation and rendering local
