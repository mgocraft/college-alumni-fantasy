import { DateTime } from "luxon";
import { kvGet, kvSet } from "@/lib/kv";
import { normalizeSchool as normalizeSchoolBase } from "./datasources";

export type CfbGame = {
  season: number;
  week: number;
  seasonType: "regular" | "postseason";
  home: string;
  away: string;
  kickoffISO: string | null;
};

const CFBD_API_BASE = "https://api.collegefootballdata.com";

type SeasonType = "regular" | "postseason";

const SEASON_SLATE_CACHE_TTL_SECONDS = 60 * 60 * 24;

const buildSlateCacheKey = (season: number, seasonType: SeasonType) =>
  `cfbd:slate:${season}:${seasonType}`;

const SYN: Record<string, string> = {
  "miami": "miami (fl)",
  "miami fl": "miami (fl)",
  "miami fla": "miami (fl)",
  "miami hurricanes": "miami (fl)",
  "texas a and m": "texas a&m",
  "texas a m": "texas a&m",
  "texas am": "texas a&m",
  "ole miss": "ole miss",
  "the ohio state": "ohio state",
  "ohio st": "ohio state",
  "ohio st.": "ohio state",
  "ohio state buckeyes": "ohio state",
  "ohio st buckeyes": "ohio state",
  "alabama crimson tide": "alabama",
  "crimson tide": "alabama",
  "bama": "alabama",
  "alab": "alabama",
};

export function canonicalTeam(raw?: string) {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(university|the|of|at)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  s = SYN[s] ?? s;

  return s;
}

const canonicalSlug = (raw?: string) => canonicalTeam(raw).replace(/[^a-z0-9]+/g, "");

export function canonicalize(raw?: string) {
  if (!raw) return "";
  return canonicalSlug(raw);
}

const DISPLAY_OVERRIDES: Record<string, string> = (() => {
  const entries: Array<[string, string]> = [
    ["Miami", "Miami (FL)"],
    ["Miami (FL)", "Miami (FL)"],
    ["Texas A&M", "Texas A&M"],
    ["Texas A and M", "Texas A&M"],
    ["Ole Miss", "Ole Miss"],
    ["Ohio State", "Ohio State"],
    ["Ohio St", "Ohio State"],
    ["Ohio St.", "Ohio State"],
    ["The Ohio State", "Ohio State"],
    ["Ohio State Buckeyes", "Ohio State"],
    ["Alabama", "Alabama"],
    ["Alabama Crimson Tide", "Alabama"],
    ["Crimson Tide", "Alabama"],
    ["Alab", "Alabama"],
  ];
  return entries.reduce<Record<string, string>>((acc, [raw, value]) => {
    const slug = canonicalSlug(raw);
    if (slug) acc[slug] = value;
    return acc;
  }, {});
})();

export function normalizeSchool(n?: string) {
  if (!n) return "";
  const cleaned = n
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const slug = canonicalSlug(cleaned);
  const override = DISPLAY_OVERRIDES[slug];
  if (override) return override;
  const base = normalizeSchoolBase(cleaned);
  return base || cleaned;
}

export function sameSchool(a?: string, b?: string) {
  return canonicalTeam(a) === canonicalTeam(b);
}

type RawCfbGame = {
  week?: number;
  home_team?: string;
  home?: string;
  away_team?: string;
  away?: string;
  start_date?: string;
  start_time?: string;
  kickoff?: string;
};

const toIsoOrNull = (value?: string | null): string | null => {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: "utc" });
  return dt.isValid ? dt.toISO() : null;
};

const mapTeamGame = (season: number, seasonType: SeasonType, raw: RawCfbGame): CfbGame | null => {
  const week = Number(raw.week ?? 0);
  const homeRaw = typeof raw.home_team === "string" && raw.home_team.trim()
    ? raw.home_team.trim()
    : typeof raw.home === "string"
      ? raw.home.trim()
      : "";
  const awayRaw = typeof raw.away_team === "string" && raw.away_team.trim()
    ? raw.away_team.trim()
    : typeof raw.away === "string"
      ? raw.away.trim()
      : "";
  if (!homeRaw || !awayRaw) return null;

  const kickoffCandidate =
    (typeof raw.start_date === "string" && raw.start_date.trim() ? raw.start_date.trim() : null)
    ?? (typeof raw.start_time === "string" && raw.start_time.trim() ? raw.start_time.trim() : null)
    ?? (typeof raw.kickoff === "string" && raw.kickoff.trim() ? raw.kickoff.trim() : null)
    ?? null;

  return {
    season,
    week,
    seasonType,
    home: normalizeSchool(homeRaw),
    away: normalizeSchool(awayRaw),
    kickoffISO: toIsoOrNull(kickoffCandidate),
  };
};

