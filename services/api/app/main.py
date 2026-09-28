"""CAFI RS Platform API.

The single data door for the web app (design doc §3.2, §6.2). The frontend
never talks to upstream systems directly: PES data enters through the
pipeline service, and this API serves it with auth tiers and the privacy
curation required by the RS specification §9.

P0 scope: health + stubbed contract endpoints, so the web skeleton and the
deployment pipeline have something real to talk to. PostGIS wiring lands in P1.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .settings import settings

app = FastAPI(title="CAFI RS Platform API", version="0.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "cafi-rs-api", "version": app.version}


@app.get("/api/contracts")
def list_contracts() -> dict:
    """Contract list with buildWhere-style filters. Stub until PostGIS lands (P1)."""
    return {"items": [], "total": 0}


@app.get("/api/contracts/{code}/indicators")
def contract_indicators(code: str) -> dict:
    """pes_rs_objects rows for a contract family. Stub until PostGIS lands (P1)."""
    raise HTTPException(status_code=501, detail="Indicators land in P1 with the pipeline.")
