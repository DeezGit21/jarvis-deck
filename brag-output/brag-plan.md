# Brag Plan: JARVIS Deck

## What is this app?
JARVIS Deck is an open-source, local-first control deck for your personal AI agent — a single dark HUD dashboard with a WebGL plasma neural orb, a 3D memory galaxy of everything the agent is working on, live service pings, and a voice console with push-to-talk.

## The angle
You already talk to your agent in a chat box. This is what it looks like when your agent gets a *cockpit*: a screen that shows it thinking, a galaxy of its work, and a voice channel. The video sells the fantasy everyone already has from Iron Man — and the punchline is that it's real, it's open source, and it boots with one command.

## Hook (first 2-3 seconds)
Black screen, HUD boot flicker, then the plasma orb ignites out of darkness — a cyan (#00f0ff) pulsing core under a neural web — while the line **"YOUR AGENT HAS A COCKPIT NOW."** slams in in Orbitron. The orb IS the hook; it's the project's most striking visual.

## Key moments (the middle)
- **The deck, alive:** a HUD panel recreation of the real dock — Today / Memory / Status / Tickers — with a status bar reading services up, and "Today's top 3 actions" arriving one by one with interface ticks.
- **Memory galaxy:** a 3D star cloud of the agent's work clustered by status (active / queued / done), drifting, then accelerating under a simulated drag ("drag to rotate" is a real feature).
- **Push-to-talk:** a voice waveform bar rises, the console types the agent's reply character-by-character with keyboard ticks, and the orb pulses into its "speaking" state.

## Outro / punchline
Logo lockup: **JARVIS DECK** over the orb at full pulse. Line: "open-source · runs local · one command to boot" — then the repo URL. The joke lands because the sci-fi fantasy was the product demo all along.

## User flow worth showing
entry → key action → result:
1. Boot the deck — orb ignites, dock panels populate (Scene 2)
2. Inspect the agent's work — memory galaxy, drag to rotate (Scene 3)
3. Hold SPACE, speak — the agent replies on screen, orb goes to speaking (Scene 4)

## Tone
- Preset: cinematic
- Creative direction: "your personal JARVIS, booted" — trailer-scale reveals with product-clean restraint
- Interpretation: wide dark frames, big Orbitron type, dramatic but unhurried reveals; the HUD chrome does the drama, SFX stay sparse and motion-matched.

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from the project)
- Background: #020610 (near-black navy; cards #090e17)
- Accent: #00f0ff (cyan), glow rgba(0,240,255,0.35)
- Text: #f0f6fc primary, #94a3b8 secondary
- Display font: Orbitron (900/700)
- Body font: Rajdhani; mono: JetBrains Mono
- Strongest visual element: the plasma orb (fbm shader core + neural web) and the HUD language — scanlines, chamfered panels, tactical corner brackets, 32px grid

## Share copy (draft)
"Built an open-source control deck for my personal AI agent — plasma neural orb, a 3D galaxy of everything it's working on, push-to-talk voice. Runs local, boots with one command. MIT on GitHub."

## Audio direction
- Role: cinematic support
- Music: cinematic bed (pick from bundled tracks at composition time; prefer a dark/atmospheric cue over bright business-pop)
- Music treatment: fade in under the boot flicker (~0.5s), swell into the hook slam, stay low under Scenes 2-4, final hit + fade on the outro logo
- Music cue guidance: cue preset for the chosen bundled track will be read from `assets/music/cues/` at composition time; target strong cues at the hook text (Scene 1), the galaxy reveal (Scene 3) and the outro lockup (Scene 5). Sequential text reveals snap to every other beat so lines stay readable.
- Audio-reactive treatment: subtle — orb core pulse and dock glow may breathe with music energy; no waveform bars outside the voice scene
- SFX posture: sparse, motion-matched — boot flicker, one UI tick per dock item, keyboard ticks in the console, one soft impact on the galaxy reveal, one heavier hit on the outro
- Audio-coupled moments: typed reply text (Scene 4), card-by-card "top 3 actions" reveal (Scene 2), simulated galaxy drag (Scene 3)
- Restraint rule: no SFX spam on the orb's idle pulsing; the bed stays quiet enough that the two big text slams read clean

