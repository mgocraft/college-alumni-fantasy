import type { NflScheduleGame } from "./datasources";

export type NflWeekWindow = {
  season: number;
  week: number;
  windowEndUTC: string;
  games: number;
  gameTypes: string[];
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
  const groups = new Map<
    string,
    { season: number; week: number; maxKick: Date; games: number; gameTypes: Set<string> }
  >();
  for (const game of schedule) {
    const kickoff = new Date(game.kickoffISO);
    const key = `${game.season}-${game.week}`;
    const existing = groups.get(key);
    const type = typeof game.gameType === "string" ? game.gameType.toUpperCase() : "REG";
    if (existing) {
      if (kickoff.getTime() > existing.maxKick.getTime()) existing.maxKick = kickoff;
      existing.games += 1;
      existing.gameTypes.add(type);
    } else {
      groups.set(key, {
        season: game.season,
        week: game.week,
        maxKick: kickoff,
        games: 1,
        gameTypes: new Set([type]),
      });
    }
  }
  const windows: NflWeekWindow[] = [];
  for (const entry of groups.values()) {
    const cutoff = toTuesdayCutoff(entry.maxKick);
    windows.push({
      season: entry.season,
      week: entry.week,
      windowEndUTC: cutoff.toISOString(),
      games: entry.games,
      gameTypes: Array.from(entry.gameTypes).sort(),
    });
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
  const sortedWindows = sortWindows(windows);
  const normalizeType = (type: string) => type.trim().toUpperCase();
  const isPreseason = (window: NflWeekWindow) =>
    window.gameTypes.some((type) => {
      const normalized = normalizeType(type);
      return normalized === "PRE" || normalized === "PRESEASON" || normalized.startsWith("PRE");
    });
  const isRegular = (window: NflWeekWindow) =>
    window.gameTypes.some((type) => {
      const normalized = normalizeType(type);
      return normalized === "REG" || normalized === "REGULAR" || normalized.startsWith("REG");
    });

  const preseasonWindows = sortedWindows.filter(isPreseason);
  const regularSeasonWindows = sortedWindows.filter(isRegular);

  if (cfbWeek <= 1) {
    const target = preseasonWindows[preseasonWindows.length - 1];
    if (target) {
      return { season: target.season, week: target.week };
    }
  } else if (regularSeasonWindows.length) {
    const regularIndex = Math.max(0, Math.min(cfbWeek - 2, regularSeasonWindows.length - 1));
    const target = regularSeasonWindows[regularIndex];
    if (target) {
      return { season: target.season, week: target.week };
    }
  }

  if (!games.length) {
    const fallbackTarget =
      regularSeasonWindows[regularSeasonWindows.length - 1] ?? sortedWindows[sortedWindows.length - 1];
    if (fallbackTarget) {
      return { season: fallbackTarget.season, week: fallbackTarget.week };
    }
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

  return mapKickoffToNflWeek(latest.toISOString(), sortedWindows, priorSeason);
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
