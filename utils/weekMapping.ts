import type { NflScheduleGame } from "./datasources";

export type NflWeekWindow = {
  season: number;
  week: number;
  windowEndUTC: string;
  games: number;
};

export type NflWeekReference = {
  season: number;
  week: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const sortWindows = (windows: NflWeekWindow[]): NflWeekWindow[] =>
  windows.slice().sort((a, b) => (a.season - b.season) || (a.week - b.week));

const startOfWeekUtc = (date: Date): Date => {
  const base = new Date(date.getTime());
  base.setUTCHours(0, 0, 0, 0);
  const day = base.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setUTCDate(base.getUTCDate() + diff);
  return base;
};

const toTuesdayCutoff = (maxKick: Date): Date => {
  const monday = startOfWeekUtc(maxKick);
  let cutoff = new Date(monday.getTime());
  cutoff = new Date(cutoff.getTime() + DAY_MS); // Tuesday 00:00
  cutoff.setUTCHours(10, 0, 0, 0);
  if (cutoff.getTime() <= maxKick.getTime()) {
    cutoff = new Date(cutoff.getTime() + 7 * DAY_MS);
  }
  return cutoff;
};

export function buildNflWeekWindows(schedule: NflScheduleGame[]): NflWeekWindow[] {
  const groups = new Map<string, { season: number; week: number; maxKick: Date; games: number }>();
  for (const game of schedule) {
    const kickoff = new Date(game.kickoffISO);
    const key = `${game.season}-${game.week}`;
    const existing = groups.get(key);
    if (existing) {
      if (kickoff.getTime() > existing.maxKick.getTime()) existing.maxKick = kickoff;
      existing.games += 1;
    } else {
      groups.set(key, { season: game.season, week: game.week, maxKick: kickoff, games: 1 });
    }
  }
  const windows: NflWeekWindow[] = [];
  for (const entry of groups.values()) {
    const cutoff = toTuesdayCutoff(entry.maxKick);
    windows.push({ season: entry.season, week: entry.week, windowEndUTC: cutoff.toISOString(), games: entry.games });
  }
  return sortWindows(windows);
}

export function mapKickoffToNflWeek(
  kickoffISO: string,
  windows: NflWeekWindow[],
  priorSeason: number,
): NflWeekReference {
  const kickoff = new Date(kickoffISO);
  let chosen: NflWeekWindow | undefined;
  for (const window of sortWindows(windows)) {
    const windowEnd = new Date(window.windowEndUTC);
    if (windowEnd.getTime() <= kickoff.getTime()) {
      chosen = window;
    } else {
      break;
    }
  }
  if (!chosen) {
    return { season: priorSeason, week: 18 };
  }
  return { season: chosen.season, week: chosen.week };
}

export function mapCfbWeekToSingleNflWeek(
  games: Array<{ kickoffISO: string }>,
  windows: NflWeekWindow[],
  cfbWeek: number,
  priorSeason: number,
): NflWeekReference {
  if (!games.length || cfbWeek <= 1) {
    return { season: priorSeason, week: 18 };
  }
  const latest = games.reduce<Date | null>((acc, game) => {
    const kickoff = new Date(game.kickoffISO);
    if (!acc || kickoff.getTime() > acc.getTime()) return kickoff;
    return acc;
  }, null);
  if (!latest) {
    return { season: priorSeason, week: 18 };
  }
  return mapKickoffToNflWeek(latest.toISOString(), windows, priorSeason);
}

export function mapCfbGamesToNflWeeks(
  games: Array<{ kickoffISO: string; home?: string; away?: string }>,
  windows: NflWeekWindow[],
  priorSeason: number,
): Array<NflWeekReference & { kickoffISO: string; home?: string; away?: string }> {
  return games.map((game) => {
    const mapped = mapKickoffToNflWeek(game.kickoffISO, windows, priorSeason);
    return { ...mapped, kickoffISO: game.kickoffISO, home: game.home, away: game.away };
  });
}
