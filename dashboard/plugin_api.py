"""agentos dashboard backend — routes mount under /api/plugins/agentos/.

Runs inside the gateway process. Dependency-light: fastapi + stdlib + PyYAML.
Heavy/fragile integrations (webull, plaid) run as subprocesses in their own
venv under ~/.hermes/agentos/venv and write JSON snapshots to the cache dir.
"""
from __future__ import annotations

import csv
import datetime as _dt
import difflib
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import yaml
from fastapi import APIRouter, Body, HTTPException, Response

router = APIRouter()

HOME = Path.home()
AGENTOS = HOME / ".hermes" / "agentos"
CACHE = AGENTOS / "cache"
GOALS_FILE = AGENTOS / "goals.md"
APPS_FILE = AGENTOS / "apps.yaml"
ENV_FILE = AGENTOS / ".env"
MONEY_VENV_PY = AGENTOS / "venv" / "Scripts" / "python.exe"
if not MONEY_VENV_PY.exists():
    MONEY_VENV_PY = AGENTOS / "venv" / "bin" / "python"

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

# Daily collected revenue for the last 30 days (deck ribbon sparkline).
# Day boundaries are Phoenix-local to match how D reads the business.
REVENUE_SERIES_SQL = """
SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(j.amount_paid), 0) AS revenue
FROM generate_series(current_date - 29, current_date, interval '1 day') AS d(day)
LEFT JOIN jobs j
  ON (j.created_at AT TIME ZONE 'America/Phoenix')::date = d.day::date
 AND j.deleted_at IS NULL
GROUP BY d.day ORDER BY d.day;
"""


@router.get("/metrics")
def metrics():
    hdr = _psql(METRICS_SQL)[0]
    cols = ["leads_week", "jobs_week", "revenue_mtd", "jobs_today"]
    data = dict(zip(cols, hdr))
    by_status = [{"status": r[0], "count": int(r[1]), "total_price": float(r[2])} for r in _psql(STATUS_SQL)]
    try:
        rev_rows = _psql(REVENUE_SERIES_SQL)
        revenue_series = [float(r[1]) for r in rev_rows]
        revenue_series_dates = [r[0] for r in rev_rows]
    except HTTPException:
        revenue_series, revenue_series_dates = [], []  # sparkline is best-effort
    return {"date": _local_date(), **data, "revenue_mtd": float(data["revenue_mtd"]),
            "jobs_by_status": by_status,
            "revenue_series": revenue_series, "revenue_series_dates": revenue_series_dates}


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
# The personal todo list lives on the dedicated kanban board `personal`
# (durable, shared: the telegram bot's standing rule in SOUL.md points it
# here, and the JARVIS deck reads/writes the same board via sqlite — no
# dependency on the CLI's *current* board). The telegram todo_list bridge
# stays as a fallback for items the bot stored in session state instead;
# those are fuzzy-deduped against board titles so nothing shows twice.

PERSONAL_BOARD = str(_CFG.get("personal_board") or "personal")
_OPEN_STATUSES = {"todo", "ready", "blocked", "review", "scheduled"}


def _norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _titles_similar(a: str, b: str) -> bool:
    na, nb = _norm_title(a), _norm_title(b)
    if not na or not nb:
        return False
    if na == nb or na in nb or nb in na:
        return True
    return difflib.SequenceMatcher(None, na, nb).ratio() >= 0.72


def _personal_board_tasks() -> list[dict]:
    """All tasks on the personal board, read straight from its sqlite DB."""
    db = _HERMES_HOME / "kanban" / "boards" / PERSONAL_BOARD / "kanban.db"
    if not db.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows = con.execute(
            "select id, title, status, priority, assignee,"
            " coalesce(completed_at, started_at, created_at)"
            " from tasks order by created_at desc limit 200"
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    return [
        {"id": tid, "title": (title or "")[:140], "status": status or "todo",
         "priority": prio or 0, "assignee": assignee or "", "source": "kanban", "at": ts}
        for tid, title, status, prio, assignee, ts in rows
    ]


def _tg_notify(text: str) -> bool:
    """Fire-and-forget push to the telegram home channel via `hermes send`."""
    if not _CFG.get("telegram_notify", True):
        return False
    rc, _, _ = _sh(["hermes", "send", "--to", "telegram", text], timeout=45)
    return rc == 0


@router.get("/todos")
def todos():
    board = _personal_board_tasks()
    rows = [t for t in board if t["status"] in _OPEN_STATUSES]
    # telegram session-store bridge — only items with no board twin survive
    for t in _session_todos():
        if not any(_titles_similar(t["title"], bt["title"]) for bt in board):
            rows.append(t)
    rows.sort(key=lambda t: (-t.get("priority", 0), t.get("status", "")))
    return {"tasks": rows, "total_open": len(rows), "board": PERSONAL_BOARD}


@router.post("/todos/create")
def todos_create(body: dict = Body(...)):
    """Create a task on the personal board (no assignee — stays on the board)."""
    title = str(body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    title = title[:200]
    rc, out, err = _sh(
        ["hermes", "kanban", "--board", PERSONAL_BOARD, "create", title, "--json"], timeout=40)
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"kanban create failed: {err.strip()[:300]}")
    try:
        task = json.loads(out)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="kanban create returned non-JSON") from None
    sent = _tg_notify(f"📝 Added to your list (deck): {title}")
    return {"ok": True, "id": task.get("id"), "status": task.get("status"),
            "title": title, "notified": sent}


