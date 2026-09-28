"""Incremental update state and source change detection (notebook §6B).

The signature logic is the notebook's; the JSON state file becomes rows in
gov_ingest_state so the state lives with the data.
"""

import datetime as _dt
import hashlib
import json
import os
import time

from .config import FORCE_REFRESH_DAYS, LOCAL_DATA_DIR, UPDATE_MODE, log
from .fetchers import layer_meta


def _spec_state_key(layer, spec):
    """Stable key for one configured source."""
    return "|".join((layer, str(spec.get("iso3", "")), str(spec.get("layer_key", "")), str(spec.get("kind", ""))))


def load_state(conn):
    if UPDATE_MODE != "smart":
        return {"sources": {}}
    try:
        rows = conn.execute(
            "SELECT state_key, fingerprint, success_epoch, loaded, retired FROM gov_ingest_state"
        ).fetchall()
    except Exception as e:
        log(f"Incremental state could not be read ({e}); doing a full refresh of selected sources", "WARN")
        conn.rollback()
        return {"sources": {}}
    return {
        "sources": {
            r[0]: {"fingerprint": r[1], "success_epoch": r[2], "loaded": r[3], "retired": r[4]}
            for r in rows
        }
    }


def _arcgis_source_signature(url):
    meta = layer_meta(url)
    editing = meta.get("editingInfo") or {}
    last_edit = editing.get("dataLastEditDate") or editing.get("lastEditDate")
    # If no edit timestamp exists, retain a structural signature and let the
    # periodic due-date rule trigger a refresh.
    structural = {
        "name": meta.get("name"),
        "last_edit": last_edit,
        "max_record_count": meta.get("maxRecordCount"),
        "fields": [(f.get("name"), f.get("type"), f.get("length")) for f in (meta.get("fields") or [])],
    }
    return hashlib.sha1(json.dumps(structural, sort_keys=True, default=str).encode("utf-8")).hexdigest(), bool(last_edit)


def source_signature(layer, spec):
    """Return (fingerprint, reliable_change_metadata). No source features are downloaded here."""
    kind = spec.get("kind")
    if kind in ("agol", "mapserver"):
        return _arcgis_source_signature(spec["url"])
    if kind == "agol_multi":
        parts, reliable = [], True
        for url in spec.get("urls", []):
            sig, rel = _arcgis_source_signature(url)
            parts.append((url, sig))
            reliable = reliable and rel
        return hashlib.sha1(json.dumps(parts, sort_keys=True).encode("utf-8")).hexdigest(), reliable
    if kind == "local_shp":
        path = spec["path"] if os.path.isabs(spec["path"]) else os.path.join(LOCAL_DATA_DIR, spec["path"])
        base = os.path.splitext(path)[0]
        parts = []
        for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
            p = base + ext
            if os.path.exists(p):
                st = os.stat(p)
                parts.append((ext, st.st_size, st.st_mtime_ns))
        if not parts:
            return "missing:" + os.path.normcase(os.path.abspath(path)), True
        return hashlib.sha1(json.dumps(parts).encode("utf-8")).hexdigest(), True
    # WDPA and GeoCFCL do not expose a dependable lightweight last-edit value
    # in this workflow. They refresh when FORCE_REFRESH_DAYS is reached.
    identity = {k: spec.get(k) for k in ("kind", "iso3", "layer_key", "url", "vintage")}
    return hashlib.sha1(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest(), False


def source_needs_refresh(layer, spec, state):
    """Annotate a spec and decide whether it must be fetched this run."""
    key = _spec_state_key(layer, spec)
    spec["_state_key"] = key
    if UPDATE_MODE == "full":
        spec["_refresh_reason"] = "full mode"
        return True
    previous = state.get("sources", {}).get(key)
    try:
        fingerprint, reliable = source_signature(layer, spec)
    except Exception as e:
        # Do not silently skip a source when change detection itself fails.
        spec["_fingerprint"] = None
        spec["_refresh_reason"] = f"signature check failed: {e}"
        return True
    spec["_fingerprint"] = fingerprint
    if not previous:
        spec["_refresh_reason"] = "no successful prior run"
        return True
    if previous.get("fingerprint") != fingerprint:
        spec["_refresh_reason"] = "source signature changed"
        return True
    last_success = float(previous.get("success_epoch") or 0)
    age_days = (time.time() - last_success) / 86400.0 if last_success else 1e9
    if not reliable and age_days >= FORCE_REFRESH_DAYS:
        spec["_refresh_reason"] = f"periodic refresh due ({age_days:.1f} days)"
        return True
    spec["_refresh_reason"] = f"unchanged ({age_days:.1f} days since success)"
    return False


def mark_sources_success(conn, layer, specs, load_result):
    """Commit source checkpoints only after fetch and load succeeded."""
    if load_result.get("failed", 0):
        return
    now_epoch = time.time()
    for spec in specs:
        if not spec.get("_fetch_ok"):
            continue
        key = spec.get("_state_key") or _spec_state_key(layer, spec)
        fingerprint = spec.get("_fingerprint")
        if fingerprint is None:
            try:
                fingerprint, _ = source_signature(layer, spec)
            except Exception:
                fingerprint = None
        conn.execute(
            """
            INSERT INTO gov_ingest_state
              (state_key, fingerprint, success_epoch, success_utc, loaded, retired)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (state_key) DO UPDATE SET
              fingerprint = EXCLUDED.fingerprint,
              success_epoch = EXCLUDED.success_epoch,
              success_utc = EXCLUDED.success_utc,
              loaded = EXCLUDED.loaded,
              retired = EXCLUDED.retired
            """,
            (
                key, fingerprint, now_epoch,
                _dt.datetime.now(_dt.timezone.utc),
                int(load_result.get("added", 0) + load_result.get("updated", 0)),
                int(load_result.get("retired", 0)),
            ),
        )
    conn.commit()
