import { useEffect, useState } from "react";
import type { GovDocument, GovLayerKey } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT, type Key } from "../i18n";
import { ZONE_TYPES, govLayerLabel, zoneTypeLabel } from "./governance";
import {
  FLAG,
  IUCN,
  LAYER_ACCENT,
  MGMT_CHIP,
  PA_SUBTYPE,
  STATUS_CHIP,
  SUBTYPE,
  nativeFields,
} from "./govVocab";

/** M7c — the governance feature inspector: the v1 Arcade popup content
 *  (chips, tiles, timeline, zoning donut, parent card, national
 *  attributes, categorised documents, overlaps) in the map sidebar. */

type Detail = Record<string, unknown> & {
  zones?: { srcUid: string; name: string | null; zoneTypeStd: string | null; zoneTypeRaw?: string | null; areaCalcHa: number | null }[];
  parent?: Record<string, unknown>;
  overlaps?: { layer: string; srcUid: string; name: string | null; areaCalcHa: number | null }[];
  srcAttrs?: Record<string, unknown>;
  extras?: Record<string, unknown>;
};

const DOCCAT_ORDER = [
  "attribution_decree", "convention", "management_plan", "simple_management_plan",
  "specifications", "certificate", "map", "attestation", "minutes",
  "application", "evaluation", "other",
];

const CFCL_STEPS = ["identification", "affichage", "enquete", "attribution", "gestion"];

function cfclStepIndex(stage: string): number {
  const s = stage.toLowerCase();
  if (/gestion|exploitation/.test(s)) return 5;
  if (/attribu/.test(s)) return 4;
  if (/enqu/.test(s)) return 3;
  if (/affich|public/.test(s)) return 2;
  return 1;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function year(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 4) : null;
}