const sortGames = (a: CfbGame, b: CfbGame) => {
  if (a.week !== b.week) return a.week - b.week;
  if (a.kickoffISO && b.kickoffISO) return a.kickoffISO.localeCompare(b.kickoffISO);
  if (a.kickoffISO) return -1;
  if (b.kickoffISO) return 1;
  return 0;
};

const fetchSeasonSlate = async (season: number, seasonType: SeasonType): Promise<CfbGame[]> => {
  const apiKey = process.env.CFBD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing CFBD_API_KEY environment variable");
  }
  const params = new URLSearchParams({
    year: String(season),
    seasonType,
  });
  const res = await fetch(`${CFBD_API_BASE}/games?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CFBD season slate fetch failed: ${res.status}`);
  }
  const payload = (await res.json()) as RawCfbGame[];
  const rows: CfbGame[] = [];
  for (const game of payload) {
    const mapped = mapTeamGame(season, seasonType, game);
    if (!mapped) continue;
    rows.push(mapped);
  }
  const bad = rows.filter((game) => !game.home || !game.away);
  if (bad.length) {
    // eslint-disable-next-line no-console
    console.warn("CFB slate had blank teams:", bad.length);
  }
  return rows;
};

export async function getCfbSeasonSlate(
  season: number,
  seasonType: SeasonType = "regular",
): Promise<CfbGame[]> {
  const cacheKey = buildSlateCacheKey(season, seasonType);
  const cached = await kvGet<CfbGame[]>(cacheKey);
  if (cached) {
    if (!Array.isArray(cached)) return [];
    const copy = [...cached];
    copy.sort(sortGames);
    return copy;
  }

  const fetched = await fetchSeasonSlate(season, seasonType);
  const sorted = [...fetched];
  sorted.sort(sortGames);
  await kvSet(cacheKey, sorted, SEASON_SLATE_CACHE_TTL_SECONDS);
  return sorted;
}

export function filterTeamGamesFromSlate(slate: CfbGame[], requestedTeam: string): CfbGame[] {
  const team = requestedTeam.trim();
  if (!team) return [];
  const canonical = canonicalTeam(team);
  if (!canonical) return [];

  const strictMatches = slate.filter((game) => {
    if (!game.home || !game.away) return false;
    return canonicalTeam(game.home) === canonical || canonicalTeam(game.away) === canonical;
  });
  if (strictMatches.length) {
    const sorted = [...strictMatches];
    sorted.sort(sortGames);
    return sorted;
  }

  const fallback = slate.filter((game) => {
    if (!game.home || !game.away) return false;
    const home = canonicalTeam(game.home);
    const away = canonicalTeam(game.away);
    if (!home || !away) return false;
    return home.includes(canonical) || away.includes(canonical);
  });
  const sorted = [...fallback];
  sorted.sort(sortGames);
  return sorted;
}

export async function getCfbTeamSeasonGames(season: number, team: string): Promise<CfbGame[]> {
  const normalizedTeam = normalizeSchool(team);
  const seasonTypes: SeasonType[] = ["regular", "postseason"];
  const games: CfbGame[] = [];
  for (const seasonType of seasonTypes) {
    try {
      const slate = await getCfbSeasonSlate(season, seasonType);
      const matches = filterTeamGamesFromSlate(slate, normalizedTeam);
      for (const game of matches) {
        games.push(game);
      }
    } catch (error) {
      if (seasonType === "regular") throw error;
      // eslint-disable-next-line no-console
      console.warn(`Failed to load ${seasonType} games for ${team}:`, error);
    }
  }
  games.sort(sortGames);
  return games;
}
