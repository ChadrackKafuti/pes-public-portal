/** M11 — vocabularies ported verbatim from the ArcGIS Arcade popups
 *  (popup_concessions / popup_community_forests / popup_protected_areas /
 *  popup_local_territories). Labels are the source French, as in v1. */

import type { GovLayerKey } from "@cafi/shared";

export const FLAG: Record<string, string> = {
  CMR: "🇨🇲", CAF: "🇨🇫", COD: "🇨🇩", COG: "🇨🇬", GNQ: "🇬🇶", GAB: "🇬🇦",
};

/** Banner accent per layer (the Arcade ACCENT constants). */
export const LAYER_ACCENT: Record<GovLayerKey, string> = {
  protected_areas: "#1b5e20",
  concessions: "#5d4037",
  concession_zoning: "#5d4037",
  community_forests: "#1b5e20",
  community_forest_zoning: "#1b5e20",
  local_territories: "#37474f",
  local_territory_zoning: "#37474f",
  local_governance: "#6a1b9a",
};

type Chip = [label: string, bg: string, fg: string];

export const STATUS_CHIP: Record<string, Chip> = {
  attributed: ["Attribuée", "#e8f5e9", "#2e7d32"],
  provisional: ["Convention provisoire", "#fff8e1", "#ff8f00"],
  final: ["Convention définitive", "#e8f5e9", "#1b5e20"],
  in_process: ["En cours d'instruction", "#e3f2fd", "#1565c0"],
  not_attributed: ["Non attribuée", "#eceff1", "#607d8b"],
  rejected: ["Rejetée", "#ffebee", "#c62828"],
  expired: ["Expirée / résiliée", "#efebe9", "#6d4c41"],
  unknown: ["Statut non renseigné", "#eceff1", "#546e7a"],
};

export const MGMT_CHIP: Record<string, Chip> = {
  approved: ["Plan d'aménagement approuvé", "#e8f5e9", "#2e7d32"],
  in_preparation: ["Aménagement en cours", "#fff8e1", "#ff8f00"],
  under_revision: ["Plan en révision", "#e3f2fd", "#1565c0"],
  not_planned: ["Non aménagée", "#eceff1", "#607d8b"],
  unknown: ["Aménagement non renseigné", "#eceff1", "#90a4ae"],
};

export const SUBTYPE: Record<string, string> = {
  // concessions
  ufa: "Unité forestière d'aménagement",
  communal_forest: "Forêt communale",
  timber_sale: "Vente de coupe",
  pea: "Permis d'exploitation et d'aménagement",
  ccf_exploitation: "Contrat de concession forestière",
  ccf_conservation: "Concession forestière de conservation",
  concession: "Concession forestière",
  parcel: "Parcela forestal",
  permit: "Permis forestier",
  ufa_cfad: "UFA / CFAD (unité aménagée)",
  // community forests
  community_forest: "Forêt communautaire",
  cfcl: "Concession forestière des communautés locales (CFCL)",
  cfcl_application: "Demande de CFCL en instruction",
  bosque_comunal: "Bosque comunal",
};

/** Protected-area subtypes: label, accent color, emoji. */
export const PA_SUBTYPE: Record<string, [string, string, string]> = {
  national_park: ["Parc national", "#1b5e20", "🏞"],
  world_heritage: ["Patrimoine mondial", "#4a148c", "🏛"],
  biosphere_reserve: ["Réserve de biosphère", "#00695c", "🌍"],
  ramsar: ["Site Ramsar (zone humide)", "#0277bd", "💧"],
  sanctuary: ["Sanctuaire", "#2e7d32", "🦍"],
  hunting_zone: ["Zone d'intérêt cynégétique", "#8d6e63", "🎯"],
  wildlife_reserve: ["Réserve de faune", "#388e3c", "🐘"],
  forest_reserve: ["Réserve forestière", "#558b2f", "🌳"],
  community_reserve: ["Réserve communautaire", "#43a047", "🏘"],
  botanical_garden: ["Jardin botanique / zoologique", "#7cb342", "🌿"],
  natural_monument: ["Monument naturel", "#6d4c41", "🪨"],
  strict_reserve: ["Réserve naturelle intégrale", "#004d40", "🔒"],
  nature_reserve: ["Réserve naturelle", "#2e7d32", "🌲"],
  marine_protected_area: ["Aire marine protégée", "#01579b", "🐠"],
  other_protected_area: ["Aire protégée", "#607d8b", "🛡"],
  other: ["Aire protégée", "#607d8b", "🛡"],
};

