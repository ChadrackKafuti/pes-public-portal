"""API test fixtures: a throwaway Postgres cluster with the core schema and
a small seed, mirroring services/pipeline/tests/test_store_integration.py.

Skipped when no Postgres server binaries are available.
"""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

_INIT = Path(__file__).resolve().parents[3] / "infra" / "db" / "init"
SCHEMA = _INIT / "001_core.sql"
GOV_SCHEMA = _INIT / "003_governance.sql"

GOV_SEED = """
INSERT INTO gov_areas
  (src_uid, layer, country, iso3, name, reference, sub_type_std, status_std,
   situation, retired, area_calc_ha, doc_count, parent_uid, extras, geom_geojson, loaded_at)
VALUES
  ('COG:conc:1', 'concessions', 'Republic of Congo', 'COG', 'Ngombe', 'UFA-NGOMBE',
   'ufa', 'attributed', 'complete', 0, 12000.0, 1, NULL,
   '{"cert_type": "FSC"}'::jsonb,
   '{"type": "Polygon", "coordinates": [[[15,-1],[15,-1.1],[15.1,-1.1],[15,-1]]]}'::jsonb, now()),
  ('COG:series:1', 'concession_zoning', 'Republic of Congo', 'COG', 'Serie 1', NULL,
   NULL, NULL, 'complete', 0, 400.0, 0, 'COG:conc:1',
   '{"zone_type_std": "production", "parent_name": "Ngombe"}'::jsonb,
   '{"type": "Polygon", "coordinates": [[[15,-1],[15,-1.05],[15.05,-1.05],[15,-1]]]}'::jsonb, now()),
  ('COD:conc:9', 'concessions', 'Democratic Republic of Congo', 'COD', 'Retired one', NULL,
   'ccf', NULL, 'complete', 1, 10.0, 0, NULL, '{}'::jsonb,
   '{"type": "Polygon", "coordinates": [[[16,-1],[16,-1.1],[16.1,-1.1],[16,-1]]]}'::jsonb, now()),
  ('COD:conc:10', 'concessions', 'Democratic Republic of Congo', 'COD', 'No data one', NULL,
   'ccf', NULL, 'no_data', 0, 10.0, 0, NULL, '{}'::jsonb,
   '{"type": "Polygon", "coordinates": [[[17,-1],[17,-1.1],[17.1,-1.1],[17,-1]]]}'::jsonb, now());

INSERT INTO gov_documents
  (doc_uid, parent_uid, parent_layer, country, iso3, title, category_std,
   file_name, url, src_system, retired, loaded_at)
VALUES
  ('COG:conc:1:doc:1', 'COG:conc:1', 'concessions', 'Republic of Congo', 'COG',
   'Plan d''aménagement', 'management_plan', 'PA.pdf', 'https://example.org/pa.pdf',
   'agol_attachment', 0, now()),
  ('COG:conc:1:doc:2', 'COG:conc:1', 'concessions', 'Republic of Congo', 'COG',
   'Plan d''aménagement', 'other', 'PA.pdf', 'https://example.org/pa.pdf?sig=dup',
   'agol_attachment', 0, now());
"""

M26_SEED = """
UPDATE pes_photos SET
  ai_scene = 'saplings_plantation', ai_scene_confidence = 0.92,
  ai_activity_consistent = true, ai_tree_count = 24, ai_health = 'healthy',
  ai_species = 'Acacia auriculiformis', ai_flags = NULL,
  ai_summary = 'Rows of young acacia saplings on cleared cropland.',
  ai_model = 'claude-opus-5-5', ai_status = 'ok', ai_processed_utc = now()
WHERE photo_uid = 'aaaa1111';
"""

M25_SEED = """
UPDATE pes_rs_objects
SET canopy_mean_m = 4.5, canopy_pct_gt3m = 62.0, canopy_utc = now()
WHERE object_id = 'A1' AND object_type = 'application';
UPDATE pes_annual_indicators SET control_tc_ha = 2.5
WHERE application_id = 'A1' AND year = 2025;
"""

