import { NextResponse } from "next/server";

import { HttpError, respondWithError } from "@/lib/api";
import { computeMatchups, computeSeasonToDate } from "@/utils/compute";
import {
  detectTargetCfbWeek,
  getCfbWeekGames,
  getNflSchedule,
  getRosterWithColleges,
  getWeeklyStats,
  joinStatsToColleges,
  normalizeSchool,
  type SeasonType,
  StatsNotAvailableError,
} from "@/utils/datasources";
import { persistJson } from "@/utils/cache";
import { buildNflWeekWindows, mapCfbGamesToNflWeeks, mapCfbWeekToSingleNflWeek } from "@/utils/weekMapping";

export const runtime = "nodejs";
export const revalidate = 0;

const parseIntParam = (value: string | null | undefined, name: string): number | undefined => {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new HttpError(400, `${name} must be a numeric value`);
  }
  return Math.trunc(num);
};

const parseBooleanParam = (value: string | null | undefined): boolean => {
  if (value === null || value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
};

const validateMode = (value: string): "matchups" | "std" | "both" => {
  const normalized = value.trim().toLowerCase();
  if (["matchups", "std", "both"].includes(normalized)) {
    return normalized as "matchups" | "std" | "both";
  }
  throw new HttpError(400, `mode must be one of matchups, std, or both`);
};

const validateMappingMode = (value: string): "per-week" | "per-game" => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "per-week" || normalized === "per-game") return normalized;
  throw new HttpError(400, `map must be per-week or per-game`);
};

const parseSeasonType = (value: string | null | undefined, fallback: SeasonType): SeasonType => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "regular" || normalized === "postseason") {
    return normalized as SeasonType;
  }
  throw new HttpError(400, `seasonType must be regular or postseason`);
};

const ADMIN_HEADER_NAME = "x-admin-token";
const ADMIN_QUERY_PARAM = "token";

const extractAdminToken = (req: Request, url?: URL) => {
  const headerToken = req.headers.get(ADMIN_HEADER_NAME)?.trim();
  if (headerToken) return headerToken;

  const queryToken = (url ?? new URL(req.url)).searchParams.get(ADMIN_QUERY_PARAM)?.trim();
  return queryToken && queryToken.length > 0 ? queryToken : null;
};

const requireAdmin = (req: Request, url: URL) => {
  const token = extractAdminToken(req, url);
  const expected = process.env.ADMIN_PRECOMPUTE_TOKEN?.trim();
  return Boolean(token && expected && token === expected);
};

const previewMissing = (rows: { player_id: string; name: string; team: string }[], limit = 25) =>
  rows.slice(0, limit);

