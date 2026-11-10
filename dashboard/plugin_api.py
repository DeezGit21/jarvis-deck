"""agentos dashboard backend — routes mount under /api/plugins/agentos/.

Runs inside the gateway process. Dependency-light: fastapi + stdlib + PyYAML.
Heavy/fragile integrations (webull, plaid) run as subprocesses in their own
venv under ~/.hermes/agentos/venv and write JSON snapshots to the cache dir.
"""
from __future__ import annotations

import csv
import datetime as _dt
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

import yaml
from fastapi import APIRouter, Body, HTTPException

router = APIRouter()

HOME = Path.home()
AGENTOS = HOME / ".hermes" / "agentos"
CACHE = AGENTOS / "cache"
GOALS_FILE = AGENTOS / "goals.md"
APPS_FILE = AGENTOS / "apps.yaml"
ENV_FILE = AGENTOS / ".env"
MONEY_VENV_PY = AGENTOS / "venv" / "Scripts" / "python.exe"

AGENTOS_YAML = AGENTOS / "agentos.yaml"


def _agentos_config() -> dict:
    """Optional instance config: persona, hub url, db target, tz, service pings.

    Lives outside the repo (~/.hermes/agentos/agentos.yaml) so a public checkout
    carries no personal topology. Every key has a generic default.
    """
    if not AGENTOS_YAML.exists():
        return {}
    try:
        data = yaml.safe_load(AGENTOS_YAML.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


_CFG = _agentos_config()
_PERSONA = str(_CFG.get("persona") or "the operator")
_HUB_URL = str(_CFG.get("hub_url") or "http://localhost:3003")
_DB_CFG = _CFG.get("db") if isinstance(_CFG.get("db"), dict) else {}
AGENTOS_TZ = _dt.timezone(_dt.timedelta(hours=float(_CFG.get("tz_offset_hours", -7))))

# ---------------------------------------------------------------- helpers


def _sh(args: list[str], timeout: int = 30) -> tuple[int, str, str]:
    # Strip PYTHONPATH/PYTHONHOME: a stray PYTHONPATH pointing at a foreign
    # site-packages (e.g. a hermes installs venv) shadows the agentos venv's
    # own packages — a broken numpy there made webull imports fail.
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")}
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except FileNotFoundError as e:
        return 127, "", str(e)


def _local_date() -> str:
    return _dt.datetime.now(AGENTOS_TZ).strftime("%Y-%m-%d")


def _read_env() -> dict[str, str]:
    out: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


# ---------------------------------------------------------------- health


@router.get("/health")
def health():
    return {"ok": True, "date": _local_date(), "time": _dt.datetime.now().isoformat(timespec="seconds")}


# ---------------------------------------------------------------- metrics


def _psql(sql: str, timeout: int = 25) -> list[list[str]]:
    # SQL goes over ssh stdin, output as CSV — nothing shell-special in the
    # remote command line or the payload.
    args = [
        "ssh", str(_DB_CFG.get("ssh_host", "db-host")),
        "psql", "-U", str(_DB_CFG.get("psql_user", "postgres")),
        "-d", str(_DB_CFG.get("psql_db", "postgres")),
        "-t", "--csv",
    ]
    try:
        p = subprocess.run(args, input=sql, capture_output=True, text=True, timeout=timeout)
        rc, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        rc, out, err = 124, "", f"timeout after {timeout}s"
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"psql failed: {err.strip()[:300]}")
    rows = list(csv.reader(out.strip().splitlines()))
    return [r for r in rows if any(cell.strip() for cell in r)]


METRICS_SQL = """
SELECT
  (SELECT count(*) FROM leads WHERE created_at >= date_trunc('week', now()) AND deleted_at IS NULL) AS leads_week,
  (SELECT count(*) FROM jobs WHERE created_at >= date_trunc('week', now()) AND deleted_at IS NULL) AS jobs_week,
  (SELECT COALESCE(SUM(amount_paid), 0) FROM jobs WHERE deleted_at IS NULL AND created_at >= date_trunc('month', now())) AS revenue_mtd,
  (SELECT count(*) FROM jobs WHERE scheduled_date = current_date AND deleted_at IS NULL) AS jobs_today;
"""

STATUS_SQL = (
    "SELECT status, count(*), COALESCE(SUM(total_price), 0) FROM jobs "
    "WHERE deleted_at IS NULL GROUP BY status ORDER BY count(*) DESC;"
)


@router.get("/metrics")
def metrics():
    hdr = _psql(METRICS_SQL)[0]
    cols = ["leads_week", "jobs_week", "revenue_mtd", "jobs_today"]
    data = dict(zip(cols, hdr))
    by_status = [{"status": r[0], "count": int(r[1]), "total_price": float(r[2])} for r in _psql(STATUS_SQL)]
    return {"date": _local_date(), **data, "revenue_mtd": float(data["revenue_mtd"]), "jobs_by_status": by_status}


# ---------------------------------------------------------------- status


# Instance services come from agentos.yaml — nothing personal in the repo.
SERVICE_PINGS = [
    {"name": str(s["name"]), "url": str(s["url"])}
    for s in (_CFG.get("services") or [])
    if isinstance(s, dict) and s.get("name") and s.get("url")
]


def _ping(url: str) -> dict:
    t0 = time.monotonic()
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "agentos/0.1"})
        with urllib.request.urlopen(req, timeout=6) as r:
            return {"ok": True, "code": r.status, "ms": int((time.monotonic() - t0) * 1000)}
    except Exception as e:  # noqa: BLE001 - report any failure as a red status
        return {"ok": False, "error": str(e)[:120], "ms": int((time.monotonic() - t0) * 1000)}


UPTIME_FILE = CACHE / "uptime-history.json"


