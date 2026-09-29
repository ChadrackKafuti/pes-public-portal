"""Ingest driver (notebook §7 run()) against the Postgres store.

Same flow as the notebook: active specs -> threaded fetch -> harmonise ->
enrich -> fallback dedup -> parent linking -> documents -> load -> retire.
The console report becomes a gov_runs row; the CSV side files become
entries in that row's stats JSON.
"""

import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from .config import (
    COLLECT_DOCS,
    COUNTRIES,
    DATABASE_URL,
    FETCH_WORKERS,
    LAYERS,
    SKIP_LARGE,
    SOURCES,
    DOC_LAYERS,
    LAYER_NAME,
    LAYER_ORDER,
    PARENT_LAYER,
    UPDATE_MODE,
    ZONING_LAYERS,
    log,
)
from .docs import collect_docs
from .enrich import SpatialLookup, attach_parents, classify_situation, dedup_fallbacks, enrich
from .fetchers import domain_maps, fetch_source
from .harmonisers import harmonise
from .state import load_state, mark_sources_success, source_needs_refresh
from .store import GovStore

STAT_COLS = ["fetched", "no_geom", "loaded", "added", "updated", "failed", "retired",
             "dedup_dropped", "complete", "part_complete", "no_data", "country_mismatch",
             "province_computed", "parent_matched", "parent_spatial", "parent_unmatched", "docs"]


def active_specs(layer, state):
    out = []
    for original in SOURCES.get(layer, []):
        spec = dict(original)  # run annotations must not mutate the registry
        if spec.get("kind") == "none" or spec.get("enabled", True) is False:
            continue
        if COUNTRIES and spec["iso3"] != "*" and spec["iso3"] not in COUNTRIES:
            continue
        if SKIP_LARGE and spec.get("large"):
            log(f"  skipping large source {layer}/{spec['iso3']}/{spec['layer_key']} (SKIP_LARGE)")
            continue
        if source_needs_refresh(layer, spec, state):
            log(f"  refresh {layer}/{spec['iso3']}/{spec['layer_key']}: {spec['_refresh_reason']}")
            out.append(spec)
        else:
            log(f"  skip unchanged {layer}/{spec['iso3']}/{spec['layer_key']}: {spec['_refresh_reason']}")
    return out


def run(store: GovStore | None = None):
    t0 = time.time()
    start_utc = datetime.now(UTC)
    store = store or GovStore(DATABASE_URL)
    layers = [k for k in LAYER_ORDER if (not LAYERS or k in LAYERS)]
    bad = [k for k in (LAYERS or []) if k not in LAYER_ORDER]
    if bad:
        raise SystemExit(f"Unknown layer keys {bad}. Valid: {LAYER_ORDER}")
    log("=" * 78)
    log(f"cb_governance ingest  layers={layers}  countries={COUNTRIES or 'all'}")
    log("=" * 78)
    with store.connection() as conn:
        if not store.try_acquire_lock(conn):
            log("Another governance ingest holds the run lock; exiting.", "WARN")
            return None
        try:
            return _run_locked(store, conn, layers, t0, start_utc)
        finally:
            store.release_lock(conn)


