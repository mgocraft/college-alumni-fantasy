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
  getNflSchedule,
} from "@/utils/datasources";
import { estimateNflWeekForDate, lastCompletedNflWeek, REGULAR_SEASON_WEEKS } from "@/utils/nflWeek";
import type { PlayerWeekly } from "@/utils/compute";
import type { SlateDiagnostics, SlateMatchSample } from "@/types/alumniTeam";
import { buildNflWeekWindows, mapCfbWeekToSingleNflWeek } from "@/utils/weekMapping";

export const runtime = "nodejs";

type ResultRow = {
  cfbWeek: number;
  cfbDate: string;
  homeAway: "Home" | "Away";
  opponent: string;
  usPts: number | null;
  oppPts: number | null;
  result: "W" | "L" | "T" | null;
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
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
    const filterNormalized = normalizeSchool(teamForFilter);
    const filterCanonical = canonicalTeam(filterNormalized || teamForFilter) || null;
    const games = filterTeamGamesFromSlate(slate, teamForFilter, { debug });

    const matchSample: SlateMatchSample[] = games.slice(0, 3).map((game) => ({
      week: game.week,
      kickoffISO: game.kickoffISO,
      home: game.home,
      away: game.away,
      homeCanonical: canonicalTeam(game.home) || null,
      awayCanonical: canonicalTeam(game.away) || null,
    }));

    const meta: SlateDiagnostics = {
      requestedSlug: rawTeamParam,
      requestedTeamOriginal: teamRaw,
      requestedTeam: unsluggedTeam,
      normalizedTeam,
      provider: "cfbd",
      filter: {
        input: teamForFilter,
        normalized: filterNormalized,
        canonical: filterCanonical,
      },
      slate: {
        total: slate.length,
        regular: {
          count: regularResult.slate.length,
          status: regularResult.status,
          error: regularResult.error,
        },
        postseason: {
          count: postseasonResult.slate.length,
          status: postseasonResult.status,
          error: postseasonResult.error,
        },
      },
      matches: {
        count: games.length,
        sample: matchSample,
      },
    };

    if (debug) {
      meta.probes = {
        alabama: probeNames(slate, "alab"),
        ohio: probeNames(slate, "ohio"),
        canonicalizedRequested: {
          canonicalized: canonicalize(teamForFilter),
          canonical: filterCanonical,
        },
      };
    }

    if (!games.length) {
      if (cached && cached.length) {
        return NextResponse.json(
          { team: normalizedTeam, season, rows: cached, cached: true, meta },
          { headers: buildHeaders() },
        );
      }
      return NextResponse.json(
        { team: normalizedTeam, season, rows: [], meta },
        { headers: buildHeaders() },
      );
    }

    const canonicalNormalized = canonicalTeam(normalizedTeam);
    const latestCompleted = lastCompletedNflWeek();
    const nowMs = Date.now();

    let windows: ReturnType<typeof buildNflWeekWindows> | null = null;
    const windowLookup = new Map<string, { startISO: string; endISO: string; gameTypes: string[] }>();
    const mappingCache = new Map<number, { season: number; week: number }>();

    try {
      const schedule = await getNflSchedule(season);
      windows = buildNflWeekWindows(schedule);
      for (const window of windows) {
        const end = new Date(window.windowEndUTC);
        const start = new Date(end.getTime() - WEEK_MS);
        windowLookup.set(`${window.season}-${window.week}`, {
          startISO: start.toISOString(),
          endISO: end.toISOString(),
          gameTypes: window.gameTypes,
        });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[alumni] failed to load NFL schedule for mapping", error);
    }

    const mapWeek = (cfbWeek: number) => {
      if (!windows) return null;
      const cachedMapping = mappingCache.get(cfbWeek);
      if (cachedMapping) return cachedMapping;
      const weekGames = slate.filter(
        (candidate): candidate is CfbGame & { kickoffISO: string } =>
          candidate.seasonType === "regular" &&
          candidate.week === cfbWeek &&
          typeof candidate.kickoffISO === "string" &&
          candidate.kickoffISO.length > 0,
      );
      const mappedGames = weekGames.map((game) => ({ kickoffISO: game.kickoffISO }));
      const mapping = mapCfbWeekToSingleNflWeek(mappedGames, windows, cfbWeek, season - 1);
      mappingCache.set(cfbWeek, mapping);
      return mapping;
    };

    const contexts = games.map((game) => {
      const kickoff = game.kickoffISO ? new Date(game.kickoffISO) : new Date(Number.NaN);
      const estimate = estimateNflWeekForDate(game.season, kickoff, game.week);
      const isHome = canonicalTeam(game.home) === canonicalNormalized;
      const opponent = isHome ? game.away : game.home;
      const mapping = mapWeek(game.week);
      let nflSeason = mapping ? mapping.season : game.season;
      let nflWeek = mapping ? mapping.week : estimate.week;
      let nflWindowStart = estimate.startISO;
      let nflWindowEnd = estimate.endISO;
      let shouldFetch = false;

      if (mapping) {
        const windowKey = `${mapping.season}-${mapping.week}`;
        const window = windowLookup.get(windowKey);
        if (window) {
          nflWindowStart = window.startISO;
          nflWindowEnd = window.endISO;
          shouldFetch = new Date(window.endISO).getTime() <= nowMs;
        } else {
          shouldFetch =
            mapping.season < latestCompleted.season ||
            (mapping.season === latestCompleted.season && mapping.week <= latestCompleted.week);
        }
      }

      const rawWeek = estimate.rawWeek;
      if (!shouldFetch) {
        const withinRegularSeason = Number.isFinite(rawWeek)
          ? rawWeek >= 1 && rawWeek <= REGULAR_SEASON_WEEKS
          : false;
        const withinCompletedWindow =
          game.season < latestCompleted.season ||
          (game.season === latestCompleted.season && estimate.week <= latestCompleted.week);
        if (withinRegularSeason && withinCompletedWindow) {
          shouldFetch = true;
          nflSeason = game.season;
          nflWeek = estimate.week;
          nflWindowStart = estimate.startISO;
          nflWindowEnd = estimate.endISO;
        }
      }

      const statsKey = shouldFetch ? `${nflSeason}:${nflWeek}` : null;
      return {
        game,
        isHome,
        opponent,
        nflSeason,
        nflWeek,
        nflWindowStart,
        nflWindowEnd,
        rawWeek,
        shouldFetch,
        statsKey,
      };
    });

    if (cached && cached.length) {
      const cacheIndex = new Map<string, ResultRow>();
      for (const row of cached) {
        const signature = `${row.cfbWeek}:${row.homeAway}:${row.opponent}`;
        if (!cacheIndex.has(signature)) cacheIndex.set(signature, row);
      }
      const needsRefresh = contexts.some((ctx) => {
        if (!ctx.shouldFetch) return false;
        const signature = `${ctx.game.week}:${ctx.isHome ? "Home" : "Away"}:${ctx.opponent}`;
        const cachedRow = cacheIndex.get(signature);
        return !cachedRow || cachedRow.usPts === null || cachedRow.oppPts === null;
      });
      if (!needsRefresh) {
        return NextResponse.json(
          { team: normalizedTeam, season, rows: cached, cached: true, meta },
          { headers: buildHeaders() },
        );
      }
    }

    const rosterCache = new Map<number, Awaited<ReturnType<typeof getRosterWithColleges>>>();
    const weeklyRows = new Map<string, PlayerWeekly[]>();
    const targets = Array.from(new Set(contexts.map((ctx) => ctx.statsKey).filter(Boolean))) as string[];
    const pendingErrors: StatsNotAvailableError[] = [];

    for (const key of targets) {
      const [seasonPart, weekPart] = key.split(":");
      const targetSeason = Number.parseInt(seasonPart, 10);
      const targetWeek = Number.parseInt(weekPart, 10);
      try {
        const stats = await getWeeklyStats(targetSeason, targetWeek, "ppr");
        let roster = rosterCache.get(targetSeason);
        if (!roster) {
          roster = await getRosterWithColleges(targetSeason);
          rosterCache.set(targetSeason, roster);
        }
        const joined = await joinStatsToColleges(stats, roster);
        weeklyRows.set(key, joined.rows);
      } catch (error) {
        if (error instanceof StatsNotAvailableError) {
          pendingErrors.push(error);
          continue;
        }
        throw error;
      }
    }

    if (!weeklyRows.size && pendingErrors.length) {
      const pending = pendingErrors[0];
      const payload: PendingPayload = {
        status: "pending",
        message: "NFL weekly player stats not yet published",
        season: pending.season,
        week: pending.week,
      };
      return NextResponse.json(meta ? { ...payload, meta } : payload, {
        status: 202,
        headers: buildHeaders(),
      });
    }

    const rows: ResultRow[] = [];
    const completionFlags: boolean[] = [];

    for (const ctx of contexts) {
      const statsKey = ctx.statsKey;
      const weekRows = statsKey ? weeklyRows.get(statsKey) : undefined;
      let usPts: number | null = null;
      let oppPts: number | null = null;
      let result: ResultRow["result"] = null;

      if (weekRows && weekRows.length) {
        const totals = sumForMatchup(weekRows, ctx.game.home, ctx.game.away);
        const usRaw = ctx.isHome ? totals.home : totals.away;
        const oppRaw = ctx.isHome ? totals.away : totals.home;
        usPts = roundOne(usRaw);
        oppPts = roundOne(oppRaw);
        result = usPts === oppPts ? "T" : usPts > oppPts ? "W" : "L";
      }

      rows.push({
        cfbWeek: ctx.game.week,
        cfbDate: ctx.game.kickoffISO ? ctx.game.kickoffISO.slice(0, 10) : "",
        homeAway: ctx.isHome ? "Home" : "Away",
        opponent: ctx.opponent,
        usPts,
        oppPts,
        result,
        nflSeason: ctx.nflSeason,
        nflWeek: ctx.nflWeek,
        nflWindowStart: ctx.nflWindowStart,
        nflWindowEnd: ctx.nflWindowEnd,
      });
      completionFlags.push(usPts !== null && oppPts !== null);
    }

    rows.sort((a, b) => a.cfbWeek - b.cfbWeek || a.cfbDate.localeCompare(b.cfbDate));

    const shouldCache = contexts.every((ctx, index) => !ctx.shouldFetch || completionFlags[index]);
    if (shouldCache && rows.length) {
      await kvSet(cacheKey, rows, CACHE_TTL_SECONDS);
    }

    return NextResponse.json({ team: normalizedTeam, season, rows, cached: false, meta }, { headers: buildHeaders() });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[alumni] team results failed", error);
    return NextResponse.json({ error: "alumni_team_failed", message: String(error) }, { status: 500 });
  }
}