export const IUCN: Record<string, string> = {
  IA: "Ia · Réserve naturelle intégrale",
  IB: "Ib · Zone de nature sauvage",
  II: "II · Parc national",
  III: "III · Monument naturel",
  IV: "IV · Gestion des habitats et espèces",
  V: "V · Paysage protégé",
  VI: "VI · Utilisation durable des ressources",
  "NOT APPLICABLE": "Non applicable",
  "NOT REPORTED": "Non renseignée",
  "NOT ASSIGNED": "Non assignée",
};

type FieldMap = [key: string, label: string][];

const NATIVE_CONCESSIONS: Record<string, FieldMap> = {
  CMR: [["desc_type", "Type"], ["nom_conces", "Nom de la concession"], ["statu_class", "Statut de classement"], ["date_class", "Date de classement"], ["rfa_ha", "RFA (FCFA/ha)"], ["sup_adm_ha", "Superficie administrative (ha)"], ["sup_sig_ha", "Superficie SIG (ha)"], ["statut_vc", "Statut vente de coupe"], ["destin", "Destination"], ["cyc_renouv", "Cycle de renouvellement"]],
  CAF: [["num_permis", "Numéro de permis"], ["type_conv", "Type de convention"], ["date_conv", "Date de la convention"], ["statu_amgt", "Statut d'aménagement"], ["date_amgt", "Date d'aménagement"], ["sup_tax_ha", "Superficie taxable (ha)"], ["t_cert_af", "Certification aménagement"], ["b_cert_af", "Bureau certificateur"], ["s_cert_af", "Superficie certifiée (ha)"], ["t_cert_leg", "Certification origine légale"], ["t_cert_tra", "Certification traçabilité"], ["dat_exp", "Date d'expiration"]],
  COD: [["num_ccf", "N° contrat de concession"], ["ref_ccf", "Référence du contrat"], ["num_ga", "N° garantie d'approvisionnement"], ["num_ccc", "N° CCC"], ["ancien_nom", "Ancien nom"], ["statu_ccf", "Statut du contrat"], ["date_attr", "Date d'attribution"], ["date_echea", "Échéance du contrat"], ["orig_capit", "Origine du capital"], ["statu_pg", "Statut plan de gestion"], ["statu_amgt", "Statut d'aménagement"], ["date_amgt", "Validation du plan d'aménagement"], ["statu_cert", "Statut certification"], ["type_cert", "Type de certification"], ["date_cert", "Date de certification"], ["dat_ech_ce", "Échéance certification"], ["statu_leg", "Statut de légalité"], ["date_legal", "Date de légalité"], ["sup_ccf_ha", "Superficie dans le CCF (ha)"], ["sup_exp_ha", "Superficie exploitable (ha)"]],
  COG: [["nom_ufa", "UFA"], ["Code", "Code"], ["nom_dep", "Département"], ["statu_attr", "Statut d'attribution"], ["Sitatu_att", "Statut"], ["statu_amgt", "Statut d'aménagement"], ["Processus_", "Processus d'aménagement"], ["Types_de_p", "Type de plan d'aménagement"], ["type_cert", "Type de certificat"], ["Type_de_ce", "Certificat"], ["Situation_", "Situation de la certification"], ["Capital", "Origine du capital"]],
  GNQ: [["num_regis", "N° de registre"], ["codigo", "Código"], ["nom_pblado", "Poblado"], ["local_dist", "Distrito"], ["estad_atrb", "Estado de atribución"], ["estad_expl", "Estado de explotación"], ["fech_atrb", "Fecha de atribución"], ["empr_explo", "Empresa explotadora"], ["nomb_propt", "Propietario"], ["auto_firma", "Autoridad firmante"], ["texto_ofic", "Texto oficial"]],
  GAB: [["type_desc", "Type de permis"], ["num_permis", "Numéro de permis"], ["cat_titulaire", "Catégorie de titulaire"], ["code_titul", "Code titulaire"], ["num_lot", "Numéro de lot"], ["nbr_lot", "Nombre de lots"], ["ref_cons", "Concession de rattachement"], ["proces_agt", "Processus d'aménagement"], ["conformit", "Conformité"], ["nom_ferm", "Société fermière"], ["date_attri", "Date d'attribution"], ["nom_cfad", "CFAD"], ["nbr_permis", "Nombre de permis"], ["date_sgnt", "Signature du décret"], ["date_amgt", "Date d'aménagement"], ["date_d_rev", "Dernière révision du PA"], ["nbr_rev_pa", "Révisions du PA"], ["annee_ouv", "Année d'ouverture"], ["annee_fem", "Année de fermeture"], ["type_cert", "Certification"], ["bur_certif", "Bureau de certification"], ["cert_o_lgl", "Certification d'origine légale"], ["certif_tra", "Certification traçabilité"], ["etu_imp_env", "Étude d'impact"], ["observatn", "Observations"]],
};

