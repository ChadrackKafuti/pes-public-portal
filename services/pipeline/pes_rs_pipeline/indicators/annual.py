"""Annual indicators (M7d) — the v1 contract-analysis sheet's data.

Per application (its geometry bearer): a yearly Dynamic World tree-cover
series from annual_start_year to the last full year, with loss derived
from consecutive values (loss_y = max(0, tc_{y-1} - tc_y)), and the
dominant land-cover class at the application date vs today (the v1
"Land Cover" card). The backlog drains inside the run's remaining time
budget; selection is simply "rows missing", so re-runs resume.
"""

import logging
from datetime import UTC, date, datetime

from ..config import PipelineConfig
from ..geometry import resolve_geom_source
from ..models import ObjectType, PesObject
from ..windows import Interval

log = logging.getLogger(__name__)


def _bearer(row) -> PesObject:
    def _text(v):
        return v.decode("utf-8", errors="replace") if isinstance(v, bytes) else v

    return PesObject(
        object_id=_text(row[0]),
        object_type=ObjectType.APPLICATION,
        object_date=row[5],
        application_date=row[5],
        application_id=_text(row[0]),
        shape_wkt=_text(row[1]),
        point=(row[2], row[3]) if row[2] is not None else None,
        estimated_area_ha=row[4],
    )


_CANDIDATES_SQL = """
SELECT p.application_id, p.shape_raw, p.point_lon, p.point_lat,
       p.estimated_area_ha, p.application_date, o.landcover_at_app,
       o.canopy_utc, o.parcel_area_ha, p.pes_activity
FROM pes_parcels p
JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE o.status IN ('ok', 'partial', 'partial_final')
  AND NOT (p.application_id = ANY(%(hidden)s))
  AND (
    o.landcover_at_app IS NULL
    OR o.canopy_utc IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pes_annual_indicators a
      WHERE a.application_id = p.application_id AND a.year = %(last_year)s
    )
    OR EXISTS (
      SELECT 1 FROM pes_annual_indicators a
      WHERE a.application_id = p.application_id
        AND a.tc_ha IS NOT NULL
        AND (a.control_tc_ha IS NULL OR a.burned_ha IS NULL)
    )
  )
ORDER BY
  -- Contract-linked applications first (M22): the Analyses page can only
  -- show contracts, so parcels reachable through a monitoring visit's
  -- contract code must get their series before the contract-less backlog.
  (p.application_id = ANY(%(priority)s)) DESC,
  -- Applications still missing the series come first (M19): records whose
  -- land cover keeps failing (e.g. GEE projection-validity errors on odd
  -- geometries) otherwise sit at the head of the queue and are retried
  -- every run before any new series gets computed.
  EXISTS (
    SELECT 1 FROM pes_annual_indicators a
    WHERE a.application_id = p.application_id AND a.year = %(last_year)s
  ) ASC,
  p.application_date DESC
LIMIT %(limit)s
"""


