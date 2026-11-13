# Workshop — 3D Build Space for jarvis-deck (Spec)

Derived from the reference video ("JARVIS builds 3D objects in a workshop with Fable 5.2"):
build-from-prompt, exploded views, labeled parts, voice-controlled editing, part inspection.
Adapted to jarvis-deck's architecture: **the LLM only produces structured scene JSON; the
frontend renders it deterministically with three.js** (same split as the WirePro decision:
deterministic engine computes, AI only specifies).

## What the Workshop is

A new **Workshop** tab in the deck. A 3D viewport where JARVIS constructs objects out of
primitive parts on command, which can then be exploded, labeled, inspected, and edited by
voice or text — all local, persisted, and reproducible.

## Features (in scope, v1)

1. **Build from prompt** — type or speak "build yourself a body" / "build a robotic arm".
   Backend asks Gemini for a structured build plan; frontend renders parts appearing
   sequentially with a build animation and JARVIS speaks a short confirmation.
2. **Exploded view** — slider 0→1 plus voice "pull it apart" / "put it back together":
   every part translates outward along its explosion vector, animated.
3. **Part labels** — toggleable sprite labels anchored to each part.
4. **Part inspection** — click a part → highlighted + its metadata card; "what is this?"
   asks the agent about the selected part specifically.
5. **Voice/text editing** — "make the reactor ring red", "add two more arms", "remove the
   heat sink": backend returns an ops patch, applied deterministically; scene re-renders.
6. **Persistence** — scene JSON saved server-side after every change; the tab reopens with
   the last scene (saved data must visibly render — never a blank viewport after reload).
7. **Empty state** — a default demo scene (small robot core: base, reactor core, ring,
   head) ships built-in so a fresh user sees a working 3D scene immediately.

## Out of scope (v1, deferred)

- Photorealistic rendering (v1 uses stylized PBR-ish materials + environment presets).
- Image/floor-plan → 3D ingestion.
- Sub-part physics, mesh generation beyond primitives, GLTF import.

## Architecture

- **Backend** (`dashboard/plugin_api.py`): Gemini direct call (pattern of `/vision/analyze`),
  model `gemini-2.5-flash`, `responseSchema` constrained JSON. Scene persisted to
  `~/.hermes/agentos/cache/workshop-scene.json`. Server validates/caps the scene (part count,
  string lengths, numeric ranges) so a bad LLM response can't wedge the renderer.
- **Frontend** (`desktop/plugin.js`): `Workshop3D` component (three.js WebGLRenderer,
  OrbitControls), `WS_Store` (scene + explosion + selection + subscribe), `WorkshopTab`
  (viewport + command bar + voice button reusing the deck's mic/TTS patterns).
- Scene JSON schema is the single contract between backend and renderer.

## Scene schema (the contract)

```json
{
  "name": "robot body",
  "parts": [
    {
      "id": "reactor",
      "label": "Emerald reactor core",
      "desc": "The glowing power core at the center of the chest.",
      "shape": "cylinder",            // box|sphere|cylinder|cone|torus|octahedron|capsule
      "params": {"r": 0.5, "h": 0.3}, // per-shape params (r,h | w,h,d | r | tube,r)
      "pos": [0, 0.9, 0], "rot": [0, 0, 0],   // meters, radians
      "explodeDir": [0, 1, 0.4],              // unit-ish direction for explode
      "material": {"color": "#10b981", "emissive": "#10b981", "emissiveIntensity": 1.6,
                    "metalness": 0.3, "roughness": 0.35, "opacity": 1.0}
    }
  ],
  "updated": "2026-11-12T17:00:00"
}
```

Rules: ≤ 48 parts, labels ≤ 60 chars, desc ≤ 300 chars, numeric fields finite and sane
(|pos| ≤ 20). Unknown shapes render as a box; a malformed part is dropped, not fatal.

## Operations the backend may emit on edit

`add_part` (full part object), `remove_part {id}`, `update_part {id, patch}` (merge into
part: material fields, params, pos, rot, label, desc), `set_camera {target}` (reserved).
Applied in order; ids are slugs regenerated on collision.

## Endpoints

- `GET  /workshop/scene` → `{ok, scene}` (defaults to the demo scene when nothing saved)
- `POST /workshop/scene` → persist a client-edited scene `{ok}`
- `POST /workshop/build {prompt}` → fresh scene from prompt → `{ok, scene, speech, ops}`
- `POST /workshop/edit {prompt}` → ops against the current scene → `{ok, scene, speech, ops}`
- Requires `GEMINI_API_KEY` (409 without it, like vision). Speech lines ≤ 600 chars.

## Voice

The Workshop command bar gets a mic button (same Web Speech pattern as the console) and
JARVIS's reply is spoken through `Tts.speak` with the 600-char cap. The deck's global
push-to-talk (Space) already routes to the console and is left untouched.
