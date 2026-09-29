"""Settings (env) + source registry, vocabularies and aliases (notebook §0/§1).

The §1 configuration is ported verbatim from cb_forest_ingest.py. The §0
settings become environment variables (GOV_* / WDPA_TOKEN); the notebook's
hardcoded WDPA token is deliberately NOT carried over — set WDPA_TOKEN.
"""

import datetime as _dt
import os
import re

from .helpers import norm_text


def _env_bool(name, default=False):
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _env_list(name):
    v = os.environ.get(name, "")
    return [x.strip() for x in v.split(",") if x.strip()] or None


UPDATE_MODE        = os.environ.get("GOV_UPDATE_MODE", "smart")     # "smart" | "full"
FORCE_REFRESH_DAYS = int(os.environ.get("GOV_FORCE_REFRESH_DAYS", "7"))
LAYERS             = _env_list("GOV_LAYERS")                        # None = all
COUNTRIES          = [c.upper() for c in _env_list("GOV_COUNTRIES") or []] or None
SKIP_LARGE         = _env_bool("GOV_SKIP_LARGE")
GEOCFCL_SCRAPE_ALL = _env_bool("GOV_GEOCFCL_SCRAPE_ALL")
COLLECT_DOCS       = _env_bool("GOV_COLLECT_DOCS", True)
WDPA_TOKEN         = os.environ.get("WDPA_TOKEN", "")
WDPA_MARINE        = None                       # None = all, False = terrestrial only
LOCAL_DATA_DIR     = os.environ.get("GOV_LOCAL_DATA_DIR", "")
DATABASE_URL       = os.environ.get("CAFI_RS_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://cafi:cafi@localhost:5432/cafi_rs"
)
MAX_RUNTIME_S      = int(os.environ.get("GOV_MAX_RUNTIME_S", "0")) or None
BATCH_SIZE         = 200
FETCH_WORKERS      = int(os.environ.get("GOV_FETCH_WORKERS", "6"))
DOC_WORKERS        = int(os.environ.get("GOV_DOC_WORKERS", "8"))
HTTP_TIMEOUT       = int(os.environ.get("GOV_HTTP_TIMEOUT", "180"))
JSON_MAX_LEN       = 32000                      # src_attrs_json field length
LOG_LEVEL          = os.environ.get("GOV_LOG_LEVEL", "INFO")


def log(msg, level="INFO"):
    order = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3}
    if order.get(level, 1) >= order.get(LOG_LEVEL, 1):
        print(f"{_dt.datetime.now():%H:%M:%S} [{level:<5}] {msg}", flush=True)

COUNTRY_META = {   # iso3: (display name, admin0 pcode)
    "CMR": ("Cameroon",                     "CM"),
    "CAF": ("Central African Republic",     "CF"),
    "COD": ("Democratic Republic of Congo", "CD"),
    "COG": ("Republic of Congo",            "CG"),
    "GNQ": ("Equatorial Guinea",            "GQ"),
    "GAB": ("Gabon",                        "GA"),
}
# normalised tokens that identify each country in free text / admin layers
COUNTRY_ALIASES = {
    "CMR": ["CAMEROON", "CAMEROUN", "CMR"],
    "CAF": ["CENTRAL AFRICAN REPUBLIC", "CENTRAFRIQUE", "REPUBLIQUE CENTRAFRICAINE", "CAR", "RCA", "CAF"],
    "COD": ["DEMOCRATIC REPUBLIC OF CONGO", "DEMOCRATIC REPUBLIC OF THE CONGO", "REPUBLIQUE DEMOCRATIQUE DU CONGO",
            "CONGO DEMOCRATIC REPUBLIC", "CONGO KINSHASA", "DRC", "RDC", "COD"],
    "COG": ["REPUBLIC OF CONGO", "REPUBLIC OF THE CONGO", "REPUBLIQUE DU CONGO", "CONGO BRAZZAVILLE", "CONGO BRAZ", "COG"],
    "GNQ": ["EQUATORIAL GUINEA", "GUINEA ECUATORIAL", "GUINEE EQUATORIALE", "EQ GUINEA", "GNQ"],
    "GAB": ["GABON", "GABONESE REPUBLIC", "GAB"],
}

