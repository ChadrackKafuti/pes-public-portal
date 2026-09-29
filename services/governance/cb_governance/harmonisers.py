"""Harmonisers (notebook §4): one function per source, verbatim port."""

import json

from .config import (
    COUNTRY_META,
    GAB_PROVINCES,
    JSON_MAX_LEN,
    VOCAB_MGMT,
    VOCAB_PA,
    VOCAB_STATUS,
    VOCAB_ZONE,
    pa_name_key,
)
from .fetchers import fix_admin
from .helpers import (
    decode,
    first_valid,
    map_vocab,
    norm_text,
    parse_date_any,
    parse_int,
    parse_num,
    sha16,
    trunc,
)
from .schema import field_names, string_limits

# =============================================================================
HARMONISERS = {}

def harmoniser(name):
    def deco(fn):
        HARMONISERS[name] = fn
        return fn
    return deco

def base_record(layer, spec, src, meta):
    """Fields every record gets before the source-specific harmoniser runs."""
    iso3 = src.iso3
    country = COUNTRY_META.get(iso3, (iso3, None))[0]
    uid_tail = src.globalid or (str(src.oid) if src.oid is not None else None)
    if spec.get("kind") == "local_shp" or uid_tail is None:
        a = src.attrs
        uid_tail = sha16(src.src_file, a.get("Terroir"), a.get("Groupement"), a.get("Territoire"), a.get("Zonage"),
                         a.get("Raison"), a.get("Source_fil"), round(parse_num(a.get("Area_ha")) or 0, 2), src.oid)
    rec = {k: None for k in field_names(layer)}
    rec.update({
        "src_uid": f"{iso3}:{spec['layer_key']}:{uid_tail}",
        "country": country, "iso3": iso3, "layer": layer,
        "src_layer": trunc(meta.get("name") or spec["layer_key"], 60), "src_url": trunc(src.src_url, 500),
        "src_oid": parse_int(src.oid) if not isinstance(src.oid, str) else None,
        "src_globalid": src.globalid, "src_file": trunc(src.src_file, 255),
        "src_vintage": spec.get("vintage"), "src_last_edit": parse_date_any(src.last_edit),
        "geom_quality": "ok", "retired": 0, "doc_count": 0,
    })
    return rec

def std_status(raw):
    return map_vocab(raw, VOCAB_STATUS)

def std_mgmt(raw):
    return map_vocab(raw, VOCAB_MGMT)

def std_zone(raw):
    return map_vocab(raw, VOCAB_ZONE, default="other") if first_valid(raw) else "unclassified"

def cafi_common(rec, a):
    """CAFI consolidated shapefile block shared by CFCL_*/PSAT_* files."""
    rec["province_src"] = first_valid(a.get("Province"))
    rec["province"] = fix_admin(a.get("Province"))
    rec["admin2"] = fix_admin(a.get("Territoire"))
    rec["admin3"] = fix_admin(a.get("Secteur"))
    rec["admin4"] = first_valid(a.get("Groupement"))
    rec["programme"] = first_valid(a.get("Programme"))
    rec["funder"] = first_valid(a.get("Finance"), a.get("Co_finance"))
    rec["agency"] = first_valid(a.get("Agence"))
    rec["partner"] = first_valid(a.get("Partenaire"))
    y = parse_int(a.get("Annee"))
    rec["year_ref"] = y if y and 1990 < y < 2100 else None
    rec["area_sig_ha"] = parse_num(a.get("Area_ha"))
    if rec["area_sig_ha"] is not None and rec["area_sig_ha"] <= 0:
        rec["area_sig_ha"] = None
    rec["src_layer"] = trunc(first_valid(a.get("Source_DB")) or rec["src_layer"], 60)
    if a.get("bbox_only") in (True, "T", "t", 1, "1", "True"):
        rec["geom_quality"] = "bbox"
    rec["link_key"] = "|".join(norm_text(x) for x in (a.get("Terroir"), a.get("Groupement"), a.get("Territoire")))
    return rec

