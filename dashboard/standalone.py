"""Standalone runner for the agentos plugin backend.

Serves the same APIRouter the gateway mounts, on a plain local port so the
Vite preview shell can proxy to it and show real data instead of mocks.
Localhost only — no auth wall here, do not expose beyond loopback.

    C:/Users/D/.hermes/agentos/venv/Scripts/python.exe -m uvicorn standalone:app \
        --app-dir dashboard --host 127.0.0.1 --port 8775
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plugin_api import router  # noqa: E402

app = FastAPI(title="agentos plugin api (standalone preview)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4517", "http://127.0.0.1:4517"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Same mount prefix the gateway uses, so preview proxy paths line up 1:1.
app.include_router(router, prefix="/api/plugins/agentos")


@app.get("/healthz")
def healthz():
    return {"ok": True}
