"""M4 alert feed: seeded M1 visit has a fire_alerts failure (NULL) but no
positive signals — extend the seed with an alerting visit here."""

import pytest


@pytest.fixture(autouse=True)
def alerting_visit(client):
    from app.db import get_pool

    with get_pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO pes_rs_objects
              (object_id, object_type, object_date, application_id, application_code,
               contract_code, pes_activity, parcel_area_ha, defor_alerts_current,
               fire_alerts_current, defor_current_ha, geom_source, status,
               failed_indicators, geom_input_hash)
            VALUES ('M2', 'monitoring_visit', '2025-06-10', 'A1', 'APP-001', 'CTR-001',
                    'Agroforestry', 3.4, 4, 1, 0.12, 'polygon_inherited', 'ok', '{}', 'h1')
            ON CONFLICT (object_id) DO NOTHING
            """
        )
        conn.commit()
    yield
    # The database is session-scoped: remove the extra visit so later test
    # modules keep their expected counts.
    with get_pool().connection() as conn:
        conn.execute("DELETE FROM pes_rs_objects WHERE object_id = 'M2'")
        conn.commit()


def test_alert_feed_lists_only_signalling_visits(client):
    rows = client.get("/api/alerts").json()
    ids = [r["objectId"] for r in rows]
    assert "M2" in ids          # has alerts
    assert "M1" not in ids      # fire failed (NULL), everything else absent
    m2 = next(r for r in rows if r["objectId"] == "M2")
    assert m2["deforAlertsCurrent"] == 4
    assert m2["country"] == "DRC"


def test_alert_feed_country_filter(client):
    assert client.get("/api/alerts", params={"country": "ROC"}).json() == []
