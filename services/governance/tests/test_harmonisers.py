"""Harmoniser tests on fabricated source attributes (field names from the
real source layers, values synthetic)."""

from cb_governance.fetchers import SrcFeature
from cb_governance.harmonisers import HARMONISERS, harmonise
from cb_governance.helpers import ms_to_datetime

RINGS = {"rings": [[[15.0, -1.0], [15.0, -1.01], [15.01, -1.01], [15.01, -1.0], [15.0, -1.0]]]}


def _src(layer, spec, attrs, oid=7, globalid="abc-123"):
    return SrcFeature(layer, spec["iso3"], spec["layer_key"], oid, globalid, attrs, RINGS,
                      "https://example/FeatureServer/0", 1700000000000)


def test_all_registered_harmonisers_are_referenced_by_sources():
    from cb_governance.config import SOURCES

    used = {s["harmoniser"] for specs in SOURCES.values() for s in specs if s.get("harmoniser")}
    assert used <= set(HARMONISERS), used - set(HARMONISERS)


def test_cmr_ufa_harmoniser():
    spec = {"iso3": "CMR", "layer_key": "ufa", "kind": "agol", "harmoniser": "cmr_ufa", "vintage": "2026"}
    src = _src("concessions", spec, {
        "nom_foret": "UFA 09-024", "nom_conces": "09-024", "desc_type": "UFA",
        "statu_class": "1", "date_class": "2010-03-04", "sup_adm_ha": "125000",
        "sup_sig_ha": 124321.5,
    })
    rec = harmonise("concessions", spec, src, {"name": "UFA"}, {"statu_class": {"1": "Classé"}})
    assert rec["src_uid"] == "CMR:ufa:abc-123"
    assert rec["sub_type_std"] == "ufa"
    assert rec["status_raw"] == "Classé"
    assert rec["status_std"] == "attributed"
    assert rec["area_adm_ha"] == 125000.0
    assert ms_to_datetime(rec["date_attr"]).year == 2010
    assert rec["link_key"]  # filled from name
    assert rec["src_attrs_json"].startswith("{")


def test_wdpa_harmoniser():
    spec = {"iso3": "COD", "layer_key": "wdpa", "kind": "wdpa", "harmoniser": "wdpa_pa", "vintage": "2026"}
    src = _src("protected_areas", spec, {
        "wdpa_id": 555, "name": "Salonga", "original_name": "Parc National de la Salonga",
        "designation": {"name": "Parc National", "jurisdiction": {"name": "National"}},
        "iucn_category": {"name": "II"}, "governance": {"governance_type": "Federal or national ministry or agency"},
        "legal_status": {"name": "Designated"}, "legal_status_updated_at": "01/01/1970",
        "reported_area": "36000", "marine": False,
    }, oid=555, globalid=None)
    rec = harmonise("protected_areas", spec, src, {"name": "Protected Planet / WDPA"}, {})
    assert rec["src_uid"] == "COD:wdpa:555"
    assert rec["wdpa_id"] == 555
    assert rec["sub_type_std"] == "national_park"
    assert rec["status_std"] == "attributed"
    assert rec["wdpa_url"] == "https://www.protectedplanet.net/555"


def test_cafi_psat_lim_harmoniser_builds_stable_uid():
    spec = {"iso3": "COD", "layer_key": "psat_lim", "kind": "local_shp",
            "harmoniser": "cafi_psat_lim", "vintage": "2025"}
    attrs = {"Terroir": "Bolobo", "Territoire": "Mai ndombe", "Province": "MAI NDOMBE",
             "Groupement": "G1", "Area_ha": 100.0, "Annee": 2024}
    src = SrcFeature("local_territories", "COD", "psat_lim", 3, None, attrs, RINGS,
                     "/data/PSAT_LIM_CAFI_2025.shp", None, "PSAT_LIM_CAFI_2025.shp")
    rec = harmonise("local_territories", spec, src, {"name": "PSAT_LIM"}, {})
    rec2 = harmonise("local_territories", spec, src, {"name": "PSAT_LIM"}, {})
    assert rec["src_uid"] == rec2["src_uid"]  # sha16-based, reproducible
    assert rec["province"] == "Mai-Ndombe"    # ADMIN_FIXES applied
    assert rec["year_ref"] == 2024