ADMIN0_URL = "https://geosmarthosting.undp.org/arcgis/rest/services/Hosted/CAFI_admin_0/FeatureServer/0"
ADMIN1_URL = "https://geosmarthosting.undp.org/arcgis/rest/services/Hosted/CAFI_admin_1/FeatureServer/0"

# ---- source URLs -------------------------------------------------------------
WRI_CMR = "https://services3.arcgis.com/dwv7XaFMgpPo7FSx/arcgis/rest/services"
WRI_COD = "https://services9.arcgis.com/N6bh3jZojHIhVEPX/arcgis/rest/services"
WRI_COG = "https://services9.arcgis.com/Vw7F0TmRI5ku8alp/arcgis/rest/services"
WRI_GNQ = "https://services2.arcgis.com/g8WusZB13b9OegfU/arcgis/rest/services"
WRI_GAB = "https://services6.arcgis.com/eWRcSThaExlJjPQF/arcgis/rest/services"
WRI_CAF = "https://services7.arcgis.com/oHaHhn2ffeZrgnvd/arcgis/rest/services"
FA_SRV  = "https://gis.forest-atlas.org/server/rest/services"

CMR_UFA       = f"{WRI_CMR}/UFA/FeatureServer/0"
CMR_VC        = f"{WRI_CMR}/Ventes_de_coupe/FeatureServer/0"
CMR_FCOM      = f"{WRI_CMR}/forets_communautaires/FeatureServer/0"
CMR_SERIES    = f"{FA_SRV}/cmr/open_data_fr/MapServer/134"
CAF_PEA       = f"{WRI_CAF}/PEA/FeatureServer/0"
CAF_SERIES    = f"{WRI_CAF}/series_amenagements/FeatureServer/0"
COD_CCF       = f"{WRI_COD}/Concession_forestiere2025/FeatureServer/0"
COD_SERIES    = f"{WRI_COD}/S%C3%A9ries_d_Am%C3%A9nagement/FeatureServer/0"
COD_WRI_CF    = f"{WRI_COD}/For%C3%AAt_Communautaire/FeatureServer/0"
COD_FA_CCF    = f"{FA_SRV}/cod/Donnees_ouvertes_fr/MapServer/5"
COD_FA_CF     = f"{FA_SRV}/cod/Donnees_ouvertes_fr/MapServer/37"
GEOCFCL_API   = "https://rdc.geocfcl.org/api/applications/"
GEOCFCL_PAGE  = "https://rdc.geocfcl.org/applications/{id}/"
COG_CONC      = f"{WRI_COG}/Couche_concession_forestiere/FeatureServer/0"
COG_SERIES    = f"{WRI_COG}/S%C3%A9ries_d_am%C3%A9nagement/FeatureServer/0"
GNQ_PARCELAS  = f"{WRI_GNQ}/Parcelas_Forestales/FeatureServer/0"
GNQ_BOSQUES   = f"{WRI_GNQ}/Bosques_Comunales/FeatureServer/0"
GAB_PERMITS   = f"{WRI_GAB}/Map1309/FeatureServer/0"
GAB_UFA       = f"{WRI_GAB}/Map_ufa/FeatureServer/0"
GAB_FCOMM     = f"{WRI_GAB}/Forets_comm/FeatureServer/0"
GAB_SERIES    = f"{WRI_GAB}/Series_d_amenagement/FeatureServer/0"
WDPA_API      = "https://api.protectedplanet.net"
CMR_PA        = f"{WRI_CMR}/Aires_proteg%C3%A9es_de_la_faune/FeatureServer/0"
COD_PA        = f"{WRI_COD}/Aires_prot%C3%A9g%C3%A9es/FeatureServer/0"
COG_PA        = f"{WRI_COG}/Aire_prot%C3%A9g%C3%A9e_2026/FeatureServer/0"
GAB_PA        = f"{WRI_GAB}/aires_proteg%C3%A9es/FeatureServer/0"
CAF_PA        = f"{WRI_CAF}/Aires_prot%C3%A9g%C3%A9es/FeatureServer/0"
CARPE_TERROIR_URLS = [f"{FA_SRV}/Hosted/terroirs_villageois_{k}/FeatureServer/0"
                      for k in ("ituri", "mlw", "salonga", "bateke", "mtkb", "virunga", "lca_tumba", "sangha_tri_national")]
