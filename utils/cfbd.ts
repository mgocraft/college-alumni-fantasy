import { kvGet, kvSet } from "@/lib/kv";
import { canonicalTeam, normalizeSchool } from "./schoolNames";

export type SeasonType = "regular" | "postseason";

export type CfbGame = {
  id: number | null;
  season: number;
  week: number;
  seasonType: SeasonType;
  home: string;
  away: string;
  homePoints: number | null;
  awayPoints: number | null;
  venue: string | null;
  neutralSite: boolean | null;
  conferenceGame: boolean | null;
  startTimeTBD: boolean | null;
  excitementIndex: number | null;
  highlights: string | null;
  notes: string | null;
  kickoffISO: string | null;
};

const CFBD_API_BASE = "https://api.collegefootballdata.com";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

const sortGames = (a: CfbGame, b: CfbGame) => {
  if (a.week !== b.week) return a.week - b.week;
  if (a.kickoffISO && b.kickoffISO) return a.kickoffISO.localeCompare(b.kickoffISO);
  if (a.kickoffISO) return -1;
  if (b.kickoffISO) return 1;
  return 0;
};

const toIsoOrNull = (value?: string | null): string | null => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.valueOf())) return null;
  return dt.toISOString();
};

const mapGame = (
  season: number,
  seasonType: SeasonType,
  raw: Record<string, unknown>,
  debug = false,
): CfbGame | null => {
  const g = raw as {
    id?: number;
    season?: number;
    week?: number;
    seasonType?: string;
    startDate?: string;
    startTime?: string;
    startTimeTBD?: boolean;
    neutralSite?: boolean;
    conferenceGame?: boolean;
    attendance?: number;
    venueId?: number;
    venue?: string;
    homeTeam?: string;
    homePoints?: number;
    homePostgameWinProbability?: number;
    homePregameElo?: number;
    homePostgameElo?: number;
    homeLineScores?: number[];
    awayTeam?: string;
    awayPoints?: number;
    awayPostgameWinProbability?: number;
    awayPregameElo?: number;
    awayPostgameElo?: number;
    awayLineScores?: number[];
    excitementIndex?: number;
    highlights?: string;
    notes?: string;
  };

  const week = Number(g.week ?? (raw as { week?: unknown }).week ?? 0);
  const homeRaw = String(
    g.homeTeam ??
      (raw as { home_team?: unknown }).home_team ??
      (raw as { home?: unknown }).home ??
      "",
  ).trim();
  const awayRaw = String(
    g.awayTeam ??
      (raw as { away_team?: unknown }).away_team ??
      (raw as { away?: unknown }).away ??
      "",
  ).trim();
  if (!homeRaw || !awayRaw) return null;

  const homeNormalized = normalizeSchool(homeRaw);
  const awayNormalized = normalizeSchool(awayRaw);
  const homeCanonical = canonicalTeam(homeNormalized);
  const awayCanonical = canonicalTeam(awayNormalized);

  if (debug) {
    // eslint-disable-next-line no-console
    console.debug("[cfbd] mapGame normalization", {
      season,
      seasonType,
      week,
      homeRaw,
      awayRaw,
      homeNormalized,
      awayNormalized,
      homeCanonical,
      awayCanonical,
    });
  }

  const kickoffCandidate =
    (typeof g.startDate === "string" && g.startDate.trim().length)
      ? g.startDate
      : (raw as { start_date?: unknown }).start_date
          ? String((raw as { start_date?: unknown }).start_date)
          : (typeof g.startTime === "string" && g.startTime.trim().length)
              ? g.startTime
              : (raw as { start_time?: unknown }).start_time
                  ? String((raw as { start_time?: unknown }).start_time)
                  : (raw as { kickoff?: unknown }).kickoff
                      ? String((raw as { kickoff?: unknown }).kickoff)
                      : null;

  return {
    id: typeof g.id === "number" ? g.id : null,
    season,
    week,
    seasonType,
    home: homeNormalized,
    away: awayNormalized,
    homePoints: typeof g.homePoints === "number" ? g.homePoints : null,
    awayPoints: typeof g.awayPoints === "number" ? g.awayPoints : null,
    venue: typeof g.venue === "string" ? g.venue : null,
    neutralSite: typeof g.neutralSite === "boolean" ? g.neutralSite : null,
    conferenceGame: typeof g.conferenceGame === "boolean" ? g.conferenceGame : null,
    startTimeTBD: typeof g.startTimeTBD === "boolean" ? g.startTimeTBD : null,
    excitementIndex: typeof g.excitementIndex === "number" ? g.excitementIndex : null,
    highlights: typeof g.highlights === "string" ? g.highlights : null,
    notes: typeof g.notes === "string" ? g.notes : null,
    kickoffISO: toIsoOrNull(kickoffCandidate),
  };
};