def process_annual(
    conn,
    backend,
    config: PipelineConfig,
    deadline,
    today: date,
    hidden_ids: set[str] | None = None,
    priority_ids: set[str] | None = None,
) -> dict:
    last_year = today.year - 1
    rows = conn.execute(
        _CANDIDATES_SQL,
        {
            "last_year": last_year,
            "limit": config.annual_backlog_limit,
            "hidden": sorted(hidden_ids or ()),  # M20: no GEE for hidden records
            "priority": sorted(priority_ids or ()),  # M22: contract-linked first
        },
    ).fetchall()
    done = failed = 0
    for row in rows:
        if datetime.now(UTC) >= deadline:
            break
        app_id = row[0]
        try:
            obj = _bearer(row)
            resolved = resolve_geom_source(obj, obj)
            if resolved is None:
                continue
            source, bearer = resolved
            parcel = backend.resolve_parcel(bearer, source)

            existing = {
                r[0]: r[1]
                for r in conn.execute(
                    "SELECT year, tc_ha FROM pes_annual_indicators WHERE application_id = %s",
                    (app_id,),
                ).fetchall()
            }
            for year in range(config.annual_start_year, last_year + 1):
                if year in existing:
                    continue
                if datetime.now(UTC) >= deadline:
                    break
                try:
                    ha, window, coverage = backend.tree_cover(parcel, date(year, 6, 30))
                except Exception:  # noqa: BLE001 — year gap stays blank
                    continue
                conn.execute(
                    """
                    INSERT INTO pes_annual_indicators
                      (application_id, year, tc_ha, tc_window_days, tc_coverage)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (application_id, year) DO UPDATE SET
                      tc_ha = EXCLUDED.tc_ha,
                      tc_window_days = EXCLUDED.tc_window_days,
                      tc_coverage = EXCLUDED.tc_coverage,
                      computed_utc = now()
                    """,
                    (app_id, year, ha, window, coverage),
                )
                existing[year] = ha
            # Derived loss across the stored sequence (v1 sheet semantics).
            ordered = sorted(existing.items())
            for (y0, tc0), (y1, tc1) in zip(ordered, ordered[1:]):
                if y1 == y0 + 1 and tc0 is not None and tc1 is not None:
                    conn.execute(
                        "UPDATE pes_annual_indicators SET loss_ha = %s "
                        "WHERE application_id = %s AND year = %s",
                        (max(0.0, round(tc0 - tc1, 4)), app_id, y1),
                    )

            # M25 — counterfactual control: the surrounding annulus' tree
            # cover per year, scaled to the parcel's area so it overlays
            # the contract series. Backfilled for years whose own tc_ha
            # exists; a year without imagery stays blank.
            parcel_area = row[8]
            if parcel_area:
                missing_ctl = [
                    r[0]
                    for r in conn.execute(
                        "SELECT year FROM pes_annual_indicators "
                        "WHERE application_id = %s AND tc_ha IS NOT NULL "
                        "  AND control_tc_ha IS NULL ORDER BY year",
                        (app_id,),
                    ).fetchall()
                ]
                for year in missing_ctl:
                    if datetime.now(UTC) >= deadline:
                        break
                    try:
                        frac = backend.control_tree_cover(parcel, date(year, 6, 30))
                    except Exception:  # noqa: BLE001 — control stays blank
                        continue
                    if frac is None:
                        continue
                    conn.execute(
                        "UPDATE pes_annual_indicators SET control_tc_ha = %s "
                        "WHERE application_id = %s AND year = %s",
                        (round(frac * parcel_area, 4), app_id, year),
                    )

            # M29b — fire-exclusion timeline: burned area per series year.
            for year in [
                r[0]
                for r in conn.execute(
                    "SELECT year FROM pes_annual_indicators "
                    "WHERE application_id = %s AND tc_ha IS NOT NULL "
                    "  AND burned_ha IS NULL ORDER BY year",
                    (app_id,),
                ).fetchall()
            ]:
                if datetime.now(UTC) >= deadline:
                    break
                try:
                    burned = backend.burned_area_ha(
                        parcel, Interval(date(year, 1, 1), date(year, 12, 31))
                    )
                except Exception:  # noqa: BLE001 — year stays blank
                    continue
                conn.execute(
                    "UPDATE pes_annual_indicators SET burned_ha = %s "
                    "WHERE application_id = %s AND year = %s",
                    (round(burned, 4), app_id, year),
                )

            # M29b — fragmentation (conservation/SFM parcels): yearly patch
            # count + edge density of the tree mask.
            act = str(row[9] or "").lower()
            if any(k in act for k in
                   ("manage", "gestion", "aménag", "amenag", "conserv", "protect")):
                for year in [
                    r[0]
                    for r in conn.execute(
                        "SELECT year FROM pes_annual_indicators "
                        "WHERE application_id = %s AND tc_ha IS NOT NULL "
                        "  AND patch_count IS NULL ORDER BY year",
                        (app_id,),
                    ).fetchall()
                ]:
                    if datetime.now(UTC) >= deadline:
                        break
                    try:
                        frag = backend.fragmentation(parcel, date(year, 6, 30))
                    except Exception:  # noqa: BLE001 — year stays blank
                        continue
                    if frag is None:
                        continue
                    conn.execute(
                        "UPDATE pes_annual_indicators "
                        "SET patch_count = %s, edge_m_per_ha = %s "
                        "WHERE application_id = %s AND year = %s",
                        (frag[0], frag[1], app_id, year),
                    )

            # M25 — canopy metrics (static 1 m model): once per parcel.
            if row[7] is None:
                try:
                    mean_m, pct3 = backend.canopy_metrics(parcel)
                    conn.execute(
                        """
                        UPDATE pes_rs_objects
                        SET canopy_mean_m = %s, canopy_pct_gt3m = %s,
                            canopy_utc = now()
                        WHERE object_id = %s AND object_type = 'application'
                        """,
                        (mean_m, pct3, app_id),
                    )
                except Exception:  # noqa: BLE001 — canopy stays blank, but
                    # the attempt is stamped so the backlog never thrashes
                    # on a parcel the model cannot answer.
                    log.exception("canopy metrics failed")
                    conn.execute(
                        "UPDATE pes_rs_objects SET canopy_utc = now() "
                        "WHERE object_id = %s AND object_type = 'application'",
                        (app_id,),
                    )

            if row[6] is None and row[5] is not None:  # landcover_at_app missing
                try:
                    at_cls, at_pct = backend.dominant_landcover(parcel, row[5])
                    cur_cls, cur_pct = backend.dominant_landcover(parcel, today)
                    conn.execute(
                        """
                        UPDATE pes_rs_objects
                        SET landcover_at_app = %s, landcover_at_app_pct = %s,
                            landcover_current = %s, landcover_current_pct = %s,
                            landcover_current_date = %s
                        WHERE object_id = %s AND object_type = 'application'
                        """,
                        (at_cls, at_pct, cur_cls, cur_pct, today, app_id),
                    )
                except Exception:  # noqa: BLE001 — land cover stays blank
                    # Record for the admin page; keep record ids out of the
                    # public workflow logs (M20).
                    log.exception("landcover classification failed")
                    conn.execute(
                        """
                        INSERT INTO pes_rs_exceptions (object_id, object_type, reason)
                        VALUES (%s, 'application', 'landcover_failed')
                        """,
                        (app_id,),
                    )
            conn.commit()
            done += 1
        except Exception:  # noqa: BLE001 — one application never sinks the pass
            conn.rollback()
            failed += 1
            log.exception("annual indicators failed")
            try:
                conn.execute(
                    """
                    INSERT INTO pes_rs_exceptions (object_id, object_type, reason)
                    VALUES (%s, 'application', 'annual_failed')
                    """,
                    (app_id,),
                )
                conn.commit()
            except Exception:  # noqa: BLE001 — recording must never sink it
                conn.rollback()
    return {"annual_done": done, "annual_failed": failed, "annual_candidates": len(rows)}