INCIDENT_SEED = """
INSERT INTO pes_incidents
  (incident_uid, application_id, kind, first_detected, last_detected, magnitude, status)
VALUES
  ('A1:fire:2026-09-20', 'A1', 'fire', '2026-09-20', '2026-10-01', 3, 'open'),
  ('A2:deforestation:2026-09-01', 'A2', 'deforestation', '2026-09-01', '2026-09-15', 42, 'responded'),
  ('A1:deforestation:2026-07-01', 'A1', 'deforestation', '2026-07-01', '2026-07-10', 5, 'resolved'),
  ('A6:fire:2026-09-25', 'A6', 'fire', '2026-09-25', '2026-10-01', 9, 'open');
"""

ANNUAL_SEED = """
INSERT INTO pes_annual_indicators (application_id, year, tc_ha, loss_ha) VALUES
  ('A1', 2022, 2.4, NULL),
  ('A1', 2023, 2.2, 0.2),
  ('A1', 2024, 2.0, 0.2),
  ('A1', 2025, 2.1, 0.0);
"""

RAW_SEED = r"""
INSERT INTO pes_raw_records (kind, record_id, payload) VALUES
  ('application', 'A1', '{
     "ApplicationCode": "APP-001", "ApplicationStatus": "In progress",
     "Stage": "Validated", "StageOrder": 5,
     "ActivityType": "Agroforestry", "EstimatedArea": 3.5,
     "BeneficiaryType": "Individual farmer", "BeneficiaryGender": "Female",
     "FamilySituation": "Married", "Dependents": 4, "CommunityMembers": 12,
     "ProjectName": "Project X", "ImplementingOrgName": "Org A",
     "ImplementingOrgAcronym": "OA",
     "SupportingAggregator": [{"EntityFullName": "Green Coop", "EntityAcronym": "GC"}],
     "ContractCode": "CTR-001", "ContractStatus": "Active",
     "ContractStartDate": "2024-07-01", "ContractEndDate": "2029-07-01",
     "ContractDurationYears": 5, "AreaDeclaredByPlanter": 3.2,
     "ContractedPesArea": 3.0,
     "TreeDensity": [{"Name": "Acacia", "Density": 400}, {"Name": "Moringa", "Density": 150}],
     "VisitCount": 6
   }'::jsonb),
  ('monitoring_visit', 'M1', '{
     "MonitoringVisitCode": "M1", "ApplicationId": "A1", "ApplicationCode": "APP-001",
     "ContractCode": "CTR-001", "MonitoringDate": "2025-03-15",
     "PlantedAreaMeasured": 2.1, "UnplantedArea": 0.9,
     "ObservedTreesCount": 820, "ObservedLandCover": "Cropland", "ObservedLandCoverPct": 61.5
   }'::jsonb),
  ('monitoring_visit', 'MF', '{
     "MonitoringVisitCode": "MF", "ApplicationId": "A1", "ApplicationCode": "APP-001",
     "ContractCode": "CTR-001", "MonitoringDate": "2099-04-01"
   }'::jsonb),
  ('monitoring_visit', 'M2', '{
     "MonitoringVisitCode": "M2", "ApplicationId": "A2", "ApplicationCode": "APP-002",
     "ContractCode": "CTR-002", "ContractStatus": "Active",
     "ContractStartDate": "2024-09-01", "ContractEndDate": "2029-09-01",
     "ContractedPESArea": 2.0, "MonitoringDate": "2025-05-01",
     "Shape": "POLYGON((15.5 -2.25,15.51 -2.25,15.51 -2.24,15.5 -2.25))"
   }'::jsonb),
  ('application', 'A5', '{
     "ApplicationCode": "APP-005", "Stage": "Archived",
     "ActivityType": "Agroforestry", "BeneficiaryGender": "Female"
   }'::jsonb),
  ('monitoring_visit', 'MD', '{
     "MonitoringVisitCode": "MD", "ApplicationId": "A1", "ApplicationCode": "APP-001",
     "ContractCode": "CTR-001", "MonitoringDate": "2025-07-01", "IsDeleted": true
   }'::jsonb),
  ('monitoring_visit', 'MA', '{
     "MonitoringVisitCode": "MA", "ApplicationCode": "APP-004",
     "ContractCode": "CTR-003", "MonitoringDate": "2025-01-15",
     "ContractStatus": "Archived"
   }'::jsonb);
"""