# ---------------------------------------------------------------- concessions
@harmoniser("cmr_ufa")
def h_cmr_ufa(rec, a, d):
    desc = first_valid(a.get("desc_type"))
    rec.update(sub_type_raw=desc, sub_type_std="communal_forest" if "COMMUNAL" in norm_text(desc) else "ufa",
               name=first_valid(a.get("nom_foret"), a.get("nom_conces")), reference=first_valid(a.get("nom_conces")),
               status_raw=decode(a.get("statu_class"), d.get("statu_class")), date_attr=parse_date_any(a.get("date_class")),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["status_std"] = std_status(rec["status_raw"])
    return rec

@harmoniser("cmr_vc")
def h_cmr_vc(rec, a, d):
    rec.update(sub_type_raw=first_valid(a.get("desc_type")), sub_type_std="timber_sale", name=first_valid(a.get("nom_vc")),
               reference=first_valid(a.get("nom_vc")), holder=first_valid(a.get("attributai")), operator=first_valid(a.get("exploitant")),
               status_raw=decode(a.get("statut_vc"), d.get("statut_vc")), date_attr=parse_date_any(a.get("date_attr")),
               date_expiry=parse_date_any(a.get("date_expr")), area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["status_std"] = std_status(rec["status_raw"])
    return rec

@harmoniser("caf_pea")
def h_caf_pea(rec, a, d):
    conv = decode(a.get("type_conv"), d.get("type_conv"))
    rec.update(sub_type_raw=first_valid(a.get("desc_type")), sub_type_std="pea", name=first_valid(a.get("nom_pea")),
               reference=first_valid(a.get("num_permis")), holder=first_valid(a.get("attributair"), a.get("attributai")),
               operator=first_valid(a.get("exploitant")), status_raw=decode(a.get("statu_attr"), d.get("statu_attr")),
               status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")), date_attr=parse_date_any(a.get("date_attr")),
               date_plan=parse_date_any(a.get("date_amgt")), date_expiry=parse_date_any(a.get("dat_exp")),
               cert_type=first_valid(decode(a.get("t_cert_af"), d.get("t_cert_af"))), cert_body=first_valid(a.get("b_cert_af")),
               date_cert=parse_date_any(a.get("d_cert_af")), legality_cert=first_valid(decode(a.get("t_cert_leg"), d.get("t_cert_leg")), decode(a.get("t_cert_tra"), d.get("t_cert_tra"))),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")), taxable_area_ha=parse_num(a.get("sup_tax_ha")))
    if conv:
        if "PROVISO" in norm_text(conv):
            rec["date_conv_prov"] = parse_date_any(a.get("date_conv"))
        else:
            rec["date_conv_def"] = parse_date_any(a.get("date_conv"))
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    rec["cert_status"] = "certified" if rec["cert_type"] else None
    return rec

@harmoniser("cod_ccf")
def h_cod_ccf(rec, a, d):
    desc = first_valid(a.get("desc_type"))
    rec.update(sub_type_raw=desc, sub_type_std="ccf_conservation" if "CONSERV" in norm_text(desc) else "ccf_exploitation",
               name=first_valid(a.get("attributai"), a.get("ancien_nom"), a.get("ref_ccf")), reference=first_valid(a.get("num_ccf")),
               holder=first_valid(a.get("attributai")), capital_origin=first_valid(a.get("orig_capit")),
               status_raw=decode(a.get("statu_ccf"), d.get("statu_ccf")), status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")),
               date_attr=parse_date_any(a.get("date_attr")), date_expiry=parse_date_any(a.get("date_echea")), date_plan=parse_date_any(a.get("date_amgt")),
               cert_type=first_valid(decode(a.get("type_cert"), d.get("type_cert"))), cert_status=first_valid(decode(a.get("statu_cert"), d.get("statu_cert"))),
               date_cert=parse_date_any(a.get("date_cert")), legality_cert=first_valid(decode(a.get("statu_leg"), d.get("statu_leg"))),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")), parent_ref=first_valid(a.get("num_ga")))
    pg = decode(a.get("statu_pg"), d.get("statu_pg"))
    if pg and not rec["status_mgmt_raw"]:
        rec["status_mgmt_raw"] = f"Plan de gestion: {pg}"
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    return rec

@harmoniser("cog_conc")
def h_cog_conc(rec, a, d):
    rec.update(sub_type_raw=first_valid(a.get("Types_de_p"), "Concession forestiere"), sub_type_std="concession",
               name=first_valid(a.get("nom_con"), a.get("nom_ufa")), reference=first_valid(a.get("nom_ufa"), a.get("Code")),
               holder=first_valid(a.get("nom_ste")), capital_origin=first_valid(a.get("Capital")), province_src=first_valid(a.get("nom_dep")),
               status_raw=first_valid(a.get("statu_attr"), a.get("Sitatu_att")), status_mgmt_raw=first_valid(a.get("statu_amgt"), a.get("Processus_")),
               cert_type=first_valid(a.get("type_cert"), a.get("Type_de_ce")), cert_status=first_valid(a.get("Situation_")),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["province"] = rec["province_src"]
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    return rec

@harmoniser("gnq_parcela")
def h_gnq_parcela(rec, a, d):
    rec.update(sub_type_raw="Parcela forestal", sub_type_std="parcel", name=first_valid(a.get("nom_pblado"), a.get("num_regis")),
               reference=first_valid(a.get("num_regis")), holder=first_valid(a.get("empr_explo")), operator=first_valid(a.get("nomb_propt"), a.get("auto_firma")),
               community=first_valid(a.get("nom_pblado")), province_src=first_valid(a.get("local_dist")),
               status_raw=first_valid(a.get("estad_atrb")), status_mgmt_raw=first_valid(a.get("estad_expl")),
               date_attr=parse_date_any(a.get("fech_atrb")), area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    return rec

@harmoniser("gab_permit")
def h_gab_permit(rec, a, d):
    rec.update(sub_type_raw=first_valid(a.get("type_desc")), sub_type_std="permit",
               name=first_valid(a.get("num_permis"), a.get("nom_ste")), reference=first_valid(a.get("num_permis")),
               holder=first_valid(a.get("nom_titul")), operator=first_valid(a.get("nom_ste"), a.get("nom_ferm")), parent_ref=first_valid(a.get("ref_cons")),
               province_src=first_valid(a.get("provinc")), status_raw=first_valid(a.get("conformit")), status_mgmt_raw=first_valid(a.get("proces_agt")),
               date_attr=parse_date_any(a.get("date_attri")), area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["province"] = rec["province_src"]
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    return rec

@harmoniser("gab_ufa")
def h_gab_ufa(rec, a, d):
    rec.update(sub_type_raw=first_valid(a.get("type_desc"), "UFA / CFAD"), sub_type_std="ufa_cfad",
               name=first_valid(a.get("nom_ufa"), a.get("nom_cfad")), reference=first_valid(a.get("nom_cfad")),
               holder=first_valid(a.get("nom_titul")), operator=first_valid(a.get("nom_ste")),
               date_attr=parse_date_any(a.get("date_sgnt")), date_plan=parse_date_any(a.get("date_amgt")),
               cert_type=first_valid(decode(a.get("type_cert"), d.get("type_cert"))), cert_body=first_valid(a.get("bur_certif")),
               legality_cert=first_valid(a.get("cert_o_lgl"), a.get("certif_tra")),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["status_mgmt_raw"] = "Amenage" if rec["date_plan"] else None
    rec["status_mgmt_std"] = "approved" if rec["date_plan"] else None
    rec["cert_status"] = "certified" if rec["cert_type"] else None
    return rec

# ---------------------------------------------------------------- concession zoning (series)
def _series(rec, name, ztype, parent_ref, area_adm=None, area_sig=None, code=None):
    rec.update(sub_type_raw="Serie d'amenagement", sub_type_std="management_series",
               zone_name=first_valid(name), zone_type_raw=first_valid(ztype), zone_type_std=std_zone(ztype),
               parent_ref=first_valid(parent_ref), zone_code=first_valid(code), area_adm_ha=parse_num(area_adm), area_sig_ha=parse_num(area_sig))
    rec["name"] = first_valid(rec["zone_name"], rec["zone_type_raw"])
    rec["reference"] = rec["parent_ref"]
    return rec

@harmoniser("cmr_series")
def h_cmr_series(rec, a, d):
    return _series(rec, a.get("nom_serie"), a.get("desc_type"), a.get("nom_conces"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))

@harmoniser("caf_series")
def h_caf_series(rec, a, d):
    code = first_valid(a.get("code_type"))
    c = (code or "").lower()
    ztype = code
    for prefix, label in (("prod", "Serie de production"), ("consap", "Serie de conservation (aire protegee)"), ("cons", "Serie de conservation"),
                          ("prot", "Serie de protection"), ("agri", "Serie agricole"), ("conv", "Zone de conversion agricole"),
                          ("rb", "Serie de reboisement"), ("rpl", "Serie de repeuplement"), ("ur", "Serie d'usage rural"), ("re", "Serie de reserve")):
        if c.startswith(prefix):
            ztype = label + (f" ({code})" if c != prefix else "")
            break
    return _series(rec, a.get("nom_serie"), ztype, a.get("nom_pea"), a.get("sup_adm_ha"), a.get("sup_sig_ha"), code)

@harmoniser("cod_series")
def h_cod_series(rec, a, d):
    return _series(rec, a.get("num_serie"), a.get("desc_type"), a.get("num_ccf"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))

@harmoniser("cog_series")
def h_cog_series(rec, a, d):
    return _series(rec, a.get("num_serie"), a.get("desc_type"), a.get("nom_con"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))

@harmoniser("gab_series")
def h_gab_series(rec, a, d):
    r = _series(rec, a.get("nom_serie"), a.get("type_desc"), a.get("nom_ufa"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))
    r["date_plan"] = parse_date_any(a.get("date_amgt"))
    return r

# ---------------------------------------------------------------- community forests
@harmoniser("cmr_fcom")
def h_cmr_fcom(rec, a, d):
    rec.update(sub_type_raw=first_valid(a.get("desc_type"), "Foret communautaire"), sub_type_std="community_forest",
               name=first_valid(a.get("nom_fcom"), a.get("attributai")), reference=first_valid(a.get("nom_fcom")),
               holder=first_valid(a.get("attributai")), community=first_valid(a.get("attributai")), operator=first_valid(a.get("exploitant")),
               mgmt_mode=first_valid(a.get("type_attr")), status_raw=decode(a.get("statu_conv"), d.get("statu_conv")),
               status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")), date_conv_prov=parse_date_any(a.get("date_con_p")),
               date_conv_def=parse_date_any(a.get("date_con_d")), date_plan=parse_date_any(a.get("date_pgs")),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["psg_status"] = rec["status_mgmt_raw"]
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    return rec

@harmoniser("cod_geocfcl")
def h_cod_geocfcl(rec, a, d):
    granted = str(a.get("concession_status")) == "0" or norm_text(a.get("status")) == "ACCORDE"
    orgs = [x for x in (a.get("supporting_org"), a.get("supporting_org_2"), a.get("supporting_org_3")) if first_valid(x)]
    rec.update(sub_type_raw="Concession forestiere des communautes locales", sub_type_std="cfcl" if granted else "cfcl_application",
               name=first_valid(a.get("name")), reference=f"CFCL-{a.get('id')}", community=first_valid(a.get("community_name")),
               holder=first_valid(a.get("community_name"), a.get("name")), province_src=first_valid(a.get("province")),
               province=fix_admin(a.get("province")), admin2=fix_admin(a.get("territory")), admin3=fix_admin(a.get("sector")),
               admin4=first_valid(a.get("group")), supporting_org=", ".join(orgs) or None, application_stage=first_valid(a.get("application_stage")),
               status_raw=first_valid(a.get("status")), status_std="attributed" if granted else "in_process",
               psg_status=first_valid(a.get("management_plan_approval"), "PSG approuve" if a.get("smp_approved") else None),
               mgmt_mode=first_valid(a.get("operating_mode"), a.get("potential_mode")), date_attr=parse_date_any(a.get("approval_date")),
               date_plan=parse_date_any(a.get("smp_approval_date")), area_adm_ha=parse_num(a.get("area")), year_ref=parse_int(a.get("year_of_approval")))
    rec["status_mgmt_raw"] = rec["psg_status"]
    rec["status_mgmt_std"] = "approved" if a.get("smp_approved") else ("in_preparation" if granted else None)
    if a.get("_n_parts", 0) > 1:
        rec["geom_quality"] = "multipart"
    return rec

@harmoniser("cod_wri_cf")
def h_cod_wri_cf(rec, a, d):
    rec.update(sub_type_raw=first_valid(a.get("desc_type"), "Foret communautaire"), sub_type_std="cfcl",
               name=first_valid(a.get("communaute"), a.get("num_for_com")), reference=first_valid(a.get("num_for_com")), community=first_valid(a.get("communaute")),
               holder=first_valid(a.get("gestionnaire"), a.get("communaute")), province_src=first_valid(a.get("province")),
               province=fix_admin(a.get("province")), admin2=fix_admin(a.get("territoire")), admin3=fix_admin(a.get("secteur")),
               supporting_org=first_valid(a.get("accompagnateur")), psg_status=decode(a.get("pg_simple"), d.get("pg_simple")),
               mgmt_mode=decode(a.get("mode_gestion"), d.get("mode_gestion")), area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["status_raw"] = "Attribuee (numero de concession)" if rec["reference"] else None
    rec["status_std"] = "attributed" if rec["reference"] else "unknown"
    rec["status_mgmt_raw"] = rec["psg_status"]; rec["status_mgmt_std"] = std_mgmt(rec["psg_status"])
    return rec

@harmoniser("cafi_cfcl_lim")
def h_cafi_cfcl_lim(rec, a, d):
    cafi_common(rec, a)
    rec.update(sub_type_raw="CFCL (limites PIREDD)", sub_type_std="cfcl", name=first_valid(a.get("Terroir"), a.get("Groupement"), a.get("Nom")),
               community=first_valid(a.get("Groupement")), status_raw=first_valid(a.get("Statut")), status_mgmt_raw=first_valid(a.get("Exploitati")),
               operator=first_valid(a.get("Exploitant")), tenure_status=first_valid(a.get("Foncier")))
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    rec["reference"] = rec["name"]
    return rec

@harmoniser("gnq_bosque")
def h_gnq_bosque(rec, a, d):
    rec.update(sub_type_raw="Bosque comunal", sub_type_std="bosque_comunal", name=first_valid(a.get("nom_pblado"), a.get("codigo")),
               reference=first_valid(a.get("codigo"), a.get("num_regis")), community=first_valid(a.get("nom_pblado")),
               holder=first_valid(a.get("auto_firma")), operator=first_valid(a.get("empr_explo")), province_src=first_valid(a.get("local_dist")),
               status_raw=first_valid(a.get("estad_atrb")), status_mgmt_raw=first_valid(a.get("estad_expl")),
               date_attr=parse_date_any(a.get("fech_atrb")), area_sig_ha=parse_num(a.get("sup_sig_ha")), area_adm_ha=parse_num(a.get("Sub_adm")))
    rec["status_std"] = std_status(rec["status_raw"]); rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"])
    return rec

@harmoniser("gab_fcomm")
def h_gab_fcomm(rec, a, d):
    prov_raw = first_valid(a.get("province"))
    rec.update(sub_type_raw=first_valid(a.get("type_desc"), "Foret communautaire"), sub_type_std="community_forest",
               name=first_valid(a.get("nom_com"), a.get("nom_ass")), reference=first_valid(a.get("nom_com")), community=first_valid(a.get("nom_ass"), a.get("nom_com")),
               holder=first_valid(a.get("nom_ass")), operator=first_valid(a.get("nom_ste")), province_src=prov_raw,
               province=GAB_PROVINCES.get((prov_raw or "").lower(), decode(prov_raw, d.get("province"))),
               status_raw=decode(a.get("statu_conv"), d.get("statu_conv")), mgmt_mode=decode(a.get("mode_expl"), d.get("mode_expl")),
               date_conv_prov=parse_date_any(a.get("date_con_p")), date_conv_def=parse_date_any(a.get("date_con_d")), date_plan=parse_date_any(a.get("date_psg")),
               area_adm_ha=parse_num(a.get("sup_adm_ha")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    rec["psg_status"] = "PSG date " + str(first_valid(a.get("date_psg"))) if first_valid(a.get("date_psg")) else None
    rec["status_std"] = std_status(rec["status_raw"])
    return rec

# ---------------------------------------------------------------- community forest zoning
@harmoniser("cafi_cfcl_aff")
def h_cafi_cfcl_aff(rec, a, d):
    cafi_common(rec, a)
    z = first_valid(a.get("Zonage"))
    rec.update(sub_type_raw="Affectation CFCL (PIREDD)", sub_type_std="cfcl_zone", zone_name=first_valid(a.get("Terroir"), a.get("Groupement")),
               zone_type_raw=z, zone_type_std=std_zone(z), parent_ref=first_valid(a.get("Terroir"), a.get("Groupement")),
               status_raw=first_valid(a.get("Statut")), community=first_valid(a.get("Groupement")))
    rec["name"] = f"{rec['zone_name']} - {z}" if z else rec["zone_name"]
    rec["status_std"] = std_status(rec["status_raw"])
    return rec

# ---------------------------------------------------------------- local territories
@harmoniser("cafi_psat_lim")
def h_cafi_psat_lim(rec, a, d):
    cafi_common(rec, a)
    rec.update(sub_type_raw="Terroir villageois (PSAT)", sub_type_std="psat_terroir", name=first_valid(a.get("Terroir"), a.get("Nom"), a.get("Groupement")),
               community=first_valid(a.get("Groupement")), status_raw=first_valid(a.get("Statut")), cld=first_valid(a.get("CLD")),
               beneficiaries=parse_int(a.get("Beneficiai")))
    rec["reference"] = rec["name"]
    rec["status_std"] = std_status(rec["status_raw"]) if rec["status_raw"] else None
    return rec

@harmoniser("carpe_terroir")
def h_carpe_terroir(rec, a, d):
    rec.update(sub_type_raw=first_valid(decode(a.get("desc_type"), d.get("desc_type")), "Terroir villageois (CARPE)"), sub_type_std="carpe_terroir",
               name=first_valid(a.get("nom_terroi")), reference=first_valid(a.get("code_terro")), status_raw=first_valid(a.get("statut_pro")),
               date_attr=parse_date_any(a.get("date_crea")), village_count=parse_int(a.get("nbre_villa")), villages=trunc(first_valid(a.get("nom_villag")), 500),
               landscape=first_valid(a.get("paysage")), macrozone=first_valid(a.get("macrozone")), funder=first_valid(a.get("bailleur_p"), a.get("co_finance")),
               admin2=first_valid(a.get("lim_admin_"), a.get("lim_admin1")), area_sig_ha=parse_num(a.get("sup_sig_ha")))
    if rec["area_sig_ha"] is not None and rec["area_sig_ha"] <= 0:
        rec["area_sig_ha"] = None
    rec["status_std"] = std_status(rec["status_raw"]) if rec["status_raw"] else None
    rec["link_key"] = norm_text(rec["name"])
    return rec

# ---------------------------------------------------------------- local territory zoning
@harmoniser("cafi_psat_aff")
def h_cafi_psat_aff(rec, a, d):
    cafi_common(rec, a)
    z = first_valid(a.get("Zonage"))
    rec.update(sub_type_raw="Affectation PSAT", sub_type_std="psat_zone", zone_name=first_valid(a.get("Terroir"), a.get("Groupement")),
               zone_type_raw=z, zone_type_std=std_zone(z), zone_reason=first_valid(a.get("Raison")), parent_ref=rec["link_key"],
               status_raw=first_valid(a.get("Statut")), operator=first_valid(a.get("Exploitant")), community=first_valid(a.get("Groupement")))
    rec["name"] = f"{rec['zone_name']} - {z}" if z else rec["zone_name"]
    rec["status_std"] = std_status(rec["status_raw"]) if rec["status_raw"] else None
    return rec

@harmoniser("carpe_macrozone")
def h_carpe_macrozone(rec, a, d):
    z = first_valid(decode(a.get("desc_type"), d.get("desc_type")), a.get("sous_type"))
    rec.update(sub_type_raw="Macro-zone paysage (CARPE)", sub_type_std="carpe_macrozone", zone_name=first_valid(a.get("nom_macro"), a.get("nom_alter")),
               zone_type_raw=z, zone_type_std=std_zone(z), zone_code=first_valid(a.get("code_macro")), landscape=first_valid(a.get("paysage")),
               parent_ref=first_valid(a.get("paysage")), status_raw=first_valid(a.get("statut_pro")), partner=first_valid(a.get("partenaire")),
               holder=first_valid(a.get("gestion")), date_attr=parse_date_any(a.get("date_crea") or a.get("date_propo")),
               area_adm_ha=parse_num(a.get("sup_admin")), area_sig_ha=parse_num(a.get("sup_sig")))
    for k in ("area_adm_ha", "area_sig_ha"):
        if rec[k] is not None and rec[k] <= 0:
            rec[k] = None
    rec["name"] = rec["zone_name"]
    rec["status_std"] = std_status(rec["status_raw"]) if rec["status_raw"] else None
    return rec

# ---------------------------------------------------------------- protected areas
def _nested(d, *path):
    cur = d
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur if not isinstance(cur, (dict, list)) else None

def _pa_common(rec, name, designation, dtype, iucn, governance, authority, legal, wdpa_id, area_adm, area_sig):
    rec.update(sub_type_raw=first_valid(designation, dtype, "Aire protegee"), sub_type_std=map_vocab(first_valid(designation, name), VOCAB_PA, default="other_protected_area"),
               name=first_valid(name), designation=first_valid(designation), designation_type=first_valid(dtype), iucn_category=first_valid(iucn),
               governance=first_valid(governance), mgmt_authority=first_valid(authority), holder=first_valid(authority), legal_status=first_valid(legal),
               status_raw=first_valid(legal), wdpa_id=parse_int(wdpa_id), reference=(str(parse_int(wdpa_id)) if parse_int(wdpa_id) else None),
               area_adm_ha=parse_num(area_adm), area_sig_ha=parse_num(area_sig))
    if rec["wdpa_id"]:
        rec["wdpa_url"] = f"https://www.protectedplanet.net/{rec['wdpa_id']}"
    rec["status_std"] = std_status(rec["status_raw"]) if rec["status_raw"] else "unknown"
    rec["link_key"] = pa_name_key(rec["name"])
    return rec

@harmoniser("wdpa_pa")
def h_wdpa_pa(rec, a, d):
    countries = a.get("countries") or []
    _pa_common(rec, a.get("name"), _nested(a, "designation", "name"), _nested(a, "designation", "jurisdiction", "name"), _nested(a, "iucn_category", "name"),
               _nested(a, "governance", "governance_type"), _nested(a, "management_authority", "name"), _nested(a, "legal_status", "name"),
               a.get("wdpa_id") or a.get("id"), (parse_num(a.get("reported_area")) or 0) * 100 or None, (parse_num(a.get("gis_area")) or 0) * 100 or None)
    rec.update(wdpa_pid=first_valid(a.get("wdpa_pid"), a.get("site_pid")), is_marine=1 if a.get("marine") else 0, is_oecm=1 if a.get("is_oecm") else 0,
               green_list=1 if a.get("is_green_list") else 0, no_take=first_valid(a.get("no_take")), verification=first_valid(a.get("verif"), _nested(a, "verification", "name")),
               int_criteria=first_valid(a.get("international_criteria")), realm=first_valid(_nested(a, "realm", "name")), marine_area_ha=(parse_num(a.get("gis_marine_area")) or 0) * 100 or None,
               date_attr=parse_date_any(a.get("legal_status_updated_at")), operator=first_valid(_nested(a, "management_authority", "name")))
    y = parse_int(str(a.get("legal_status_updated_at") or "")[:4])
    rec["legal_status_year"] = y if y and 1800 < y < 2100 else None
    rec["community"] = first_valid(a.get("original_name")) if norm_text(a.get("original_name")) != norm_text(a.get("name")) else None
    if len(countries) > 1:
        rec["parent_ref"] = "transboundary: " + ", ".join(first_valid(c.get("iso_3"), c.get("name")) or "" for c in countries)
    rec["status_mgmt_raw"] = first_valid(a.get("management_plan"))
    rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"]) if rec["status_mgmt_raw"] else None
    if rec["is_marine"] and not rec["sub_type_std"]:
        rec["sub_type_std"] = "marine_protected_area"
    return rec

@harmoniser("cmr_pa")
def h_cmr_pa(rec, a, d):
    _pa_common(rec, a.get("nom_ap"), a.get("desc_type"), "national", decode(a.get("cat_uicn"), d.get("cat_uicn")), None, a.get("partenar"),
               decode(a.get("statu_crea"), d.get("statu_crea")), a.get("wdpaid"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))
    rec.update(status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")), date_plan=parse_date_any(a.get("date_amgt")), date_attr=parse_date_any(a.get("date_crea")),
               date_conv_prov=parse_date_any(a.get("date_prop")), marine_area_ha=parse_num(a.get("sup_mar_ha")), partner=first_valid(a.get("partenar")))
    rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"]) if rec["status_mgmt_raw"] else None
    return rec

@harmoniser("cod_pa")
def h_cod_pa(rec, a, d):
    _pa_common(rec, a.get("nom_ap"), a.get("desc_type"), first_valid(a.get("desig_type")), decode(a.get("cat_uicn"), d.get("cat_uicn")),
               decode(a.get("type_gouv"), d.get("type_gouv")), first_valid(a.get("aut_gest"), a.get("aut_amgt")), decode(a.get("statu_leg"), d.get("statu_leg")),
               a.get("wdpaid"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))
    rec.update(wdpa_pid=first_valid(a.get("wdpapid")), province_src=first_valid(a.get("province")), province=fix_admin(a.get("province")),
               date_attr=parse_date_any(a.get("date_desig")), is_marine=1 if norm_text(a.get("marine")) in ("1", "OUI", "YES", "TRUE") else 0,
               marine_area_ha=parse_num(a.get("sup_mar_ha")), status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")), community=first_valid(a.get("nom_orig")))
    rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"]) if rec["status_mgmt_raw"] else None
    return rec

@harmoniser("cog_pa")
def h_cog_pa(rec, a, d):
    _pa_common(rec, a.get("nom_ap"), a.get("desc_type"), "national", decode(a.get("cat_uicn"), d.get("cat_uicn")), None, a.get("aut_gest"), None,
               a.get("wdpa_id") or a.get("wdpaid"), a.get("sup_adm_ha"), a.get("sup_sig_ha"))
    rec.update(province_src=first_valid(a.get("departemen"), a.get("departement")), province=first_valid(a.get("departemen"), a.get("departement")))
    return rec

@harmoniser("gab_pa")
def h_gab_pa(rec, a, d):
    _pa_common(rec, first_valid(a.get("nom_ap"), a.get("nom_comple")), a.get("desc_type"), "national", decode(a.get("cat_uicn"), d.get("cat_uicn")),
               decode(a.get("type_gouv"), d.get("type_gouv")), a.get("auth_gest"), decode(a.get("statu_crea"), d.get("statu_crea")), a.get("wdpaid"),
               a.get("sup_adm_ha"), a.get("sup_sig_ha"))
    rec.update(reference=first_valid(rec.get("reference"), a.get("code_ap")), date_attr=parse_date_any(a.get("annee_crea")), date_conv_prov=parse_date_any(a.get("annee_prop")),
               status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")), is_marine=1 if norm_text(a.get("marine")) in ("1", "OUI", "YES", "TRUE") else 0,
               marine_area_ha=parse_num(a.get("sup_mar_ha")))
    rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"]) if rec["status_mgmt_raw"] else None
    return rec

@harmoniser("caf_pa")
def h_caf_pa(rec, a, d):
    _pa_common(rec, a.get("nom_ap"), a.get("desc_type"), "national", decode(a.get("cat_uicn"), d.get("cat_uicn")), None, a.get("gestionair"),
               decode(a.get("statu_crea"), d.get("statu_crea")), None, a.get("sup_adm_ha"), a.get("sup_sig_ha"))
    rec.update(funder=first_valid(a.get("bailleur")), date_attr=parse_date_any(a.get("date_crea")), date_plan=parse_date_any(a.get("date_amgt")),
               status_mgmt_raw=decode(a.get("statu_amgt"), d.get("statu_amgt")))
    rec["status_mgmt_std"] = std_mgmt(rec["status_mgmt_raw"]) if rec["status_mgmt_raw"] else None
    return rec

# ---------------------------------------------------------------- driver
JSON_SKIP_KEYS = {"shape__area", "shape__length", "shape_area", "shape_length", "shape_leng", "st_area_sh", "st_length_",
                  "shape.starea()", "shape.stlength()", "shape_star", "shape_stle", "shape_leng_1"}

def harmonise(layer, spec, src, meta, domains):
    rec = base_record(layer, spec, src, meta)
    fn = HARMONISERS[spec["harmoniser"]]
    rec = fn(rec, src.attrs, domains)
    if not rec.get("link_key"):
        rec["link_key"] = norm_text(rec.get("name") or rec.get("reference"))
    # native attributes as JSON (nulls and shape fields dropped)
    attrs = {k: v for k, v in src.attrs.items() if v is not None and str(v).strip() != "" and k.lower() not in JSON_SKIP_KEYS}
    js = json.dumps(attrs, ensure_ascii=False, default=str)
    if len(js) > JSON_MAX_LEN:
        js = js[:JSON_MAX_LEN - 3] + "..."
        rec["src_attrs_trunc"] = 1
    else:
        rec["src_attrs_trunc"] = 0
    rec["src_attrs_json"] = js
    # enforce string lengths
    for f, n in string_limits(layer).items():
        if rec.get(f) is not None and not isinstance(rec[f], str):
            rec[f] = str(rec[f])
        rec[f] = trunc(rec.get(f), n)
    return rec