CARPE_MACROZONE_URLS = [f"{FA_SRV}/Hosted/macrozones_{k}/FeatureServer/0"
                        for k in ("lac_tumba", "ituri", "salonga", "mlw", "sangha_tri_national", "bateke", "mtkb", "lac_tele")] \
                       + [f"{FA_SRV}/Hosted/macrozone_virunga/FeatureServer/0"]

# ---- layer registry (hosted layer index, name) --------------------------------
LAYER_DEFS = [   # key, hosted name, id  (id 0 is the pre-existing protected-areas layer of the target service)
    ("protected_areas",         "CB_Protected_Areas",         0),
    ("concessions",             "CB_Logging_Concessions",     1),
    ("concession_zoning",       "CB_Concession_Zoning",       2),
    ("community_forests",       "CB_Community_Forests",       3),
    ("community_forest_zoning", "CB_Community_Forest_Zoning", 4),
    ("local_territories",       "CB_Local_Territories",       5),
    ("local_territory_zoning",  "CB_Local_Territory_Zoning",  6),
]
DOCS_TABLE   = ("documents", "CB_Documents", 7)
EXISTING_LAYERS = {"protected_areas"}          # layers that already exist in the target service (never re-created)
# Layer 0 keeps its legacy columns filled so the current web maps / popups keep working:
# script field -> legacy column (values are truncated to the legacy column length)
LAYER0_LEGACY_MAP = {"reference": "code", "iso3": "iso", "area_calc_ha": "area_ha", "province": "region", "sub_type_std": "type"}
DOC_LAYERS   = {"concessions", "community_forests", "protected_areas"}
LAYER_ORDER  = [k for k, _, _ in LAYER_DEFS]           # dependency order (parents before children)
LAYER_NAME   = {k: n for k, n, _ in LAYER_DEFS}
LAYER_ID     = {k: i for k, _, i in LAYER_DEFS}
ZONING_LAYERS = {"concession_zoning", "community_forest_zoning", "local_territory_zoning"}
PARENT_LAYER  = {"concession_zoning": "concessions", "community_forest_zoning": "community_forests",
                 "local_territory_zoning": "local_territories"}

