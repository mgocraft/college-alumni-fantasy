
import { NextResponse } from "next/server";
import { aggregateByCollegeMode } from "@/lib/scoring";
import { loadWeek, computeHistoricalAverages } from "@/lib/nflverse";
import {
  parseBooleanParam,
  parseEnumParam,
  parseIntegerParam,
  parseStringParam,
  respondWithError,
} from "@/lib/api";

export const runtime = "nodejs";
export const revalidate = Number(process.env.CACHE_SECONDS ?? 3600);

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
    Object.assign(input, { season, week, format, mode, includeK, defense });
    const includeDefense = defense === "approx";
    const weekPromise = loadWeek({ season, week, format, includeDefense });
    const averagesPromise: Promise<Record<string, number> | undefined> =
      mode === "avg" && week > 1 ? computeHistoricalAverages(season, week, format) : Promise.resolve(undefined);
    const [{ leaders, defenseData }, averages] = await Promise.all([weekPromise, averagesPromise]);
    const bySchool = await aggregateByCollegeMode(leaders, week, format, mode, averages, { includeK, defense, defenseData });
    return NextResponse.json({ season, week, format, mode, includeK, defense, count: bySchool.length, results: bySchool });
  } catch (error) {
    return respondWithError("GET /api/scores", error, { input });
  }
}
