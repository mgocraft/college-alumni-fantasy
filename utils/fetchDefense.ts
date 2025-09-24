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
};

export async function fetchDefense(season = 2025, week?: number): Promise<DefenseApiResponse> {
  const qs = new URLSearchParams({ season: String(season) });
  if (week != null) qs.set("week", String(week));
  const r = await fetch(`/api/defense?${qs.toString()}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || r.statusText);

  const responseWeek = toWeek(j?.week ?? week);
  const rows = Array.isArray(j?.rows)
    ? (j.rows as Record<string, unknown>[])
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
    season: toWeek(j?.season) || season,
    week: responseWeek,
    mode: typeof j?.mode === "string" ? j.mode : undefined,
    source: typeof j?.source === "string" ? j.source : undefined,
    rows,
  };

  console.log("[alumni] DEF", {
    source: payload.source,
    week: payload.week,
    mode: payload.mode,
    rows: payload.rows.length,
  });

  return payload;
}