const buildCacheKey = (season: number, seasonType: SeasonType) => `cfb:slate:${season}:${seasonType}`;

export async function getCfbSeasonSlate(
  season: number,
  seasonTypeOrDebug: SeasonType | boolean = "regular",
  maybeDebug = false,
): Promise<{ slate: CfbGame[]; provider: "cfbd"; error?: string; status?: number }> {
  const seasonType = typeof seasonTypeOrDebug === "boolean" ? "regular" : seasonTypeOrDebug;
  const debug = typeof seasonTypeOrDebug === "boolean" ? seasonTypeOrDebug : maybeDebug;

  const cacheKey = buildCacheKey(season, seasonType);
  const cached = await kvGet<CfbGame[]>(cacheKey);
  if (cached?.length) {
    const copy = [...cached];
    copy.sort(sortGames);
    if (debug) {
      // eslint-disable-next-line no-console
      console.log("[cfbd] slate summary", {
        season,
        seasonType,
        slateLength: copy.length,
        status: "cache",
        error: undefined,
      });
    }
    return { slate: copy, provider: "cfbd" };
  }

  const apiKey = process.env.CFBD_API_KEY?.trim();
  if (!apiKey) {
    const error = "Missing CFBD_API_KEY";
    if (debug) {
      // eslint-disable-next-line no-console
      console.error("CFBD slate fetch skipped", { season, seasonType, error });
    }
    return { slate: [], provider: "cfbd", error };
  }

  const params = new URLSearchParams({ year: String(season), seasonType });
  const url = `${CFBD_API_BASE}/games?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  const status = res.status;

  let sampleBody: unknown = null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    sampleBody = text.slice(0, 200);
    if (debug) {
      // eslint-disable-next-line no-console
      console.error("CFBD slate fetch failed", { season, seasonType, status, sampleBody });
      // eslint-disable-next-line no-console
      console.log("[cfbd] slate summary", {
        season,
        seasonType,
        slateLength: 0,
        status,
        error: `CFBD ${status}: ${sampleBody}`,
      });
    }
    return { slate: [], provider: "cfbd", error: `CFBD ${status}: ${sampleBody}`, status };
  }

  const raw = (await res.json().catch(() => [])) as unknown;
  if (debug) {
    sampleBody = Array.isArray(raw) ? raw.slice(0, 2) : raw;
    // eslint-disable-next-line no-console
    console.log("CFBD slate fetch", {
      season,
      seasonType,
      status,
      sample: Array.isArray(sampleBody) ? sampleBody : [sampleBody],
    });
  }

  const slate: CfbGame[] = [];
  if (Array.isArray(raw)) {
    for (const game of raw) {
      const mapped = mapGame(season, seasonType, game as Record<string, unknown>, debug);
      if (!mapped) continue;
      const mappedHomeCanonical = canonicalTeam(mapped.home);
      const mappedAwayCanonical = canonicalTeam(mapped.away);
      if (!mappedHomeCanonical || !mappedAwayCanonical) {
        if (debug) {
          // eslint-disable-next-line no-console
          console.warn("[cfbd] skipped game lacking canonical mapping", {
            season,
            seasonType,
            week: mapped.week,
            home: mapped.home,
            away: mapped.away,
            mappedHomeCanonical,
            mappedAwayCanonical,
          });
        }
        continue;
      }
      slate.push(mapped);
    }
  }

  if (slate.length) {
    const sorted = [...slate];
    sorted.sort(sortGames);
    await kvSet(cacheKey, sorted, CACHE_TTL_SECONDS);
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log("[cfbd] slate summary", {
      season,
      seasonType,
      slateLength: slate.length,
      status,
      error: undefined,
    });
  }

  return { slate, provider: "cfbd", status };
}
