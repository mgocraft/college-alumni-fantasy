
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input: Record<string, unknown> = {
    query: Object.fromEntries(url.searchParams.entries()),
  };
  try {
    const computed = lastCompletedNflWeek();
    let defaultSeason = computed.season;
    let defaultWeek = computed.week;
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
      console.warn("[scores] override applied", { override: normalized, season: defaultSeason, week: defaultWeek });
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
        console.warn("[scores] Ignoring week parameter without override", {
          requested: normalizedWeek,
          using: week,
        });
      }
    }
    const format = parseStringParam(url, "format", "ppr", { maxLength: 32, toLowerCase: true });
    const mode = parseEnumParam(url, "mode", ["weekly", "avg"] as const, "weekly");
    const includeK = parseBooleanParam(url, "includeK", true);
    const defense = parseEnumParam(url, "defense", ["none", "approx"] as const, "approx");
    Object.assign(input, {
      computedDefaults: computed,
      season,
      week,
      format,
      mode,
      includeK,
      defense,
    });
    const includeDefense = defense === "approx";
    const weekPromise = loadWeek({ season, week, format, includeDefense });
    const averagesPromise: Promise<Record<string, number> | undefined> =
      mode === "avg" && week > 1 ? computeHistoricalAverages(season, week, format) : Promise.resolve(undefined);
    const [{ leaders, defenseData, playerStatsSource }, averages] = await Promise.all([weekPromise, averagesPromise]);
    const bySchool = await aggregateByCollegeMode(leaders, week, format, mode, averages, { includeK, defense, defenseData });
    return NextResponse.json({
      season,
      week,
      seasonLoaded: playerStatsSource?.seasonLoaded ?? season,
      format,
      mode,
      includeK,
      defense,
      defaults: { season: computed.season, week: computed.week },
      playerStatsSource,
      count: bySchool.length,
      results: bySchool,
    });
  } catch (error) {
    return respondWithError("GET /api/scores", error, { input });
  }
}