@router.post("/todos/complete")
def todos_complete(body: dict = Body(...)):
    """Complete a personal todo.

    Board task -> `hermes kanban complete`. Telegram-bridge item (session
    todo_list store, no durable write path) -> record it as a completed
    task on the board so the completion is durable and visible everywhere.
    """
    tid = str(body.get("id") or "").strip()
    title = str(body.get("title") or "").strip()
    if not tid:
        raise HTTPException(status_code=400, detail="id is required")
    if tid.startswith("tg:"):
        if not title:
            raise HTTPException(status_code=400, detail="title required for telegram items")
        rc, out, err = _sh(
            ["hermes", "kanban", "--board", PERSONAL_BOARD, "create", title[:200], "--json"],
            timeout=40)
        if rc != 0:
            raise HTTPException(status_code=502, detail=f"kanban create failed: {err.strip()[:300]}")
        try:
            tid = json.loads(out).get("id") or ""
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="kanban create returned non-JSON") from None
        if not tid:
            raise HTTPException(status_code=502, detail="kanban create returned no id")
    rc, out, err = _sh(
        ["hermes", "kanban", "--board", PERSONAL_BOARD, "complete", tid,
         "--result", "completed from JARVIS deck"], timeout=40)
    if rc != 0:
        raise HTTPException(status_code=502, detail=f"kanban complete failed: {err.strip()[:300]}")
    sent = _tg_notify(f"✅ Completed (deck): {title or tid}")
    return {"ok": True, "id": tid, "notified": sent}


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
- speech: AT MOST 90 words of clean speakable prose — no markdown, no bullets, no symbols. \
Pick the TOP THREE things that need D's attention; never enumerate every task or metric \
(summarize the rest as "a few open items"). Cover business numbers (round them for speech) \
and anything down or at risk. Start with a one-line greeting appropriate to the current \
local time given below. Speak TO D, confident chief-of-staff tone, zero fluff. \
Brevity is a feature: shorter is better.
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
    now_local = _dt.datetime.now(AGENTOS_TZ).strftime("%A %B %d, %Y at %I:%M %p")
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
    speech = str(data["speech"]).strip()
    # Hard cap — TTS synthesis wait scales with length (Fish: ~40s for 150
    # words). Trim at a sentence boundary so the cap never ends mid-sentence.
    _SPEECH_CAP = 600  # ~95 words ≈ 25-30s of audio
    if len(speech) > _SPEECH_CAP:
        cut = speech.rfind(". ", 0, _SPEECH_CAP)
        speech = speech[: cut + 1 if cut > 200 else _SPEECH_CAP].rstrip(" ,;:")
        if not speech.endswith((".", "!", "?")):
            speech += "."
    out = {
        "ok": True, "date": _local_date(),
        "speech": speech,
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
    fast = _memory_fastpath(query)
    if fast:
        return {"ok": True, "reply": fast["reply"], "date": _local_date()}
    query = _memory_block(query)
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

def _config_file() -> Path:
    """Hermes config.yaml under whichever home owns the data (desktop app or CLI)."""
    return _hermes_home() / "config.yaml"


@router.get("/tools")
def tools():
    """Enabled plugins + MCP servers from config.yaml — feeds the orbit ring."""
    try:
        cfg = yaml.safe_load(_config_file().read_text(encoding="utf-8")) or {}
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
        cfg = yaml.safe_load(_config_file().read_text(encoding="utf-8")) or {}
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


# ---------------------------------------------------------------- tts (JARVIS voice)

_TTS_CACHE_TTL = 7 * 86400  # a week of voice lines is plenty; prune lazily

_TTS_GEMINI_MODEL = "gemini-2.5-flash-preview-tts"
_TTS_GEMINI_STYLE = (
    "You are JARVIS, the composed British AI butler from the Iron Man films. "
    "Speak with a refined, calm, articulate British RP accent: measured pace, "
    "warm confidence, dry understated wit, precise enunciation. Read naturally:\n\n"
)


def _saved_tts_voice() -> str:
    # _load_settings is defined near the end of this module; the TTS prewarm
    # thread can call this at import time, before that line executes. Fall
    # back to "" (yaml defaults) instead of crashing the prewarm thread.
    try:
        return str(_load_settings().get("tts_voice") or "").strip()
    except NameError:
        return ""


def _tts_cfg(voice_override: str | None = None) -> dict:
    tts_cfg = _CFG.get("tts") if isinstance(_CFG.get("tts"), dict) else {}
    # The Settings-panel voice picker is authoritative: a saved (or per-request)
    # edge voice switches the provider to edge-tts; a fish:<model-id> value
    # switches to Fish Audio. Empty → agentos.yaml defaults.
    override = str(voice_override or _saved_tts_voice() or "").strip()
    if override.startswith("fish:"):
        ref = override.split(":", 1)[1].strip()
        return {
            "provider": "fish",
            "voice": override,
            "rate": str(tts_cfg.get("rate") or "+4%"),
            "gemini_voice": str(tts_cfg.get("gemini_voice") or "Charon"),
            "fish_ref": ref,
            "fish_model": str(tts_cfg.get("fish_model") or "s2.1-pro-free"),
        }
    if override:
        return {
            "provider": "edge",
            "voice": override,
            "rate": str(tts_cfg.get("rate") or "+4%"),
            "gemini_voice": str(tts_cfg.get("gemini_voice") or "Charon"),
            "fish_ref": str(tts_cfg.get("fish_reference") or ""),
            "fish_model": str(tts_cfg.get("fish_model") or "s2.1-pro-free"),
        }
    return {
        "provider": str(tts_cfg.get("provider") or "gemini").strip().lower(),
        "voice": str(tts_cfg.get("voice") or "en-GB-RyanNeural"),
        "rate": str(tts_cfg.get("rate") or "+4%"),
        "gemini_voice": str(tts_cfg.get("gemini_voice") or "Charon"),
        "fish_ref": str(tts_cfg.get("fish_reference") or ""),
        "fish_model": str(tts_cfg.get("fish_model") or "s2.1-pro-free"),
    }


def _tts_stream(text: str, voice: str, rate: str):
    """Async generator: edge-tts chunks as they arrive, teed to a cache file."""
    import asyncio as _asyncio
    import edge_tts

    async def _gen():
        comm = edge_tts.Communicate(text, voice, rate=rate)
        tmp = CACHE / f"tts-{_hashlib.sha1((voice + '|' + rate + '|' + text).encode('utf-8')).hexdigest()[:16]}.mp3.part"
        CACHE.mkdir(parents=True, exist_ok=True)
        first = True
        try:
            with open(tmp, "wb") as fh:
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        if first:
                            first = False
                            yield chunk["data"]  # header bytes go out immediately
                        else:
                            yield chunk["data"]
                        fh.write(chunk["data"])
            tmp.rename(tmp.with_suffix(""))
        except Exception:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    return _gen


def _tts_gemini_wav(text: str, voice: str) -> bytes:
    """Synthesize via Gemini TTS (style-prompted JARVIS) -> full WAV bytes."""
    import base64 as _base64
    import io as _io
    import json as _json
    import urllib.request as _urllib
    import wave as _wave
    from pathlib import Path as _Path

    import os as _os
    key = _os.environ.get("GEMINI_API_KEY")
    if not key:
        env_file = _Path.home() / ".hermes" / "agentos" / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("GEMINI_API_KEY"):
                    key = line.split("=", 1)[1].strip().strip('"')
                    break
    if not key:
        raise RuntimeError("no GEMINI_API_KEY in agentos .env")
    body = _json.dumps({
        "contents": [{"parts": [{"text": _TTS_GEMINI_STYLE + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }).encode("utf-8")
    req = _urllib.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{_TTS_GEMINI_MODEL}:generateContent?key={key}",
        data=body, headers={"Content-Type": "application/json"})
    with _urllib.urlopen(req, timeout=120) as resp:
        r = _json.load(resp)
    pcm = _base64.b64decode(r["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    buf = _io.BytesIO()
    with _wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return buf.getvalue()


def _tts_fish_mp3(text: str, reference_id: str, model: str) -> bytes:
    """Synthesize via Fish Audio POST /v1/tts -> full mp3 bytes.

    reference_id is a fish.audio voice-model id (the Jarvis MCU voice is
    612b878b113047d9a770c069c8b4fdfe). Model header selects s2.1-pro-free
    (free tier) by default; 401/402/429 map to actionable messages.
    """
    import json as _json
    import os as _os
    import urllib.error as _urlerr
    import urllib.request as _urllib

    key = _read_env().get("FISH_API_KEY") or _os.environ.get("FISH_API_KEY")
    if not key:
        raise RuntimeError(
            "no FISH_API_KEY in agentos .env — add it in Settings "
            "(fish.audio > Get your API key)")
    body = _json.dumps({
        "text": text,
        "reference_id": reference_id,
        "format": "mp3",
        "latency": "balanced",
    }).encode("utf-8")
    req = _urllib.Request(
        "https://api.fish.audio/v1/tts",
        data=body,
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "model": model,
        })
    try:
        with _urllib.urlopen(req, timeout=120) as resp:
            data = resp.read()
    except _urlerr.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:200]
        except OSError:
            pass
        hints = {
            401: "invalid FISH_API_KEY — re-copy it from fish.audio API keys",
            402: "Fish Audio credit needed — switch to the free model or add API credit",
            400: "bad voice model id (" + reference_id[:8] + "…)",
            429: "Fish Audio rate limit — wait a moment and retry",
        }
        raise RuntimeError(
            f"Fish Audio TTS failed ({e.code}): {hints.get(e.code, detail or 'request error')}"
        ) from None
    except OSError as e:
        raise RuntimeError(f"Fish Audio TTS unreachable: {e}") from None
    if not data:
        raise RuntimeError("Fish Audio TTS returned empty audio")
    return data


def _tts_audio_response(text: str, force_provider: str | None = None,
                        voice_override: str | None = None):
    cfg = _tts_cfg(voice_override)
    provider = force_provider or cfg["provider"]
    # Fish Audio (cloned/community voices, e.g. Jarvis MCU). Cache full mp3s;
    # a failure surfaces as 502 with the actionable message — no silent edge
    # fallback, which would mask a misconfigured key as "the wrong voice".
    if provider == "fish" and cfg.get("fish_ref"):
        import hashlib as _hashlib
        fkey = _hashlib.sha1(("fish|" + cfg["fish_ref"] + "|" + cfg["fish_model"] + "|" + text)
                             .encode("utf-8")).hexdigest()[:16]
        CACHE.mkdir(parents=True, exist_ok=True)
        fout = CACHE / f"tts-fish-{fkey}.mp3"
        if fout.exists() and fout.stat().st_size > 0:
            return Response(content=fout.read_bytes(), media_type="audio/mpeg")
        try:
            mp3 = _tts_fish_mp3(text, cfg["fish_ref"], cfg["fish_model"])
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e)) from None
        fout.write_bytes(mp3)
        return Response(content=mp3, media_type="audio/mpeg")
    if provider == "gemini":
        import hashlib as _hashlib
        gkey = _hashlib.sha1((provider + "|" + cfg["gemini_voice"] + "|" + text).encode("utf-8")).hexdigest()[:16]
        CACHE.mkdir(parents=True, exist_ok=True)
        gout = CACHE / f"tts-{gkey}.wav"
        if gout.exists() and gout.stat().st_size > 0:
            return Response(content=gout.read_bytes(), media_type="audio/wav")
        try:
            wav = _tts_gemini_wav(text, cfg["gemini_voice"])
            gout.write_bytes(wav)
            return Response(content=wav, media_type="audio/wav")
        except Exception:
            pass  # fall through to edge-tts
    voice, rate = cfg["voice"], cfg["rate"]
    import hashlib as _hashlib
    key = _hashlib.sha1((voice + "|" + rate + "|" + text).encode("utf-8")).hexdigest()[:16]
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"tts-{key}.mp3"
    if out.exists() and out.stat().st_size > 0:
        return Response(content=out.read_bytes(), media_type="audio/mpeg")
    try:
        import edge_tts  # noqa: F401 — availability check before streaming starts
    except ImportError:
        raise HTTPException(status_code=501, detail="edge-tts not installed in the agentos venv") from None
    from fastapi.responses import StreamingResponse
    # Prune stale cache entries lazily (best-effort).
    try:
        now = time.time()
        for f in CACHE.glob("tts-*.mp3") if hasattr(CACHE, "glob") else []:
            if now - f.stat().st_mtime > _TTS_CACHE_TTL:
                f.unlink(missing_ok=True)
    except OSError:
        pass
    return StreamingResponse(_tts_stream(text, voice, rate)(), media_type="audio/mpeg")


# Near-instant verbal acks for briefs/actions: short edge-tts lines, pre-warmed
# at startup so the browser gets cache-speed audio (single-digit ms) the moment
# D clicks — the slower styled reply (Gemini) follows when it's ready.
_TTS_ACK_PHRASES = [
    "Generating brief now, sir",
    "Right away, sir",
    "On it, sir",
    "At once, sir",
    "Working on it now, sir",
]


def _tts_prewarm_acks() -> None:
    import asyncio as _asyncio

    def _run():
        if _tts_cfg()["provider"] == "fish":
            return  # cloned voice: don't burn Fish Audio calls at startup
        for phrase in _TTS_ACK_PHRASES:
            try:
                cfg = _tts_cfg()
                key = _hashlib.sha1((cfg["voice"] + "|" + cfg["rate"] + "|" + phrase).encode("utf-8")).hexdigest()[:16]
                out = CACHE / f"tts-{key}.mp3"
                if out.exists() and out.stat().st_size > 0:
                    continue
                tmp = out.with_suffix(".mp3.part")
                async def _gen():
                    import edge_tts
                    comm = edge_tts.Communicate(phrase, cfg["voice"], rate=cfg["rate"])
                    with open(tmp, "wb") as fh:
                        async for chunk in comm.stream():
                            if chunk["type"] == "audio":
                                fh.write(chunk["data"])
                _asyncio.run(_gen())
                tmp.rename(out)
            except Exception:
                pass

    threading.Thread(target=_run, name="tts-prewarm", daemon=True).start()


_tts_prewarm_acks()


_EDGE_VOICE_RE = _re.compile(r"^[A-Za-z][A-Za-z0-9-]{2,40}Neural$")
_FISH_REF_RE = _re.compile(r"^fish:[0-9a-fA-F]{8,64}$")


@router.get("/tts")
def tts_get(text: str = "", ack: str = "", voice: str = ""):
    """Streaming neural TTS — the browser <audio> element starts playing as
    chunks arrive (first sound in well under a second for short lines).
    ack=1 forces the fast edge-tts provider for pre-warmed acknowledgements
    (unless the active voice is a fish:<id> clone — then Fish Audio serves it).
    voice=<override> tests a selection without saving it (edge voice name or
    fish:<model-id>)."""
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    if len(text) > 4000:
        raise HTTPException(status_code=413, detail="text too long for one utterance")
    voice = (voice or "").strip()
    if voice and not (_EDGE_VOICE_RE.match(voice) or _FISH_REF_RE.match(voice)):
        raise HTTPException(status_code=400, detail="invalid voice override")
    cfg = _tts_cfg(voice or None)
    force_edge = bool(ack) and cfg["provider"] != "fish"
    return _tts_audio_response(text, force_provider="edge" if force_edge else None,
                               voice_override=voice or None)


@router.post("/tts")
def tts(body: dict = Body(...)):
    """POST variant returning the full mp3 (used as a compatibility fallback)."""
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    if len(text) > 4000:
        raise HTTPException(status_code=413, detail="text too long for one utterance")
    return _tts_audio_response(text)


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


# ------------------------------------------------- money self-healing (webull)
# The webull session needs an interactive MFA code only D can type, so "fixing
# it automatically" means: open the login console on his desktop + ping Telegram.
WEBULL_LOGIN_FLAG = CACHE / "webull-login-launched.json"


def _launch_webull_login(silent: bool = False) -> dict:
    """Launch webull_login.py.

    silent=True (auto-remediation): no console window — output goes to a log
    file and the Telegram notice points D at the deck's reconnect button.
    silent=False (D clicked reconnect): a visible console opens so he can type
    the MFA code — that step cannot be automated.
    """
    script = AGENTOS / "scripts" / "webull_login.py"
    if not script.exists():
        return {"launched": False, "detail": "webull_login.py not installed"}
    if not MONEY_VENV_PY.exists():
        return {"launched": False, "detail": "agentos venv missing"}
    if silent:
        log = CACHE / "webull-login-silent.log"
        CACHE.mkdir(parents=True, exist_ok=True)
        flags = 0x00000008 | 0x00000200 | 0x08000000  # detached, no window
        try:
            with open(log, "ab") as fh:
                subprocess.Popen(
                    [str(MONEY_VENV_PY), str(script)],
                    creationflags=flags, cwd=str(AGENTOS),
                    stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                )
        except OSError as e:
            return {"launched": False, "detail": str(e)[:200]}
        WEBULL_LOGIN_FLAG.write_text(json.dumps({"ts": time.time()}), encoding="utf-8")
        return {"launched": True, "silent": True,
                "detail": "Login retry running silently — click 'reconnect webull' "
                          "in the Money tab when you're ready to type the MFA code."}
    CREATE_NEW_CONSOLE = 0x00000010
    try:
        subprocess.Popen(
            [str(MONEY_VENV_PY), str(script)],
            creationflags=CREATE_NEW_CONSOLE,
            cwd=str(AGENTOS),
        )
    except OSError as e:
        return {"launched": False, "detail": str(e)[:200]}
    WEBULL_LOGIN_FLAG.write_text(json.dumps({"ts": time.time()}), encoding="utf-8")
    return {"launched": True,
            "detail": "Login window opened — type the MFA code there; positions refresh on the next poll."}


@router.post("/money/webull/login")
def money_webull_login():
    return _launch_webull_login()


@router.post("/money/webull/browser-session")
def money_webull_browser_session(body: dict = Body(...)):
    """Receive Webull web-session material from the user's own browser console.

    The user runs a snippet in DevTools on webull.com that POSTs their
    localStorage/cookies here over loopback — tokens travel machine-local and
    never pass through chat. We keep only auth-relevant entries and write them
    to agentos/cache/webull-browser-session.json for money_webull.py to use.
    """
    ls = body.get("localStorage") or {}
    ck = body.get("cookies") or ""
    keep = {}
    for k, v in (ls.items() if isinstance(ls, dict) else []):
        v = str(v)
        if re.search(r"(?i)token|access|did|region|uuid|device", k) and 8 < len(v) < 4000:
            keep[str(k)] = v
    out = {"received_at": _dt.datetime.now(AGENTOS_TZ).isoformat(timespec="seconds"),
           "keys": sorted(keep), "cookies": str(ck)[:4000]}
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "webull-browser-session.json").write_text(
        json.dumps({"raw_keys": keep, "meta": out}, indent=1), encoding="utf-8")
    return Response(content=json.dumps({"ok": True, "stored_keys": sorted(keep)}),
                    media_type="application/json",
                    headers={"Access-Control-Allow-Origin": "*"})


@router.options("/money/webull/browser-session")
def money_webull_browser_session_preflight():
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    })


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