export async function GET(req: Request) {
  const url = new URL(req.url);

  if (!requireAdmin(req, url)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const mode = validateMode(url.searchParams.get("mode") ?? "both");
    const mappingMode = validateMappingMode(url.searchParams.get("map") ?? "per-week");
    const force = parseBooleanParam(url.searchParams.get("force"));

    const seasonParam = parseIntParam(url.searchParams.get("season"), "season");
    const weekParam = parseIntParam(url.searchParams.get("cfbWeek"), "cfbWeek");
    const seasonTypeParam = url.searchParams.get("seasonType");

    const detected = !seasonParam || !weekParam || !seasonTypeParam ? await detectTargetCfbWeek() : null;

    const cfbSeason = seasonParam ?? detected?.season ?? new Date().getUTCFullYear();
    const cfbWeek = weekParam ?? detected?.week ?? 1;
    const requestedSeasonType: SeasonType = parseSeasonType(seasonTypeParam, detected?.seasonType ?? "regular");

    if (cfbSeason < 1900 || cfbSeason > 2100) {
      throw new HttpError(400, "season out of supported range");
    }
    if (cfbWeek < 0 || cfbWeek > 30) {
      throw new HttpError(400, "cfbWeek must be between 0 and 30");
    }

    let cfbGames = await getCfbWeekGames(cfbSeason, cfbWeek, requestedSeasonType);
    let seasonTypeUsed: SeasonType = requestedSeasonType;
    if (!cfbGames.length && requestedSeasonType === "regular") {
      cfbGames = await getCfbWeekGames(cfbSeason, cfbWeek, "postseason");
      if (cfbGames.length) {
        seasonTypeUsed = "postseason";
      }
    }
    if (!cfbGames.length) {
      throw new HttpError(404, `No college games found for season ${cfbSeason} week ${cfbWeek}`);
    }

    const nflSchedule = await getNflSchedule(cfbSeason);
    const windows = buildNflWeekWindows(nflSchedule);
    const priorNflSeason = cfbSeason - 1;

    let mapping = mapCfbWeekToSingleNflWeek(cfbGames, windows, cfbWeek, priorNflSeason);
    let perGameMappings: ReturnType<typeof mapCfbGamesToNflWeeks> | undefined;
    if (mappingMode === "per-game") {
      perGameMappings = mapCfbGamesToNflWeeks(cfbGames, windows, priorNflSeason);
      const counts = new Map<string, { season: number; week: number; count: number }>();
      for (const entry of perGameMappings) {
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

    let stats;
    try {
      stats = await getWeeklyStats(mapping.season, mapping.week);
    } catch (error) {
      if (error instanceof StatsNotAvailableError) {
        return NextResponse.json({
          status: "pending",
          message: error.message,
          cfbSeason,
          cfbWeek,
          nflSeason: error.season,
          nflWeek: error.week,
        }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }

    const roster = await getRosterWithColleges(mapping.season);
    const joined = await joinStatsToColleges(stats, roster);

    const scheduleForCompute = cfbGames.map((game) => ({ home: game.home, away: game.away, kickoffISO: game.kickoffISO }));
    const matchups = computeMatchups(joined.rows, scheduleForCompute, normalizeSchool);

    const metadataBase = {
      cfbSeason,
      cfbWeek,
      cfbSeasonType: seasonTypeUsed,
      nflSeason: mapping.season,
      nflWeek: mapping.week,
      mapping_mode: mappingMode,
      generated_at: new Date().toISOString(),
      row_counts: {
        schedule: cfbGames.length,
        stats: stats.rows.length,
        joined: joined.rows.length,
        matchups: matchups.length,
        missing_college: joined.missing.length,
      },
      source_meta: {
        schedule_provider: cfbGames[0]?.provider ?? null,
        stats: { provider: stats.provider, format: stats.format },
        roster: { source: roster.source, rows: roster.rows, season: roster.season },
        mapping_windows: windows.length,
      },
      missing_preview: previewMissing(joined.missing.map((row) => ({
        player_id: row.player_id,
        name: row.name,
        team: row.team,
      }))),
      per_game_mappings: perGameMappings,
    };

    const keyBase = `alumni:v1:${cfbSeason}:${cfbWeek}`;

    const responseBody: Record<string, unknown> = {
      cfbSeason,
      cfbWeek,
      seasonType: seasonTypeUsed,
      nflSeason: mapping.season,
      nflWeek: mapping.week,
      mapping_mode: mappingMode,
      schedule_provider: cfbGames[0]?.provider ?? null,
      mode,
    };

    if (mode === "matchups" || mode === "both") {
      const matchupsPayload = {
        metadata: { ...metadataBase, dataset: "matchups" },
        schedule: cfbGames,
        matchups,
      };
      const persisted = await persistJson(`${keyBase}:matchups`, matchupsPayload, { force });
      responseBody.matchups_key = persisted.key;
      responseBody.matchups_backend = persisted.backend;
      responseBody.matchups_skipped = persisted.skipped;
      if (persisted.url) responseBody.matchups_url = persisted.url;
    }

    if (mode === "std" || mode === "both") {
      const stdRows = computeSeasonToDate([joined.rows], scheduleForCompute, normalizeSchool);
      const stdPayload = {
        metadata: { ...metadataBase, dataset: "season-to-date" },
        schedule: cfbGames,
        results: stdRows,
      };
      const persisted = await persistJson(`${keyBase}:std`, stdPayload, { force });
      responseBody.std_key = persisted.key;
      responseBody.std_backend = persisted.backend;
      responseBody.std_skipped = persisted.skipped;
      if (persisted.url) responseBody.std_url = persisted.url;
    }

    return NextResponse.json(responseBody, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return respondWithError("admin-precompute", error, { input: { url: req.url } });
  }
}
