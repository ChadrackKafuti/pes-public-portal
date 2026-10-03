import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { IncidentItem, Incidents, Photo } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";

/** M27 — the field monitor's task list, mobile-first. Each open or
 *  responded incident is a task card: go to the parcel, take geotagged
 *  photos through the PES app, and the evidence appears here (with its
 *  AI reading) for the verifying officer to close the loop. */

const ACTIVE = new Set(["open", "responded"]);

function EvidenceStrip({ uid }: { uid: string }) {
  const t = useT();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    api.incidentEvidence(uid).then(setPhotos).catch(() => setPhotos([]));
  }, [uid]);
  useEffect(() => {
    (photos ?? [])
      .filter((p) => p.mirrored)
      .slice(0, 6)
      .forEach((p) => {
        api
          .photoImageUrl(p.photoUid)
          .then(({ url }) => setUrls((u) => ({ ...u, [p.photoUid]: url })))
          .catch(() => undefined);
      });
  }, [photos]);
  if (photos === null) return <p className="muted small">{t("loading")}</p>;
  if (photos.length === 0) return <p className="muted small">{t("tk_no_evidence")}</p>;
  return (
    <div className="tk-evidence">
      {photos.map((p) => (
        <figure key={p.photoUid} className="tk-photo">
          {urls[p.photoUid] ? (
            <img src={urls[p.photoUid]} alt={p.label ?? p.photoUid} loading="lazy" />
          ) : (
            <div className="tk-photo-ph" aria-hidden>📷</div>
          )}
          <figcaption>
            {(p.aiFlags || p.aiConsistent === false) && (
              <span className="tk-flag">▲ {p.aiFlags ?? t("tk_inconsistent")}</span>
            )}
            {p.aiSummary ?? p.label ?? ""}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function TaskCard({
  i,
  onAction,
  busy,
}: {
  i: IncidentItem;
  onAction: (i: IncidentItem, status: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [openEvidence, setOpenEvidence] = useState(false);
  const isFire = i.kind === "fire";
  return (
    <article className={`tk-card tk-${i.status}`}>
      <header className="tk-head">
        <span className={`alert-chip ${isFire ? "alert-critical" : "alert-warning"}`}>
          {isFire ? "▲" : "●"}{" "}
          {isFire
            ? t("alert_fire")
            : i.kind === "road"
              ? t("inc_kind_road")
              : t("alert_defor")}
        </span>
        <span className={`inc-status inc-${i.status}`}>
          {i.status === "open" ? t("inc_open") : t("inc_responded")}
        </span>
      </header>
      <div className="tk-body">
        <Link to={`/applications/${encodeURIComponent(i.applicationId)}`} className="tk-code">
          {i.applicationCode ?? i.applicationId}
        </Link>
        <span className="muted small">
          {[i.implementingOrg, i.province, i.country].filter(Boolean).join(" · ")}
        </span>
        <span className="muted small">
          {t("inc_th_window")}: {fmtDate(i.firstDetected, locale)} →{" "}
          {fmtDate(i.lastDetected, locale)} · {t("inc_th_magnitude")}:{" "}
          {fmtNum(i.magnitude, locale, 0)}
        </span>
        <p className="tk-instruction">{t("tk_instruction")}</p>
      </div>
      <button className="tk-evidence-toggle" onClick={() => setOpenEvidence((v) => !v)}>
        {t("tk_evidence")} · {fmtNum(i.evidenceCount ?? 0, locale, 0)}{" "}
        {openEvidence ? "▴" : "▾"}
      </button>
      {openEvidence && <EvidenceStrip uid={i.incidentUid} />}
      <footer className="tk-actions inc-actions">
        {i.status === "open" && (
          <button disabled={busy} onClick={() => onAction(i, "responded")}>
            {t("tk_mark_responded")}
          </button>
        )}
        <button disabled={busy} onClick={() => onAction(i, "verified")}>
          {t("inc_verified")}
        </button>
        <button disabled={busy} onClick={() => onAction(i, "dismissed")}>
          {t("inc_dismissed")}
        </button>
      </footer>
    </article>
  );
}

export function TasksPage() {
  const t = useT();
  const [data, setData] = useState<Incidents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    api
      .incidents()
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(reload, [reload]);

  const act = (i: IncidentItem, status: string) => {
    const note =
      status === "responded"
        ? undefined
        : window.prompt(t("tk_note_prompt")) ?? undefined;
    setBusy(true);
    api
      .incidentUpdate(i.incidentUid, status, note)
      .then(reload)
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  };

  if (error) return <main className="page"><p className="notice">{t("error_load")}</p></main>;
  if (data === null) return <main className="page"><p className="notice">{t("loading")}</p></main>;

  const tasks = data.items.filter((i) => ACTIVE.has(i.status));
  return (
    <main className="page tk-page">
      <h2>{t("tk_title")}</h2>
      <p className="muted small">{t("tk_lead")}</p>
      {tasks.length === 0 ? (
        <p className="notice">{t("tk_none")}</p>
      ) : (
        <div className="tk-list">
          {tasks.map((i) => (
            <TaskCard key={i.incidentUid} i={i} onAction={act} busy={busy} />
          ))}
        </div>
      )}
    </main>
  );
}
