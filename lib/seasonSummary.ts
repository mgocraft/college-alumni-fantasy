import { aggregateByCollegeMode } from "./scoring";
import { computeHistoricalAverages, loadWeek, NflverseAssetMissingError } from "./nflverse";

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

    lastCompletedWeek = week;
    lastWeekTotals = weekTotals;
  }

  const rows: SeasonSummaryRow[] = [];
  for (const [key, entry] of schools.entries()) {
    const lastWeekPoints = lastWeekTotals.get(key) ?? 0;
    let topPlayer: PlayerContribution | undefined;
    for (const contribution of entry.contributions.values()) {
      if (!topPlayer || contribution.totalPoints > topPlayer.totalPoints) {
        topPlayer = contribution;
      }
    }

    rows.push({
      school: entry.school,
      weeklyTotal: Number(entry.weeklyTotal.toFixed(2)),
      managerTotal: Number(entry.managerTotal.toFixed(2)),
      lastWeekPoints: Number(lastWeekPoints.toFixed(2)),
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
