export type DefenseRow = {
  team: string;
  week: number;
  points_allowed: number;
  sacks: number;
  interceptions: number;
  fumbles_recovered: number;
  score: number;
};

export async function fetchDefense(season = 2025, week?: number): Promise<DefenseRow[]> {
  const qs = new URLSearchParams({ season: String(season) });
  if (week != null) qs.set("week", String(week));
  const r = await fetch(`/api/defense?${qs.toString()}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || r.statusText);
  console.log("[alumni] DEF", { source: j.source, week: j.week, mode: j.mode, rows: j.rows.length });
  return j.rows as DefenseRow[];
}