## Storyboard

### Scene 1 — Boot / Hook — 3s
Near-black frame with HUD grid + scanlines. A CRT boot flicker, then the orb ignites center-frame: layered radial-gradient core pulsing, a neural web of nodes and edges fading in around it. At ~0.8s the hook line slams in below the orb: "YOUR AGENT HAS A COCKPIT NOW." (Orbitron 900, cyan-white, letter-spaced). Hold to read (~1.8s settled).
Sequential/interaction: none
Audio intent: cold open → ignition swell; the music's first strong cue lands on the text slam
Audio-coupled idea: boot flicker ticks; one soft impact on the text slam
Music: cinematic bed, fade-in from silence
Transition mood: dramatic wipe → Scene 2

### Scene 2 — The deck — 4.5s
Full-deck recreation: left dock rail with real item labels (Today, Memory, Status, Tickers — each with a lucide-style glyph), a "Today's top 3 actions" brief card, and a bottom status bar reading "8/16 SERVICES UP · ALL LOCAL". The three action rows arrive one by one (~0.45s apart) with UI ticks, then the full set holds ~1.6s so every line reads. Label "JARVIS DECK" top-right in small mono.
Sequential/interaction: yes — 3 action rows reveal one by one; status bar types/counts up
Audio intent: confident, rhythmic; ticks keep the UI feeling live
Audio-coupled idea: per-row UI tick; count-up on the services number
Music: bed continues, subtle pulse under reveals
Transition mood: clean crossfade → Scene 3

### Scene 3 — Memory galaxy — 4.5s
Deep-space frame: a 3D star cloud (three status clusters — active cyan, queued amber, done slate) drifts in with slow rotation. Caption top-left: "EVERY TASK. EVERY JOB. EVERY SERVICE." (reads ~1.5s). Then a simulated drag: cursor grabs, the cloud accelerates its spin, stars streak slightly, caption swaps to "DRAG TO ROTATE" bottom-center with a 0.8s+ hold. One soft impact on the drag grab.
Sequential/interaction: yes — simulated click-drag rotate on the star cloud
Audio intent: awe, weight — the bed swells slightly with the spin
Audio-coupled idea: impact on drag grab; faint whoosh during fast spin
Music: bed swells, then dips before the voice scene
Transition mood: hard cut → Scene 4

### Scene 4 — Push-to-talk — 4.5s
Console frame: a waveform bar rises as a "HOLD SPACE TO TALK" keycap pulses (real feature: hold SPACE anywhere). The orb in the corner switches to its amber "listening" ring, then cyan "speaking". The agent's reply types into the console character-by-character with keyboard ticks (~1.8s of typing), full reply holds ~1.4s. Reply copy is product-true and fictional-safe, e.g. "Brief ready — 3 actions, 2 services degraded, release green."
Sequential/interaction: yes — keycap press → waveform rise → typed reply
Audio intent: intimacy — the bed drops low; typing ticks carry the scene
Audio-coupled idea: keyboard ticks during typing; soft confirm on reply completion
Music: low bed only
Transition mood: soft crossfade → Scene 5

### Scene 5 — Outro — 3.5s
The orb returns full-frame at maximum pulse. Logo lockup fades in: "JARVIS DECK" (Orbitron 900) over "OPEN-SOURCE · RUNS LOCAL · ONE COMMAND TO BOOT" (Rajdhani), then the repo line "github.com/DeezGit21/jarvis-deck" in mono with a final heavier music hit. Hold 2s+.
Sequential/interaction: none
Audio intent: finality — the swell resolves on the logo hit
Audio-coupled idea: one heavier impact on the logo lockup
Music: final hit + fade-out
Transition mood: fade to black

**Music mood for this video:** cinematic
**Audio summary:** a dark cinematic bed that swells at the hook and galaxy, drops low for the voice moment, and resolves on one heavy outro hit — sparse motion-matched SFX carry the UI's aliveness without crowding the text.

## Safety note
All service names, action rows, and console copy shown on screen are fictional stand-ins invented for the video — no real hostnames, IPs, customer names, or personal data from the developer's live deck appear anywhere.
