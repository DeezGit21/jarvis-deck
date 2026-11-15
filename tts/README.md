# Jarvis — Real Time TTS

<p align="center">
  <img src="docs/orb.png" width="560" alt="The Jarvis Deck orb — a plasma-core neural sphere surrounded by orbiting memory clusters">
</p>

Hold a button, talk, and **Jarvis starts answering out loud about one second
after you stop talking** — sentence by sentence, while the rest of the reply is
still being generated.

This repo is a minimal, self-contained implementation of that realtime
push-to-talk voice loop. It fixes the classic problem with "talk to your
computer" demos: they feel dead. The naive loop is full LLM turn (10–90s) →
full TTS synthesis (1–5s) → *then* the first sound. By the time anything
happens you've lost the conversation. This one breaks both stages open and
overlaps them. No message queue, no websocket server farm — one FastAPI file
and one static page.

Extracted from the [jarvis-deck](https://github.com/DeezGit21/jarvis-deck)
project (MIT).

## Want the whole dashboard?

This repo is the voice loop only. The orb in the image above lives in
**[jarvis-deck](https://github.com/DeezGit21/jarvis-deck)** — the full Jarvis
ops dashboard this was extracted from: a personal command deck with a real-time
neural orb + 3D memory galaxy, daily briefings, a task/goal board, service
health and auto-remediation, revenue telemetry, a console with `/`-commands,
persistent memory, and this same voice loop wired through all of it. If you
like the voice, that's where it gets superpowers.

## What it actually does

1. **Push-to-talk.** Hold **SPACE** (or the mic button); the browser's
   Web Speech API transcribes your voice. Release to send. Typed input works
   everywhere as a fallback.
2. **Instant verbal acknowledgement.** While the reply is still streaming, a
   short rotating line ("Right away, sir", "On it, sir") is spoken from the
   fast pre-warmed TTS cache (~100ms). You hear Jarvis acknowledge before the
   answer even exists.
3. **Sentence-level LLM streaming.** `POST /voice/chat` streams the LLM
   (OpenRouter) token-by-token and splits **complete sentences** off the
   buffer as they form, emitting each as an NDJSON event the instant it
   completes.
4. **Per-sentence streaming TTS.** Each sentence event goes into a client
   speak-queue and is fetched from `GET /tts` — a streaming `audio/mpeg`
   response from edge-tts. The browser's `Audio` element starts playing while
   chunks are still arriving, so first sound lands well under a second.
   Sentences play back-to-back with no gaps between them.
5. **Action execution (`[[agent]]`).** If the model decides the request needs
   a *real action* (run a script, restart a service, check a URL) instead of
   an answer, it replies with exactly `[[agent]] <command>`. Those sentences
   are **withheld from speech** — even mid-stream, before the marker is
   complete — and the command is executed locally by the Hermes one-shot
   agent (`hermes -z <instruction>`, full toolset, local file access). Jarvis
   opens with a spoken acknowledgement — *"Delegating to Hermes Agent, sir."*
   or *"Hermes executing now, sir."* — that plays instantly from the TTS
   cache while the agent works. The
   agent's report comes back as `{t:'agent_result'}`, is fed into the
   conversation, and a second turn has Jarvis **speak a 1–2 sentence summary
   of the outcome**. Jarvis never reads a command out loud; `HERMES_AGENT=0`
   falls back to emitting `{t:'agent'}` for an external host to handle.
6. **Barge-in.** `Esc` or the stop button kills both the in-flight stream and
   the speech queue cleanly; the next turn starts fresh.
7. **Rolling memory.** The last 24 turns survive across requests server-side;
   `/voice/reset` clears them.

## The loop in one picture

```
 hold SPACE ──► Web Speech API ──► POST /voice/chat ──► OpenRouter (streaming)
                    transcript           │                     │
                                         │                tokens stream in
                                         ▼                     ▼
              ┌──────────── sentence splitter (as they complete) ──────────┐
              │  {t:'s',text:"First sentence."}   {t:'s',text:"Second…"}   │
              └───────────────────────┬───────────────────────┬────────────┘
                                      │                       │
                     client speak-queue (back-to-back)        │
                                      │                       │
                                      ▼                       ▼
                          GET /tts (streaming mp3)      remaining text still
                          Audio plays as chunks arrive  generating
                          ~1s to first sound ◄─────────── overlap is the point
```

## Quickstart

```bash
pip install -r requirements.txt
cp .env.example .env        # add at least OPENROUTER_API_KEY
python server.py            # http://localhost:8899
```

Open http://localhost:8899 in **Chrome or Edge** (mic input needs the Web
Speech API; every other browser can type instead).

**Want it to sound more like JARVIS from the MCU? Use the Gemini API key** —
drop it in `.env` and add `provider=gemini` to `/tts` for the proper
RP-butler voice (the default edge voice is free and works with no key).

No API key? The TTS half still works:

```bash
curl -o test.mp3 "http://localhost:8899/tts?text=Right%20away%2C%20sir"
```

## API

| Endpoint | What it does |
|---|---|
| `POST /voice/chat {query}` | NDJSON stream: `{t:'s',text}` per sentence, `{t:'agent',cmd}`, `{t:'agent_result',text}`, `{t:'err',msg}`, `{t:'done'}` |
| `GET /tts?text=...` | Streaming audio. edge-tts by default; `provider=gemini` uses the style-prompted JARVIS British-butler voice (needs `GEMINI_API_KEY`) |
| `POST /voice/reset` | Clear rolling conversation history |
| `GET /healthz` | Liveness + current model |

### Config (env vars or `.env`)

| Var | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | required for `/voice/chat` |
| `GEMINI_API_KEY` | — | optional, enables `provider=gemini` on `/tts` |
| `VOICE_MODEL` | `z-ai/glm-5.3-flash` | any OpenRouter model; fast models shine in voice loops |
| `JARVIS_PERSONA` | `the operator` | who the assistant serves |
| `TTS_VOICE` / `TTS_RATE` | `en-GB-RyanNeural` / `+4%` | edge voice |
| `GEMINI_TTS_VOICE` | `Charon` | gemini voice |
| `HERMES_AGENT` | `1` | when Jarvis emits `[[agent]] <cmd>`, run it locally via the Hermes one-shot agent (`hermes -z <cmd>`) and feed the report back so Jarvis speaks a summary. `0` = hand-off-only |
| `HERMES_BIN` | `hermes` | hermes CLI on PATH |
| `HERMES_IN` | launch directory (server's cwd) | working directory Hermes runs in |
| `HERMES_TIMEOUT` | `600` | seconds before the agent run is abandoned |

## Files

```
server.py       FastAPI: /voice/chat sentence stream + /tts streaming audio
web/index.html  push-to-talk UI
web/app.js      stream reader, sentence speak queue, barge-in
web/style.css   dark console styling
```

## Gotchas baked in (learned the hard way so you don't have to)

- **No speechSynthesis fallback. Ever.** This page is served by the same
  server that synthesizes, so if `/tts` fails the app is down — and a
  Microsoft system voice blurting over the dead Jarvis voice is worse than
  silence. Genuine failures retry once, then surface an inline
  `[tts unavailable]` note while the queue drains on. (The classic
  double-voice bug came from `stop()`'s `AbortError` being mistaken for a
  load failure — it rejects *after* the audio handle was swapped.)
- **Never half-speak a marker.** A sentence arriving while `[[` is streaming
  is withheld until the marker resolves; if no complete marker appears, the
  withheld sentences flush and are spoken after all.
- **600-char spoken cap.** Any text longer than ~600 chars is cut at the last
  sentence boundary — a runaway reply must not become a ten-minute utterance.
- **Cache trap when testing TTS changes.** Audio is cached by
  `sha1(provider|voice|text)`; the same test text keeps serving the old cached
  format and masks your fix. Test with fresh text.
- **`[[agent]]` commands actually execute now.** When Jarvis hands off, the
  server runs `hermes -z "<instruction>"` (the Hermes one-shot agent — full
  local toolset, runs in `HERMES_IN`, which defaults to the directory the
  server was launched from), emits `{t:'agent_result',text}` with the
  report, and streams a second turn so Jarvis speaks a 1–2 sentence summary of
  the outcome. Jarvis first speaks a random acknowledgement —
  "Delegating to Hermes Agent, sir." / "Hermes executing now, sir." — while
  the agent works. The command is an *instruction*, not a shell command —
  Hermes decides how to perform it. `HERMES_AGENT=0` returns to hand-off-only.
- The mic leg cannot be tested headlessly (SpeechRecognition needs real
  audio); everything else is testable with curl.

## More open-source from the same builder

- **[skill-radar](https://github.com/DeezGit21/skill-radar)** — discovers AI
  agent skills, MCP servers, and coding tools by scanning GitHub, local files,
  and the web; recommends the relevant ones upfront. Works with Claude Code,
  Hermes, any agent LLM.
- **[Prompt_Forge](https://github.com/DeezGit21/Prompt_Forge)** — prompt
  enhancement tool that turns one-liner prompts into structured, high-signal
  ones.

## License

MIT — see [LICENSE](LICENSE).
