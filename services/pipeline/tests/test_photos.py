"""Pure-logic tests for the v1 PhotoLoad port (M7a)."""

import json

from pes_rs_pipeline.photos import (
    extract_http_url,
    parse_photo_array,
    photo_rows,
    url_without_query,
)


def test_extract_http_url_variants():
    assert extract_http_url('<a href="https://x.test/a.jpg?s=1">photo</a>') == "https://x.test/a.jpg?s=1"
    assert extract_http_url("see https://x.test/b.jpg?tok=2, thanks") == "https://x.test/b.jpg?tok=2"
    assert extract_http_url(None) is None
    assert extract_http_url("") is None


def test_url_without_query_strips_sas():
    assert url_without_query("https://blob.test/c/p.jpg?sv=abc&sig=xyz") == "https://blob.test/c/p.jpg"
    assert url_without_query(None) is None


def test_parse_photo_array_accepts_json_string_and_list():
    raw = json.dumps([{"url": "https://x/1.jpg", "lat": 1, "lon": 2, "label": "a"}, "junk"])
    photos = parse_photo_array(raw)
    assert len(photos) == 1 and photos[0]["label"] == "a"
    assert parse_photo_array(photos) == photos
    assert parse_photo_array("not json") == []
    assert parse_photo_array(None) == []


def _app_record(**over):
    rec = {
        "ApplicationCode": "APP-9",
        "ApplicationGeotaggedPhotos": [
            {"url": "https://b.test/p1.jpg?sig=1", "lat": "-1.5", "lon": "15.25", "label": "North"},
            {"url": "", "lat": 0, "lon": 0},  # missing url → skipped
            {"url": "https://b.test/p3.jpg", "lat": 999, "lon": 15},  # bad coords → skipped
        ],
    }
    rec.update(over)
    return rec


def test_photo_rows_application():
    rows = photo_rows([_app_record()], "application")
    assert len(rows) == 1
    row = rows[0]
    assert row["kind"] == "application"
    assert row["parent_id"] == "APP-9" and row["application_id"] == "APP-9"
    assert row["url_no_query"] == "https://b.test/p1.jpg"
    assert row["lon"] == 15.25 and row["lat"] == -1.5
    assert row["label"] == "North"
    assert len(row["photo_uid"]) == 40


def test_photo_uid_stable_across_sas_rotation():
    first = photo_rows([_app_record()], "application")[0]
    rotated = _app_record()
    rotated["ApplicationGeotaggedPhotos"][0]["url"] = "https://b.test/p1.jpg?sig=OTHER"
    second = photo_rows([rotated], "application")[0]
    assert first["photo_uid"] == second["photo_uid"]
    assert first["url"] != second["url"]


def test_photo_rows_monitoring_visit_links_application():
    rec = {
        "MonitoringVisitCode": "MV-1",
        "ApplicationId": "APP-9",
        "ApplicationCode": "APP-9",
        "ContractCode": "CTR-9",
        "MonitoringVisitGeoTaggedPhotos": json.dumps(
            [{"url": "https://b.test/v.jpg?x=1", "lat": -1, "lon": 15, "label": None}]
        ),
    }
    rows = photo_rows([rec], "monitoring_visit")
    assert len(rows) == 1
    row = rows[0]
    assert row["parent_id"] == "MV-1"
    assert row["application_id"] == "APP-9"
    assert row["contract_code"] == "CTR-9"
    assert row["label"] == "Photo"
