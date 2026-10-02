import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Photo, Profile } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";

/** M9 — v1's Overview behaviour: the clicked application's details render in
 *  the panel's Overview tab (never a separate page). Seeds instantly from the
 *  clicked feature's properties, then enriches with the full profile. */
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

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setFailed(false);
    setPhotos([]);
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
        if (!cancelled) setPhotos(ph.filter((x) => x.mirrored).slice(0, 6));
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
    chips.push(`${t("pf_fire_risk")}: ${t(`fire_${profile.fire.category}` as never)}`);
  }

  const loc = profile?.location;
  const where = [loc?.country, loc?.province, loc?.territory, loc?.village]
    .filter(Boolean)
    .join(" › ");

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
            </p>
          )}
          {profile.performance?.achievedPct != null && (
            <p className="pov-line">
              {Math.round(profile.performance.achievedPct)}% {t("perf_achieved")}
              {profile.performance.achievedHa != null
                ? ` (${fmtNum(profile.performance.achievedHa, locale)} ha)`
                : ""}
            </p>
          )}
          {profile.areas && (
            <table className="pov-table">
              <tbody>
                {(
                  [
                    ["area_estimated", profile.areas.estimatedHa],
                    ["area_declared", profile.areas.declaredHa],
                    ["area_contracted", profile.areas.contractedHa],
                  ] as const
                )
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{t(k)}</td>
                      <td className="num">{fmtNum(v, locale)} ha</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {photos.length > 0 && (
            <>
              <p className="pov-line muted">{t("dossier_photos")}</p>
              <div className="pov-photos">
                {photos.map((p) => (
                  <PhotoThumb key={p.photoUid} uid={p.photoUid} label={p.label} />
                ))}
              </div>
            </>
          )}
          <Link className="pov-dossier" to={`/applications/${encodeURIComponent(id)}`}>
            {t("open_dossier")} ↗
          </Link>
        </>
      )}
    </div>
  );
}

function PhotoThumb({ uid, label }: { uid: string; label: string | null }) {
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
  return <img className="pov-thumb" src={url} alt={label ?? "Photo"} loading="lazy" />;
}
