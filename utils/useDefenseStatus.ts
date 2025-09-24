"use client";
import { useEffect, useState } from "react";
import { fetchDefense } from "./fetchDefense";

export type DefenseStatus = {
  message: string | null;
  showApproxBadge: boolean;
};

type Options = {
  season: number;
  week?: number;
  enabled: boolean;
};

export function useDefenseStatus({ season, week, enabled }: Options): DefenseStatus {
  const [status, setStatus] = useState<DefenseStatus>({ message: null, showApproxBadge: false });

  useEffect(() => {
    if (!enabled) {
      setStatus({ message: null, showApproxBadge: false });
      return;
    }
    if (!Number.isFinite(season) || season <= 0) {
      setStatus({ message: null, showApproxBadge: false });
      return;
    }

    let cancelled = false;
    setStatus({ message: null, showApproxBadge: false });

    const load = async () => {
      try {
        const requestedWeek = typeof week === "number" && Number.isFinite(week) && week > 0 ? Math.trunc(week) : undefined;
        const result = await fetchDefense(season, requestedWeek);
        const rows = result.rows;
        if (cancelled) return;
        if (requestedWeek && result.week > 0 && requestedWeek !== result.week) {
          setStatus({
            message: `Defense data available for Week ${result.week}, not Week ${requestedWeek}.`,
            showApproxBadge: result.mode === "approx-opponent-offense",
          });
          return;
        }
        if (!rows.length) {
          setStatus({ message: "Defense stats not posted yet; check back later.", showApproxBadge: false });
          return;
        }
        const allZero = rows.every((row) => Number(row.score) === 0);
        if (allZero) {
          console.warn("[alumni] DEF approx returned zero scores", { season, week, teams: rows.length });
          setStatus({ message: null, showApproxBadge: result.mode === "approx-opponent-offense" });
          return;
        }
        setStatus({ message: null, showApproxBadge: result.mode === "approx-opponent-offense" });
      } catch (error) {
        if (cancelled) return;
        console.warn("[alumni] DEF fetch failed", error);
        setStatus({ message: "Defense stats not posted yet; check back later.", showApproxBadge: false });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [season, week, enabled]);

  return status;
}
