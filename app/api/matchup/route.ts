
import { NextResponse } from "next/server";
import { aggregateByCollegeMode } from "@/lib/scoring";
import { loadWeek, computeHistoricalAverages } from "@/lib/nflverse";
import { saveRecord, MatchRecord } from "@/lib/league";
import {
  HttpError,
  parseBooleanParam,
  parseEnumParam,
  parseIntegerParam,
  parseRequiredString,
  parseStringParam,
  respondWithError,
} from "@/lib/api";
import { lastCompletedNflWeek } from "@/utils/nflWeek";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input: Record<string, unknown> = {
    query: Object.fromEntries(url.searchParams.entries()),
  };
  try {
    const defaults = lastCompletedNflWeek();
    let defaultSeason = defaults.season;
    let defaultWeek = defaults.week;
    const overrideParam = url.searchParams.get("override");
    let overrideApplied = false;
    if (overrideParam && overrideParam.trim().length > 0) {
      const normalized = overrideParam.trim();
      const match = normalized.match(/^(\d{4})-(\d{1,2})$/);
      if (!match) {
        throw new HttpError(400, "override must be in the format season-week (e.g., 2025-3)");
      }
      defaultSeason = Number(match[1]);
      defaultWeek = Number(match[2]);
      overrideApplied = true;
      // eslint-disable-next-line no-console
      console.warn("[matchup] override applied", { override: normalized, season: defaultSeason, week: defaultWeek });
      input.override = normalized;
    }
    const season = parseIntegerParam(url, "season", defaultSeason, { min: 1900, max: 2100 });
    const weekParam = url.searchParams.get("week");
    const week = overrideApplied
      ? parseIntegerParam(url, "week", defaultWeek, { min: 1, max: 30 })
      : defaultWeek;
    if (!overrideApplied && weekParam && weekParam.trim().length > 0) {
      const normalizedWeek = weekParam.trim();
      input.ignoredWeekParam = normalizedWeek;
      if (Number(normalizedWeek) !== week) {
        // eslint-disable-next-line no-console
        console.warn("[matchup] Ignoring week parameter without override", {
          requested: normalizedWeek,
          using: week,
        });
      }
    }
    const format = parseStringParam(url, "format", "ppr", { maxLength: 32, toLowerCase: true });
    const mode = parseEnumParam(url, "mode", ["weekly", "avg"] as const, "weekly");
    const includeK = parseBooleanParam(url, "includeK", true);
    const defense = parseEnumParam(url, "defense", ["none", "approx"] as const, "approx");
    const home = parseRequiredString(url, "home", { maxLength: 120 });
    const away = parseRequiredString(url, "away", { maxLength: 120 });
    Object.assign(input, { defaults, season, week, format, mode, includeK, defense, home, away });
    if (home.toLowerCase() === away.toLowerCase()) {
      throw new HttpError(400, "home and away must be different schools");
    }
    const doRecord = parseBooleanParam(url, "record", false);
    input.record = doRecord;
    const includeDefense = defense === "approx";
    const weekPromise = loadWeek({ season, week, format, includeDefense });
    const averagesPromise: Promise<Record<string, number> | undefined> =
      mode === "avg" && week > 1 ? computeHistoricalAverages(season, week, format) : Promise.resolve(undefined);
    const [{ leaders, defenseData, playerStatsSource }, averages] = await Promise.all([weekPromise, averagesPromise]);
    const bySchool = await aggregateByCollegeMode(leaders, week, format, mode, averages, { includeK, defense, defenseData });
    const a = bySchool.find((r) => r.school.toLowerCase() === home.toLowerCase());
    const b = bySchool.find((r) => r.school.toLowerCase() === away.toLowerCase());
    const homePoints = a?.totalPoints ?? 0;
    const awayPoints = b?.totalPoints ?? 0;
    const winner: "home" | "away" | "tie" = homePoints > awayPoints ? "home" : awayPoints > homePoints ? "away" : "tie";
    const payload = {
      season,
      week,
      format,
      mode,
      includeK,
      defense,
      seasonLoaded: playerStatsSource?.seasonLoaded ?? season,
      home,
      away,
      homePoints,
      awayPoints,
      winner,
      homeLineup: a?.performers ?? [],
      awayLineup: b?.performers ?? [],
    };
    if (doRecord) {
      const record: MatchRecord = {
        season,
        week,
        format,
        mode,
        home,
        away,
        homePoints,
        awayPoints,
        winner,
        timestamp: Date.now(),
      };
      await saveRecord(record);
    }
    return NextResponse.json(payload);
  } catch (error) {
    return respondWithError("GET /api/matchup", error, { input });
  }
}