# ---- SOURCES registry ---------------------------------------------------------
# kind   : agol | mapserver | agol_multi | geocfcl | local_shp | none
# role   : primary (default) | fallback  (fallback rows are deduplicated against primary rows of the same layer/country)
# docs   : dict(kind=agol_attachments | mapserver_attachments | geocfcl_html, ...)
# parent : dict(layer=<parent layer key>, layer_key=<parent source key or None=any>, child_field=..., parent_field=...,
#               alt_parent_field=..., scope="province"|None)
SOURCES = {
  "concessions": [
    dict(iso3="CMR", layer_key="ufa",      kind="agol", url=CMR_UFA,      harmoniser="cmr_ufa",     vintage="2026",
         docs=dict(kind="agol_attachments")),
    dict(iso3="CMR", layer_key="vc",       kind="agol", url=CMR_VC,       harmoniser="cmr_vc",      vintage="2026",
         docs=dict(kind="agol_attachments"), enabled=False),
    dict(iso3="CAF", layer_key="pea",      kind="agol", url=CAF_PEA,      harmoniser="caf_pea",     vintage="2025",
         docs=dict(kind="agol_attachments")),
    dict(iso3="COD", layer_key="ccf",      kind="agol", url=COD_CCF,      harmoniser="cod_ccf",     vintage="2025",
         docs=dict(kind="mapserver_attachments", url=COD_FA_CCF, join_child="num_ccf", join_parent="reference")),
    dict(iso3="COG", layer_key="conc",     kind="agol", url=COG_CONC,     harmoniser="cog_conc",    vintage="2026",
         docs=dict(kind="agol_attachments")),
    dict(iso3="GNQ", layer_key="parcela",  kind="agol", url=GNQ_PARCELAS, harmoniser="gnq_parcela", vintage="2023"),
    dict(iso3="GAB", layer_key="permit",   kind="agol", url=GAB_PERMITS,  harmoniser="gab_permit",  vintage="2024",
         docs=dict(kind="agol_attachments")),
    dict(iso3="GAB", layer_key="ufa_cfad", kind="agol", url=GAB_UFA,      harmoniser="gab_ufa",     vintage="2023",
         docs=dict(kind="agol_attachments")),
  ],
  "concession_zoning": [
    dict(iso3="CMR", layer_key="series", kind="mapserver", url=CMR_SERIES, harmoniser="cmr_series", vintage="2026",
         parent=dict(layer="concessions", layer_key="ufa", child_field="parent_ref", parent_field="name", alt_parent_field="reference")),
    dict(iso3="CAF", layer_key="series", kind="agol", url=CAF_SERIES, harmoniser="caf_series", vintage="2018",
         parent=dict(layer="concessions", layer_key="pea", child_field="parent_ref", parent_field="reference", alt_parent_field="name")),
    dict(iso3="COD", layer_key="series", kind="agol", url=COD_SERIES, harmoniser="cod_series", vintage="2026", large=True,
         parent=dict(layer="concessions", layer_key="ccf", child_field="parent_ref", parent_field="reference")),
    dict(iso3="COG", layer_key="series", kind="agol", url=COG_SERIES, harmoniser="cog_series", vintage="2024",
         parent=dict(layer="concessions", layer_key="conc", child_field="parent_ref", parent_field="name", alt_parent_field="reference")),
    dict(iso3="GAB", layer_key="series", kind="agol", url=GAB_SERIES, harmoniser="gab_series", vintage="2023",
         parent=dict(layer="concessions", layer_key="ufa_cfad", child_field="parent_ref", parent_field="name", alt_parent_field="reference")),
    dict(iso3="GNQ", kind="none", note="no management-series layer published"),
  ],
  "community_forests": [
    dict(iso3="CMR", layer_key="fcom",    kind="agol",    url=CMR_FCOM,    harmoniser="cmr_fcom",    vintage="2026",
         docs=dict(kind="agol_attachments")),
    dict(iso3="COD", layer_key="geocfcl", kind="geocfcl", url=GEOCFCL_API, harmoniser="cod_geocfcl", vintage="2026",
         docs=dict(kind="geocfcl_html", page=GEOCFCL_PAGE)),
    dict(iso3="COD", layer_key="wri_cf",  kind="agol",    url=COD_WRI_CF,  harmoniser="cod_wri_cf",  vintage="2026", role="fallback",
         docs=dict(kind="mapserver_attachments", url=COD_FA_CF, join_child="num_for_com", join_parent="reference",
                   join_alt_child="communaute", join_alt_parent="name")),
    dict(iso3="COD", layer_key="piredd_lim", kind="local_shp", path="CFCL_LIM_CAFI_2025.shp", harmoniser="cafi_cfcl_lim",
         vintage="2025", role="fallback"),
    dict(iso3="GNQ", layer_key="bosque",  kind="agol",    url=GNQ_BOSQUES, harmoniser="gnq_bosque",  vintage="2023"),
    dict(iso3="GAB", layer_key="fcomm",   kind="agol",    url=GAB_FCOMM,   harmoniser="gab_fcomm",   vintage="2023",
         docs=dict(kind="agol_attachments")),
    dict(iso3="CAF", kind="none", note="no public community-forest layer"),
    dict(iso3="COG", kind="none", note="no public community-forest layer"),
  ],
  "community_forest_zoning": [
    dict(iso3="COD", layer_key="piredd_aff", kind="local_shp", path="CFCL_AFF_CAFI_2025_polygon.shp",
         harmoniser="cafi_cfcl_aff", vintage="2025",
         parent=dict(layer="community_forests", layer_key=None, child_field="parent_ref", parent_field="name",
                     alt_parent_field="community", scope="province")),
  ],
  "local_territories": [
    dict(iso3="COD", layer_key="psat_lim", kind="local_shp", path="PSAT_LIM_CAFI_2025.shp", harmoniser="cafi_psat_lim", vintage="2025"),
    # WRI/CARPE landscape terroirs: excluded on user request (poor data quality); set enabled=True to bring them back
    dict(iso3="*",   layer_key="carpe_terroir", kind="agol_multi", urls=CARPE_TERROIR_URLS, harmoniser="carpe_terroir", vintage="2024", enabled=False),
  ],
  "local_territory_zoning": [
    dict(iso3="COD", layer_key="psat_aff", kind="local_shp", path="PSAT_AFF_CAFI_2025.shp", harmoniser="cafi_psat_aff", vintage="2025",
         parent=dict(layer="local_territories", layer_key="psat_lim", child_field="parent_ref", parent_field="link_key",
                     alt_child_field="zone_name", alt_parent_field="name", scope="admin2")),
    # WRI/CARPE landscape macro-zones: excluded on user request (poor data quality); set enabled=True to bring them back
    dict(iso3="*",   layer_key="carpe_macrozone", kind="agol_multi", urls=CARPE_MACROZONE_URLS, harmoniser="carpe_macrozone", vintage="2024", enabled=False),
  ],
  # WDPA (Protected Planet API, needs WDPA_TOKEN) is the primary source; the national atlases complete it
  # (their rows are deduplicated on WDPA id / name and their documents re-parented to the WDPA row).
  "protected_areas": [
    dict(iso3=c, layer_key="wdpa", kind="wdpa", url=WDPA_API, harmoniser="wdpa_pa", vintage="2026") for c in ("CMR", "CAF", "COD", "COG", "GNQ", "GAB")
  ] + [
    dict(iso3="CMR", layer_key="nat_pa", kind="agol", url=CMR_PA, harmoniser="cmr_pa", vintage="2026", role="fallback", docs=dict(kind="agol_attachments")),
    dict(iso3="COD", layer_key="nat_pa", kind="agol", url=COD_PA, harmoniser="cod_pa", vintage="2025", role="fallback", docs=dict(kind="agol_attachments")),
    dict(iso3="COG", layer_key="nat_pa", kind="agol", url=COG_PA, harmoniser="cog_pa", vintage="2026", role="fallback", docs=dict(kind="agol_attachments")),
    dict(iso3="GAB", layer_key="nat_pa", kind="agol", url=GAB_PA, harmoniser="gab_pa", vintage="2021", role="fallback"),
    dict(iso3="CAF", layer_key="nat_pa", kind="agol", url=CAF_PA, harmoniser="caf_pa", vintage="2023", role="fallback", docs=dict(kind="agol_attachments")),
  ],
}