PHOTO_SEED = """
INSERT INTO pes_photos
  (photo_uid, kind, parent_id, application_id, application_code, contract_code,
   photo_index, label, url, url_no_query, lon, lat, mirrored_path, mirror_status)
VALUES
  ('aaaa1111', 'application', 'A1', 'A1', 'APP-001', NULL, 1, 'Parcel north edge',
   'https://example.org/p1.jpg?sig=x', 'https://example.org/p1.jpg',
   15.002, -0.998, 'application/aa/aaaa1111.jpg', 'done'),
  ('bbbb2222', 'monitoring_visit', 'M1', 'A1', 'APP-001', 'CTR-001', 1, 'Visit photo',
   'https://example.org/p2.jpg?sig=y', 'https://example.org/p2.jpg',
   15.003, -0.997, NULL, NULL),
  ('dddd4444', 'application', 'A1', 'A1', 'APP-001', NULL, 2, 'No GPS photo',
   'https://example.org/p4.jpg?sig=w', 'https://example.org/p4.jpg',
   0, 0, NULL, NULL),
  ('cccc3333', 'application', 'A2', 'A2', 'APP-002', NULL, 1, 'Other parcel',
   'https://example.org/p3.jpg?sig=z', 'https://example.org/p3.jpg',
   15.5, -2.25, NULL, 'error');
"""

SEED = """
INSERT INTO pes_parcels
  (application_id, application_code, contract_code, application_date, shape_raw,
   point_lon, point_lat, estimated_area_ha, pes_activity,
   country, province, implementing_org, project_name, geom_input_hash)
VALUES
  ('A1', 'APP-001', 'CTR-001', '2024-06-01', 'POLYGON((15 -1,15.01 -1,15.01 -0.99,15 -1))',
   NULL, NULL, 3.5, 'Agroforestry', 'DRC', 'Kongo-Central', 'Org A', 'Project X', 'h1'),
  ('A2', 'APP-002', NULL, '2024-07-01', NULL, 15.5, -2.25, 2.0, 'Reforestation',
   'DRC', 'Kinshasa', 'Org B', 'Project X', 'h2'),
  ('A4', 'APP-004', NULL, '2024-08-01', NULL, NULL, NULL, 1.0, 'Regeneration',
   'ROC', 'Sangha', 'Org A', 'Project Y', 'h4'),
  ('A5', 'APP-005', NULL, '2024-09-01', 'POLYGON((15 -1,15.01 -1,15.01 -0.99,15 -1))',
   NULL, NULL, 2.0, 'Agroforestry', 'DRC', 'Kinshasa', 'Org A', 'Project X', 'h5'),
  ('A6', 'APP-006', NULL, '2024-10-01', NULL, 16.5, -3.25, 1.5, 'Agroforestry',
   'DRC', 'Equateur', 'XeptagonQATestProject', 'QA Project', 'h6');

INSERT INTO pes_rs_objects
  (object_id, object_type, object_date, application_id, application_code,
   contract_code, pes_activity, parcel_area_ha,
   tree_cover_ha, defor_5yr_ha_yr, geom_source, baseline_years, status,
   failed_indicators, geom_input_hash)
VALUES
  ('A1', 'application', '2024-06-01', 'A1', 'APP-001', 'CTR-001', 'Agroforestry', 3.4,
   2.1, 0.05, 'polygon', 5, 'ok', '{}', 'h1'),
  ('M1', 'monitoring_visit', '2025-03-15', 'A1', 'APP-001', 'CTR-001', 'Agroforestry', 3.4,
   2.0, 0.05, 'polygon_inherited', 5, 'partial', '{fire_alerts}', 'h1');

INSERT INTO pes_rs_exceptions (object_id, object_type, reason, area_gis) VALUES
  ('A2', 'application', 'oversize_gt_5000ha', 6200),
  ('A2', 'application', 'oversize_gt_5000ha', 6200),
  ('A4', 'application', 'no_usable_geometry', NULL),
  ('A6', 'application', 'no_usable_geometry', NULL);

INSERT INTO pes_rs_runs
  (start_utc, end_utc, duration_s, fetched_app, fetched_mon, selected, ok, partial,
   skipped, queued, stopped_reason)
VALUES (now() - interval '20 minutes', now() - interval '19 minutes', 60, 2, 1, 3,
        1, 1, 1, 0, 'completed');
"""


