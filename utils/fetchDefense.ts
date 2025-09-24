const TEAM_ALIAS: Record<string, string> = {
  JAX: "JAC",
  WSH: "WAS",
  LA: "LAR",
};

const normalizeTeam = (value: unknown): string => {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return "";
  return TEAM_ALIAS[trimmed] ?? trimmed;
};

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toWeek = (value: unknown): number => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
};

const toOptionalWeek = (value: unknown): number | undefined => {
  const wk = toWeek(value);
  return wk > 0 ? wk : undefined;
};

const toWeekList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const result: number[] = [];
  for (const entry of value) {
    const wk = toWeek(entry);
    if (wk > 0 && !seen.has(wk)) {
      seen.add(wk);
      result.push(wk);
    }
  }
  return result.sort((a, b) => a - b);
};

export type DefenseRow = {
  team: string;
  week: number;
  points_allowed: number;
  sacks: number;
  interceptions: number;
  fumbles_recovered: number;
  score: number;
};

export type DefenseApiResponse = {
  season: number;
  week: number;
  mode?: string;
  source?: string;
  rows: DefenseRow[];
  weeks_available?: number[];
  requested_week?: number | null;
  fallback_reason?: string | null;
};

export async function fetchDefense(season = 2025, week?: number): Promise<DefenseApiResponse> {
  const requestedWeek = toOptionalWeek(week);

  const load = async (targetWeek?: number) => {
    const qs = new URLSearchParams({ season: String(season) });
    if (targetWeek != null) qs.set("week", String(targetWeek));
    const res = await fetch(`/api/defense?${qs.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || res.statusText);
    return json as Record<string, unknown>;
  };

  let json = await load(requestedWeek);
  let weeksAvailable = toWeekList(json?.weeks_available);

  if ((Array.isArray(json?.rows) ? json.rows.length : 0) === 0 && weeksAvailable.length) {
    const latest = weeksAvailable[weeksAvailable.length - 1];
    if (latest && latest !== (requestedWeek ?? 0)) {
      json = await load(latest);
      weeksAvailable = toWeekList(json?.weeks_available ?? weeksAvailable);
    }
  }

  const responseWeek = toWeek(json?.week ?? requestedWeek);
  const rows = Array.isArray(json?.rows)
    ? (json.rows as Record<string, unknown>[])
        .map((row) => ({
          team: normalizeTeam(row.team),
          week: toWeek(row.week ?? responseWeek),
          points_allowed: toNumber(row.points_allowed),
          sacks: toNumber(row.sacks),
          interceptions: toNumber(row.interceptions),
          fumbles_recovered: toNumber(row.fumbles_recovered),
          score: toNumber(row.score),
        }))
        .filter((row) => row.team.length > 0)
    : [];

  const payload: DefenseApiResponse = {
    season: toWeek(json?.season) || season,
    week: responseWeek,
    mode: typeof json?.mode === "string" ? (json.mode as string) : undefined,
    source: typeof json?.source === "string" ? (json.source as string) : undefined,
    rows,
    weeks_available: weeksAvailable.length ? weeksAvailable : undefined,
    requested_week:
      json?.requested_week === null
        ? null
        : toOptionalWeek(json?.requested_week ?? requestedWeek ?? null) ?? (requestedWeek ?? null),
    fallback_reason: typeof json?.fallback_reason === "string" ? (json.fallback_reason as string) : null,
  };

  console.log("[alumni] DEF", {
    source: payload.source,
    week: payload.week,
    mode: payload.mode,
    rows: payload.rows.length,
    fallback: payload.fallback_reason,
    requested: payload.requested_week,
  });

  return payload;
}
