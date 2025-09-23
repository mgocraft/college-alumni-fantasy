#!/usr/bin/env tsx

import { computeMatchups, computeSeasonToDate } from "@/utils/compute";
import {
  getCfbWeekGames,
  getNflSchedule,
  getRosterWithColleges,
  getWeeklyStats,
  joinStatsToColleges,
  normalizeSchool,
  type SeasonType,
} from "@/utils/datasources";
import { buildNflWeekWindows, mapCfbGamesToNflWeeks, mapCfbWeekToSingleNflWeek } from "@/utils/weekMapping";
import { persistJson } from "@/utils/cache";

const parseRange = (input: string): number[] => {
  const parts = input.split("-").map((value) => Number(value.trim()));
  if (parts.length !== 2 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid range: ${input}`);
  }
  const [start, end] = parts;
  if (start > end) {
    throw new Error(`Range start must be <= end: ${input}`);
  }
  const weeks: number[] = [];
  for (let week = start; week <= end; week += 1) {
    weeks.push(week);
  }
  return weeks;
};

type CliArgs = {
  season?: number;
  cfbWeek?: number;
  range?: string;
  all?: boolean;
  map: "per-week" | "per-game";
  force: boolean;
};

const parseNumber = (value: string | undefined, name: string): number => {
  if (!value) throw new Error(`Missing value for --${name}`);
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(`Invalid number for --${name}: ${value}`);
  return Math.trunc(num);
};

const parseCliArgs = (argv: string[]): CliArgs => {
  const result: CliArgs = { map: "per-week", force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }
    const [flag, inline] = token.slice(2).split("=");
    const nextValue = inline !== undefined ? inline : argv[i + 1];
    const consumeNext = inline === undefined;
    switch (flag) {
      case "season":
        result.season = parseNumber(nextValue, "season");
        if (consumeNext) i += 1;
        break;
      case "cfbWeek":
        result.cfbWeek = parseNumber(nextValue, "cfbWeek");
        if (consumeNext) i += 1;
        break;
      case "range":
        if (!nextValue) throw new Error("Missing value for --range");
        result.range = nextValue;
        if (consumeNext) i += 1;
        break;
      case "all":
        result.all = true;
        break;
      case "map":
        if (!nextValue) throw new Error("Missing value for --map");
        if (nextValue !== "per-week" && nextValue !== "per-game") {
          throw new Error(`Invalid value for --map: ${nextValue}`);
        }
        result.map = nextValue;
        if (consumeNext) i += 1;
        break;
      case "force":
        result.force = true;
        break;
      case "help":
        console.log("Usage: precomputeWeekly --season <year> --cfbWeek <week> [--range a-b] [--all] [--map per-week|per-game] [--force]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag --${flag}`);
    }
  }
  return result;
};

const ensureSchedule = async (season: number, week: number, seasonType: SeasonType): Promise<{ games: Awaited<ReturnType<typeof getCfbWeekGames>>; seasonType: SeasonType }> => {
  let games = await getCfbWeekGames(season, week, seasonType);
  let type = seasonType;
  if (!games.length && seasonType === "regular") {
    games = await getCfbWeekGames(season, week, "postseason");
    if (games.length) type = "postseason";
  }
  return { games, seasonType: type };
};

const computeOne = async (
  season: number,
  week: number,
  mapMode: "per-week" | "per-game",
  force: boolean,
) => {
  const { games, seasonType } = await ensureSchedule(season, week, "regular");
  if (!games.length) {
    console.warn(`[precompute] Skipping CFB ${season} W${week}: no games found`);
    return;
  }

  const nflSchedule = await getNflSchedule(season);
  const windows = buildNflWeekWindows(nflSchedule);
  const priorSeason = season - 1;

  let mapping = mapCfbWeekToSingleNflWeek(games, windows, week, priorSeason);
  if (mapMode === "per-game") {
    const perGame = mapCfbGamesToNflWeeks(games, windows, priorSeason);
    const counts = new Map<string, { season: number; week: number; count: number }>();
    for (const entry of perGame) {
      const key = `${entry.season}-${entry.week}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { season: entry.season, week: entry.week, count: 1 });
      }
    }
    const sorted = Array.from(counts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.season !== a.season) return b.season - a.season;
      return b.week - a.week;
    });
    const top = sorted[0];
    if (top) {
      mapping = { season: top.season, week: top.week };
    }
  }

  const stats = await getWeeklyStats(mapping.season, mapping.week);
  const roster = await getRosterWithColleges(mapping.season);
  const joined = await joinStatsToColleges(stats, roster);

  const scheduleForCompute = games.map((game) => ({ home: game.home, away: game.away, kickoffISO: game.kickoffISO }));
  const matchups = computeMatchups(joined.rows, scheduleForCompute, normalizeSchool);
  const stdRows = computeSeasonToDate([joined.rows], scheduleForCompute, normalizeSchool);

  const metadata = {
    cfbSeason: season,
    cfbWeek: week,
    cfbSeasonType: seasonType,
    nflSeason: mapping.season,
    nflWeek: mapping.week,
    mapping_mode: mapMode,
    generated_at: new Date().toISOString(),
    row_counts: {
      schedule: games.length,
      stats: stats.rows.length,
      joined: joined.rows.length,
      matchups: matchups.length,
      missing_college: joined.missing.length,
    },
    source_meta: {
      schedule_provider: games[0]?.provider ?? null,
      stats: { provider: stats.provider, format: stats.format },
      roster: { source: roster.source, rows: roster.rows, season: roster.season },
      mapping_windows: windows.length,
    },
  };

  const keyBase = `alumni:v1:${season}:${week}`;
  const matchupsPayload = {
    metadata: { ...metadata, dataset: "matchups" },
    schedule: games,
    matchups,
  };
  const stdPayload = {
    metadata: { ...metadata, dataset: "season-to-date" },
    schedule: games,
    results: stdRows,
  };

  const matchupsResult = await persistJson(`${keyBase}:matchups`, matchupsPayload, { force });
  const stdResult = await persistJson(`${keyBase}:std`, stdPayload, { force });

  const summaryParts = [
    `CFB ${season} W${week}`,
    `NFL ${mapping.season} W${mapping.week}`,
    `${matchups.length} matchups`,
    `store=${matchupsResult.backend}${matchupsResult.skipped ? "(skip)" : ""}`,
  ];
  console.log(`[precompute] ${summaryParts.join(" | ")}`);
  if (stdResult.backend !== matchupsResult.backend) {
    console.log(`  season-to-date stored via ${stdResult.backend}${stdResult.skipped ? " (skip)" : ""}`);
  }
};

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2));
  const season = parsed.season ?? new Date().getUTCFullYear();
  const mapMode = parsed.map;
  const force = parsed.force;

  const weeks: number[] = [];
  if (parsed.all) {
    for (let w = 1; w <= 20; w += 1) weeks.push(w);
  } else if (parsed.range) {
    weeks.push(...parseRange(parsed.range));
  } else if (typeof parsed.cfbWeek === "number") {
    weeks.push(parsed.cfbWeek);
  } else {
    weeks.push(1);
  }

  for (const week of weeks) {
    try {
      await computeOne(season, week, mapMode, force);
    } catch (error) {
      console.warn(`[precompute] Failed for CFB ${season} W${week}:`, error);
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