# ---------------------------------------------------------------- workshop (3D build space)
#
# JARVIS builds 3D objects from natural language. The LLM only ever produces
# STRUCTURED scene JSON (spec: docs/superpowers/plans/2026-11-12-workshop-spec.md);
# the frontend renders it deterministically with three.js. Scene persists to
# agentos/cache/workshop-scene.json and is sanitized so a bad LLM response can
# never wedge the renderer.

WORKSHOP_FILE = CACHE / "workshop-scene.json"
WORKSHOP_SHAPES = ("box", "sphere", "cylinder", "cone", "torus", "octahedron", "capsule")
_WORKSHOP_MAX_PARTS = 48  # internal alias; WORKSHOP_MAX_PARTS below is the public name
WORKSHOP_MAX_PARTS = _WORKSHOP_MAX_PARTS
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# LLMs love color names; map the common ones so "make it gold" actually applies.
_COLOR_NAMES = {
    "gold": "#d4af37", "silver": "#c0c0c0", "copper": "#b87333", "bronze": "#cd7f32",
    "red": "#e5484d", "crimson": "#dc143c", "orange": "#f5811e", "amber": "#ffb454",
    "yellow": "#f5d90a", "green": "#30a46c", "emerald": "#10b981", "teal": "#12a594",
    "cyan": "#5cd6ff", "blue": "#3b82f6", "navy": "#1e3a8a", "purple": "#8b5cf6",
    "violet": "#a855f7", "pink": "#ec4899", "magenta": "#d6409f", "white": "#f0f6fc",
    "black": "#141a24", "gray": "#8b93a7", "grey": "#8b93a7", "steel": "#8b93a7",
    "aluminum": "#aab2c5", "chrome": "#dfe7f2", "carbon": "#1c2431", "brass": "#b5985a",
}