def _pg_bin() -> str | None:
    for base in ("/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin"):
        if (Path(base) / "initdb").exists():
            return base
    found = shutil.which("initdb")
    return str(Path(found).parent) if found else None


def _as_unprivileged(cmd: list[str]) -> list[str]:
    if os.geteuid() != 0:
        return cmd
    return ["setpriv", "--reuid=nobody", "--regid=nogroup", "--clear-groups", *cmd]


_POSTGIS = False  # set while bringing the throwaway cluster up


@pytest.fixture(scope="session")
def postgis(client):
    """Skip marker for tests needing the 005 spatial layer (PostGIS may be
    absent on a dev box; CI installs postgresql-16-postgis-3)."""
    if not _POSTGIS:
        pytest.skip("PostGIS extension not available")


@pytest.fixture(scope="session")
def client():
    bin_dir = _pg_bin()
    if bin_dir is None:
        pytest.skip("no Postgres server binaries")
    base = Path(tempfile.mkdtemp(prefix="cafi-apitest-"))
    data, sockets = base / "data", base / "sock"
    data.mkdir()
    sockets.mkdir()
    if os.geteuid() == 0:
        base.chmod(0o755)
        for d in (data, sockets):
            shutil.chown(d, "nobody", "nogroup")
            d.chmod(0o777)
    subprocess.run(
        _as_unprivileged([f"{bin_dir}/initdb", "-D", str(data), "-U", "cafi", "-A", "trust", "-E", "UTF8", "--locale=C"]),
        check=True, capture_output=True,
    )
    proc = subprocess.Popen(
        _as_unprivileged([
            f"{bin_dir}/postgres", "-D", str(data),
            "-k", str(sockets), "-c", "listen_addresses=",
        ]),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"postgresql://cafi@/postgres?host={sockets}"
    try:
        import psycopg

        for _ in range(50):
            try:
                with psycopg.connect(url) as conn:
                    conn.execute(SCHEMA.read_text())
                    conn.execute(GOV_SCHEMA.read_text())
                    conn.execute((_INIT / "004_display_geom.sql").read_text())
                    conn.execute((_INIT / "006_photos_raw.sql").read_text())
                    conn.execute((_INIT / "007_annual.sql").read_text())
                    conn.execute((_INIT / "008_incidents.sql").read_text())
                    conn.execute((_INIT / "009_canopy_controls.sql").read_text())
                    conn.execute((_INIT / "010_photo_ai.sql").read_text())
                    conn.execute((_INIT / "011_basemap_checks.sql").read_text())
                    conn.execute(INCIDENT_SEED)
                    conn.execute(ANNUAL_SEED)
                    conn.execute(PHOTO_SEED)
                    conn.execute(RAW_SEED)
                    conn.commit()
                    global _POSTGIS
                    try:
                        conn.execute("CREATE EXTENSION postgis")
                        conn.execute((_INIT / "005_spatial.sql").read_text())
                        _POSTGIS = True
                    except psycopg.Error:
                        conn.rollback()  # no PostGIS binaries: AOI tests skip
                    conn.execute(SEED)
                    conn.execute(M25_SEED)
                    conn.execute(M26_SEED)
                    conn.execute(GOV_SEED)
                    conn.commit()
                break
            except psycopg.OperationalError:
                time.sleep(0.2)
        else:
            pytest.fail("postgres did not come up")

        os.environ["CAFI_DATABASE_URL"] = url
        from app import db

        db._pool = None  # rebuild the pool against the test database
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as tc:
            yield tc
        if db._pool is not None:
            db._pool.close()
            db._pool = None
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        shutil.rmtree(base, ignore_errors=True)
