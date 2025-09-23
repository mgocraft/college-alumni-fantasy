export type PlayerWeekly = {
  player_id: string;
  points: number;
  college?: string;
  name?: string;
  team?: string;
  sourceWeek?: number;
};

export type Matchup = {
  home: string;
  away: string;
  kickoffISO?: string;
};

export type MatchupResult = {
  home: string;
  away: string;
  kickoffISO?: string;
  homeTotal: number;
  awayTotal: number;
  winner: string | "tie";
  homeBox: Array<{ player_id: string; points: number; name?: string; team?: string }>;
  awayBox: Array<{ player_id: string; points: number; name?: string; team?: string }>;
};

export function indexByCollege(rows: PlayerWeekly[], normalizer?: (value: string) => string) {
  const map = new Map<string, PlayerWeekly[]>();
  for (const row of rows) {
    const raw = row.college?.trim();
    if (!raw) continue;
    const key = normalizer ? normalizer(raw) : raw;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return map;
}

const sumPoints = (rows: PlayerWeekly[]): number => rows.reduce((total, current) => total + (current.points || 0), 0);

export function computeMatchups(rows: PlayerWeekly[], schedule: Matchup[], normalizer?: (value: string) => string): MatchupResult[] {
  const byCollege = indexByCollege(rows, normalizer);
  return schedule.map(({ home, away, kickoffISO }) => {
    const homeKey = normalizer ? normalizer(home) : home;
    const awayKey = normalizer ? normalizer(away) : away;
    const homeRows = byCollege.get(homeKey) ?? [];
    const awayRows = byCollege.get(awayKey) ?? [];
    const homeTotal = sumPoints(homeRows);
    const awayTotal = sumPoints(awayRows);
    const winner = homeTotal === awayTotal ? "tie" : homeTotal > awayTotal ? home : away;
    return {
      home,
      away,
      kickoffISO,
      homeTotal,
      awayTotal,
      winner,
      homeBox: homeRows.map((row) => ({
        player_id: row.player_id,
        points: row.points,
        name: row.name,
        team: row.team,
      })),
      awayBox: awayRows.map((row) => ({
        player_id: row.player_id,
        points: row.points,
        name: row.name,
        team: row.team,
      })),
    };
  });
}

export function computeSeasonToDate(weeklyRows: PlayerWeekly[][], schedule: Matchup[], normalizer?: (value: string) => string) {
  const merged = ([] as PlayerWeekly[]).concat(...weeklyRows);
  return computeMatchups(merged, schedule, normalizer);
}
