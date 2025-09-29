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
  // high-risk aliases
  "Ohio State": "Ohio State",
  "Ohio St": "Ohio State",
  "Ohio St.": "Ohio State",
  "The Ohio State": "Ohio State",
  "Ohio State Buckeyes": "Ohio State",
  // keep your other mappings
  "Miami": "Miami (FL)",
  "Texas A&M": "Texas A&M",
  "Ole Miss": "Ole Miss",
};

export function normalizeSchool(n?: string) {
  if (!n) return "";
  const x = n.replace(/\u2013|\u2014/g, "-").replace(/\s+/g, " ").trim();
  const mapped = SYN[x] ?? x;
  return normalizeSchoolBase(mapped);
}

function eqLoose(a: string, b: string) {
  const A = normalizeSchool(a).toLowerCase();
  const B = normalizeSchool(b).toLowerCase();
  if (A === B) return true;
  // extra tolerance: “ohio st” vs “ohio state”
  return A.replace(/\bst\b/g, "state") === B.replace(/\bst\b/g, "state");
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

const parseIsoCandidate = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const combineDateAndTime = (dateValue: unknown, timeValue: unknown): string | null => {
  if (typeof dateValue !== "string") return null;
  const date = dateValue.trim();
  if (!date) return null;
  if (typeof timeValue !== "string" || !timeValue.trim()) {
    return parseIsoCandidate(date);
  }
  const candidate = `${date}T${timeValue.trim()}`;
  return parseIsoCandidate(candidate);
};

const mapTeamGame = (season: number, seasonType: SeasonType, raw: RawCfbGame): CfbGame => {
  const week = Number(raw.week ?? 0);
  const home = normalizeSchool(String(raw.home_team ?? raw.home ?? ""));
  const away = normalizeSchool(String(raw.away_team ?? raw.away ?? ""));
  const kickoffISO =
    parseIsoCandidate(raw.start_date)
    || parseIsoCandidate(raw.start_time)
    || parseIsoCandidate(raw.kickoff)
    || combineDateAndTime(raw.start_date, raw.start_time);
  return {
    season,
    week,
    seasonType,
    home,
    away,
    kickoffISO,
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
  return payload.map((game) => mapTeamGame(season, seasonType, game));
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

export function filterTeamGames(slate: CfbGame[], rawTeam: string): CfbGame[] {
  const team = normalizeSchool(rawTeam);
  if (!team) return [];
  // 1) strict normalized match
  let out = slate.filter((game) => eqLoose(game.home, team) || eqLoose(game.away, team));
  if (out.length) {
    const sorted = [...out];
    sorted.sort(sortGames);
    return sorted;
  }
  // 2) fallback: substring fuzzy (case-insensitive) to catch odd labels
  const needle = team.toLowerCase();
  out = slate.filter(
    (game) => game.home.toLowerCase().includes(needle) || game.away.toLowerCase().includes(needle),
  );
  const sorted = [...out];
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
      const matches = filterTeamGames(slate, normalizedTeam);
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