const NATIVE_CF: Record<string, FieldMap> = {
  CMR: [["type_attr", "Type d'attributaire (GIC, ASS, COOP…)"], ["statu_conv", "Statut de la convention"], ["statu_amgt", "Statut d'aménagement"], ["date_con_p", "Convention provisoire"], ["date_con_d", "Convention définitive"], ["date_pgs", "Plan simple de gestion"], ["sup_adm_ha", "Superficie administrative (ha)"], ["sup_sig_ha", "Superficie SIG (ha)"]],
  COD: [["id", "N° dossier geocfcl"], ["application_stage", "Étape de la procédure"], ["status", "Statut"], ["approval_date", "Date d'attribution"], ["year_of_approval", "Année d'attribution"], ["request_approval_entity", "Entité d'approbation"], ["community_org_type", "Type d'organisation communautaire"], ["operating_mode", "Mode d'exploitation"], ["potential_mode", "Potentiel identifié"], ["smp_approved", "PSG approuvé"], ["management_plan_approval", "Approbation du PSG"], ["smp_approval_date", "Date d'approbation du PSG"], ["supporting_org", "ONG / expert accompagnateur"], ["supporting_org_2", "Accompagnateur 2"], ["supporting_org_3", "Accompagnateur 3"], ["supporting_org_type", "Type d'accompagnateur"], ["group", "Groupement"], ["sector", "Secteur / chefferie"], ["territory", "Territoire"], ["area", "Superficie déclarée (ha)"], ["modified", "Dernière mise à jour geocfcl"], ["num_for_com", "N° de concession (WRI)"], ["accompagnateur", "Accompagnateur (WRI)"], ["gestionnaire", "Gestionnaire (WRI)"], ["pg_simple", "PSG (WRI)"], ["mode_gestion", "Mode de gestion (WRI)"], ["Programme", "Programme"], ["Finance", "Financement"], ["Agence", "Agence"], ["Partenaire", "Partenaire"], ["Statut", "Statut (PIREDD)"], ["Foncier", "Sécurisation foncière"], ["Exploitati", "Exploitation"], ["Certificat", "Certification"]],
  GNQ: [["codigo", "Código"], ["num_regis", "N° de registro"], ["nom_pblado", "Poblado"], ["local_dist", "Distrito"], ["fech_atrb", "Fecha de atribución"], ["texto_ofic", "Texto oficial"], ["auto_firma", "Autoridad firmante"], ["estad_atrb", "Estado de atribución"], ["empr_explo", "Empresa explotadora"], ["estad_expl", "Estado de explotación"], ["Sub_adm", "Superficie administrativa (ha)"]],
  GAB: [["nom_ass", "Association"], ["nom_com", "Communauté"], ["nom_ste", "Société partenaire"], ["mode_expl", "Mode d'exploitation"], ["statu_conv", "Statut de la convention"], ["date_con_p", "Convention provisoire"], ["date_con_d", "Convention définitive"], ["date_psg", "Plan simple de gestion"], ["observatn", "Observations"], ["sup_adm_ha", "Superficie administrative (ha)"], ["sup_sig_ha", "Superficie SIG (ha)"]],
};