def _workshop_color(v, default):
    v = str(v or "").strip().lower()
    if _HEX_COLOR.match(v):
        return v
    return _COLOR_NAMES.get(v, default)

_SHAPE_DEFAULTS = {
    "box": {"w": 1.0, "h": 1.0, "d": 1.0},
    "sphere": {"r": 0.5},
    "cylinder": {"r": 0.4, "h": 1.0},
    "cone": {"r": 0.4, "h": 1.0},
    "torus": {"r": 0.5, "tube": 0.15},
    "octahedron": {"r": 0.5},
    "capsule": {"r": 0.3, "h": 0.8},
}


def _num(v, lo, hi, default):
    try:
        f = float(v)
        return f if lo <= f <= hi and f == f else default  # f==f rejects NaN
    except (TypeError, ValueError):
        return default


def _vec3(v, lo=-20.0, hi=20.0, default=(0.0, 0.0, 0.0)):
    if isinstance(v, (list, tuple)) and len(v) == 3:
        return [_num(x, lo, hi, 0.0) for x in v]
    return list(default)


def _sanitize_part(p, idx):
    """One part dict in, clean part dict out. None = unusable."""
    if not isinstance(p, dict):
        return None
    shape = str(p.get("shape") or "box").strip().lower()
    if shape not in WORKSHOP_SHAPES:
        shape = "box"
    raw_params = p.get("params") if isinstance(p.get("params"), dict) else {}
    params = {}
    for k, dv in _SHAPE_DEFAULTS[shape].items():
        params[k] = round(_num(raw_params.get(k, dv), 0.02, 12.0, dv), 3)
    mat_raw = p.get("material") if isinstance(p.get("material"), dict) else {}

    def color(key, default):
        return _workshop_color(mat_raw.get(key), default)

    pos = _vec3(p.get("pos"))
    mat = {
        "color": color("color", "#5cd6ff"),
        "emissive": color("emissive", "#000000"),
        "emissiveIntensity": round(_num(mat_raw.get("emissiveIntensity", 0.0), 0.0, 10.0, 0.0), 2),
        "metalness": round(_num(mat_raw.get("metalness", 0.2), 0.0, 1.0, 0.2), 2),
        "roughness": round(_num(mat_raw.get("roughness", 0.5), 0.0, 1.0, 0.5), 2),
        "opacity": round(_num(mat_raw.get("opacity", 1.0), 0.05, 1.0, 1.0), 2),
    }
    edir = _vec3(p.get("explodeDir"), -5.0, 5.0, (0.0, 1.0, 0.0))
    if sum(x * x for x in edir) < 0.001:
        edir = ([0.0, 1.0, 0.0] if pos[1] >= 0 else [0.0, -1.0, 0.0])
    label = str(p.get("label") or "")[:60].strip()
    desc = str(p.get("desc") or "")[:300].strip()
    pid = re.sub(r"[^a-z0-9_-]+", "-", str(p.get("id") or ("part-" + str(idx + 1))).lower())[:40] or ("part-" + str(idx + 1))
    return {
        "id": pid, "label": label or pid, "desc": desc,
        "shape": shape, "params": params,
        "pos": [round(x, 3) for x in pos],
        "rot": [round(x, 3) for x in _vec3(p.get("rot"), -6.3, 6.3)],
        "explodeDir": [round(x, 3) for x in edir],
        "material": mat,
    }


def sanitize_scene(raw) -> dict:
    """Any dict (or garbage) in -> a valid scene dict out. Never raises."""
    parts_raw = raw.get("parts") if isinstance(raw, dict) else None
    parts = []
    if isinstance(parts_raw, list):
        for p in parts_raw[:WORKSHOP_MAX_PARTS]:
            clean = _sanitize_part(p, len(parts))
            if clean is None:
                continue
            while any(existing["id"] == clean["id"] for existing in parts):
                clean["id"] = clean["id"][:34] + "-" + _hashlib.sha1(clean["id"].encode()).hexdigest()[:4]
            parts.append(clean)
    name = str(raw.get("name") if isinstance(raw, dict) else "")[:60].strip() or "workshop build"
    return {"name": name, "parts": parts, "updated": _dt.datetime.now().isoformat(timespec="seconds")}


def _load_workshop_scene() -> dict | None:
    if not WORKSHOP_FILE.exists():
        return None
    try:
        data = json.loads(WORKSHOP_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("parts"), list):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _save_workshop_scene(scene: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    WORKSHOP_FILE.write_text(json.dumps(scene, indent=1), encoding="utf-8")


def _demo_workshop_scene() -> dict:
    """First-run scene: a small robot core so the tab is never empty."""
    return sanitize_scene({
        "name": "jarvis core",
        "parts": [
            {"id": "base", "label": "Aluminum base plate", "desc": "Weighted foundation the core stands on.",
             "shape": "cylinder", "params": {"r": 0.7, "h": 0.18}, "pos": [0, 0.09, 0],
             "explodeDir": [0, -1, 0], "material": {"color": "#8b93a7", "metalness": 0.85, "roughness": 0.35}},
            {"id": "torso", "label": "Main chassis", "desc": "Soft-black chassis housing the core systems.",
             "shape": "box", "params": {"w": 0.9, "h": 1.1, "d": 0.7}, "pos": [0, 0.75, 0],
             "explodeDir": [0, 0, 1], "material": {"color": "#1c2431", "metalness": 0.4, "roughness": 0.55}},
            {"id": "reactor", "label": "Emerald reactor", "desc": "Glowing power core in the chest bay.",
             "shape": "torus", "params": {"r": 0.24, "tube": 0.07}, "pos": [0, 0.85, 0.37],
             "explodeDir": [0, 0, 1], "material": {"color": "#10b981", "emissive": "#10b981", "emissiveIntensity": 2.2, "metalness": 0.1, "roughness": 0.3}},
            {"id": "head", "label": "Sensor dome", "desc": "Optics and sensor array module.",
             "shape": "sphere", "params": {"r": 0.26}, "pos": [0, 1.5, 0],
             "explodeDir": [0, 1, 0], "material": {"color": "#dfe7f2", "metalness": 0.7, "roughness": 0.25}},
        ],
    })


def _cap_speech(text, cap=600):
    text = str(text or "").strip()
    if len(text) <= cap:
        return text
    cut = text.rfind(". ", 0, cap)
    out = text[: cut + 1 if cut > 200 else cap].rstrip(" ,;:")
    return out if out.endswith((".", "!", "?")) else out + "."


@router.get("/workshop/scene")
def workshop_scene_get():
    saved = _load_workshop_scene()
    scene = sanitize_scene(saved) if saved else _demo_workshop_scene()
    return {"ok": True, "saved": saved is not None, "scene": scene, "date": _local_date()}


@router.post("/workshop/scene")
def workshop_scene_set(body: dict = Body(...)):
    scene = sanitize_scene(body.get("scene"))
    if not scene["parts"]:
        raise HTTPException(status_code=400, detail="scene has no valid parts")
    _save_workshop_scene(scene)
    return {"ok": True, "parts": len(scene["parts"])}


_WORKSHOP_BUILDER_RULES = """You are JARVIS, a precise 3D design engine speaking in the \
voice of a calm British butler.
Design an object assembled ONLY from these primitive shapes: box, sphere, cylinder, cone, \
torus, octahedron, capsule.
Hard rules:
- 4 to 48 parts; every part gets a short id (lowercase, letters/digits/dashes), a human \
label (<=60 chars) and a one-sentence desc.
- Parts must physically stack plausibly in meters (y grows upward; adjacent parts touch, \
no floating and no interpenetrating blocks; sizes roughly 0.05..3).
- explodeDir is the direction the part flies when the view explodes — roughly away from \
the object's center.
- Materials: hex colors (#rrggbb). Glowing parts set emissive to their color with \
emissiveIntensity 1.5..2.5; structural parts stay dark metal.
- speech: ONE short in-character line announcing the build (<= 40 words), no lists.
Return STRICT JSON only."""


def _workshop_gemini(prompt: str, schema: dict, max_tokens: int = 8192) -> dict:
    env = _read_env()
    key = env.get("GEMINI_API_KEY", "")
    if not key:
        raise HTTPException(status_code=409, detail=(
            "GEMINI_API_KEY missing from ~/.hermes/agentos/.env — add it in Settings to use the Workshop"))
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "maxOutputTokens": max_tokens,
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
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail=f"gemini returned unparseable output: {text[:200]}")
    return data


