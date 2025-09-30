import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { getCfbSeasonSlate, type CfbGame } from "@/utils/cfbd";
import { canonicalTeam, canonicalize, filterTeamGamesFromSlate, normalizeSchool } from "@/utils/schedules";
import { probeNames } from "@/utils/debugSlate";
import {
  getWeeklyStats,
  getRosterWithColleges,
  joinStatsToColleges,
  StatsNotAvailableError,
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

const unslugTeamParam = (value: string): string => {
  const decoded = decodeURIComponent(value || "");
  const spaced = decoded.replace(/[-_]+/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};

export async function GET(
  req: Request,
  context: { params: { season: string; team: string } },
) {
  const seasonParam = context.params?.season ?? "";
  const season = Number.parseInt(seasonParam, 10);
  if (!Number.isFinite(season) || season < 1900 || season > 2100) {
    return NextResponse.json({ error: "invalid_season" }, { status: 400 });
  }

  const rawTeamParam = context.params?.team ?? "";
  const teamRaw = decodeURIComponent(rawTeamParam || "");
  const unsluggedTeam = unslugTeamParam(rawTeamParam);
  const normalizedTeam = normalizeSchool(unsluggedTeam);
  if (!normalizedTeam) {
    return NextResponse.json({ error: "invalid_team" }, { status: 400 });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  const cacheKey = buildCacheKey(season, normalizedTeam);
  const cached = await kvGet<ResultRow[]>(cacheKey);

  try {
    const [regularResult, postseasonResult] = await Promise.all([
      getCfbSeasonSlate(season, debug),
      getCfbSeasonSlate(season, "postseason", debug),
    ]);

    const slate: CfbGame[] = [...regularResult.slate, ...postseasonResult.slate];
    const teamForFilter = unsluggedTeam || normalizedTeam;
    const games = filterTeamGamesFromSlate(slate, teamForFilter);

    const providerUsed: "cfbd" = "cfbd";

    const meta: Record<string, unknown> = {
      requestedSlug: rawTeamParam,
      requestedTeam: unsluggedTeam,
      team: normalizedTeam,
      slateCount: slate.length,
      slateRegularCount: regularResult.slate.length,
      slatePostseasonCount: postseasonResult.slate.length,
      cfbdStatus: regularResult.status,
      cfbdErr: regularResult.error,
      cfbdPostStatus: postseasonResult.status,
      cfbdPostErr: postseasonResult.error,
      matched: games.length,
      providerUsed,
      requestedTeamOriginal: teamRaw,
      teamCanonical: canonicalTeam(teamForFilter),
    };

    if (debug) {
      meta.firstGames = games.slice(0, 3);
      meta.probe = {
        alabama: probeNames(slate, "alab"),
        ohio: probeNames(slate, "ohio"),
      };
      meta.canon = {
        requested: canonicalize(teamForFilter),
        requestedTeam: canonicalTeam(teamForFilter),
      };
    }

    if (!games.length) {
      const probe = {
        alabama: probeNames(slate, "alab"),
        ohio: probeNames(slate, "ohio"),
      };
      const metaWithProbe = { ...meta, matched: 0, probe };
      if (cached && cached.length) {
        return NextResponse.json(
          { team: normalizedTeam, season, rows: cached, cached: true, meta: metaWithProbe },
          { headers: buildHeaders() },
        );
      }
      return NextResponse.json(
        { team: normalizedTeam, season, rows: [], meta: metaWithProbe },
        { headers: buildHeaders() },
      );
    }

    if (cached && cached.length) {
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
    const canonicalNormalized = canonicalTeam(normalizedTeam);

    for (const game of games) {
      const totals = sumForMatchup(joined.rows, game.home, game.away);
      const isHome = canonicalTeam(game.home) === canonicalNormalized;
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