def _run_locked(store, conn, layers, t0, start_utc):
    state = load_state(conn)
    lookup = SpatialLookup().load()
    stats = defaultdict(Counter)                 # (layer, iso3) -> Counter
    records = {}                                 # layer -> list of (rec, geom, spec)
    uid_alias = {}                               # fallback src_uid -> primary src_uid (dedup)
    doc_rows, unmatched_rows, nogeom_rows, fetch_errors = [], [], [], []
    doc_refresh_scopes = set()

    for layer in layers:
        specs = active_specs(layer, state)
        log(f"--- {LAYER_NAME[layer]} : {len(specs)} sources")
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as ex:
            results = list(ex.map(lambda s: fetch_source(layer, s), specs))
        items = []
        for spec, feats, meta, err in results:
            if err:
                log(f"  FETCH FAILED {spec['iso3']}/{spec['layer_key']}: {err}", "ERROR")
                fetch_errors.append((layer, spec["iso3"], spec.get("layer_key"), err))
                spec["_fetch_ok"] = False
                continue
            spec["_fetch_ok"] = True
            domains = domain_maps(meta)
            n_ok = 0
            for src in feats:
                k = (layer, src.iso3)
                stats[k]["fetched"] += 1
                try:
                    rec = harmonise(layer, spec, src, meta, domains)
                except Exception as e:
                    stats[k]["failed"] += 1
                    log(f"  harmonise error {spec['layer_key']} oid={src.oid}: {e}", "WARN")
                    continue
                if not src.geom:
                    stats[k]["no_geom"] += 1
                    nogeom_rows.append((layer, src.iso3, spec["layer_key"], src.oid,
                                        rec.get("name"), rec.get("reference")))
                    continue
                enrich(layer, rec, src.geom, lookup, stats[k], reassign_country=(spec["iso3"] == "*"))
                items.append((rec, src.geom, spec))
                n_ok += 1
            log(f"  {spec['iso3']:<3} {spec['layer_key']:<16} fetched={len(feats):>6}  usable={n_ok:>6}")
        # de-duplicate fallback sources against primary ones (same layer)
        items, dropped = dedup_fallbacks(layer, items, specs, stats, uid_alias)
        # uniqueness of src_uid
        seen = {}
        for rec, g, spec in items:
            if rec["src_uid"] in seen:
                seen[rec["src_uid"]] += 1
                rec["src_uid"] = f"{rec['src_uid']}:{seen[rec['src_uid']]}"
            else:
                seen[rec["src_uid"]] = 0
        # link zoning to parents
        if layer in ZONING_LAYERS:
            parent_layer = PARENT_LAYER[layer]
            parents_all = [r for r, _, _ in records.get(parent_layer, [])]
            if not parents_all:
                parents_all = store.load_parent_index(conn, parent_layer) or []
                if not parents_all:
                    log(f"  parent layer {parent_layer} not available in this run: parent_uid left empty", "WARN")
            for spec in specs:
                rule = spec.get("parent")
                if not rule:
                    continue
                children = [r for r, _, s in items if s is spec]
                parents = [p for p in parents_all if p.get("iso3") == spec["iso3"] or spec["iso3"] == "*"]
                if rule.get("layer_key"):
                    parents = [p for p in parents if str(p.get("src_uid", "")).split(":")[1:2] == [rule["layer_key"]]]
                um = []
                parent_geoms = {r["src_uid"]: g for r, g, _ in records.get(parent_layer, [])}
                attach_parents(children, parents, rule, stats[(layer, spec["iso3"])], um, parent_geoms)
                unmatched_rows.extend(
                    (layer, c["iso3"], spec["layer_key"], c.get("src_uid"),
                     c.get(rule["child_field"]), c.get("zone_name"), c.get("province"))
                    for c in um
                )
                for c in children:
                    c["situation"] = classify_situation(layer, c)
        # documents
        if COLLECT_DOCS and layer in DOC_LAYERS:
            for spec in specs:
                if not spec.get("docs") or not spec.get("_fetch_ok"):
                    continue
                recs = [r for r, _, s in items if s is spec] + [r for r, _, s in dropped if s is spec]
                t1 = time.time()
                rows = collect_docs(spec, recs)
                if spec["iso3"] != "*":
                    doc_refresh_scopes.add(f"{spec['iso3']}:{spec['layer_key']}:")
                for row in rows:
                    if row["parent_uid"] in uid_alias:          # re-parent docs of deduplicated fallback rows
                        row["parent_uid"] = uid_alias[row["parent_uid"]]
                        row["doc_uid"] = row["parent_uid"] + row["doc_uid"][row["doc_uid"].index(":doc:"):]
                doc_rows.extend(rows)
                stats[(layer, spec["iso3"])]["docs"] += len(rows)
                log(f"  docs {spec['iso3']}/{spec['layer_key']}: {len(rows)} in {int(time.time() - t1)}s")
        # situation tallies + load
        for rec, g, spec in items:
            stats[(layer, rec["iso3"])][rec["situation"] or "no_data"] += 1
            stats[(layer, rec["iso3"])]["loaded"] += 1
        records[layer] = items
        scopes = [f"{s['iso3']}:{s['layer_key']}:" for s in specs if s.get("_fetch_ok") and s["iso3"] != "*"]
        t1 = time.time()
        res = store.write(conn, layer, [(r, g) for r, g, _ in items], scopes=scopes)
        for k, v in res.items():
            stats[(layer, "ALL")][k] += v
        log(f"  loaded {LAYER_NAME[layer]}: {res} in {int(time.time() - t1)}s")
        mark_sources_success(conn, layer, specs, res)

    # documents table (doc_count on parents was not known before loading)
    if COLLECT_DOCS and (doc_rows or doc_refresh_scopes):
        counts = Counter(r["parent_uid"] for r in doc_rows)
        for layer, items in records.items():
            for rec, _, _ in items:
                rec["doc_count"] = counts.get(rec["src_uid"], 0)
        seen, uniq = set(), []
        for r in doc_rows:
            if r["doc_uid"] in seen:
                continue
            seen.add(r["doc_uid"]); uniq.append(r)
        res = store.write_documents(conn, uniq, scopes=sorted(doc_refresh_scopes))
        stats[("documents", "ALL")].update(res)
        log(f"  documents table: {len(uniq)} rows -> {res}")
        store.update_doc_counts(
            conn,
            {r["src_uid"]: r["doc_count"] for items in records.values() for r, _, _ in items},
        )

    # ---- report --------------------------------------------------------------
    duration = time.time() - t0
    log("=" * 100)
    log(f"CB GOVERNANCE INGEST REPORT   elapsed={int(duration)}s")
    rows_out = {}
    for (layer, iso3) in sorted(stats, key=lambda k: (LAYER_ORDER.index(k[0]) if k[0] in LAYER_ORDER else 99, k[1])):
        c = stats[(layer, iso3)]
        log(f"  {layer:<26} {iso3:<5} " + " ".join(f"{col[:9]}={c.get(col, 0)}" for col in STAT_COLS if c.get(col)))
        rows_out[f"{layer}/{iso3}"] = {col: c.get(col, 0) for col in STAT_COLS if c.get(col)}
    totals = Counter()
    for (layer, iso3), c in stats.items():
        if iso3 != "ALL":
            totals["fetched"] += c.get("fetched", 0)
            totals["docs"] += c.get("docs", 0)
        elif layer != "documents":  # documents-table adds are reported via "docs", not "loaded"
            for k in ("added", "updated", "retired", "failed"):
                totals[k] += c.get(k, 0)
    health = {
        "start_utc": start_utc,
        "end_utc": datetime.now(UTC),
        "duration_s": round(duration, 1),
        "update_mode": UPDATE_MODE,
        "layers": ",".join(layers),
        "countries": ",".join(COUNTRIES) if COUNTRIES else None,
        "fetched": totals["fetched"],
        "loaded": totals["added"] + totals["updated"],
        "retired": totals["retired"],
        "failed": totals["failed"],
        "docs": totals["docs"],
        "fetch_errors": fetch_errors,
        "stats": {
            "by_scope": rows_out,
            "unmatched_parents": len(unmatched_rows),
            "no_geometry": len(nogeom_rows),
        },
    }
    store.insert_run(conn, health)
    if fetch_errors:
        log(f"  {len(fetch_errors)} fetch error(s)", "WARN")
    if unmatched_rows:
        log(f"  {len(unmatched_rows)} zoning rows without parent")
    log("  Production filter for maps:  retired = 0 AND situation IN ('complete','part_complete')")
    return stats