_WORKSHOP_PART_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "label": {"type": "string"},
        "desc": {"type": "string"},
        "shape": {"type": "string", "enum": list(WORKSHOP_SHAPES)},
        "params": {"type": "object", "properties": {
            k: {"type": "number"} for k in ("w", "h", "d", "r", "tube")}},
        "pos": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "rot": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "explodeDir": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "material": {"type": "object", "properties": {
            "color": {"type": "string"}, "emissive": {"type": "string"},
            "emissiveIntensity": {"type": "number"}, "metalness": {"type": "number"},
            "roughness": {"type": "number"}, "opacity": {"type": "number"}},
        },
    },
    "required": ["id", "label", "shape", "params", "pos"],
}

_WORKSHOP_BUILD_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "speech": {"type": "string"},
        "parts": {"type": "array", "items": _WORKSHOP_PART_SCHEMA, "minItems": 4},
    },
    "required": ["name", "speech", "parts"],
}

_WORKSHOP_PATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "label": {"type": "string"},
        "desc": {"type": "string"},
        "shape": {"type": "string", "enum": list(WORKSHOP_SHAPES)},
        "params": {"type": "object", "properties": {
            k: {"type": "number"} for k in ("w", "h", "d", "r", "tube")}},
        "pos": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "rot": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "explodeDir": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "material": {"type": "object", "properties": {
            "color": {"type": "string"}, "emissive": {"type": "string"},
            "emissiveIntensity": {"type": "number"}, "metalness": {"type": "number"},
            "roughness": {"type": "number"}, "opacity": {"type": "number"}},
        },
    },
}

_WORKSHOP_EDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "speech": {"type": "string"},
        "ops": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["add_part", "remove_part", "update_part"]},
                "id": {"type": "string"},
                "part": _WORKSHOP_PART_SCHEMA,
                "patch": _WORKSHOP_PATCH_SCHEMA,
            },
            "required": ["kind"],
        }},
    },
    "required": ["speech", "ops"],
}


def _apply_ops(scene: dict, ops) -> tuple[dict, list]:
    """Mutate a *sanitized* scene with the LLM's ops. Unknown ops/ids are ignored."""
    applied = []
    for op in (ops if isinstance(ops, list) else [])[:24]:
        if not isinstance(op, dict):
            continue
        kind = str(op.get("kind") or "")
        if kind == "add_part":
            clean = _sanitize_part(op.get("part"), len(scene["parts"]))
            if clean is None:
                continue
            while any(p["id"] == clean["id"] for p in scene["parts"]):
                clean["id"] = clean["id"][:34] + "-" + _hashlib.sha1(str(time.time_ns()).encode()).hexdigest()[:4]
            if len(scene["parts"]) >= WORKSHOP_MAX_PARTS:
                continue
            scene["parts"].append(clean)
            applied.append({"kind": "add", "id": clean["id"]})
        elif kind == "remove_part":
            pid = str(op.get("id") or "")
            if any(p["id"] == pid for p in scene["parts"]) and len(scene["parts"]) > 1:
                scene["parts"] = [p for p in scene["parts"] if p["id"] != pid]
                applied.append({"kind": "remove", "id": pid})
        elif kind == "update_part":
            pid = str(op.get("id") or "")
            patch = op.get("patch") if isinstance(op.get("patch"), dict) else {}
            target = next((p for p in scene["parts"] if p["id"] == pid), None)
            if target is None:
                continue
            for key in ("label", "desc"):
                if key in patch:
                    limit = 60 if key == "label" else 300
                    target[key] = str(patch[key] or "")[:limit].strip() or target[key]
            for key in ("pos", "rot", "explodeDir"):
                if key in patch:
                    target[key] = [round(x, 3) for x in _vec3(patch[key], -20.0 if key != "rot" else -6.3,
                                                              20.0 if key != "rot" else 6.3, target[key])]
            if "shape" in patch:
                shape = str(patch["shape"]).lower()
                if shape in WORKSHOP_SHAPES and shape != target["shape"]:
                    target["shape"] = shape
                    target["params"] = dict(_SHAPE_DEFAULTS[shape])
            if "params" in patch and isinstance(patch["params"], dict):
                merged = dict(_SHAPE_DEFAULTS[target["shape"]])
                for k in merged:
                    if k in patch["params"]:
                        merged[k] = _num(patch["params"][k], 0.02, 12.0, merged[k])
                target["params"] = {k: round(v, 3) for k, v in merged.items()}
            if "material" in patch and isinstance(patch["material"], dict):
                mat = dict(target["material"])
                raw = patch["material"]
                for key in ("color", "emissive"):
                    if key in raw:
                        mat[key] = _workshop_color(raw[key], mat[key])
                for key in ("emissiveIntensity", "metalness", "roughness"):
                    if key in raw:
                        hi = 10.0 if key == "emissiveIntensity" else 1.0
                        mat[key] = round(_num(raw[key], 0.0, hi, mat[key]), 2)
                if "opacity" in raw:
                    mat["opacity"] = round(_num(raw["opacity"], 0.05, 1.0, mat["opacity"]), 2)
                target["material"] = mat
            applied.append({"kind": "update", "id": pid})
    scene["updated"] = _dt.datetime.now().isoformat(timespec="seconds")
    return scene, applied


@router.post("/workshop/build")
def workshop_build(body: dict = Body(...)):
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt required")
    if len(prompt) > 2000:
        raise HTTPException(status_code=400, detail="prompt too long (2000 max)")
    full = (_WORKSHOP_BUILDER_RULES +
            "\n\nObject request from the operator: " + prompt +
            "\nReturn the JSON build plan now.")
    data = _workshop_gemini(full, _WORKSHOP_BUILD_SCHEMA)
    scene = sanitize_scene(data)
    if len(scene["parts"]) < 2:
        raise HTTPException(status_code=502, detail="gemini produced no usable parts")
    _save_workshop_scene(scene)
    return {"ok": True, "scene": scene, "ops": [],
            "speech": _cap_speech(data.get("speech")), "date": _local_date()}


@router.post("/workshop/edit")
def workshop_edit(body: dict = Body(...)):
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt required")
    if len(prompt) > 2000:
        raise HTTPException(status_code=400, detail="prompt too long (2000 max)")
    current = _load_workshop_scene() or _demo_workshop_scene()
    current = sanitize_scene(current)
    full = (_WORKSHOP_BUILDER_RULES +
            "\nYou are now EDITING an existing scene. Reply with ops against it.\n"
            "Rules: ids must match existing parts for remove/update; new parts are added on "
            "empty ground beside the object; keep the speech one short in-character line "
            "(<=40 words). If the request is impossible with the allowed ops, leave ops empty "
            "and say so in speech.\n\nCurrent scene JSON:\n" +
            json.dumps({"name": current["name"], "parts": current["parts"]}) +
            "\n\nOperator request: " + prompt + "\nReturn the JSON ops now.")
    data = _workshop_gemini(full, _WORKSHOP_EDIT_SCHEMA)
    scene, applied = _apply_ops(current, data.get("ops"))
    if applied:
        _save_workshop_scene(scene)
    # No applicable ops is a valid ANSWER (e.g. "what is the heat sink?") — the
    # speech line carries the reply; the scene comes back untouched.
    return {"ok": True, "scene": scene, "ops": applied,
            "speech": _cap_speech(data.get("speech")), "date": _local_date()}


