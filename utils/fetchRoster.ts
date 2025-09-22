export type RosterRow = { name: string; id: string; team: string; college: string };

export async function fetchRoster(season = 2025): Promise<RosterRow[]> {
  const r = await fetch(`/api/nflverse?season=${season}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`nflverse ${r.status}`);
  const data = await r.json();
  if (String(data.source).includes("/rosters/roster_")) {
    // Optional: surface fallback banner in your UI
    console.warn("[alumni] Weekly not available; using season fallback");
  }
  return data.rows as RosterRow[];
}
