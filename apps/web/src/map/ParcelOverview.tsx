import { useEffect, useState, type ReactNode } from "react";
import type { Photo, Profile } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT, type Key } from "../i18n";

/** M9/M10 — v1's Overview behaviour: the clicked application's COMPLETE
 *  dossier renders in the panel's Overview tab; nothing navigates away.
 *  Seeds instantly from the clicked feature's properties, then enriches. */

function Section({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  const [isOpen, setOpen] = useState(open);
  return (
    <section className="panel-collapsible">
      <button
        className="panel-collapsible-head"
        aria-expanded={isOpen}
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {isOpen && <div className="pov-section-body">{children}</div>}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string | number | null | undefined][] }) {
  const filled = rows.filter(([, v]) => v != null && v !== "");
  if (!filled.length) return null;
  return (
    <table className="pov-table">
      <tbody>
        {filled.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="num">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ParcelOverview({
  id,
  seed,
  onClose,
}: {
  id: string;
  seed: Record<string, unknown>;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; label: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setFailed(false);
    setPhotos([]);
    setLightbox(null);
    api
      .applicationProfile(id)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    api
      .applicationPhotos(id)
      .then((ph) => {
        if (!cancelled) setPhotos(ph.filter((x) => x.mirrored).slice(0, 24));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const code = (profile?.applicationCode ?? seed.applicationCode ?? id) as string;
  const activity = (profile?.activity ?? seed.pesActivity ?? null) as string | null;
  const date = (profile?.applicationDate ?? seed.applicationDate ?? null) as string | null;

  const chips: string[] = [];
  if (profile?.stage?.name) chips.push(`${t("pf_stage")}: ${profile.stage.name}`);
  if (profile?.contract?.status) chips.push(`${t("pf_contract")}: ${profile.contract.status}`);
  if (profile?.visits?.overdue) chips.push(t("pf_visit_overdue"));
  if (profile?.fire?.category) {
    chips.push(`${t("pf_fire_risk")}: ${t(`fire_${profile.fire.category}` as Key)}`);
  }

  const loc = profile?.location;
  const where = [loc?.country, loc?.province, loc?.territory, loc?.village]
    .filter(Boolean)
    .join(" › ");
  const num = (v: number | null | undefined, d = 1) =>
    v != null ? fmtNum(v, locale, d) : null;
  const perfMainKey = `perf_main_${profile?.activityGroup ?? "generic"}` as Key;

  return (
    <div className="pov">
      <button className="btn-ghost pov-back" onClick={onClose}>
        ← {t("tab_overview")}
      </button>
      <h3 className="pov-title">{code}</h3>
      <p className="pov-sub">
        {[activity, date ? fmtDate(date, locale) : null].filter(Boolean).join(" · ")}
        {profile?.contract?.code ? ` · ${profile.contract.code}` : ""}
      </p>
      {failed && <p className="panel-hint">{t("error_load")}</p>}
      {!failed && !profile && <p className="panel-hint">{t("loading")}</p>}
      {profile && (
        <>
          {chips.length > 0 && (
            <div className="pov-chips">
              {chips.map((c) => (
                <span key={c} className="pov-chip">
                  {c}
                </span>
              ))}
            </div>
          )}
          {where && <p className="pov-line">{where}</p>}
          {profile.stage?.order != null && (
            <p className="pov-line">
              {t("pf_stage_caption", {
                n: profile.stage.order,
                total: profile.stage.total,
                name: profile.stage.name ?? "",
              })}
            </p>
          )}
          {profile.contract?.start && profile.contract.end && (
            <p className="pov-line">
              {fmtDate(profile.contract.start, locale)} → {fmtDate(profile.contract.end, locale)}
              {profile.contract.pctElapsed != null
                ? ` · ${fmtNum(profile.contract.pctElapsed, locale, 0)}% ${t("pf_elapsed")}`
                : ""}
            </p>
          )}
          {profile.visits && (
            <p className="pov-line">
              {t("pf_visits_title")}:{" "}
              {t("pf_visits_done", {
                done: profile.visits.completed ?? 0,
                total: profile.visits.expected ?? "—",
              })}
              {profile.visits.lastDate
                ? ` · ${t("pf_last_visit")} ${fmtDate(profile.visits.lastDate, locale)}`
                : ""}
              {profile.visits.nextDue
                ? ` · ${t("pf_next_visit")} ${fmtDate(profile.visits.nextDue, locale)}`
                : ""}
            </p>
          )}

          {/* performance */}
          {profile.performance && (
            <Section title={t(`perf_title_${profile.activityGroup ?? "generic"}` as Key)} open>
              {profile.performance.achievedPct != null && (
                <p className="pov-line">
                  <strong>{Math.round(profile.performance.achievedPct)}%</strong>{" "}
                  {t("perf_achieved")}
                </p>
              )}
              <Rows
                rows={[
                  [t(perfMainKey), num(profile.performance.achievedHa)],
                  [t(`perf_gap_${profile.activityGroup ?? "generic"}` as Key), num(profile.performance.gapHa)],
                  [t("perf_total"), num(profile.performance.monitoredTotalHa)],
                  [t("perf_trees"), profile.performance.observedTrees],
                  [
                    t("perf_land_cover"),
                    profile.performance.observedLandCover
                      ? `${profile.performance.observedLandCover}${
                          profile.performance.observedLandCoverPct != null
                            ? ` (${num(profile.performance.observedLandCoverPct)}%)`
                            : ""
                        }`
                      : null,
                  ],
                ]}
              />
            </Section>
          )}

          {/* areas */}
          {profile.areas && (
            <Section title={t("area_comparison")} open>
              <Rows
                rows={[
                  [t("area_estimated"), num(profile.areas.estimatedHa)],
                  [t("area_declared"), num(profile.areas.declaredHa)],
                  [t("area_contracted"), num(profile.areas.contractedHa)],
                  [t(perfMainKey), num(profile.areas.achievedHa)],
                ].map(([k, v]) => [k as string, v != null ? `${v} ha` : null])}
              />
            </Section>
          )}

          {/* fire */}
          {profile.fire && (
            <Section title={t("pf_fire_title")}>
              <p className="pov-line">
                {profile.fire.burnedPct != null && profile.fire.burnedPct > 0
                  ? t("pf_fire_burned", { pct: fmtNum(profile.fire.burnedPct, locale, 1) })
                  : t("pf_fire_none")}
              </p>
              <Rows
                rows={[
                  [t("ind_fire_alerts"), profile.fire.fireAlerts5yr],
                  [t("alert_burned"), num(profile.fire.burned5yrHa, 2)],
                ]}
              />
            </Section>
          )}

          {/* v1 attribute sections */}
          <Section title={t("sec_beneficiary")}>
            <Rows
              rows={[
                [t("row_ben_type"), profile.beneficiary?.type],
                [t("row_ben_status"), profile.beneficiary?.status],
                [t("row_gender"), profile.beneficiary?.gender],
                [t("row_family"), profile.beneficiary?.familySituation],
                [t("row_dependents"), profile.beneficiary?.dependents],
                [t("row_community"), profile.beneficiary?.communityMembers],
              ]}
            />
          </Section>
          <Section title={t("sec_project")}>
            <Rows
              rows={[
                [t("row_project"), profile.project?.name],
                [t("row_org"), profile.project?.org],
                [t("row_acronym"), profile.project?.orgAcronym],
                [t("row_aggregator"), profile.project?.aggregator],
              ]}
            />
          </Section>
          <Section title={t("sec_contract")}>
            <Rows
              rows={[
                [t("row_code"), profile.contract?.code],
                [t("row_status"), profile.contract?.status],
                [t("row_duration"), profile.contract?.durationYears],
                [t("area_declared"), num(profile.contract?.declaredAreaHa)],
                [t("area_contracted"), num(profile.contract?.contractedAreaHa)],
              ]}
            />
            {profile.contract?.species && profile.contract.species.length > 0 && (
              <>
                <p className="pov-line muted">{t("row_species")}</p>
                <ul className="pov-list">
                  {profile.contract.species.map((s, i) => (
                    <li key={i}>
                      {s.name ?? "—"}
                      {s.densityPerHa != null ? ` · ${fmtNum(s.densityPerHa, locale, 0)}/ha` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          {/* photos */}
          {photos.length > 0 && (
            <Section title={`${t("dossier_photos")} (${photos.length})`} open>
              <div className="pov-photos">
                {photos.map((p) => (
                  <PhotoThumb
                    key={p.photoUid}
                    uid={p.photoUid}
                    label={p.label}
                    onOpen={(url) => setLightbox({ url, label: p.label })}
                  />
                ))}
              </div>
            </Section>
          )}

          <p className="pov-foot">
            {profile.geometrySource === "polygon_inherited"
              ? t("geom_from_visit")
              : profile.geometrySource
                ? t("geom_from_application")
                : ""}
            {profile.lastSync
              ? ` ${t("pf_synced")}: ${fmtDate(profile.lastSync, locale)}`
              : ""}
          </p>
        </>
      )}

      {lightbox && (
        <div
          className="pov-lightbox"
          role="dialog"
          aria-label={lightbox.label ?? "Photo"}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.url} alt={lightbox.label ?? "Photo"} />
          {lightbox.label && <span>{lightbox.label}</span>}
        </div>
      )}
    </div>
  );
}

function PhotoThumb({
  uid,
  label,
  onOpen,
}: {
  uid: string;
  label: string | null;
  onOpen: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .photoImageUrl(uid)
      .then((r) => {
        if (!cancelled) setUrl(r.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [uid]);
  if (!url) return <span className="pov-thumb pov-thumb-empty" />;
  return (
    <button className="pov-thumb-btn" onClick={() => onOpen(url)} title={label ?? "Photo"}>
      <img className="pov-thumb" src={url} alt={label ?? "Photo"} loading="lazy" />
    </button>
  );
}
