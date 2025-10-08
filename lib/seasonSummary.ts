import { getCfbSeasonSlate } from "@/utils/cfbd";
import { normalizeSchool } from "@/utils/schoolNames";
import { aggregateByCollegeMode } from "./scoring";
import { computeHistoricalAverages, loadWeek, NflverseAssetMissingError } from "./nflverse";
import { computeStandings, loadRecords } from "./league";

export type SeasonSummaryOptions = {
  season: number;
  format: string;
  includeK?: boolean;
  defense?: "none" | "approx";
  maxWeeks?: number;
};

type PlayerContribution = {
  name: string;
  position?: string;
  team?: string;
  totalPoints: number;
};

type MutableSchoolRow = {
  school: string;
  weeklyTotal: number;
  managerTotal: number;
  contributions: Map<string, PlayerContribution>;
};

export type SeasonSummaryRow = {
  school: string;
  weeklyTotal: number;
  lastWeekPoints: number;
  managerTotal: number;
  topPlayer?: PlayerContribution;
  record?: string;
};

export type SeasonSummary = {
  season: number;
  format: string;
  includeK: boolean;
  defense: "none" | "approx";
  lastCompletedWeek: number;
  rows: SeasonSummaryRow[];
};

const DEFAULT_MAX_WEEKS = 30;