# ---- controlled vocabularies (regex on normalised upper-case text -> std value; first match wins) ----
VOCAB_STATUS = [
    (r"NON ATTRIB|\bN ATTRIB|NOT ATTRIB|NON ALLOU|NON CONCED", "not_attributed"),
    (r"^DESIGNAT|^INSCRI|^ADOPT|^ESTABLISH|^CREE\b|^CLASSE\b|^DECRET", "attributed"),
    (r"^PROPOS|^EN PROJET|^NOT REPORTED", "in_process"),
    (r"REJET|REFUS", "rejected"),
    (r"EXPIR|ECHU|RESILI|RETIR|ABANDON|ABOND|RETOUR AU DOMAINE|RETROCED|INACTIVE", "expired"),
    (r"PROVISO|PROVISIO|PROVISION", "provisional"),
    (r"DEFINITI|FINAL", "final"),
    (r"EN COURS|ENCOURS|IN PROCESS|TRAITEMENT|VERIFICATION|AFFICHAGE|ENQUETE|IDENTIFICATION|CONTESTATION|DEMANDE|PROJET", "in_process"),
    (r"NON CONFORME", "in_process"),
    (r"VALID|APPROUV|ACCORD|SIGNE|\bCLASSE\b|CONFORME|ATTRIB|ATDA|ACTIVE|RECONNU|RECONN|GRANTED|TITRE", "attributed"),
]
VOCAB_MGMT = [
    (r"NON AMENAG|NON ELABOR|NOT YET|NON PLANIF|NON INITI|NON EXPLOIT|\bPHA|HORS AMENAG|\bRD\b", "not_planned"),
    (r"^UFA\b|\bUFA\b$", "approved"),
    (r"REVISION|REVISE", "under_revision"),
    (r"\bAMENAGE|AMENGE|APPROUV|VALID|ADOPT|ELABORE\b|PLAN ADOPT|PLANS? APPROUV", "approved"),
    (r"EN COURS|ENCOURS|DEPOSE|TRAVAUX|ELABORATION|DECOUPAGE|CPAET|EEXPL|\bCDC\b", "in_preparation"),
]
VOCAB_ZONE = [
    (r"NON CLASSE|NON DETERMIN|LIMITE NON", "unclassified"),
    (r"CFCL|FORETS? DES COMMUNAUTES|COMMUNAUTES LOCALES|FORET COMMUNAUTAIRE", "community_forest"),
    (r"CONCED|CONCESSION|EMPHYTEOSE|PERPETUELLE|DOMAINE PUBLIC|DOMAINE DE L ETAT", "concession"),
    (r"PRODUCTION|EXPLOIT|LIGNEUSE|PRELEVEMENT|\bPROD\b|EXTRACTIV|COUPE DE BOIS|CHANTIER|PFBO|COLLECTE", "production"),
    (r"CONSERV|CONSEV|\bCONS\b", "conservation"),
    (r"PROTECT|BERGES|SOURCES|\bPROT\b|RIVERAIN|PENTES|COURS D EAU|LACS|SACRE|CULTUREL|CIMETI|AIRE PROTEG", "protection"),
    (r"DEVELOPPEMENT RURAL|DEVELOPPEMENT COMMUNAUTAIRE|DEVELOPPEMENT|COMMUNAUTAIRE|POPULATION|\bUR\b|USAGE RURAL|RNC|CBNRM|CHASSE|PECHE|CUEILLETTE|PFNL", "community_development"),
    (r"MISE EN DEFENS|SAVANE|REBOIS|\bRB\b|\bRPL\b|REGENERATION|REPEUPLEMENT|RESTAURATION|\bRNA\b", "savanna_protection"),
    (r"AIRES? PROTEG|FORET PROTEG|HUMIDE|MARAIS|RESERVE|TOURIST", "protection"),
    (r"HABITAT|VILLAGE|RESIDENT|CAMPEMENT|\bCAMP\b", "habitat"),
    (r"SYLVICOLE|SYLVICULT|FORESTIERE REGIME", "production"),
    (r"AGRIC|CHAMPS|ELEVAGE|PERENNE|CULTURE|PISCICULT|PATURAGE|PLANTATION|\bCONV\b|AGROSYL|AGRO SYL|AGROFOREST|AGRO FOREST|AGRO PISC|PASTORAL", "agriculture"),
    (r"CONFLI|LITIGE", "conflict"),
    (r"RECHERCHE|RESEARCH|SCIENTIF", "research"),
]
VOCAB_PA = [   # protected-area designation -> sub_type_std
    (r"PARC NATIONAL|NATIONAL PARK|PARQUE NACIONAL", "national_park"),
    (r"PATRIMOINE MONDIAL|WORLD HERITAGE", "world_heritage"),
    (r"BIOSPH", "biosphere_reserve"),
    (r"RAMSAR|WETLAND|ZONE HUMIDE", "ramsar"),
    (r"SANCTUAIRE|SANCTUARY|SANTUARIO", "sanctuary"),
    (r"CHASSE|CYNEGETIQUE|HUNTING|\bZIC\b|SAFARI", "hunting_zone"),
    (r"FAUNE|FAUNAL|FAUNIQUE|WILDLIFE|GIBIER", "wildlife_reserve"),
    (r"FORESTIERE|FOREST RESERVE|FORET CLASSEE|CLASSIFIED FOREST|RESERVA FORESTAL|FORET DE PROTECTION|FORET DOMANIALE", "forest_reserve"),
    (r"COMMUNAUT|COMMUNITY|VILLAGEOIS|COMMUNAL", "community_reserve"),
    (r"JARDIN|BOTANI|ZOOLOG|ARBORETUM", "botanical_garden"),
    (r"MONUMENT|MONUMENTO|SITE NATUREL", "natural_monument"),
    (r"RESERVE INTEGRALE|STRICT NATURE|RESERVE SCIENTIFIQUE|RESERVA CIENTIFICA", "strict_reserve"),
    (r"RESERVE NATURELLE|NATURE RESERVE|NATURAL RESERVE|RESERVA NATURAL|RESERVE\b|RESERVA\b", "nature_reserve"),
    (r"MARIN|MARINE|MANGROVE|COTIER", "marine_protected_area"),
    (r"AIRE PROTEGEE|PROTECTED AREA|AREA PROTEGIDA|PAYSAGE|LANDSCAPE|CORRIDOR", "other_protected_area"),
]
PA_STRIP_WORDS = ("PARC NATIONAL", "NATIONAL PARK", "PARQUE NACIONAL", "RESERVE DE FAUNE", "RESERVE NATURELLE", "RESERVE FORESTIERE", "RESERVE DE LA BIOSPHERE",
                  "RESERVE DE BIOSPHERE", "RESERVE", "RESERVA", "SANCTUAIRE", "SANCTUARY", "PARC", "PARK", "PARQUE", "NATIONAL", "NACIONAL", "NATURELLE", "NATURAL",
                  # The word-boundary entries were plain strings in the notebook, so their
                  # "\b" was a backspace character and they never stripped; raw strings fix
                  # the stopword removal (better WDPA <-> national atlas name matching).
                  "FORESTIERE", "BIOSPHERE", "DOMAINE DE CHASSE", "ZONE D INTERET CYNEGETIQUE", "ZONE DE CHASSE", "AIRE PROTEGEE", r"\bZIC\b", r"\bPN\b", r"\bRN\b",
                  r"\bRF\b", r"\bRFD\b", r"\bDE\b", r"\bDU\b", r"\bDES\b", r"\bLA\b", r"\bLE\b", r"\bLES\b", r"\bD\b", r"\bL\b", r"\bDEL\b", r"\bET\b", r"\bAND\b", r"\bOF\b", r"\bTHE\b")

