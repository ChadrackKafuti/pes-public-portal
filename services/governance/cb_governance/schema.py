"""Target fields (notebook §2), the Postgres schema's source of truth.

The ArcGIS layer/table definitions (layer_def/table_def/service_definition)
are not ported — infra/db/init/003_governance.sql replaces them.
"""

from .config import (
    JSON_MAX_LEN,
    LAYER_DEFS,
    LAYER_ID,
    LAYER_NAME,
    LAYER_ORDER,
    ZONING_LAYERS,
)

def F(name, ftype, length=None, alias=None):
    d = {"name": name, "type": f"esriFieldType{ftype}", "alias": alias or name.replace("_", " "),
         "nullable": True, "editable": True, "defaultValue": None}
    if ftype == "String":
        d["length"] = length or 255
    return d

FIELDS_COMMON = [
    F("src_uid", "String", 120, "Source unique id"), F("country", "String", 60), F("iso3", "String", 3), F("layer", "String", 30),
    F("sub_type_std", "String", 40, "Sub-type (standard)"), F("sub_type_raw", "String", 120, "Sub-type (source)"),
    F("name", "String", 255), F("reference", "String", 120), F("holder", "String", 255, "Holder / attributaire"),
    F("operator", "String", 255, "Operator / exploitant"), F("community", "String", 255),
    F("province", "String", 120), F("province_src", "String", 120, "Province (source value)"),
    F("admin2", "String", 120, "Territoire / departement"), F("admin3", "String", 120, "Secteur / chefferie"),
    F("admin4", "String", 120, "Groupement"), F("link_key", "String", 255, "Normalised matching key"),
    F("status_raw", "String", 120, "Status (source)"), F("status_std", "String", 30, "Status (standard)"),
    F("status_mgmt_raw", "String", 120, "Management status (source)"), F("status_mgmt_std", "String", 30, "Management status (standard)"),
    F("date_attr", "Date", None, "Attribution date"), F("date_conv_prov", "Date", None, "Provisional convention date"),
    F("date_conv_def", "Date", None, "Final convention date"), F("date_plan", "Date", None, "Management plan date"),
    F("date_expiry", "Date", None, "Expiry date"),
    F("area_adm_ha", "Double", None, "Administrative area (ha)"), F("area_sig_ha", "Double", None, "GIS area from source (ha)"),
    F("area_calc_ha", "Double", None, "Geodesic area computed (ha)"), F("doc_count", "Integer", None, "Documents"),
    F("situation", "String", 20), F("country_check", "String", 20), F("centroid_x", "Double"), F("centroid_y", "Double"),
    F("programme", "String", 120), F("funder", "String", 120), F("agency", "String", 120), F("partner", "String", 120),
    F("year_ref", "SmallInteger", None, "Reference year"), F("geom_quality", "String", 20),
    F("src_layer", "String", 60), F("src_url", "String", 500), F("src_oid", "Integer"), F("src_globalid", "String", 60),
    F("src_file", "String", 255), F("src_vintage", "String", 20), F("src_last_edit", "Date"),
    F("src_attrs_json", "String", JSON_MAX_LEN, "All source attributes (JSON)"), F("src_attrs_trunc", "SmallInteger"),
    F("retired", "SmallInteger"), F("loaded_at", "Date"),
]
FIELDS_ZONING = [
    F("parent_uid", "String", 120, "Parent src_uid"), F("parent_ref", "String", 255, "Parent reference (source)"),
    F("parent_name", "String", 255, "Parent name"),
    F("zone_name", "String", 255), F("zone_type_raw", "String", 120), F("zone_type_std", "String", 30),
    F("zone_reason", "String", 120), F("zone_code", "String", 40),
]
FIELDS_EXTRA = {
    "concessions": [
        F("parent_ref", "String", 120, "Parent unit reference"), F("capital_origin", "String", 120),
        F("cert_type", "String", 120), F("cert_status", "String", 120), F("cert_body", "String", 120),
        F("legality_cert", "String", 120), F("date_cert", "Date"), F("taxable_area_ha", "Double"),
    ],
    "concession_zoning": FIELDS_ZONING,
    "community_forests": [
        F("supporting_org", "String", 255), F("application_stage", "String", 120), F("psg_status", "String", 120, "Simple management plan status"),
        F("mgmt_mode", "String", 120, "Management / operating mode"), F("tenure_status", "String", 60), F("dedup_of", "String", 120),
    ],
    "community_forest_zoning": FIELDS_ZONING,
    "local_territories": [
        F("village_count", "Integer"), F("villages", "String", 500), F("landscape", "String", 120), F("macrozone", "String", 120),
        F("cld", "String", 120, "CLD (comite local de developpement)"), F("beneficiaries", "Integer"),
    ],
    "local_territory_zoning": FIELDS_ZONING + [F("landscape", "String", 120)],
    "protected_areas": [
        F("wdpa_id", "Integer", None, "WDPA id"), F("wdpa_pid", "String", 60, "WDPA parcel id"), F("designation", "String", 255),
        F("designation_type", "String", 60, "Designation type (national / international / regional)"), F("iucn_category", "String", 60, "IUCN category"),
        F("governance", "String", 120, "Governance type"), F("mgmt_authority", "String", 255, "Management authority"), F("legal_status", "String", 120),
        F("legal_status_year", "SmallInteger"), F("is_marine", "SmallInteger"), F("is_oecm", "SmallInteger"), F("green_list", "SmallInteger"),
        F("no_take", "String", 60), F("marine_area_ha", "Double"), F("verification", "String", 60, "WDPA verification"), F("int_criteria", "String", 255, "International criteria"),
        F("wdpa_url", "String", 255, "Protected Planet page"), F("realm", "String", 60), F("dedup_of", "String", 120), F("parent_ref", "String", 120, "Parent site (WDPA)"),
    ],
}
FIELDS_DOCS = [
    F("doc_uid", "String", 200), F("parent_uid", "String", 120), F("parent_layer", "String", 30), F("country", "String", 60),
    F("iso3", "String", 3), F("title", "String", 255), F("category_std", "String", 40), F("category_raw", "String", 120),
    F("file_name", "String", 255), F("content_type", "String", 80), F("size_bytes", "Integer"), F("date_doc", "Date"),
    F("author", "String", 120), F("url", "String", 1000), F("src_system", "String", 40), F("retired", "SmallInteger"),
    F("loaded_at", "Date"),
]

def layer_fields(layer):
    return FIELDS_COMMON + FIELDS_EXTRA.get(layer, [])

def field_names(layer):
    return [f["name"] for f in (FIELDS_DOCS if layer == "documents" else layer_fields(layer))]

STRING_LEN = {}   # (layer, field) -> length, filled lazily for truncation
def string_limits(layer):
    if layer not in STRING_LEN:
        STRING_LEN[layer] = {f["name"]: f["length"] for f in (FIELDS_DOCS if layer == "documents" else layer_fields(layer))
                             if f["type"] == "esriFieldTypeString"}
    return STRING_LEN[layer]