def _record_uptime(services: list[dict]) -> None:
    """Append latency samples per service; keep the last 40 checks."""
    try:
        hist = json.loads(UPTIME_FILE.read_text(encoding="utf-8")) if UPTIME_FILE.exists() else {}
    except (json.JSONDecodeError, OSError):
        hist = {}
    for s in services:
        if s.get("up") is None:
            continue
        arr = hist.setdefault(s["name"], [])
        arr.append({"t": _dt.datetime.now().isoformat(timespec="seconds"),
                    "ok": bool(s["up"]), "ms": s.get("ms")})
        hist[s["name"]] = arr[-40:]
    CACHE.mkdir(parents=True, exist_ok=True)
    UPTIME_FILE.write_text(json.dumps(hist), encoding="utf-8")


def _apps_notes() -> dict:
    if not APPS_FILE.exists():
        return {}
    try:
        data = yaml.safe_load(APPS_FILE.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return {}
    apps = data.get("apps") if isinstance(data, dict) else None
    return {a["name"]: a for a in (apps or []) if isinstance(a, dict) and "name" in a}


@router.get("/status")
def status():
    notes = _apps_notes()
    services = []
    for svc in SERVICE_PINGS:
        r = _ping(svc["url"])
        note = notes.get(svc["name"], {})
        services.append({
            "name": svc["name"],
            "url": svc["url"],
            "up": bool(r.get("ok")),
            "ms": r.get("ms"),
            "detail": r.get("code") or r.get("error") or "",
            "note": note.get("note", ""),
            "status_note": note.get("status", ""),
            "updated": note.get("updated", ""),
        })
    extra_notes = [
        {"name": k, "up": None, "detail": "", "note": v.get("note", ""), "status_note": v.get("status", ""), "updated": v.get("updated", "")}
        for k, v in notes.items()
        if k not in {s["name"] for s in SERVICE_PINGS}
    ]
    all_rows = services + extra_notes
    try:
        _record_uptime(all_rows)
    except OSError:
        pass  # history is best-effort; the live status must not fail
    hist = {}
    try:
        hist = json.loads(UPTIME_FILE.read_text(encoding="utf-8")) if UPTIME_FILE.exists() else {}
    except (json.JSONDecodeError, OSError):
        pass
    for s in all_rows:
        rows = hist.get(s["name"]) or []
        s["history"] = [{"ms": r.get("ms"), "ok": r.get("ok")} for r in rows[-20:]]
    return {"date": _local_date(), "services": all_rows}


# ---------------------------------------------------------------- todos


@router.get("/todos")
def todos():
    rc, out, err = _sh(["hermes", "kanban", "list", "--json"], timeout=40)
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"kanban list failed: {err.strip()[:300]}")
    try:
        tasks = json.loads(out)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="kanban list returned non-JSON") from None
    keep = {"todo", "ready", "blocked", "review", "scheduled"}
    rows = [
        {"id": t.get("id"), "title": t.get("title", "")[:140], "status": t.get("status"),
         "priority": t.get("priority", 0), "assignee": t.get("assignee", "")}
        for t in tasks if t.get("status") in keep
    ]
    rows.sort(key=lambda t: (-t["priority"], t["status"]))
    return {"tasks": rows, "total_open": len(rows)}


@router.post("/todos/create")
def todos_create(body: dict = Body(...)):
    """Create a kanban task (no assignee — stays visible on the board)."""
    title = str(body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    title = title[:200]
    rc, out, err = _sh(["hermes", "kanban", "create", title, "--json"], timeout=40)
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"kanban create failed: {err.strip()[:300]}")
    try:
        task = json.loads(out)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="kanban create returned non-JSON") from None
    return {"ok": True, "id": task.get("id"), "status": task.get("status"), "title": title}


# ---------------------------------------------------------------- goals


@router.get("/goals")
def goals_get():
    if not GOALS_FILE.exists():
        return {"text": "", "missing": True}
    return {"text": GOALS_FILE.read_text(encoding="utf-8"), "missing": False}


@router.post("/goals")
def goals_set(text: str = Body(..., embed=True)):
    if len(text) > 60_000:
        raise HTTPException(status_code=413, detail="goals file too large")
    AGENTOS.mkdir(parents=True, exist_ok=True)
    GOALS_FILE.write_text(text, encoding="utf-8")
    return {"ok": True, "bytes": len(text)}


# ---------------------------------------------------------------- brief


BRIEF_PROMPT = """You are the chief of staff for {persona}. \
Write today's operational brief. Use ONLY the data provided below; do not invent numbers.

Data:
{context}

Write the brief in markdown, under 350 words, zero fluff, in this order:
1. **Top priorities today** (max 3, tied to goals where possible)
2. **Business** (bookings, revenue, pipeline — cite the numbers given)
3. **Projects & apps** (anything down or needing attention)
4. **Tasks** (top open items worth acting on today)
5. **Watch list** (risks, stale items)
No greeting, no closing, no offers to do more.
"""


@router.get("/brief/today")
def brief_today():
    path = CACHE / f"brief-{_local_date()}.md"
    if path.exists():
        return {"brief": path.read_text(encoding="utf-8"), "generated_at": path.stat().st_mtime, "date": _local_date()}
    return {"brief": None, "date": _local_date()}


def _brief_context() -> str:
    parts = []
    try:
        parts.append("## Goals\n" + GOALS_FILE.read_text(encoding="utf-8"))
    except OSError:
        parts.append("## Goals\n(no goals file)")
    try:
        parts.append("## Metrics (live)\n" + json.dumps(metrics(), default=str))
    except HTTPException as e:
        parts.append(f"## Metrics\n(unavailable: {e.detail})")
    try:
        parts.append("## Services\n" + json.dumps(status()["services"], default=str))
    except Exception as e:  # noqa: BLE001
        parts.append(f"## Services\n(unavailable: {e})")
    try:
        parts.append("## Open tasks\n" + json.dumps(todos()["tasks"], default=str))
    except HTTPException as e:
        parts.append(f"## Open tasks\n(unavailable: {e.detail})")
    planner_snap = CACHE / f"planner-{_local_date()}.json"
    try:
        if planner_snap.exists():
            pd = json.loads(planner_snap.read_text(encoding="utf-8"))
            if pd.get("state") == "ok":
                slim = {
                    "focus": pd.get("focus", ""),
                    "open_planner_tasks": [t["text"] for t in pd.get("planner_tasks", []) if not t.get("done")],
                    "inbox_today": [t["text"] for t in pd.get("inbox_today", [])],
                    "inbox_overdue": [t["text"] for t in pd.get("inbox_overdue", [])],
                    "repeating_today_unchecked": [r["text"] for r in pd.get("repeating_today", []) if not r.get("checked_today")],
                    "habits": pd.get("habits", {}),
                    "projects": pd.get("projects", []),
                    "week_focus": pd.get("week_focus", ""),
                }
                parts.append("## ADHD Planner (today)\n" + json.dumps(slim, default=str))
    except Exception as e:  # noqa: BLE001
        parts.append(f"## ADHD Planner\n(unavailable: {e})")
    return "\n\n".join(parts)