const NATIVE_PA_WDPA: FieldMap = [["original_name", "Nom original"], ["wdpa_pid", "Identifiant WDPA (parcelle)"], ["reported_area", "Superficie déclarée (km²)"], ["gis_area", "Superficie SIG (km²)"], ["reported_marine_area", "Superficie marine déclarée (km²)"], ["gis_marine_area", "Superficie marine SIG (km²)"], ["no_take", "Zone de non-prélèvement"], ["no_take_area", "Superficie non-prélèvement (km²)"], ["legal_status_updated_at", "Mise à jour du statut légal"], ["management_plan", "Plan de gestion"], ["international_criteria", "Critères internationaux"], ["verif", "Vérification WDPA"], ["is_green_list", "Liste verte UICN"], ["is_oecm", "Autre mesure de conservation (OECM)"], ["marine", "Marine"], ["owner_type", "Type de propriétaire"], ["supplementary_info", "Informations complémentaires"]];

const NATIVE_PA_NAT: Record<string, FieldMap> = {
  CMR: [["desc_type", "Type (atlas national)"], ["partenar", "Partenaire"], ["statu_crea", "Statut de création"], ["statu_amgt", "Statut d'aménagement"], ["date_prop", "Date de proposition"], ["date_crea", "Date de création"], ["date_amgt", "Date d'aménagement"], ["sup_mar_ha", "Superficie marine (ha)"]],
  COD: [["desc_type", "Type (atlas national)"], ["nom_orig", "Nom original"], ["province", "Province"], ["desig_type", "Type de désignation"], ["desig_eng", "Désignation (anglais)"], ["statu_leg", "Statut légal"], ["date_desig", "Date de désignation"], ["type_gouv", "Type de gouvernance"], ["aut_gest", "Autorité de gestion"], ["aut_amgt", "Autorité d'aménagement"], ["statu_amgt", "Statut d'aménagement"], ["wdpapid", "WDPA PID"]],
  COG: [["desc_type", "Type (atlas national)"], ["departemen", "Département"], ["aut_gest", "Autorité de gestion"]],
  GAB: [["desc_type", "Type (atlas national)"], ["nom_comple", "Nom complet"], ["code_ap", "Code de l'aire protégée"], ["statu_crea", "Statut de création"], ["annee_crea", "Année de création"], ["annee_prop", "Année de proposition"], ["statu_amgt", "Statut d'aménagement"], ["auth_gest", "Autorité de gestion"], ["type_gouv", "Gouvernance"], ["sup_mar_ha", "Superficie marine (ha)"]],
  CAF: [["desc_type", "Type (atlas national)"], ["gestionair", "Gestionnaire"], ["bailleur", "Bailleur"], ["statu_crea", "Statut de création"], ["date_crea", "Date de création"], ["statu_amgt", "Statut d'aménagement"], ["date_amgt", "Date d'aménagement"]],
};

const NATIVE_LT: Record<string, FieldMap> = {
  COD: [["Programme", "Programme"], ["Finance", "Financement"], ["Agence", "Agence"], ["Partenaire", "Partenaire"]],
};

/** Field-label map for a feature's national source attributes. */
export function nativeFields(
  layer: GovLayerKey,
  iso3: string | null,
  srcUid: string | null,
): FieldMap {
  if (layer === "protected_areas") {
    if (srcUid && srcUid.includes(":wdpa:")) return NATIVE_PA_WDPA;
    return (iso3 && NATIVE_PA_NAT[iso3]) || [];
  }
  if (layer === "concessions" || layer === "concession_zoning") {
    return (iso3 && NATIVE_CONCESSIONS[iso3]) || [];
  }
  if (layer === "community_forests" || layer === "community_forest_zoning") {
    return (iso3 && NATIVE_CF[iso3]) || [];
  }
  return (iso3 && NATIVE_LT[iso3]) || [];
}
