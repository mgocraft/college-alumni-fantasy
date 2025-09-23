
import { NextResponse } from "next/server";
import { aggregateByCollegeMode } from "@/lib/scoring";
import { loadWeek, computeHistoricalAverages } from "@/lib/nflverse";
import {
  HttpError,
  parseBooleanParam,
  parseEnumParam,
  parseIntegerParam,
  parseStringParam,
  respondWithError,
} from "@/lib/api";
import { lastCompletedNflWeek } from "@/utils/nflWeek";

export const runtime = "nodejs";
export const revalidate = Number(process.env.CACHE_SECONDS ?? 3600);

export async function GET(req: Request, { params }: { params: { school: string }}) {
  const url = new URL(req.url);
  const input: Record<string, unknown> = {
    params,
    query: Object.fromEntries(url.searchParams.entries()),
  };
  try {
    const defaults = lastCompletedNflWeek();
    const season = parseIntegerParam(url, "season", defaults.season, { min: 1900, max: 2100 });
    const startWeek = parseIntegerParam(url, "startWeek", 1, { min: 1, max: 30 });
    const defaultEndWeek = Math.max(defaults.week, startWeek);
    const endWeek = parseIntegerParam(url, "endWeek", defaultEndWeek, { min: startWeek, max: 30 });
    const format = parseStringParam(url, "format", "ppr", { maxLength: 32, toLowerCase: true });
    const mode = parseEnumParam(url, "mode", ["weekly", "avg"] as const, "weekly");
    const includeK = parseBooleanParam(url, "includeK", true);
    const defense = parseEnumParam(url, "defense", ["none", "approx"] as const, "approx");
    Object.assign(input, { defaults, season, startWeek, endWeek, format, mode, includeK, defense });
    const schoolParamRaw = decodeURIComponent(params.school ?? "");
    const schoolParam = schoolParamRaw.trim();
    input.school = schoolParam;
    if (!schoolParam) throw new HttpError(400, "School parameter is required");
    if (schoolParam.length > 120) throw new HttpError(400, "School parameter is too long");
    const weeks = Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i);
    const includeDefense = defense === "approx";
    const seasonSources = new Set<number>();
    const series = await Promise.all(weeks.map(async (w) => {
      const weekPromise = loadWeek({ season, week: w, format, includeDefense });
      const averagesPromise: Promise<Record<string, number> | undefined> =
        mode === "avg" && w > 1 ? computeHistoricalAverages(season, w, format) : Promise.resolve(undefined);
      const [{ leaders, defenseData, playerStatsSource }, averages] = await Promise.all([weekPromise, averagesPromise]);
      if (playerStatsSource?.seasonLoaded !== undefined) {
        seasonSources.add(playerStatsSource.seasonLoaded);
      }
      const bySchool = await aggregateByCollegeMode(leaders, w, format, mode, averages, { includeK, defense, defenseData });
      const match = bySchool.find((r) => r.school.toLowerCase() === schoolParam.toLowerCase());
      return match ? { week: w, totalPoints: match.totalPoints, performers: match.performers } : { week: w, totalPoints: 0, performers: [] };
    }));
    const seasonLoadedCandidates = Array.from(seasonSources);
    const seasonLoaded = seasonLoadedCandidates.length === 1 ? seasonLoadedCandidates[0] : undefined;
    return NextResponse.json({ school: schoolParam, season, seasonLoaded: seasonLoaded ?? season, format, mode, includeK, defense, series });
  } catch (error) {
    return respondWithError(`GET /api/school/${params.school ?? ""}`, error, { input });
  }
}