@router.post("/brief/generate")
def brief_generate():
    CACHE.mkdir(parents=True, exist_ok=True)
    prompt = BRIEF_PROMPT.format(context=_brief_context(), persona=_PERSONA)
    prompt_file = CACHE / "brief-prompt.txt"
    prompt_file.write_text(prompt, encoding="utf-8")
    try:
        p = subprocess.run(
            ["hermes", "chat", "-Q", "--query-file", "-"],
            input=prompt, capture_output=True, text=True, timeout=480,
        )
        rc, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        rc, out, err = 124, "", "brief generation timed out after 480s"
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"brief generation failed: {err.strip()[:300]}")
    # hermes chat -Q prints the answer, then a trailing session_id line — drop it.
    lines = [ln for ln in out.strip().splitlines() if not ln.startswith("session_id:")]
    brief = "\n".join(lines).strip()
    if not brief:
        raise HTTPException(status_code=502, detail="brief generation returned empty output")
    path = CACHE / f"brief-{_local_date()}.md"
    path.write_text(brief, encoding="utf-8")
    return {"brief": brief, "date": _local_date(), "prompt_file": str(prompt_file)}


BROADCAST_MODEL = "gemini-2.5-flash"

BROADCAST_SCHEMA = {
    "type": "object",
    "properties": {
        "speech": {"type": "string"},
        "followUps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["speech", "followUps"],
}

BROADCAST_PROMPT = """You are JARVIS, the voice assistant on the operations dashboard. \
Convert today's daily brief into a spoken announcement plus follow-up suggestions.

Rules:
- speech: 120-220 words of clean speakable prose — no markdown, no bullets, no symbols. \
Cover the top priorities first, then business numbers (round them for speech), then \
anything down or at risk. Start with a one-line greeting appropriate to the current \
local time given below. Speak TO D, confident chief-of-staff tone, zero fluff.
- followUps: 0-5 concrete commands D could give his agent immediately after the brief \
(imperative voice, under 90 characters each, executable via hermes/kanban/hub tools).

Return ONLY JSON matching the schema.

Current local time: {now}

Daily brief:
{brief}
"""


@router.post("/brief/broadcast")
def brief_broadcast():
    """JARVIS read-out: speakable script of today's brief + suggested follow-up commands.

    Cached per brief revision (keyed on the brief file's mtime), so re-running the
    read-out is instant until the brief is regenerated.
    """
    path = CACHE / f"brief-{_local_date()}.md"
    if not path.exists():
        raise HTTPException(status_code=409, detail="no brief for today yet — generate it first")
    brief = path.read_text(encoding="utf-8")
    mtime = int(path.stat().st_mtime)
    cache = CACHE / "brief-speech-latest.json"
    if cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("brief_mtime") == mtime and data.get("speech"):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    env = _read_env()
    key = env.get("GEMINI_API_KEY", "")
    if not key:
        raise HTTPException(status_code=409, detail="GEMINI_API_KEY missing from ~/.hermes/agentos/.env")
    now_local = _dt.datetime.now(PHOENIX).strftime("%A %B %d, %Y at %I:%M %p")
    payload = {
        "contents": [{"parts": [{"text": BROADCAST_PROMPT.format(brief=brief[:12000], now=now_local)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": BROADCAST_SCHEMA,
            "maxOutputTokens": 2048,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{BROADCAST_MODEL}:generateContent?key={urllib.parse.quote(key)}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"gemini call failed: {str(e)[:200]}") from None
    cands = resp.get("candidates") or []
    parts = ((cands[0].get("content") or {}).get("parts")) if cands else []
    text = (parts[0].get("text") if parts else "") or ""
    data = _extract_json(text)
    if data is None or not data.get("speech"):
        raise HTTPException(status_code=502, detail=f"unparseable broadcast output: {text[:200]}")
    out = {
        "ok": True, "date": _local_date(),
        "speech": str(data["speech"])[:6000],
        "followUps": [str(f).strip()[:120] for f in (data.get("followUps") or [])[:6] if str(f).strip()],
        "brief_mtime": mtime,
        "at": _dt.datetime.now().isoformat(timespec="seconds"),
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, default=str), encoding="utf-8")
    return out


# ---------------------------------------------------------------- jarvis console

@router.post("/command")
def command(body: dict = Body(...)):
    """Run a natural-language command through the Hermes agent (full tool access).

    This is the Jarvis layer: voice or typed prompts from the dashboard execute
    real actions — kanban tasks, hub queries, scripts, anything hermes chat can do.
    """
    query = (body.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query required")
    if len(query) > 8000:
        raise HTTPException(status_code=400, detail="query too long")
    try:
        p = subprocess.run(
            ["hermes", "chat", "-Q", "--query-file", "-"],
            input=query, capture_output=True, text=True, timeout=600,
        )
        rc, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        rc, out, err = 124, "", "command timed out after 600s"
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"command failed: {(err or out).strip()[:300]}")
    lines = [ln for ln in out.strip().splitlines() if not ln.startswith("session_id:")]
    reply = "\n".join(lines).strip()
    if not reply:
        raise HTTPException(status_code=502, detail="command returned empty output")
    return {"ok": True, "reply": reply, "date": _local_date()}


# ---------------------------------------------------------------- advisor

import hashlib as _hashlib
import re as _re

RECS_FILE = AGENTOS / "advisor_recs.json"

ADVISOR_PROMPT = """You are the chief of staff for {persona}.
Read the operational data and the outstanding-recommendation ledger below and decide the
THREE most important concrete actions for today.

Filter every candidate through three strict tiers, in order of urgency:
1. Anything actively breaking production or blocking revenue (down services, lost leads, overdue work)
2. Anything outperforming expectations that deserves more resources NOW
3. Slow operational leaks (things degrading quietly: ignored recommendations, stale tasks, undone habits)

Hard rules:
- Output EXACTLY 3 actions, ranked most urgent first.
- Each action must be concrete and executable (a task someone can start in the next hour), not a theme.
- Use ONLY numbers from the data below. If a source is unavailable, do not guess about it.
- Account for the outstanding-recommendation ledger: recommendations ignored 3+ days must
  appear among the three unless something tier-1 outranks them.

Return STRICT JSON only — no markdown fences, no commentary:
{{"actions":[{{"tier":1,"text":"..."}}]}}

Data:
{context}

Outstanding-recommendation ledger (open items, oldest attention first):
{ledger}
"""


def _load_recs() -> list[dict]:
    if not RECS_FILE.exists():
        return []
    try:
        data = json.loads(RECS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_recs(recs: list[dict]) -> None:
    AGENTOS.mkdir(parents=True, exist_ok=True)
    RECS_FILE.write_text(json.dumps(recs, indent=2, default=str), encoding="utf-8")


def _rec_id(text: str) -> str:
    return _hashlib.sha1(_re.sub(r"\s+", " ", text.strip().lower()).encode()).hexdigest()[:10]


def _age_days(iso_date: str) -> int:
    try:
        return max(0, (_dt.date.fromisoformat(_local_date()) - _dt.date.fromisoformat(iso_date)).days)
    except ValueError:
        return 0


def _accountability() -> list[dict]:
    """Deterministic loop: every open rec, oldest first, with days-ignored."""
    rows = []
    for r in _load_recs():
        if r.get("status") != "open":
            continue
        age = _age_days(r.get("created", _local_date()))
        if age < 1:
            continue
        rows.append({"id": r["id"], "text": r.get("text", ""), "tier": r.get("tier"),
                     "age_days": age, "escalated": age >= 3})
    rows.sort(key=lambda r: -r["age_days"])
    return rows


def _ledger_block() -> str:
    rows = _accountability()
    if not rows:
        return "(empty — no outstanding recommendations)"
    return json.dumps(rows, default=str)


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    text = _re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=_re.MULTILINE).strip()
    m = _re.search(r"\{.*\}", text, _re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _run_hermes_prompt(prompt: str, timeout: int = 480) -> str:
    try:
        p = subprocess.run(
            ["hermes", "chat", "-Q", "--query-file", "-"],
            input=prompt, capture_output=True, text=True, timeout=timeout,
        )
        rc, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        rc, out, err = 124, "", f"timed out after {timeout}s"
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"hermes call failed: {(err or out).strip()[:300]}")
    lines = [ln for ln in out.strip().splitlines() if not ln.startswith("session_id:")]
    reply = "\n".join(lines).strip()
    if not reply:
        raise HTTPException(status_code=502, detail="hermes returned empty output")
    return reply


@router.get("/advisor")
def advisor():
    """Cached advisor actions (if generated today) + live accountability loop."""
    cache = CACHE / f"advisor-{_local_date()}.json"
    actions = []
    generated_at = None
    if cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            actions = data.get("actions", [])
            generated_at = data.get("generated_at")
        except (json.JSONDecodeError, OSError):
            pass
    recs = {r["id"]: r for r in _load_recs()}
    for a in actions:
        r = recs.get(a.get("id"))
        if r:
            a["status"] = r.get("status")
    return {"date": _local_date(), "actions": actions, "generated_at": generated_at,
            "accountability": _accountability()}


@router.post("/advisor/generate")
def advisor_generate():
    """Run the advisor: rank today's top-3 actions, merge into the rec ledger."""
    CACHE.mkdir(parents=True, exist_ok=True)
    prompt = ADVISOR_PROMPT.format(context=_brief_context(), ledger=_ledger_block(), persona=_PERSONA)
    reply = _run_hermes_prompt(prompt)
    data = _extract_json(reply)
    if not data or not isinstance(data.get("actions"), list) or not data["actions"]:
        raise HTTPException(status_code=502, detail=f"advisor returned unparseable output: {reply[:200]}")

    today = _local_date()
    recs = _load_recs()
    by_id = {r["id"]: r for r in recs}
    merged_actions = []
    for a in data["actions"][:3]:
        text = str(a.get("text", "")).strip()
        if not text:
            continue
        rid = _rec_id(text)
        tier = a.get("tier") if a.get("tier") in (1, 2, 3) else 3
        existing = by_id.get(rid)
        if existing is None:
            rec = {"id": rid, "text": text, "tier": tier, "created": today,
                   "last_shown": today, "status": "open"}
            recs.append(rec)
        elif existing.get("status") == "open":
            existing["last_shown"] = today
            existing["tier"] = tier
            rec = existing
        else:
            # done/killed — do not resurrect silently
            continue
        merged_actions.append({"id": rec["id"], "tier": rec["tier"], "text": rec["text"]})
    _save_recs(recs)

    cache = CACHE / f"advisor-{today}.json"
    cache.write_text(json.dumps(
        {"date": today, "actions": merged_actions, "generated_at": _dt.datetime.now().isoformat(timespec="seconds")},
        default=str), encoding="utf-8")
    return {"ok": True, "actions": merged_actions, "date": today}


@router.post("/advisor/action")
def advisor_action(body: dict = Body(...)):
    rid = str(body.get("id") or "")
    action = str(body.get("action") or "")
    if not rid or action not in ("done", "kill"):
        raise HTTPException(status_code=400, detail="id and action ('done'|'kill') required")
    recs = _load_recs()
    for r in recs:
        if r.get("id") == rid and r.get("status") == "open":
            r["status"] = action
            r["closed_date"] = _local_date()
            _save_recs(recs)
            return {"ok": True, "id": rid, "status": action}
    raise HTTPException(status_code=404, detail="recommendation not found or not open")


# ---------------------------------------------------------------- tools (orbit ring)

CONFIG_FILE = HOME / "AppData" / "Local" / "hermes" / "config.yaml"


@router.get("/tools")
def tools():
    """Enabled plugins + MCP servers from config.yaml — feeds the orbit ring."""
    try:
        cfg = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        cfg = {}
    plugins: list[str] = []
    pel = (cfg.get("plugins") or {}).get("enabled") if isinstance(cfg.get("plugins"), dict) else None
    if isinstance(pel, list):
        plugins = [str(p) for p in pel if isinstance(p, str) and p]
    mcps: list[str] = []
    srv = cfg.get("mcp_servers")
    if isinstance(srv, dict):
        mcps = [k for k, v in srv.items()
                if not (isinstance(v, dict) and v.get("enabled") is False)]
    return {"plugins": plugins, "mcps": mcps}


# ---------------------------------------------------------------- connectors (orbit ring)

# Where each tool/app actually lives — clicking an orbit chip routes here.
MCP_URLS = {
    "github": "https://github.com",
    "postgres": _HUB_URL,  # routed to the instance's business app (hub_url in agentos.yaml)
    "stripe": "https://dashboard.stripe.com",
    "twilio-docs": "https://www.twilio.com/docs",
    "twelve-data": "https://twelvedata.com",
    "context7": "https://context7.com",
    "globalping": "https://globalping.io",
    "deepwiki": "https://deepwiki.com",
    "playwright": "https://playwright.dev",
    "magic": "https://21st.dev",
    "alpaca": "https://app.alpaca.markets",
}

HOSTED_URLS = {
    "cloudflare_mcp": "https://dash.cloudflare.com",
    "higgsfield_mcp": "https://higgsfield.ai",
    "gmail": "https://mail.google.com",
    "notion": "https://www.notion.so",
    "slack": "https://app.slack.com",
    "linear": "https://linear.app",
    "jira": "https://www.atlassian.com/software/jira",
    "airtable": "https://airtable.com",
    "stripe_mcp": "https://dashboard.stripe.com",
    "sendgrid": "https://app.sendgrid.com",
    "sentry_mcp": "https://sentry.io",
    "datadog_mcp": "https://app.datadoghq.com",
    "vercel_mcp": "https://vercel.com",
    "supabase": "https://supabase.com",
    "shopify": "https://admin.shopify.com",
    "todoist_mcp": "https://todoist.com",
    "calendly": "https://calendly.com",
    "asana": "https://app.asana.com",
    "clickup_mcp": "https://app.clickup.com",
    "box": "https://app.box.com",
    "confluence": "https://www.atlassian.com/software/confluence",
    "railway": "https://railway.app",
    "neon_mcp": "https://neon.tech",
    "turso": "https://turso.tech",
    "posthog_mcp": "https://posthog.com",
    "semrush": "https://www.semrush.com",
    "ahrefs_mcp": "https://ahrefs.com",
    "ramp_mcp": "https://app.ramp.com",
    "intercom_mcp": "https://app.intercom.com",
    "apollo": "https://app.apollo.io",
    "peopledatalabs": "https://www.peopledatalabs.com",
    "pandadoc_mcp": "https://app.pandadoc.com",
    "cashfree_payments_mcp": "https://www.cashfree.com",
    "coinbase_agents_mcp": "https://www.coinbase.com",
    "resend_mcp": "https://resend.com",
    "plain": "https://plain.com",
    "metabase": "https://www.metabase.com",
    "granola_mcp": "https://www.granola.ai",
    "circleback_mcp": "https://circleback.ai",
    "canva_mcp": "https://www.canva.com",
    "amplitude_mcp": "https://analytics.amplitude.com",
    "statsig_mcp": "https://statsig.com",
    "customerio_mcp": "https://customer.io",
    "better_stack_mcp": "https://betterstack.com",
    "greptile_mcp": "https://greptile.com",
    "mintlify_mcp": "https://mintlify.com",
    "pylon_mcp": "https://pylon.com",
    "ashby": "https://www.ashbyhq.com",
    "wispr_flow_mcp": "https://www.wisprflow.ai",
    "memelord_mcp": "https://memelord.com",
    "discordbot": "https://discord.com",
    "adobe_marketing_agent_mcp": "https://www.adobe.com",
    "coinbase_wallet_mcp": "https://www.coinbase.com/wallet",
    "clickhouse_mcp": "https://clickhouse.com",
    "plaid_mcp": "https://dashboard.plaid.com",
}

CONNECTORS_URL = "https://portal.nousresearch.com/connectors"

_HOSTED_CACHE: dict = {"at": 0.0, "rows": None}
_HOSTED_CACHE_TTL = 300.0


def _hosted_connectors() -> list[dict]:
    """Hosted connector accounts via the hermes CLI (name + connected state)."""
    now = time.time()
    if _HOSTED_CACHE["rows"] is not None and now - _HOSTED_CACHE["at"] < _HOSTED_CACHE_TTL:
        return _HOSTED_CACHE["rows"]
    rows: list[dict] = []
    rc, out, err = _sh(["hermes", "connectors", "list"], timeout=60)
    if rc == 0:
        for line in out.splitlines():
            m = _re.match(r"^([a-z0-9_]+)\s+(connected|not connected)\s*$", line.strip())
            if m:
                name = m.group(1)
                rows.append({
                    "name": name,
                    "connected": m.group(2) == "connected",
                    "url": HOSTED_URLS.get(name),
                })
    rows.sort(key=lambda r: (not r["connected"], r["name"]))
    _HOSTED_CACHE["at"] = now
    _HOSTED_CACHE["rows"] = rows
    return rows


@router.get("/connectors")
def connectors():
    """Hosted connector accounts + local MCP servers, with click-through URLs."""
    mcps = []
    try:
        cfg = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}
        srv = cfg.get("mcp_servers")
        if isinstance(srv, dict):
            for name, val in srv.items():
                disabled = isinstance(val, dict) and val.get("enabled") is False
                mcps.append({"name": str(name), "enabled": not disabled,
                             "url": MCP_URLS.get(str(name))})
            mcps.sort(key=lambda m: (not m["enabled"], m["name"]))
    except (OSError, yaml.YAMLError):
        pass
    hosted = _hosted_connectors()
    return {"date": _local_date(), "hosted": hosted, "mcps": mcps,
            "portal_url": CONNECTORS_URL}


@router.post("/connectors/connect")
def connectors_connect(body: dict = Body(...)):
    """Start the hosted-connector OAuth flow: returns the portal connect URL.

    The CLI prints the URL and then stays alive waiting for the OAuth callback,
    so it is spawned detached with stdout to a scratch file and we poll for the
    URL instead of waiting for exit.
    """
    name = str(body.get("name") or "").strip()
    if not _re.fullmatch(r"[a-z0-9_]{2,40}", name):
        raise HTTPException(status_code=400, detail="invalid connector name")
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")}
    out_file = CACHE / f"connect-{name}-{int(time.time() * 1000)}.txt"
    CACHE.mkdir(parents=True, exist_ok=True)
    flags = 0
    if os.name == "nt":
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    with open(out_file, "w", encoding="utf-8") as fh:
        subprocess.Popen(
            ["hermes", "connectors", "connect", name],
            stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            env=env, creationflags=flags,
        )
    url = None
    deadline = time.time() + 20
    while time.time() < deadline:
        time.sleep(0.4)
        try:
            text = out_file.read_text(encoding="utf-8")
        except OSError:
            continue
        m = _re.search(r"https://portal\.nousresearch\.com/connect/[A-Za-z0-9]+", text)
        if m:
            url = m.group(0)
            break
    try:
        out_file.unlink()
    except OSError:
        pass  # the detached CLI may still hold the file open; harmless
    if not url:
        raise HTTPException(status_code=502, detail=f"no connect URL appeared within 20s for {name}")
    _HOSTED_CACHE["at"] = 0.0  # state may change after the user finishes OAuth
    _HOSTED_CACHE["rows"] = None
    return {"ok": True, "name": name, "url": url}


# ---------------------------------------------------------------- money

MONEY_SCRIPTS = {
    "stripe": "money_stripe.py",
    "stocks": "money_webull.py",
    "banks": "money_plaid.py",
}


def _run_money(kind: str) -> dict:
    script = AGENTOS / "scripts" / MONEY_SCRIPTS[kind]
    if not script.exists():
        return {"configured": False, "state": "not_installed", "detail": f"{kind} client not installed yet"}
    if not MONEY_VENV_PY.exists():
        return {"configured": False, "state": "no_venv", "detail": "agentos venv missing"}
    snap = CACHE / f"money-{kind}-{_local_date()}.json"
    rc, out, err = _sh([str(MONEY_VENV_PY), str(script)], timeout=90)
    if rc != 0:
        return {"configured": True, "state": "error", "detail": (err or out).strip()[:300]}
    try:
        return json.loads(snap.read_text(encoding="utf-8")) if snap.exists() else json.loads(out)
    except json.JSONDecodeError:
        return {"configured": True, "state": "error", "detail": (out or err).strip()[:300]}


@router.get("/money/summary")
def money_summary():
    env = _read_env()
    out = {"date": _local_date(), "stripe": None, "stocks": None, "banks": None}
    out["stripe"] = (
        _run_money("stripe") if env.get("STRIPE_SECRET_KEY")
        else {"configured": False, "state": "no_key", "detail": "STRIPE_SECRET_KEY missing from ~/.hermes/agentos/.env"}
    )
    out["stocks"] = (
        _run_money("stocks") if (env.get("WEBULL_USERNAME") or env.get("WEBULL_EMAIL"))
        else {"configured": False, "state": "no_creds", "detail": "WEBULL_USERNAME/WEBULL_PASSWORD missing from .env"}
    )
    out["banks"] = (
        _run_money("banks") if env.get("PLAID_CLIENT_ID")
        else {"configured": False, "state": "no_creds", "detail": "PLAID_CLIENT_ID/PLAID_SECRET missing from .env"}
    )
    return out


# ------------------------------------------------------- planner (ADHD Planner app)

@router.get("/planner/today")
def planner_today():
    script = AGENTOS / "scripts" / "planner_today.py"
    if not script.exists():
        return {"configured": False, "state": "not_installed", "detail": "planner client not installed"}
    if not MONEY_VENV_PY.exists():
        return {"configured": False, "state": "no_venv", "detail": "agentos venv missing"}
    env = _read_env()
    key = env.get("PLANNER_FIREBASE_KEY", "")
    if not key or not Path(key).exists():
        return {"configured": False, "state": "no_key",
                "detail": "Save a Firebase service-account key and set PLANNER_FIREBASE_KEY in ~/.hermes/agentos/.env"}
    rc, out, err = _sh([str(MONEY_VENV_PY), str(script)], timeout=90)
    if rc != 0:
        return {"configured": True, "state": "error", "detail": (err or out).strip()[:300]}
    try:
        snap = CACHE / f"planner-{_local_date()}.json"
        return json.loads(snap.read_text(encoding="utf-8")) if snap.exists() else json.loads(out)
    except json.JSONDecodeError:
        return {"configured": True, "state": "error", "detail": (out or err).strip()[:300]}


# ---------------------------------------------------------------- vision (JARVIS eyes)

VISION_MODEL = "gemini-2.5-flash"

VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "extractedText": {"type": "string"},
        "spokenSummary": {"type": "string"},
        "detailedAnalysis": {"type": "string"},
        "entities": {"type": "array", "items": {"type": "string"}},
        "suggestedActions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["spokenSummary", "detailedAnalysis", "extractedText", "entities", "suggestedActions"],
}

VISION_PROMPT = """You are JARVIS, the visual cortex of D's operations dashboard. \
Analyze the attached image and extract every useful fact.
- extractedText: ALL readable text verbatim (empty string if none).
- spokenSummary: one or two speakable sentences.
- detailedAnalysis: what this screen/image shows, notable numbers, anomalies, anything needing action.
- entities: key names, IDs, tickers, app names, people found.
- suggestedActions: 0-5 concrete follow-up commands D could give his agent ( imperative, short).
Return ONLY JSON matching the schema."""


@router.get("/vision/last")
def vision_last():
    path = CACHE / "vision-last.json"
    if not path.exists():
        return {"ok": False, "detail": "no analysis yet"}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"ok": False, "detail": "cached analysis unreadable"}


@router.post("/vision/analyze")
def vision_analyze(body: dict = Body(...)):
    """Analyze a screenshot/image through Gemini and return structured JSON."""
    env = _read_env()
    key = env.get("GEMINI_API_KEY", "")
    if not key:
        raise HTTPException(status_code=409, detail="GEMINI_API_KEY missing from ~/.hermes/agentos/.env")
    data_url = str(body.get("image") or "")
    m = _re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", data_url, _re.DOTALL)
    if not m:
        raise HTTPException(status_code=400, detail="image must be a base64 data URL")
    mime, b64 = m.group(1), m.group(2)
    if len(b64) > 14_000_000:  # ~10 MB decoded
        raise HTTPException(status_code=413, detail="image too large (10MB max)")
    payload = {
        "contents": [{"parts": [
            {"text": VISION_PROMPT},
            {"inline_data": {"mime_type": mime, "data": b64}},
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": VISION_SCHEMA,
            "maxOutputTokens": 4096,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{VISION_MODEL}:generateContent?key={urllib.parse.quote(key)}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"gemini call failed: {str(e)[:200]}") from None
    cands = resp.get("candidates") or []
    parts = ((cands[0].get("content") or {}).get("parts")) if cands else []
    text = (parts[0].get("text") if parts else "") or ""
    data = _extract_json(text)
    if data is None:
        raise HTTPException(status_code=502, detail=f"gemini returned unparseable output: {text[:200]}")
    out = {"ok": True, "date": _local_date(), "mime": mime,
           "at": _dt.datetime.now().isoformat(timespec="seconds"), **data}
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "vision-last.json").write_text(json.dumps(out, default=str), encoding="utf-8")
    return out


# ---------------------------------------------------------------- quotes (no-auth market data)

DEFAULT_QUOTE_SYMBOLS = ["SPY", "QQQ", "NVDA", "MSFT"]
DEFAULT_QUOTE_CRYPTO = ["BTC-USD", "ETH-USD"]
_QUOTE_CACHE: dict = {"at": 0.0, "data": None}


def _yahoo_chart(sym: str) -> dict | None:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=1d&interval=15m"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (agentos dashboard)"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            j = json.loads(r.read())
        res = (j.get("chart") or {}).get("result") or []
        if not res:
            return None
        meta = res[0].get("meta", {})
        closes = [c for c in (res[0].get("indicators", {}).get("quote", [{}])[0].get("close") or []) if c is not None]
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or (closes[0] if closes else None)
        chg = (price - prev) if (price is not None and prev) else None
        return {"symbol": sym, "price": price,
                "change_pct": (chg / prev * 100) if (chg is not None and prev) else None,
                "series": closes[-80:]}
    except Exception:  # noqa: BLE001
        return None


def _binance(sym: str) -> dict | None:
    # Binance REST is geo-blocked from US hosts (HTTP 451) — crypto rides the
    # same Yahoo chart endpoint as stocks via BTC-USD style tickers instead.
    return _yahoo_chart(sym)


@router.get("/quotes")
def quotes(symbols: str = "", crypto: str = ""):
    """Live quotes with intraday series for sparklines. No auth needed."""
    now = time.time()
    if _QUOTE_CACHE["data"] and now - _QUOTE_CACHE["at"] < 60:
        return _QUOTE_CACHE["data"]
    stocks = [s.strip().upper() for s in symbols.split(",") if s.strip()] or DEFAULT_QUOTE_SYMBOLS
    cryptos = [s.strip().upper() for s in crypto.split(",") if s.strip()] or DEFAULT_QUOTE_CRYPTO
    out = {"date": _local_date(), "stocks": [], "crypto": []}
    for s in stocks[:10]:
        d = _yahoo_chart(s)
        if d:
            out["stocks"].append(d)
    for s in cryptos[:6]:
        d = _binance(s)
        if d:
            out["crypto"].append(d)
    _QUOTE_CACHE["at"] = now
    _QUOTE_CACHE["data"] = out
    return out


# ---------------------------------------------------- agent activity + release board

def _hermes_home() -> Path:
    """The hermes data home: ~/.hermes for CLI-only setups, or AppData/Local/hermes
    when the desktop app owns it (its cron/, kanban/ live there)."""
    for cand in (Path.home() / ".hermes", Path.home() / "AppData" / "Local" / "hermes"):
        if (cand / "cron").exists():
            return cand
    return Path.home() / ".hermes"


_HERMES_HOME = _hermes_home()
_RELEASE_REPOS = [
    ("WirePro", "DeezGit21/hvac-wirepro"),
    ("TriQuote", "DeezGit21/triquote"),
    ("AC DR's App", "DeezGit21/AC-DRs-App"),
    ("Arctic Hub", "DeezGit21/arctic-hub"),
    ("Dynamic Intake", "DeezGit21/hvac-dynamic-intake"),
]
_REL_CACHE = {"at": 0.0, "data": None}


def _cron_activity(hours: float = 48.0, limit: int = 12) -> list:
    """Recent cron executions joined with job names."""
    try:
        import sqlite3
        jobs = {}
        jf = _HERMES_HOME / "cron" / "jobs.json"
        if jf.exists():
            j = json.loads(jf.read_text(encoding="utf-8"))
            for it in j.get("jobs", []):
                jobs[it.get("id", "")] = it.get("name", "?")
        db = _HERMES_HOME / "cron" / "executions.db"
        if not db.exists():
            return []
        cut = (time.time() - hours * 3600) * 1000
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows = con.execute(
            "select job_id, status, started_at, finished_at, delivery_outcome, error"
            " from executions where started_at is not null order by started_at desc limit 40"
        ).fetchall()
        con.close()
        out = []
        for job_id, status, started, finished, outcome, err in rows:
            ts = _parse_ts(started)
            if ts and ts * 1000 < cut:
                continue
            out.append({
                "kind": "cron", "name": jobs.get(job_id, job_id[:8]) if job_id else "?",
                "status": status or "?", "at": started, "outcome": outcome or "",
                "error": (err or "")[:140],
            })
            if len(out) >= limit:
                break
        return out
    except Exception:  # noqa: BLE001
        return []


def _parse_ts(v):
    """ISO-ish or epoch-ms string -> epoch seconds."""
    if v is None:
        return None
    try:
        return float(v) / 1000.0 if float(v) > 1e11 else float(v) / 1000.0
    except (TypeError, ValueError):
        pass
    try:
        import datetime as _dt
        return _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


def _kanban_activity(limit: int = 10) -> list:
    """Most recent task activity across all kanban boards."""
    import sqlite3
    boards_dir = _HERMES_HOME / "kanban" / "boards"
    if not boards_dir.exists():
        return []
    out = []
    for bdir in sorted(boards_dir.iterdir()):
        db = bdir / "kanban.db"
        if not db.exists():
            continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            rows = con.execute(
                "select title, status, assignee, coalesce(completed_at, started_at, created_at),"
                " coalesce(result,''), priority"
                " from tasks where coalesce(completed_at, started_at, created_at) is not null"
                " order by coalesce(completed_at, started_at, created_at) desc limit 4"
            ).fetchall()
            con.close()
            for title, status, assignee, ts, result, prio in rows:
                out.append({
                    "kind": "task", "board": bdir.name, "title": (title or "")[:90],
                    "status": status or "?", "assignee": assignee or "",
                    "at": ts, "result": (result or "")[:140], "priority": prio or 0,
                })
        except Exception:  # noqa: BLE001
            continue
    out.sort(key=lambda r: (_parse_ts(r["at"]) or 0), reverse=True)
    return out[:limit]


@router.get("/agents_activity")
def agents_activity():
    """Recent agent/cron runs + kanban task activity. Read-only, no auth beyond gateway."""
    return {
        "date": _local_date(),
        "cron": _cron_activity(),
        "tasks": _kanban_activity(),
    }


def _gh(*args: str, timeout: int = 20):
    import subprocess
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout)


@router.get("/releases")
def releases():
    """Release + CI status for D's active app repos, via the gh CLI (10 min cache)."""
    import datetime as _dt
    now = time.time()
    if _REL_CACHE["data"] and now - _REL_CACHE["at"] < 600:
        return _REL_CACHE["data"]
    out = []
    for label, repo in _RELEASE_REPOS:
        item = {"label": label, "repo": repo.split("/", 1)[1], "release": None, "ci": None, "pushed": None}
        try:
            r = _gh("api", f"repos/{repo}/releases/latest")
            if r.returncode == 0:
                j = json.loads(r.stdout)
                item["release"] = {"tag": j.get("tag_name"), "name": (j.get("name") or "")[:60],
                                   "at": j.get("published_at"), "prerelease": bool(j.get("prerelease"))}
        except Exception:  # noqa: BLE001
            pass
        try:
            r = _gh("api", f"repos/{repo}/actions/runs?per_page=1")
            if r.returncode == 0:
                runs = json.loads(r.stdout).get("workflow_runs") or []
                if runs:
                    w = runs[0]
                    item["ci"] = {"status": w.get("status"), "conclusion": w.get("conclusion"),
                                  "name": (w.get("name") or "")[:40], "at": w.get("created_at")}
        except Exception:  # noqa: BLE001
            pass
        try:
            r = _gh("api", f"repos/{repo}/commits/HEAD")
            if r.returncode == 0:
                j = json.loads(r.stdout)
                item["pushed"] = (j.get("commit") or {}).get("committer", {}).get("date")
        except Exception:  # noqa: BLE001
            pass
        out.append(item)
    data = {"date": _local_date(), "repos": out}
    _REL_CACHE["at"] = now
    _REL_CACHE["data"] = data
    return data


# ---------------------------------------------------------------- export / import (encrypted bundles)

@router.get("/export")
def export_data():
    return {
        "date": _local_date(),
        "goals": GOALS_FILE.read_text(encoding="utf-8") if GOALS_FILE.exists() else "",
        "recs": _load_recs(),
        "apps": (APPS_FILE.read_text(encoding="utf-8") if APPS_FILE.exists() else ""),
    }


@router.post("/import")
def import_data(body: dict = Body(...)):
    AGENTOS.mkdir(parents=True, exist_ok=True)
    restored = []
    goals = body.get("goals")
    if isinstance(goals, str) and len(goals) <= 60_000:
        GOALS_FILE.write_text(goals, encoding="utf-8")
        restored.append("goals")
    recs = body.get("recs")
    if isinstance(recs, list):
        _save_recs(recs)
        restored.append("recs")
    apps = body.get("apps")
    if isinstance(apps, str) and len(apps) <= 20_000:
        APPS_FILE.write_text(apps, encoding="utf-8")
        restored.append("apps")
    if not restored:
        raise HTTPException(status_code=400, detail="nothing recognizable in bundle")
    return {"ok": True, "restored": restored}