export function GovInspector({
  srcUid,
  layer,
  seed,
  onClose,
}: {
  srcUid: string;
  layer: GovLayerKey;
  seed: Record<string, unknown>;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [docs, setDocs] = useState<GovDocument[] | null>(null);

  useEffect(() => {
    setDetail(null);
    setDocs(null);
    api
      .governanceFeature(srcUid)
      .then((d) => setDetail(d as Detail))
      .catch(() => setDetail(null));
    api
      .governanceDocuments(srcUid)
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [srcUid]);

  const d: Detail = detail ?? (seed as Detail);
  const zoning = layer.endsWith("_zoning");
  const title = str(d.name) ?? str(d.zoneName) ?? str(d.reference) ?? srcUid;
  const area = num(d.areaAdmHa) ?? num(d.areaSigHa) ?? num(d.areaCalcHa);
  const zones = detail?.zones ?? [];
  const zonedHa = zones.reduce((s, z) => s + (z.areaCalcHa ?? 0), 0);
  const extras = (d.extras ?? {}) as Record<string, unknown>;
  const cert = str(extras.cert_type) ?? str(d.certType);
  const applicationStage = str(extras.application_stage) ?? str(d.applicationStage);
  const attrYear = year(d.dateAttr);
  const expiry = str(d.dateExpiry);
  const attr = str(d.dateAttr);
  let pctElapsed: number | null = null;
  if (attr && expiry) {
    const a = Date.parse(attr);
    const e = Date.parse(expiry);
    if (e > a) pctElapsed = Math.min(100, Math.max(0, ((Date.now() - a) / (e - a)) * 100));
  }

  // Arcade house style (M11): per-layer accent, subtype label, colored chips.
  const iso3 = str(d.iso3);
  const subTypeStd = str(d.subTypeStd) ?? str(extras.sub_type_std);
  const pa = layer === "protected_areas" ? PA_SUBTYPE[subTypeStd ?? ""] : undefined;
  const accent = pa?.[1] ?? LAYER_ACCENT[layer] ?? "#1b5e20";
  const subTypeLabel =
    pa?.[0] ?? (subTypeStd ? SUBTYPE[subTypeStd] : null) ?? str(d.subTypeRaw);
  const iucnKey = (str(extras.iucn_category) ?? str(d.iucnCategory) ?? "").toUpperCase();

  type ChipDef = { label: string; bg?: string; fg?: string };
  const statusChip = STATUS_CHIP[str(d.statusStd) ?? ""];
  const mgmtChip = MGMT_CHIP[str(d.statusMgmtStd) ?? ""];
  const chips: ChipDef[] = [
    statusChip
      ? { label: statusChip[0], bg: statusChip[1], fg: statusChip[2] }
      : str(d.statusRaw)
        ? { label: str(d.statusRaw)! }
        : null,
    mgmtChip ? { label: mgmtChip[0], bg: mgmtChip[1], fg: mgmtChip[2] } : null,
    iucnKey ? { label: IUCN[iucnKey] ?? `UICN ${iucnKey}`, bg: "#eceff1", fg: "#37474f" } : null,
    cert ? { label: `🏆 ${cert}`, bg: "#e0f7fa", fg: "#00838f" } : null,
    d.retired ? { label: t("insp_retired"), bg: "#ffebee", fg: "#c62828" } : null,
    str(d.situation) === "part_complete"
      ? { label: t("insp_approx"), bg: "#fbe9e7", fg: "#d84315" }
      : null,
  ].filter(Boolean) as ChipDef[];

  const dateRows: [Key, string | null][] = [
    ["date_attr", attr],
    ["date_conv_prov", str(d.dateConvProv)],
    ["date_conv_def", str(d.dateConvDef)],
    ["date_plan", str(d.datePlan)],
    ["date_expiry", expiry],
  ];
  const actorRows: [Key, unknown][] = [
    ["row_holder", d.holder],
    ["row_operator", d.operator],
    ["insp_community", d.community],
    ["row_reference", d.reference],
    ["insp_programme", d.programme],
    ["insp_funder", d.funder],
    ["insp_agency", d.agency],
    ["insp_partner", d.partner],
  ];

  const grouped = new Map<string, GovDocument[]>();
  for (const doc of docs ?? []) {
    const cat = doc.categoryStd ?? "other";
    grouped.set(cat, [...(grouped.get(cat) ?? []), doc]);
  }
  const catOrder = [...DOCCAT_ORDER, ...[...grouped.keys()].filter((k) => !DOCCAT_ORDER.includes(k))];

  // Zoning donut geometry.
  const donut = zones.length
    ? (() => {
        const total = zonedHa || 1;
        const r = 40;
        const c = 2 * Math.PI * r;
        let offset = 0;
        return zones.map((z) => {
          const frac = (z.areaCalcHa ?? 0) / total;
          const seg = { z, dash: frac * c, off: offset, color: ZONE_TYPES[z.zoneTypeStd ?? ""]?.color ?? "#bdbdbd" };
          offset += frac * c;
          return seg;
        });
      })()
    : null;

  return (
    <div className="ms-body gov-inspector">
      <div className="insp-banner" style={{ background: accent }}>
        <div className="insp-banner-main">
          <strong>
            {pa ? `${pa[2]} ` : ""}
            {title}
          </strong>
          <span className="insp-banner-sub">
            {iso3 && FLAG[iso3] ? `${FLAG[iso3]} ` : ""}
            {str(d.country) ?? govLayerLabel(layer, locale)}
            {str(d.holder) ? ` — ${d.holder}` : str(d.community) ? ` — ${d.community}` : ""}
          </span>
          {(subTypeLabel || str(d.reference)) && (
            <span className="insp-banner-type">
              {subTypeLabel ?? ""}
              {str(d.reference) && d.reference !== title ? ` · réf. ${d.reference}` : ""}
            </span>
          )}
        </div>
        <button className="insp-close" onClick={onClose} aria-label={t("photo_close")}>
          ✕
        </button>
      </div>

      {chips.length > 0 && (
        <p className="chip-row">
          {chips.map((c) => (
            <span
              key={c.label}
              className="alert-chip"
              style={c.bg ? { background: c.bg, color: c.fg, borderColor: "transparent" } : undefined}
            >
              {c.label}
            </span>
          ))}
        </p>
      )}

      {layer === "community_forests" && applicationStage && (
        <div className="stage-track">
          <div className="stage-segments">
            {CFCL_STEPS.map((s, i) => (
              <span key={s} className={`stage-seg${i < cfclStepIndex(applicationStage) ? " on" : ""}`} />
            ))}
          </div>
          <span className="muted small">
            {t("cfcl_stage")}: {applicationStage}
          </span>
        </div>
      )}

      <div className="insp-tiles">
        {area != null && (
          <div className="insp-tile">
            <span className="stat-label">{t("insp_area")}</span>
            <strong>{fmtNum(area, locale, 0)} ha</strong>
          </div>
        )}
        {zones.length > 0 && (
          <div className="insp-tile">
            <span className="stat-label">{t("insp_zones")}</span>
            <strong>{zones.length}</strong>
          </div>
        )}
        <div className="insp-tile">
          <span className="stat-label">{t("gov_documents")}</span>
          <strong>{docs?.length ?? num(d.docCount) ?? 0}</strong>
        </div>
        {attrYear && (
          <div className="insp-tile">
            <span className="stat-label">{t("insp_attributed")}</span>
            <strong>{attrYear}</strong>
          </div>
        )}
      </div>

      {pctElapsed != null && (
        <div className="tl-card">
          <div className="tl-row">
            <span className="small">{fmtDate(attr!, locale)}</span>
            <span className="tl-track">
              <span
                className="tl-fill"
                style={{
                  width: `${pctElapsed}%`,
                  background: pctElapsed >= 100 ? "var(--status-critical)" : "var(--accent)",
                }}
              />
            </span>
            <span className="small">{fmtDate(expiry!, locale)}</span>
          </div>
          <span className="muted small">
            {fmtNum(pctElapsed, locale, 0)}% {t("pf_elapsed")}
          </span>
        </div>
      )}

      {donut && (
        <div className="tl-card perf-card">
          <strong className="small">
            {t("insp_zoning")} · {zones.length} · {fmtNum(zonedHa, locale, 0)} ha
          </strong>
          <div className="perf-row">
            <svg viewBox="0 0 100 100" className="perf-donut" role="img" aria-label={t("insp_zoning")}>
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--grid)" strokeWidth="12" />
              {donut.map((s) => (
                <circle
                  key={s.z.srcUid}
                  cx="50" cy="50" r="40" fill="none"
                  stroke={s.color} strokeWidth="12"
                  strokeDasharray={`${s.dash} ${2 * Math.PI * 40}`}
                  strokeDashoffset={-s.off}
                  transform="rotate(-90 50 50)"
                />
              ))}
            </svg>
            <div className="perf-figures small">
              {Object.entries(
                zones.reduce<Record<string, number>>((acc, z) => {
                  const k = z.zoneTypeStd ?? "unclassified";
                  acc[k] = (acc[k] ?? 0) + (z.areaCalcHa ?? 0);
                  return acc;
                }, {}),
              )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([k, ha]) => (
                  <span key={k} className="gov-legend-row">
                    <i style={{ background: ZONE_TYPES[k]?.color ?? "#bdbdbd" }} />
                    {zoneTypeLabel(k, locale)} · {fmtNum(ha, locale, 0)} ha
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {zoning && detail?.parent && (
        <div className="pf-section">
          <h3>{t(`insp_parent_${layer}` as Key)}</h3>
          <table className="pf-rows">
            <tbody>
              <tr><td>{t("row_code")}</td><td>{str(detail.parent.name) ?? str(detail.parent.srcUid)}</td></tr>
              {str(detail.parent.statusStd) && (
                <tr><td>{t("row_status")}</td><td>{String(detail.parent.statusStd)}</td></tr>
              )}
              {num(detail.parent.areaCalcHa) != null && (
                <tr>
                  <td>{t("insp_area")}</td>
                  <td>
                    {fmtNum(num(detail.parent.areaCalcHa), locale, 0)} ha
                    {num(d.areaCalcHa) != null && num(detail.parent.areaCalcHa) ? (
                      <span className="muted">
                        {" "}· {fmtNum((num(d.areaCalcHa)! / num(detail.parent.areaCalcHa)!) * 100, locale, 1)}% {t("insp_share")}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="pf-section">
        <h3>{t("insp_actors")}</h3>
        <table className="pf-rows">
          <tbody>
            {actorRows
              .filter(([, v]) => str(v))
              .map(([k, v]) => (
                <tr key={k}><td>{t(k)}</td><td>{String(v)}</td></tr>
              ))}
          </tbody>
        </table>
      </div>

      {dateRows.some(([, v]) => v) && (
        <div className="pf-section">
          <h3>{t("insp_dates")}</h3>
          <table className="pf-rows">
            <tbody>
              {dateRows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <tr key={k}><td>{t(k)}</td><td>{fmtDate(v!, locale)}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {detail?.srcAttrs && Object.keys(detail.srcAttrs).length > 0 && (() => {
        // Arcade parity: label the national source attributes with the
        // country's field map; fall back to raw keys when unmapped.
        const attrs = detail.srcAttrs!;
        const fields = nativeFields(layer, iso3, srcUid);
        const blank = (v: unknown) => v == null || v === "" || v === "null";
        const fmt = (v: unknown): string => {
          if (typeof v === "number" && v > 100000000000) {
            return fmtDate(new Date(v).toISOString(), locale);
          }
          if (typeof v === "boolean") return v ? "oui" : "non";
          return String(v);
        };
        const mapped = fields
          .filter(([k]) => k in attrs && !blank(attrs[k]))
          .map(([k, label]) => [label, fmt(attrs[k])] as const);
        const rows = mapped.length
          ? mapped
          : Object.entries(attrs)
              .filter(([, v]) => !blank(v))
              .slice(0, 25)
              .map(([k, v]) => [k, fmt(v)] as const);
        if (!rows.length) return null;
        return (
          <div className="pf-section">
            <h3>{t("insp_attrs")}{str(d.country) ? ` · ${d.country}` : ""}</h3>
            <table className="pf-rows">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {detail?.overlaps && detail.overlaps.length > 0 && (
        <div className="pf-section">
          <h3>{t("insp_overlaps")} · {detail.overlaps.length}</h3>
          <ul className="aoi-list">
            {detail.overlaps.map((o) => (
              <li key={o.srcUid}>
                {o.name ?? o.srcUid}
                <span className="muted small">
                  {" "}— {govLayerLabel(o.layer as GovLayerKey, locale)}
                  {o.areaCalcHa != null ? ` · ${fmtNum(o.areaCalcHa, locale, 0)} ha` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pf-section">
        <h3>{t("gov_documents")}</h3>
        {docs === null ? (
          <span className="muted small">{t("loading")}</span>
        ) : docs.length === 0 ? (
          <span className="muted small">{t("insp_docs_none")}</span>
        ) : (
          catOrder
            .filter((c) => grouped.has(c))
            .map((cat) => (
              <div key={cat} className="doc-group">
                <span className="muted small doc-cat">
                  {DOCCAT_ORDER.includes(cat) ? t(`doccat_${cat}` as Key) : cat}
                </span>
                {grouped.get(cat)!.slice(0, 60).map((doc) => (
                  <div key={doc.docUid} className="doc-card">
                    <div className="doc-main">
                      <span className="small">{doc.title ?? doc.fileName ?? doc.docUid}</span>
                      <span className="muted small">
                        {[
                          doc.fileName,
                          doc.sizeBytes != null ? `${fmtNum(doc.sizeBytes / 1_000_000, locale, 1)} Mo` : null,
                          doc.dateDoc ? doc.dateDoc.slice(0, 4) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {doc.url && (
                      <a className="btn-ghost doc-open" href={doc.url} target="_blank" rel="noreferrer">
                        {t("insp_open")} ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ))
        )}
      </div>

      <p className="muted small">
        {t("insp_source")}: {str(d.srcLayer) ?? "—"}
        {str(d.srcVintage) ? ` (${d.srcVintage})` : ""}
        {str(d.loadedAt) ? ` · ${t("insp_loaded")} ${fmtDate(String(d.loadedAt), locale)}` : ""}
      </p>
    </div>
  );
}
