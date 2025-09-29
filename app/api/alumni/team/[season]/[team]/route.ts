import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { type CfbGame, filterTeamGames, getCfbSeasonSlate } from "@/utils/schedules";
import {
  getWeeklyStats,
  getRosterWithColleges,
  joinStatsToColleges,
  StatsNotAvailableError,
  normalizeSchool,
} from "@/utils/datasources";
import { lastCompletedNflWeek, nflWeekWindowUtc } from "@/utils/nflWeek";
import type { PlayerWeekly } from "@/utils/compute";

export const runtime = "nodejs";

type ResultRow = {
  cfbWeek: number;
  cfbDate: string;
  homeAway: "Home" | "Away";
  opponent: string;
  usPts: number;
  oppPts: number;
  result: "W" | "L" | "T";
  nflSeason: number;
  nflWeek: number;
  nflWindowStart: string;
  nflWindowEnd: string;
};

type PendingPayload = {
  status: "pending";
  message: string;
  season: number;
  week: number;
};

const CACHE_TTL_SECONDS = 60 * 60 * 24;

const roundOne = (value: number): number => Number(value.toFixed(1));

const sumForMatchup = (rows: PlayerWeekly[], home: string, away: string) => {
  const want = new Set([home, away]);
  const totals = new Map<string, number>();
  totals.set(home, 0);
  totals.set(away, 0);
  for (const row of rows) {
    const college = row.college;
    if (!college || !want.has(college)) continue;
    const current = totals.get(college) ?? 0;
    totals.set(college, current + (row.points ?? 0));
  }
  return {
    home: totals.get(home) ?? 0,
    away: totals.get(away) ?? 0,
  };
};

const buildCacheKey = (season: number, team: string) => `alumni:v1:team:${season}:${team}`;

const buildHeaders = () => ({ "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" });

export async function GET(
  req: Request,
  context: { params: { season: string; team: string } },
) {
  const seasonParam = context.params?.season ?? "";
  const season = Number.parseInt(seasonParam, 10);
  if (!Number.isFinite(season) || season < 1900 || season > 2100) {
    return NextResponse.json({ error: "invalid_season" }, { status: 400 });
  }

  const rawTeam = decodeURIComponent(context.params?.team ?? "");
  const normalizedTeam = normalizeSchool(rawTeam);
  if (!normalizedTeam) {
    return NextResponse.json({ error: "invalid_team" }, { status: 400 });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  const cacheKey = buildCacheKey(season, normalizedTeam);
  const cached = await kvGet<ResultRow[]>(cacheKey);
  if (cached && cached.length && !debug) {
    return NextResponse.json({ team: normalizedTeam, season, rows: cached, cached: true }, { headers: buildHeaders() });
  }

  try {
    const slateErrors: Record<string, string> = {};
    let regularSlate: CfbGame[] = [];
    try {
      regularSlate = await getCfbSeasonSlate(season, "regular");
    } catch (error) {
      slateErrors.regular = error instanceof Error ? error.message : String(error);
      if (!cached || !cached.length) throw error;
    }

    let postseasonSlate: CfbGame[] = [];
    try {
      postseasonSlate = await getCfbSeasonSlate(season, "postseason");
    } catch (error) {
      slateErrors.postseason = error instanceof Error ? error.message : String(error);
      postseasonSlate = [];
    }

    const slate = [...regularSlate, ...postseasonSlate];
    const games = filterTeamGames(slate, rawTeam || normalizedTeam);

    const meta = debug
      ? {
          requestedTeam: rawTeam,
          team: normalizedTeam,
          slateCount: slate.length,
          slateBreakdown: {
            regular: regularSlate.length,
            postseason: postseasonSlate.length,
          },
          firstGames: games.slice(0, 3),
          slateErrors: Object.keys(slateErrors).length ? slateErrors : undefined,
        }
      : undefined;

    if (!games.length) {
      if (cached && cached.length) {
        return NextResponse.json(
          { team: normalizedTeam, season, rows: cached, cached: true, meta },
          { headers: buildHeaders() },
        );
      }
      return NextResponse.json({ team: normalizedTeam, season, rows: [], meta }, { headers: buildHeaders() });
    }

    if (cached && cached.length && debug) {
      return NextResponse.json(
        { team: normalizedTeam, season, rows: cached, cached: true, meta },
        { headers: buildHeaders() },
      );
    }

    const { season: nflSeason, week: nflWeek } = lastCompletedNflWeek();
    const { startISO, endISO } = nflWeekWindowUtc(nflSeason, nflWeek);

    let stats;
    try {
      stats = await getWeeklyStats(nflSeason, nflWeek, "ppr");
    } catch (error) {
      if (error instanceof StatsNotAvailableError) {
        const payload: PendingPayload = {
          status: "pending",
          message: "NFL weekly player stats not yet published",
          season: error.season,
          week: error.week,
        };
        return NextResponse.json(meta ? { ...payload, meta } : payload, {
          status: 202,
          headers: buildHeaders(),
        });
      }
      throw error;
    }

    const roster = await getRosterWithColleges(nflSeason);
    const joined = await joinStatsToColleges(stats, roster);

    const rows: ResultRow[] = [];
    for (const game of games) {
      const totals = sumForMatchup(joined.rows, game.home, game.away);
      const isHome = game.home === normalizedTeam;
      const opponent = isHome ? game.away : game.home;
      const usRaw = isHome ? totals.home : totals.away;
      const oppRaw = isHome ? totals.away : totals.home;
      const usPts = roundOne(usRaw);
      const oppPts = roundOne(oppRaw);
      const result: ResultRow["result"] = usPts === oppPts ? "T" : usPts > oppPts ? "W" : "L";
      rows.push({
        cfbWeek: game.week,
        cfbDate: game.kickoffISO ? game.kickoffISO.slice(0, 10) : "",
        homeAway: isHome ? "Home" : "Away",
        opponent,
        usPts,
        oppPts,
        result,
        nflSeason,
        nflWeek,
        nflWindowStart: startISO,
        nflWindowEnd: endISO,
      });
    }

    rows.sort((a, b) => a.cfbWeek - b.cfbWeek || a.cfbDate.localeCompare(b.cfbDate));

    await kvSet(cacheKey, rows, CACHE_TTL_SECONDS);

    return NextResponse.json({ team: normalizedTeam, season, rows, cached: false, meta }, { headers: buildHeaders() });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[alumni] team results failed", error);
    return NextResponse.json({ error: "alumni_team_failed", message: String(error) }, { status: 500 });
  }
}