def pa_name_key(name):
    """Protected-area name reduced to its proper-name tokens (for matching WDPA vs national layers)."""
    n = norm_text(name)
    for w in PA_STRIP_WORDS:
        n = re.sub(w, " ", n)
    return re.sub(r"\s+", " ", n).strip()

# document category from filename / label text (normalised upper-case text; first match wins)
DOC_CATEGORY_RULES = [
    (r"PLAN SIMPLE|\bPSG\b|SIMPLE MANAGEMENT|PLAN DE GESTION SIMPLE|\bMP\b", "simple_management_plan"),
    (r"PLAN D ?AMENAGEMENT|PLANAM|PLAN AMENAGEMENT|\bPA\b|\bPAO\b|PLAN DE GESTION|\bPGQ\b|\bPG\b|RESUME DU PLAN", "management_plan"),
    (r"ARRET|DECRET|DECLAS|\bDCLA\b|\bDECLA\b|ATTRIBUTION|ATTRIB|APPROBATION|APPROB|APROPA|\bAPU\b|NOTIFICATION|\bAD\b|\bMA\b|\bNL\b|\bAR\b|AGPF|ACPSON|APPEL D OFFRE|TRANSFERT", "attribution_decree"),
    (r"CONVENTION|\bCONV\b|CONTRAT|\bCCF\b|ACCORD|AVENANT|COPROV|COPPROV|CODEF|CONDEF|CESSION|\bACS\b|ACCF|\bCS\b", "convention"),
    (r"CAHIER|CHARGE|\bCC\b|CAHIER DE CHARGES|CEQTB", "specifications"),
    (r"CERTIF|\bFSC\b|\bPEFC\b|\bOLB\b|LEGAL|TRACAB|PERMIS|AGREMENT|\bCP\b|\bFP\b|\bHP\b|\bHV\b|\bCT\b|\bAL\b|\bAP\b", "certificate"),
    (r"CARTE|\bMAP\b|LOCALISATION|PLAN DE SITUATION|\bGM\b|\bGD\b|\bCM\b|\bLU\b|ZONE A CLASSER|ZONE A DECLASSER|DONNEES GEOGRAPHIQUES", "map"),
    (r"ATTEST|SUPERFICIE|MESURE|RECEPISSE|RECEPISS|FICHE DE VERIF|\bAMS\b|\bCA\b|ACTE DE CONFORM", "attestation"),
    (r"\bPV\b|PROCES|REUNION|CONCERTATION|COMPTE RENDU|\bMC\b|\bMI\b|\bMP2\b|CONSEIL", "minutes"),
    (r"DEMANDE|RESERV|RESEV|FORMULAIRE|APPLICATION|STATUT|REQUEST|\bLR\b|\bLC\b|LISTE DES CLANS|\bMT\b|DOSSIER|\bFRES\b|\bCP\d", "application"),
    (r"COVENTION|CONVETION", "convention"),
    (r"ZONAGE|SITUATION DE ZONAGE", "map"),
    (r"EVALUATION|RAPPORT|\bRIA\b|\bRIE\b|\bIF\b|INVENTAIRE|ETUDE|IMPACT|AUDIT|\bA[1-5]\b|\bPI\b|ENQUETE|\bESE\b|\bCLA\b", "evaluation"),
]
# geocfcl <option value="XX"> codes -> (label, category)
GEOCFCL_DOC_CODES = {
    "GD": ("Donnees geographiques de la CFCL", "map"), "CM": ("Carte geographique de la CFCL", "map"),
    "LU": ("Carte LUP", "map"), "LC": ("Liste des clans, lignages ou familles", "application"),
    "MC": ("Proces-verbal de conseil communautaire", "minutes"), "CA": ("Acte de conformation par les ayants droit", "attestation"),
    "LR": ("Lettre de demande", "application"), "PI": ("Rapport d'enquete publique", "evaluation"),
    "MI": ("PV du processus d'identification de la communaute", "minutes"),
    "AD": ("Copie de l'arrete d'attribution", "attribution_decree"), "MP": ("Plan simple de gestion", "simple_management_plan"),
    "MA": ("Lettre/Arrete d'approbation du PSG", "attribution_decree"), "NL": ("Notification d'approbation tacite du PSG", "attribution_decree"),
    "AR": ("Accuse de reception de la notification", "attribution_decree"), "GM": ("Donnees geographiques du PSG (shapefile)", "map"),
    "CL": ("Accord de collaboration des communautes", "convention"), "LP": ("Contrat d'exploitation de bois", "convention"),
    "CC": ("Contrat de conservation de la CFCL", "convention"), "NP": ("Contrat d'exploitation des PFNL", "convention"),
    "EO": ("Contrat d'exploitation d'autres usages", "convention"), "CP": ("Permis de coupe communautaire", "certificate"),
    "FP": ("Permis de coupe de bois de feu", "certificate"), "HP": ("Permis ordinaire de chasse", "certificate"),
    "HV": ("Permis de recolte", "certificate"), "CT": ("Permis de capture commerciale", "certificate"),
    "AL": ("Permis d'exploitation artisanale de bois", "certificate"), "AP": ("Agrement exploitant artisanal", "certificate"),
    "A1": ("Evaluation annee 1", "evaluation"), "A2": ("Evaluation annee 2", "evaluation"), "A3": ("Evaluation annee 3", "evaluation"),
    "A4": ("Evaluation annee 4", "evaluation"), "A5": ("Evaluation annee 5", "evaluation"),
}
# admin spelling fixes for the CAFI consolidated shapefiles (normalised key -> display; None = unusable)
ADMIN_FIXES = {
    "MASI MANIMBA": "Masi-Manimba", "MASIMANIMBA": "Masi-Manimba", "MAI NDOMBE": "Mai-Ndombe", "MAINDOMBE": "Mai-Ndombe",
    "EQUATEUR": "Equateur", "BAS UELE": "Bas-Uele", "INGENGE": "Ingende", "PROVINCE": None, "NULL": None, "N A": None,
}
GAB_PROVINCES = {"ga_1": "Estuaire", "ga_2": "Haut-Ogooue", "ga_3": "Moyen-Ogooue", "ga_4": "Ngounie", "ga_5": "Nyanga",
                 "ga_6": "Ogooue-Ivindo", "ga_7": "Ogooue-Lolo", "ga_8": "Ogooue-Maritime", "ga_9": "Woleu-Ntem"}
