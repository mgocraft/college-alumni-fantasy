import { kvGet, kvSet } from "@/lib/kv";
import { canonicalTeam, normalizeSchool } from "./schoolNames";

export type SeasonType = "regular" | "postseason";

export type CfbGame = {
  season: number;
  week: number;
  seasonType: SeasonType;
  home: string;
  away: string;
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

const mapGame = (season: number, seasonType: SeasonType, raw: Record<string, unknown>): CfbGame | null => {
  const week = Number((raw as { week?: unknown }).week ?? 0);
  const homeRaw = String(
    (raw as { home_team?: unknown }).home_team ?? (raw as { home?: unknown }).home ?? "",
  ).trim();
  const awayRaw = String(
    (raw as { away_team?: unknown }).away_team ?? (raw as { away?: unknown }).away ?? "",
  ).trim();
  if (!homeRaw || !awayRaw) return null;

  const kickoffCandidate =
    (raw as { start_date?: unknown }).start_date
      ? String((raw as { start_date?: unknown }).start_date)
      : (raw as { start_time?: unknown }).start_time
        ? String((raw as { start_time?: unknown }).start_time)
        : (raw as { kickoff?: unknown }).kickoff
          ? String((raw as { kickoff?: unknown }).kickoff)
          : null;

  return {
    season,
    week,
    seasonType,
    home: normalizeSchool(homeRaw),
    away: normalizeSchool(awayRaw),
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
      const mapped = mapGame(season, seasonType, game as Record<string, unknown>);
      if (!mapped) continue;
      if (!canonicalTeam(mapped.home) || !canonicalTeam(mapped.away)) continue;
      slate.push(mapped);
    }
  }

  if (slate.length) {
    const sorted = [...slate];
    sorted.sort(sortGames);
    await kvSet(cacheKey, sorted, CACHE_TTL_SECONDS);
  }

  return { slate, provider: "cfbd" };
}
