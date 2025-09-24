"use client";
import { useEffect, useState } from "react";
import { fetchDefense, type DefenseRow } from "@/utils/fetchDefense";

type DefenseMeta = {
  week: number;
  mode?: string;
  source?: string;
  fallback_reason?: string | null;
  requested_week?: number | null;
  weeks_available?: number[];
};

export default function DebugDefense() {
  const [rows, setRows] = useState<DefenseRow[]>([]);
  const [err, setErr] = useState<string>("");
  const [meta, setMeta] = useState<DefenseMeta | null>(null);

  useEffect(() => {
    fetchDefense(2025)
      .then((result) => {
        setRows(result.rows);
        setMeta({
          week: result.week,
          mode: result.mode,
          source: result.source,
          fallback_reason: result.fallback_reason ?? null,
          requested_week: result.requested_week ?? null,
          weeks_available: result.weeks_available,
        });
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="p-4 text-red-600">Error: {err}</div>;
  if (!rows.length) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">
        Defense Debug (2025{meta?.week ? ` — Week ${meta.week}` : ""})
      </h1>
      {meta && (
        <div className="text-sm text-slate-400 space-y-1">
          {(meta.mode || meta.source) && (
            <div>
              {meta.mode ? `Mode: ${meta.mode}` : null}
              {meta.mode && meta.source ? " · " : ""}
              {meta.source ? `Source: ${meta.source}` : null}
            </div>
          )}
          {(meta.fallback_reason || meta.requested_week != null || meta.weeks_available?.length) && (
            <div className="text-xs text-amber-500 space-x-2">
              {meta.requested_week != null ? <span>Requested: W{meta.requested_week}</span> : null}
              {meta.fallback_reason ? <span>Fallback: {meta.fallback_reason}</span> : null}
              {meta.weeks_available?.length ? (
                <span>
                  Weeks available: {meta.weeks_available.length > 6
                    ? `${meta.weeks_available.slice(0, 3).join(", ")} … ${meta.weeks_available.slice(-3).join(", ")}`
                    : meta.weeks_available.join(", ")}
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Team</th>
            <th className="text-right">Week</th>
            <th className="text-right">PA</th>
            <th className="text-right">Sacks</th>
            <th className="text-right">INT</th>
            <th className="text-right">FR</th>
            <th className="text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .sort((a, b) => a.team.localeCompare(b.team))
            .map((r, i) => (
              <tr key={i}>
                <td>{r.team}</td>
                <td className="text-right">{r.week}</td>
                <td className="text-right">{r.points_allowed}</td>
                <td className="text-right">{r.sacks}</td>
                <td className="text-right">{r.interceptions}</td>
                <td className="text-right">{r.fumbles_recovered}</td>
                <td className="text-right font-semibold">{r.score}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
