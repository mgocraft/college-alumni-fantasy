
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

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input: Record<string, unknown> = {
    query: Object.fromEntries(url.searchParams.entries()),
  };
  try {
    const season = parseIntegerParam(url, "season", 2025, { min: 1900, max: 2100 });
    const week = parseIntegerParam(url, "week", 1, { min: 1, max: 30 });
    const format = parseStringParam(url, "format", "ppr", { maxLength: 32, toLowerCase: true });
    const mode = parseEnumParam(url, "mode", ["weekly", "avg"] as const, "weekly");
    const includeK = parseBooleanParam(url, "includeK", true);
    const defense = parseEnumParam(url, "defense", ["none", "approx"] as const, "approx");
    const home = parseRequiredString(url, "home", { maxLength: 120 });
    const away = parseRequiredString(url, "away", { maxLength: 120 });
    Object.assign(input, { season, week, format, mode, includeK, defense, home, away });
    if (home.toLowerCase() === away.toLowerCase()) {
      throw new HttpError(400, "home and away must be different schools");
    }
    const doRecord = parseBooleanParam(url, "record", false);
    input.record = doRecord;
    const includeDefense = defense === "approx";
    const weekPromise = loadWeek({ season, week, format, includeDefense });
    const averagesPromise: Promise<Record<string, number> | undefined> =
      mode === "avg" && week > 1 ? computeHistoricalAverages(season, week, format) : Promise.resolve(undefined);
    const [{ leaders, defenseData }, averages] = await Promise.all([weekPromise, averagesPromise]);
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