@router.delete("/workshop/scene")
def workshop_scene_reset():
    """Clear the saved scene — the tab falls back to the built-in demo build."""
    try:
        WORKSHOP_FILE.unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True}


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
# Watched repos for the release board: from agentos.yaml `release_repos`
# (list of {label, repo}), so a public checkout carries no personal topology.
_RELEASE_REPOS = [
    (str(r.get("label") or r["repo"]), str(r["repo"]))
    for r in (_CFG.get("release_repos") or [])
    if isinstance(r, dict) and r.get("repo")
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
        f = float(v)
        return f / 1000.0 if f > 1e11 else f  # epoch-ms vs epoch-s
    except (TypeError, ValueError):
        pass
    try:
        import datetime as _dt
        return _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


def _session_todos() -> list[dict]:
    """Latest Hermes todo_list snapshot from the gateway session store.

    Hermes todo_list state lives in session transcripts (state.db messages),
    not a durable file — the most recent snapshot from a telegram session is
    the live personal list. Returns [{id, title, status}] with kanban-style
    statuses (pending -> todo, in_progress -> ready).
    """
    try:
        import sqlite3
        db = _hermes_home() / "state.db"
        if not db.exists():
            return []
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows = con.execute(
            "select m.content, m.timestamp from messages m"
            " join sessions s on s.id = m.session_id"
            " where s.source = 'telegram' and m.content like '%'||char(34)||'todos'||char(34)||'%'"
            " order by m.timestamp desc limit 25"
        ).fetchall()
        con.close()
        for content, ts in rows:
            try:
                d = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                continue
            todos = d.get("todos")
            if isinstance(todos, list) and "revision" in d:
                out = []
                for t in todos:
                    if not isinstance(t, dict):
                        continue
                    st = str(t.get("status") or "pending")
                    if st in ("completed", "cancelled"):
                        continue
                    out.append({
                        "id": f"tg:{t.get('id') or t.get('content', '')[:20]}",
                        "title": str(t.get("content") or "")[:160],
                        "status": "todo" if st == "pending" else "ready",
                        "priority": 0, "assignee": "telegram",
                        "at": ts, "ts": ts,
                    })
                return out
        return []
    except Exception:  # noqa: BLE001
        return []


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


@router.get("/memory")
def memory_galaxy():
    """Nodes for the memory galaxy: kanban tasks, cron jobs, monitored services.

    Each node: {id, source, cluster, label, status, detail, at, ts, color_key}.
    ts = epoch seconds (backend-normalized so the frontend stays dumb).
    """
    nodes: list = []

    # 1. kanban tasks across all boards (recent 60 per board)
    boards_dir = _HERMES_HOME / "kanban" / "boards"
    if boards_dir.exists():
        for bdir in sorted(boards_dir.iterdir()):
            db = bdir / "kanban.db"
            if not db.exists():
                continue
            try:
                import sqlite3
                con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
                rows = con.execute(
                    "select id, title, status, priority, assignee,"
                    " coalesce(completed_at, started_at, created_at)"
                    " from tasks"
                    " order by coalesce(completed_at, started_at, created_at) desc limit 60"
                ).fetchall()
                con.close()
            except Exception:  # noqa: BLE001
                continue
            for tid, title, tstatus, prio, assignee, ts in rows:
                done = (tstatus or "") in ("done", "archived")
                nodes.append({
                    "id": f"task:{bdir.name}:{tid}",
                    "source": "task", "cluster": f"task:{tstatus or '?'}",
                    "label": (title or "(untitled)")[:90],
                    "status": tstatus or "?", "board": bdir.name,
                    "assignee": assignee or "", "priority": prio or 0,
                    "at": ts, "ts": _parse_ts(ts),
                    "color_key": "task_done" if done else "task_open",
                })

    # 1b. personal todos from the telegram todo_list store — glow cyan.
    # Skip items that already exist as kanban tasks (same title) so the
    # migrated personal board doesn't double-render in the galaxy.
    try:
        _kanban_titles = [n["label"] for n in nodes if n.get("source") == "task"]
        for t in _session_todos():
            if any(_titles_similar(t["title"], kt) for kt in _kanban_titles):
                continue
            nodes.append({
                "id": t["id"], "source": "task", "cluster": "task:todo",
                "label": t["title"], "status": t["status"],
                "board": "telegram", "assignee": "telegram", "priority": 0,
                "at": t.get("at"), "ts": t.get("ts"), "color_key": "task_open",
            })
    except Exception:  # noqa: BLE001
        pass

    # 2. cron jobs with last-run outcome
    try:
        jf = _HERMES_HOME / "cron" / "jobs.json"
        jobs = []
        if jf.exists():
            data = json.loads(jf.read_text(encoding="utf-8"))
            jobs = [j for j in data.get("jobs", []) if isinstance(j, dict)]
        db = _HERMES_HOME / "cron" / "executions.db"
        last: dict = {}
        if db.exists():
            import sqlite3
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            for jid, jstatus, started, err in con.execute(
                "select job_id, status, started_at, error from executions"
                " where started_at is not null order by started_at desc limit 400"
            ).fetchall():
                if jid and jid not in last:
                    last[jid] = (jstatus or "?", started, (err or "")[:120])
            con.close()
        for j in jobs:
            jid = j.get("id", "")
            info = last.get(jid, ("never", None, ""))
            ok = info[0] in ("completed", "success", "succeeded")
            nodes.append({
                "id": f"cron:{jid}", "source": "cron", "cluster": f"cron:{info[0]}",
                "label": (j.get("name") or jid or "?")[:90],
                "status": info[0],
                "detail": (str(j.get("schedule_display") or j.get("schedule") or "") )[:40],
                "at": info[1], "ts": _parse_ts(info[1]),
                "color_key": "cron_bad" if info[0] in ("failed", "error", "timeout") else "cron_ok",
            })
    except Exception as _e:  # noqa: BLE001 — surface as an error node, never silently drop
        nodes.append({
            "id": "cron:load-error", "source": "cron", "cluster": "cron:error",
            "label": f"cron feed failed: {type(_e).__name__}: {_e}"[:90],
            "status": "error", "detail": "", "at": None, "ts": None,
            "color_key": "cron_bad",
        })

    # 3. monitored services as fixed stars
    for svc in SERVICE_PINGS:
        r = _ping(svc["url"])
        nodes.append({
            "id": f"svc:{svc['name']}", "source": "service", "cluster": "services",
            "label": svc["name"], "status": "up" if r.get("ok") else "down",
            "detail": f"{svc['url']}"[:60], "at": None, "ts": None,
            "color_key": "svc_up" if r.get("ok") else "svc_down",
        })

    return {"date": _local_date(), "count": len(nodes), "nodes": nodes}


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


# ---------------------------------------------------------------- persistent memory (cross-session)

MEMORY_FILE = AGENTOS / "memory.json"


def _load_memory() -> list[dict]:
    if not MEMORY_FILE.exists():
        return []
    try:
        data = json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
        return data.get("facts", []) if isinstance(data, dict) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_memory(facts: list[dict]) -> None:
    AGENTOS.mkdir(parents=True, exist_ok=True)
    MEMORY_FILE.write_text(json.dumps({"facts": facts[-200:]}, indent=1, default=str), encoding="utf-8")


def _mem_id(text: str) -> str:
    return _hashlib.sha1(_re.sub(r"\s+", " ", text.strip().lower()).encode()).hexdigest()[:10]


@router.get("/memfacts")
def memory_get():
    facts = _load_memory()
    facts_sorted = sorted(facts, key=lambda f: f.get("created", ""), reverse=True)
    return {"facts": facts_sorted[:200], "total": len(facts)}


@router.post("/memfacts")
def memory_add(body: dict = Body(...)):
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 500:
        text = text[:500]
    tags = body.get("tags") if isinstance(body.get("tags"), list) else []
    facts = _load_memory()
    mid = _mem_id(text)
    if any(f.get("id") == mid for f in facts):
        return {"ok": True, "id": mid, "duplicate": True}
    fact = {"id": mid, "text": text, "tags": tags, "source": str(body.get("source") or "deck"),
            "created": _dt.datetime.now().isoformat(timespec="seconds")}
    facts.append(fact)
    _save_memory(facts)
    return {"ok": True, "id": mid, "duplicate": False}


@router.delete("/memfacts")
def memory_delete(body: dict = Body(...)):
    mid = str(body.get("id") or "")
    facts = _load_memory()
    kept = [f for f in facts if f.get("id") != mid]
    if len(kept) == len(facts):
        raise HTTPException(status_code=404, detail="fact not found")
    _save_memory(kept)
    return {"ok": True, "removed": mid}


# remember/forget fast-paths for /command — no agent call needed
_REMEMBER_RE = re.compile(r"^(?:/remember|please remember|remember)(?: that|:| this)?\s+(.+)$", re.IGNORECASE | re.DOTALL)
_FORGET_RE = re.compile(r"^/forget\s+(.+)$", re.IGNORECASE | re.DOTALL)


def _memory_fastpath(query: str) -> dict | None:
    m = _REMEMBER_RE.match(query.strip())
    if m:
        text = m.group(1).strip()
        if text:
            facts = _load_memory()
            mid = _mem_id(text)
            if any(f.get("id") == mid for f in facts):
                return {"ok": True, "reply": "Already in memory: " + text}
            facts.append({"id": mid, "text": text, "tags": [], "source": "conversation",
                          "created": _dt.datetime.now().isoformat(timespec="seconds")})
            _save_memory(facts)
            return {"ok": True, "reply": "Stored in permanent memory: " + text}
    m = _FORGET_RE.match(query.strip())
    if m:
        needle = m.group(1).strip().lower()
        facts = _load_memory()
        matches = [f for f in facts if needle in f.get("text", "").lower()]
        if not matches:
            close = difflib.get_close_matches(needle, [f.get("text", "") for f in facts], n=3, cutoff=0.4)
            hint = (" Closest: " + "; ".join(close)) if close else ""
            return {"ok": True, "reply": "No memory matches '" + needle + "'." + hint}
        drop = {f["id"] for f in matches}
        _save_memory([f for f in facts if f["id"] not in drop])
        return {"ok": True, "reply": "Forgot " + str(len(matches)) + " memory item(s): " +
                "; ".join(f.get("text", "")[:80] for f in matches[:3])}
    return None


def _memory_block(query: str) -> str:
    """Prepend durable facts so every agent session starts with D's context."""
    facts = _load_memory()
    if not facts:
        return query
    facts_sorted = sorted(facts, key=lambda f: f.get("created", ""), reverse=True)[:40]
    block = ("Persistent memory from previous sessions (background context — use when "
             "relevant, never recite it back):\n" +
             "\n".join("- " + f.get("text", "") for f in facts_sorted) + "\n\n")
    return block + query


# ---------------------------------------------------------------- remediation (approval-gated self-healing)
#
# The scanner pings every configured service on a timer. A down service with a
# `remediation.auto.<name>` restart command in agentos.yaml is restarted
# automatically (cooldown + hourly caps apply); anything else lands in
# `pending` and waits for a one-click APPROVE in the deck (or Telegram notice).

_REMEDIATION_CFG = _CFG.get("remediation") if isinstance(_CFG.get("remediation"), dict) else {}
REMEDIATION_FILE = CACHE / "remediation.json"
_REM_START_GUARD = [False]


def _rem_state() -> dict:
    if REMEDIATION_FILE.exists():
        try:
            data = json.loads(REMEDIATION_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("events", [])
                data.setdefault("pending", [])
                data.setdefault("enabled", None)  # None = follow agentos.yaml
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"events": [], "pending": [], "enabled": None}


def _rem_enabled() -> bool:
    state = _rem_state()
    if state.get("enabled") is not None:
        return bool(state["enabled"])
    return bool(_REMEDIATION_CFG.get("enabled"))


def _rem_save(state: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    state["events"] = state["events"][-80:]
    REMEDIATION_FILE.write_text(json.dumps(state, indent=1, default=str), encoding="utf-8")


def _rem_event(state: dict, kind: str, service: str, detail: str) -> dict:
    ev = {"id": _hashlib.sha1((kind + service + str(time.time())).encode()).hexdigest()[:10],
          "kind": kind, "service": service, "detail": detail[:300],
          "at": _dt.datetime.now().isoformat(timespec="seconds"), "ts_epoch": time.time()}
    state["events"].append(ev)
    return ev


def _rem_auto_map() -> dict:
    m = _REMEDIATION_CFG.get("auto")
    return m if isinstance(m, dict) else {}


def _rem_ping_service(name: str):
    for svc in SERVICE_PINGS:
        if svc["name"] == name:
            r = _ping(svc["url"])
            return bool(r.get("ok")), r.get("ms"), str(r.get("code") or r.get("error") or "")
    return None, None, "unknown service"


def _rem_last_action_ts(state: dict, service: str) -> float:
    for ev in reversed(state["events"]):
        if ev.get("service") == service and ev.get("kind") in ("auto_fixed", "auto_failed", "approved"):
            return float(ev.get("ts_epoch") or 0)
    return 0.0


def _remediation_scan(manual: bool = False) -> dict:
    if not (manual or _rem_enabled()):
        return {"skipped": "disabled"}
    cooldown = int(_REMEDIATION_CFG.get("cooldown_minutes", 30)) * 60
    max_hour = int(_REMEDIATION_CFG.get("max_auto_per_hour", 4))
    auto = _rem_auto_map()
    ignored = {str(x) for x in (_REMEDIATION_CFG.get("ignore") or [])}
    state = _rem_state()
    now = time.time()
    auto_last_hour = [e for e in state["events"]
                      if e.get("kind") in ("auto_fixed", "auto_failed") and now - float(e.get("ts_epoch") or 0) < 3600]
    pending_by_service = {p.get("service"): p for p in state["pending"]}
    actions = []
    for svc in SERVICE_PINGS:
        name = svc["name"]
        if name in ignored:
            continue
        up, ms, detail = _rem_ping_service(name)
        if up:
            stale = pending_by_service.pop(name, None)
            if stale:
                state["pending"] = [p for p in state["pending"] if p.get("id") != stale.get("id")]
                _rem_event(state, "recovered", name, "back online before approval — pending cleared")
                actions.append({"service": name, "result": "recovered"})
            continue
        if name in pending_by_service:
            continue  # already awaiting approval
        cmd = auto.get(name)
        can_auto = (isinstance(cmd, str) and cmd.strip()
                    and len(auto_last_hour) < max_hour
                    and now - _rem_last_action_ts(state, name) >= cooldown)
        if can_auto:
            rc, out = _run_shell_cmd(cmd.strip(), timeout=120)
            time.sleep(8)  # give the service a moment before the recheck
            up2, ms2, detail2 = _rem_ping_service(name)
            kind = "auto_fixed" if up2 else "auto_failed"
            ev = _rem_event(state, kind, name,
                            f"restart rc={rc} {'ok' if rc == 0 else out}; recheck "
                            f"{'200 in ' + str(ms2) + 'ms' if up2 else detail2 or 'still down'}")
            auto_last_hour.append(ev)
            actions.append({"service": name, "result": kind})
            _tg_notify(("🔧 Auto-fixed: " if up2 else "🔧 Auto-restart FAILED: ") + name)
        else:
            pend = {"id": _hashlib.sha1((name + str(now)).encode()).hexdigest()[:10],
                    "service": name, "url": svc["url"], "detail": detail,
                    "cmd": cmd if isinstance(cmd, str) and cmd.strip() else None,
                    "created": _dt.datetime.now().isoformat(timespec="seconds")}
            state["pending"].append(pend)
            actions.append({"service": name, "result": "pending_approval"})
            _tg_notify("⚠️ " + name + " is down and awaiting your approval to fix. Open the deck → // AUTOMATION.")
    # money connectors: read today's cached snapshots (cheap, no live calls).
    # reauth_needed = session expired → open the login console once, then stop
    # nagging (the MFA step is D's; the flag prevents relaunch loops).
    try:
        wsnap = CACHE / ("money-stocks-" + _local_date() + ".json")
        launched_recently = False
        if WEBULL_LOGIN_FLAG.exists():
            try:
                _flag = json.loads(WEBULL_LOGIN_FLAG.read_text(encoding="utf-8"))
                launched_recently = now - float(_flag.get("ts") or 0) < 6 * 3600
            except Exception:  # noqa: BLE001
                launched_recently = False
        if wsnap.exists() and not launched_recently:
            wdata = json.loads(wsnap.read_text(encoding="utf-8"))
            if wdata.get("state") == "reauth_needed" and len(auto_last_hour) < max_hour:
                res = _launch_webull_login(silent=True)
                kind = "auto_fixed" if res.get("launched") else "auto_failed"
                _rem_event(state, kind, "webull-session",
                           res.get("detail") or "webull login retry launched silently")
                auto_last_hour.append({"kind": kind, "ts_epoch": now})
                actions.append({"service": "webull-session",
                                "result": "login_launched" if res.get("launched") else "launch_failed"})
                _tg_notify("📈 Webull session expired — retried the login silently. "
                           "If it still needs MFA, click 'reconnect webull' in the deck's Money tab.")
    except Exception:  # noqa: BLE001 — the money scan must never break the service scan
        pass
    if actions:
        _rem_save(state)
    return {"date": _local_date(), "actions": actions}


def _run_shell_cmd(cmd: str, timeout: int = 120) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()[-400:]
    except subprocess.TimeoutExpired:
        return 124, "timeout after " + str(timeout) + "s"
    except OSError as e:
        return 127, str(e)[:300]


def _rem_thread_loop() -> None:
    interval = max(2, int(_REMEDIATION_CFG.get("scan_minutes", 5))) * 60
    while True:
        time.sleep(interval)
        try:
            _remediation_scan()
        except Exception:  # noqa: BLE001 — the scanner must never die
            pass


if _rem_enabled() and not _REM_START_GUARD[0]:
    _REM_START_GUARD[0] = True
    threading.Thread(target=_rem_thread_loop, daemon=True, name="agentos-remediation").start()


@router.get("/remediation")
def remediation_get():
    state = _rem_state()
    return {"enabled": _rem_enabled(),
            "auto_services": sorted(_rem_auto_map().keys()),
            "pending": state["pending"],
            "events": sorted(state["events"], key=lambda e: e.get("ts_epoch", 0), reverse=True)[:30]}


@router.post("/remediation/config")
def remediation_config(body: dict = Body(...)):
    """Runtime toggle, persisted in the remediation ledger (agentos.yaml stays untouched)."""
    enabled = bool(body.get("enabled"))
    state = _rem_state()
    state["enabled"] = enabled
    _rem_save(state)
    if enabled and not _REM_START_GUARD[0]:
        _REM_START_GUARD[0] = True
        threading.Thread(target=_rem_thread_loop, daemon=True, name="agentos-remediation").start()
    return {"ok": True, "enabled": enabled}


@router.post("/remediation/scan")
def remediation_scan():
    return _remediation_scan(manual=True)


@router.post("/remediation/approve")
def remediation_approve(body: dict = Body(...)):
    pid = str(body.get("id") or "")
    state = _rem_state()
    pend = next((p for p in state["pending"] if p.get("id") == pid), None)
    if not pend:
        raise HTTPException(status_code=404, detail="pending item not found")
    state["pending"] = [p for p in state["pending"] if p.get("id") != pid]
    name = pend.get("service", "")
    if pend.get("cmd"):
        rc, out = _run_shell_cmd(pend["cmd"], timeout=180)
    else:
        ask = (f"Service '{name}' ({pend.get('url')}) is down — {pend.get('detail')}. "
               "Diagnose and fix it, then verify the endpoint returns 200. Report what you did.")
        try:
            out = _run_hermes_prompt(ask, timeout=600)
            rc = 0
        except HTTPException as e:
            rc, out = 1, str(e.detail)[:300]
    time.sleep(6)
    up2, ms2, detail2 = _rem_ping_service(name)
    kind = "approved_fixed" if up2 else "approved_failed"
    _rem_event(state, kind, name,
               f"approved fix rc={rc} {out[:120]}; recheck {'200 in ' + str(ms2) + 'ms' if up2 else detail2 or 'still down'}")
    _rem_save(state)
    _tg_notify(("🔧 Approved fix worked: " if up2 else "🔧 Approved fix did NOT fix: ") + name)
    return {"ok": True, "id": pid, "service": name, "recheck_up": up2, "kind": kind}


@router.post("/remediation/deny")
def remediation_deny(body: dict = Body(...)):
    pid = str(body.get("id") or "")
    state = _rem_state()
    pend = next((p for p in state["pending"] if p.get("id") == pid), None)
    if not pend:
        raise HTTPException(status_code=404, detail="pending item not found")
    state["pending"] = [p for p in state["pending"] if p.get("id") != pid]
    _rem_event(state, "denied", pend.get("service", ""), "dismissed without action")
    _rem_save(state)
    return {"ok": True, "id": pid}


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


# ---------------------------------------------------------------- settings (deck customization)

SETTINGS_FILE = AGENTOS / "settings.json"

_SETTINGS_DEFAULTS = {
    "tts_voice": "",  # "" = use agentos.yaml voice
}

# .env keys the settings panel offers out of the box — a generic catalog any
# user can wire, NOT an instance-specific list. Anything else can still be
# added by name (custom key row); the only hard rule is valid env-var syntax.
# Values are write-only: the panel shows presence (set/missing), never contents.
_SETTINGS_KEYS = {
    "GEMINI_API_KEY": "Google Gemini — AI features",
    "OPENAI_API_KEY": "OpenAI",
    "ANTHROPIC_API_KEY": "Anthropic",
    "OPENROUTER_API_KEY": "OpenRouter",
    "STRIPE_SECRET_KEY": "Stripe — payments",
    "TWILIO_AUTH_TOKEN": "Twilio — SMS/voice",
    "SENDGRID_API_KEY": "SendGrid — email",
    "ALPACA_API_KEY": "Alpaca — trading (key id)",
    "ALPACA_SECRET_KEY": "Alpaca — trading (secret)",
    "PLAID_CLIENT_ID": "Plaid — banking (client id)",
    "PLAID_SECRET": "Plaid — banking (secret)",
    "FISH_API_KEY": "Fish Audio — TTS voices (fish.audio)",
}

_ENV_NAME_RE = _re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")


def _load_settings() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {**_SETTINGS_DEFAULTS, **data}
    except (json.JSONDecodeError, OSError):
        pass
    return dict(_SETTINGS_DEFAULTS)


@router.get("/settings")
def settings_get():
    env = _read_env()
    keys = {name: {"set": bool(env.get(name)), "hint": hint}
            for name, hint in _SETTINGS_KEYS.items()}
    # keys the user added beyond the catalog show up as custom entries
    for k in sorted(env):
        if k not in keys and _ENV_NAME_RE.match(k):
            keys[k] = {"set": True, "hint": "custom key"}
    return {
        "date": _local_date(),
        "settings": _load_settings(),
        "keys": keys,
    }


@router.post("/settings")
def settings_set(body: dict = Body(...)):
    cur = _load_settings()
    for k, v in body.items():
        if k in _SETTINGS_DEFAULTS:
            try:
                cur[k] = type(_SETTINGS_DEFAULTS[k])(v)
            except (TypeError, ValueError):
                pass
    AGENTOS.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(cur, indent=1), encoding="utf-8")
    return {"ok": True, "settings": cur}


@router.post("/settings/keys")
def settings_set_key(body: dict = Body(...)):
    """Upsert one API key into ~/.hermes/agentos/.env.

    Catalog names (see GET /settings) plus ANY valid ENV_VAR name — the deck is
    a product, so users wire whatever their own stack needs.
    """
    name = str(body.get("name") or "").strip().upper()
    value = str(body.get("value") or "").strip()
    if not _ENV_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="key name must be UPPER_SNAKE (3-64 chars, starts with a letter)")
    if not value:
        raise HTTPException(status_code=400, detail="value required")
    _write_env_key(name, value)
    return {"ok": True, "name": name, "set": True}


@router.delete("/settings/keys")
def settings_delete_key(body: dict = Body(...)):
    name = str(body.get("name") or "").strip().upper()
    if not _ENV_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="invalid key name")
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    kept = [ln for ln in lines if ln.split("=", 1)[0].strip() != name]
    if len(kept) == len(lines):
        raise HTTPException(status_code=404, detail="key not present in .env")
    AGENTOS.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text("\n".join(kept) + "\n", encoding="utf-8")
    return {"ok": True, "name": name, "removed": True}


def _write_env_key(name: str, value: str) -> None:
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    out, replaced = [], False
    for line in lines:
        if line.split("=", 1)[0].strip() == name:
            out.append(f"{name}={value}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"{name}={value}")
    AGENTOS.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")