export async function loadSeasonSummary(options: SeasonSummaryOptions): Promise<SeasonSummary> {
  const season = options.season;
  const format = options.format;
  const includeK = options.includeK ?? true;
  const defense = options.defense ?? "approx";
  const maxWeeks = options.maxWeeks ?? DEFAULT_MAX_WEEKS;
  const includeDefense = defense === "approx";

  const schools = new Map<string, MutableSchoolRow>();
  let lastCompletedWeek = 0;
  let lastWeekTotals = new Map<string, number>();
  type RecordCounter = { wins: number; losses: number; ties: number };
  const recordCounters = new Map<string, RecordCounter>();
  const actualRecordCounters = new Map<string, RecordCounter>();

  const ensureRecordCounter = (key: string, map: Map<string, RecordCounter>) => {
    if (map.has(key)) return map.get(key)!;
    const created: RecordCounter = { wins: 0, losses: 0, ties: 0 };
    map.set(key, created);
    return created;
  };

  const gamesPlayed = (record: RecordCounter) => record.wins + record.losses + record.ties;
  const formatRecord = (record: RecordCounter) => {
    const base = `${record.wins}-${record.losses}`;
    return record.ties > 0 ? `${base}-${record.ties}` : base;
  };
  const parseRecordString = (value: string | null | undefined): { games: number } | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    const wins = Number.parseInt(match[1], 10);
    const losses = Number.parseInt(match[2], 10);
    const ties = match[3] ? Number.parseInt(match[3], 10) : 0;
    if (!Number.isFinite(wins) || !Number.isFinite(losses) || !Number.isFinite(ties)) return null;
    return { games: wins + losses + ties };
  };

  const scheduleByWeek = new Map<number, Array<{ home: string; away: string }>>();
  try {
    const [regularSlate, postseasonSlate] = await Promise.all([
      getCfbSeasonSlate(season),
      getCfbSeasonSlate(season, "postseason"),
    ]);
    const combined = [...regularSlate.slate, ...postseasonSlate.slate];
    for (const game of combined) {
      const week = Number(game.week);
      if (!Number.isFinite(week) || week <= 0) continue;
      const home = normalizeSchool(game.home);
      const away = normalizeSchool(game.away);
      if (!home || !away) continue;
      const entry = scheduleByWeek.get(week) ?? [];
      entry.push({ home, away });
      scheduleByWeek.set(week, entry);

      const homePoints = typeof game.homePoints === "number" ? game.homePoints : null;
      const awayPoints = typeof game.awayPoints === "number" ? game.awayPoints : null;
      if (homePoints === null || awayPoints === null) continue;
      const homeKey = home.toLowerCase();
      const awayKey = away.toLowerCase();
      const homeRecord = ensureRecordCounter(homeKey, actualRecordCounters);
      const awayRecord = ensureRecordCounter(awayKey, actualRecordCounters);
      if (homePoints > awayPoints) {
        homeRecord.wins += 1;
        awayRecord.losses += 1;
      } else if (awayPoints > homePoints) {
        awayRecord.wins += 1;
        homeRecord.losses += 1;
      } else {
        homeRecord.ties += 1;
        awayRecord.ties += 1;
      }
    }
  } catch (error) {
    console.warn("[seasonSummary] Unable to load CFB schedule for records", error);
  }

  const ensureRow = (schoolName: string): MutableSchoolRow => {
    const key = schoolName.toLowerCase();
    const existing = schools.get(key);
    if (existing) {
      if (!existing.school) existing.school = schoolName;
      return existing;
    }
    const created: MutableSchoolRow = {
      school: schoolName,
      weeklyTotal: 0,
      managerTotal: 0,
      contributions: new Map<string, PlayerContribution>(),
    };
    schools.set(key, created);
    return created;
  };

  for (let week = 1; week <= maxWeeks; week += 1) {
    let weekResult;
    try {
      weekResult = await loadWeek({ season, week, format, includeDefense });
    } catch (error) {
      if (error instanceof NflverseAssetMissingError) {
        break;
      }
      throw error;
    }

    const { leaders, defenseData } = weekResult;
    if (!leaders.length) {
      break;
    }

    const weeklyRows = await aggregateByCollegeMode(leaders, week, format, "weekly", undefined, {
      includeK,
      defense,
      defenseData,
    });

    if (!weeklyRows.length) {
      break;
    }

    const averages = week > 1 ? await computeHistoricalAverages(season, week, format) : undefined;
    const managerRows = await aggregateByCollegeMode(leaders, week, format, "avg", averages, {
      includeK,
      defense,
      defenseData,
    });

    const managerBySchool = new Map(managerRows.map((row) => [row.school.toLowerCase(), row]));
    const weekTotals = new Map<string, number>();

    for (const row of weeklyRows) {
      const rowKey = row.school.toLowerCase();
      const entry = ensureRow(row.school);
      entry.weeklyTotal += row.totalPoints;
      weekTotals.set(rowKey, row.totalPoints);

      for (const performer of row.performers) {
        const position = (performer.position || "").toUpperCase();
        if (position === "DEF") continue;
        const points = typeof performer.points === "number" ? performer.points : Number(performer.points ?? 0);
        if (!Number.isFinite(points)) continue;
        const name = performer.name?.trim();
        if (!name) continue;
        const playerKey = `${name.toLowerCase()}|${position}`;
        const existing = entry.contributions.get(playerKey) ?? {
          name,
          position: performer.position,
          team: performer.team,
          totalPoints: 0,
        };
        existing.totalPoints += points;
        if (performer.position && (!existing.position || existing.position !== performer.position)) {
          existing.position = performer.position;
        }
        if (performer.team && performer.team !== existing.team) {
          existing.team = performer.team;
        }
        entry.contributions.set(playerKey, existing);
      }
    }

    for (const [managerKey, row] of managerBySchool.entries()) {
      const entry = ensureRow(row.school);
      entry.managerTotal += row.totalPoints;
      if (!weekTotals.has(managerKey)) {
        weekTotals.set(managerKey, 0);
      }
    }

    for (const key of schools.keys()) {
      if (!weekTotals.has(key)) {
        weekTotals.set(key, 0);
      }
    }

    const scheduledGames = scheduleByWeek.get(week) ?? [];
    for (const matchup of scheduledGames) {
      const homeKey = matchup.home.toLowerCase();
      const awayKey = matchup.away.toLowerCase();
      if (!weekTotals.has(homeKey)) {
        ensureRow(matchup.home);
        weekTotals.set(homeKey, 0);
      }
      if (!weekTotals.has(awayKey)) {
        ensureRow(matchup.away);
        weekTotals.set(awayKey, 0);
      }
      const homePoints = weekTotals.get(homeKey);
      const awayPoints = weekTotals.get(awayKey);
      if (homePoints === undefined || awayPoints === undefined) {
        continue;
      }
      const homeRecord = ensureRecordCounter(homeKey, recordCounters);
      const awayRecord = ensureRecordCounter(awayKey, recordCounters);
      if (homePoints > awayPoints) {
        homeRecord.wins += 1;
        awayRecord.losses += 1;
      } else if (awayPoints > homePoints) {
        awayRecord.wins += 1;
        homeRecord.losses += 1;
      } else {
        homeRecord.ties += 1;
        awayRecord.ties += 1;
      }
    }

    lastCompletedWeek = week;
    lastWeekTotals = weekTotals;
  }

  const rows: SeasonSummaryRow[] = [];
  let recordBySchool: Map<string, string> | null = null;
  try {
    const records = await loadRecords();
    if (records.length > 0) {
      const normalizedFormat = format.toLowerCase();
      const relevant = records.filter(
        (record) =>
          record.season === season &&
          record.format.toLowerCase() === normalizedFormat &&
          record.mode === "weekly",
      );
      if (relevant.length > 0) {
        const standings = computeStandings(relevant);
        const formatted = new Map<string, string>();
        for (const entry of standings) {
          const base = `${entry.wins}-${entry.losses}`;
          const value = entry.ties > 0 ? `${base}-${entry.ties}` : base;
          formatted.set(entry.school.toLowerCase(), value);
        }
        recordBySchool = formatted;
      }
    }
  } catch (error) {
    console.warn("[seasonSummary] Unable to load simulated records", error);
  }

  const fantasyRecordStrings = new Map<string, { value: string; games: number }>();
  for (const [key, record] of recordCounters.entries()) {
    const games = gamesPlayed(record);
    if (games === 0) continue;
    fantasyRecordStrings.set(key, { value: formatRecord(record), games });
  }

  const actualRecordStrings = new Map<string, { value: string; games: number }>();
  for (const [key, record] of actualRecordCounters.entries()) {
    const games = gamesPlayed(record);
    if (games === 0) continue;
    actualRecordStrings.set(key, { value: formatRecord(record), games });
  }

  for (const [key, entry] of schools.entries()) {
    const lastWeekPoints = lastWeekTotals.get(key) ?? 0;
    let topPlayer: PlayerContribution | undefined;
    for (const contribution of entry.contributions.values()) {
      if (!topPlayer || contribution.totalPoints > topPlayer.totalPoints) {
        topPlayer = contribution;
      }
    }

    const candidates: Array<{ value: string; games: number; priority: number }> = [];
    const savedRecordRaw = recordBySchool?.get(key);
    if (savedRecordRaw) {
      const trimmed = savedRecordRaw.trim();
      const parsed = parseRecordString(trimmed);
      if (parsed) {
        candidates.push({ value: trimmed, games: parsed.games, priority: 3 });
      }
    }
    const actualRecord = actualRecordStrings.get(key);
    if (actualRecord) {
      candidates.push({ value: actualRecord.value, games: actualRecord.games, priority: 2 });
    }
    const fantasyRecord = fantasyRecordStrings.get(key);
    if (fantasyRecord) {
      candidates.push({ value: fantasyRecord.value, games: fantasyRecord.games, priority: 1 });
    }
    candidates.sort((a, b) => {
      if (b.games !== a.games) return b.games - a.games;
      return b.priority - a.priority;
    });

    rows.push({
      school: entry.school,
      weeklyTotal: Number(entry.weeklyTotal.toFixed(2)),
      managerTotal: Number(entry.managerTotal.toFixed(2)),
      lastWeekPoints: Number(lastWeekPoints.toFixed(2)),
      record: candidates[0]?.value,
      topPlayer: topPlayer
        ? {
            name: topPlayer.name,
            position: topPlayer.position,
            team: topPlayer.team,
          totalPoints: Number(topPlayer.totalPoints.toFixed(2)),
        }
        : undefined,
    });
  }

  rows.sort((a, b) => b.weeklyTotal - a.weeklyTotal);

  return {
    season,
    format,
    includeK,
    defense,
    lastCompletedWeek,
    rows,
  };
}
