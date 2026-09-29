import { useEffect, useState } from "react";
import type { RunHealth } from "@cafi/shared";
import { api } from "../api/client";
import { fmtNum, useI18n, useT } from "../i18n";

export function RunsPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [runs, setRuns] = useState<RunHealth[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.runs().then(setRuns).catch(() => setError(true));
  }, []);

  if (error) return <main className="page"><p className="notice">{t("error_load")}</p></main>;
  if (runs === null) return <main className="page"><p className="notice">{t("loading")}</p></main>;

  return (
    <main className="page">
      <h1>{t("runs_title")}</h1>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>start (UTC)</th>
            <th className="num">s</th>
            <th className="num">fetched</th>
            <th className="num">selected</th>
            <th className="num">ok</th>
            <th className="num">partial</th>
            <th className="num">skipped</th>
            <th className="num">queued</th>
            <th>stopped</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId}>
              <td>{r.runId}</td>
              <td>{new Date(r.startUtc).toISOString().slice(0, 16).replace("T", " ")}</td>
              <td className="num">{fmtNum(r.durationS, locale, 0)}</td>
              <td className="num">
                {r.fetchedApp ?? "—"}+{r.fetchedMon ?? "—"}
              </td>
              <td className="num">{r.selected ?? "—"}</td>
              <td className="num">{r.ok ?? "—"}</td>
              <td className="num">{r.partial ?? "—"}</td>
              <td className="num">{r.skipped ?? "—"}</td>
              <td className="num">{r.queued ?? "—"}</td>
              <td>{r.stoppedReason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
