export const REGULAR_SEASON_WEEKS = 18;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const MODERN_MAX_PRESEASON_WEEK = 3;
const LEGACY_MAX_PRESEASON_WEEK = 4;

export const preseasonWeekCapForSeason = (season: number): number =>
  season >= 2021 ? MODERN_MAX_PRESEASON_WEEK : LEGACY_MAX_PRESEASON_WEEK;

const toUtcDate = (year: number, monthIndex: number, day: number, hours = 0): Date => {
  const date = new Date(Date.UTC(year, monthIndex, day, hours, 0, 0, 0));
  return date;
};

const firstMondayOfSeptember = (year: number): Date => {
  const septemberFirst = toUtcDate(year, 8, 1);
  const dayOfWeek = septemberFirst.getUTCDay();
  const offset = (8 - dayOfWeek) % 7;
  const laborDay = toUtcDate(year, 8, 1 + offset);
  return laborDay;
};

const weekOneTuesdayCutoff = (season: number): Date => {
  const laborDayMonday = firstMondayOfSeptember(season);
  const cutoff = new Date(laborDayMonday.getTime());
  cutoff.setUTCDate(laborDayMonday.getUTCDate() + 8);
  cutoff.setUTCHours(10, 0, 0, 0);
  return cutoff;
};

const clampWeek = (week: number): number => {
  if (!Number.isFinite(week)) return 1;
  if (week < 1) return 1;
  if (week > REGULAR_SEASON_WEEKS) return REGULAR_SEASON_WEEKS;
  return Math.trunc(week);
};

export type LastCompletedWeek = {
  season: number;
  week: number;
};

export function lastCompletedNflWeek(now: Date = new Date()): LastCompletedWeek {
  const currentUtc = new Date(now.getTime());
  const candidateSeason = currentUtc.getUTCFullYear();
  let season = candidateSeason;
  let cutoff = weekOneTuesdayCutoff(season);

  if (currentUtc < cutoff) {
    season -= 1;
    cutoff = weekOneTuesdayCutoff(season);
  }

  if (currentUtc < cutoff) {
    return { season: season - 1, week: REGULAR_SEASON_WEEKS };
  }

  const msSinceCutoff = currentUtc.getTime() - cutoff.getTime();
  const weeksSince = Math.floor(msSinceCutoff / (7 * 24 * 60 * 60 * 1000)) + 1;
  const week = clampWeek(weeksSince);
  return { season, week };
}

export function nflWeekWindowUtc(
  season: number,
  week: number,
): { startISO: string; endISO: string } {
  const clampedWeek = clampWeek(week);
  const cutoff = weekOneTuesdayCutoff(season);
  const end = new Date(cutoff.getTime() + (clampedWeek - 1) * MS_PER_WEEK);
  const start = new Date(end.getTime() - MS_PER_WEEK);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export type EstimatedNflWeek = {
  week: number;
  rawWeek: number;
  startISO: string;
  endISO: string;
};

export function estimateNflWeekForDate(
  season: number,
  kickoff: Date,
  fallbackWeek = 1,
): EstimatedNflWeek {
  const fallback = clampWeek(fallbackWeek);
  if (Number.isNaN(kickoff.getTime())) {
    const window = nflWeekWindowUtc(season, fallback);
    return { week: fallback, rawWeek: Number.NaN, startISO: window.startISO, endISO: window.endISO };
  }

  const weekOneWindow = nflWeekWindowUtc(season, 1);
  const weekOneStart = new Date(weekOneWindow.startISO);
  const rawWeek = Math.floor((kickoff.getTime() - weekOneStart.getTime()) / MS_PER_WEEK) + 1;
  if (rawWeek >= 1) {
    const week = clampWeek(rawWeek);
    const { startISO, endISO } = nflWeekWindowUtc(season, week);
    return { week, rawWeek, startISO, endISO };
  }

  const maxPreseasonWeek = preseasonWeekCapForSeason(season);
  const offsetWeeks = Math.max(rawWeek - 1, -(maxPreseasonWeek + 1));
  const start = new Date(weekOneStart.getTime() + offsetWeeks * MS_PER_WEEK);
  const end = new Date(start.getTime() + MS_PER_WEEK);
  const week = Math.max(0, Math.min(maxPreseasonWeek, maxPreseasonWeek + rawWeek));
  return { week, rawWeek, startISO: start.toISOString(), endISO: end.toISOString() };
}

