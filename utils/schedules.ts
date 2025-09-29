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
  "miami": "miami fl",
  "miami fl": "miami fl",
  "miami fla": "miami fl",
  "miami hurricanes": "miami fl",
  "texas a and m": "texas a m",
  "texas a m": "texas a m",
  "texas am": "texas a m",
  "ole miss": "ole miss",
  "the ohio state": "ohio state",
  "ohio st": "ohio state",
  "ohio state buckeyes": "ohio state",
  "ohio st buckeyes": "ohio state",
  "alabama crimson tide": "alabama",
  "crimson tide": "alabama",
  "bama": "alabama",
  "alab": "alabama",
};

const STOP = new Set(["university", "the", "of", "and", "at", "state", "college"]);

function tokens(raw?: string) {
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  const inter = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return inter.size / (union.size || 1);
}

function fuzzySameSchool(a: string, b: string) {
  if (canonicalize(a) === canonicalize(b)) return true;
  const A = tokens(a);
  const B = tokens(b);
  if (A.size && B.size && jaccard(A, B) >= 0.6) return true;
  const sa = [...A].join(" ");
  const sb = [...B].join(" ");
  return sa.includes(sb) || sb.includes(sa);
}

export function canonicalize(raw?: string) {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(university|of|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  s = SYN[s] ?? s;
  const slug = s.replace(/[^a-z0-9]+/g, "");
  return slug;
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
    const slug = canonicalize(raw);
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
  const slug = canonicalize(cleaned);
  const override = DISPLAY_OVERRIDES[slug];
  if (override) return override;
  const base = normalizeSchoolBase(cleaned);
  return base || cleaned;
}

export function sameSchool(a?: string, b?: string) {
  return canonicalize(a) === canonicalize(b);
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

export function filterTeamGamesFromSlate(slate: CfbGame[], requestedTeam: string): CfbGame[] {
  const team = requestedTeam.trim();
  if (!team) return [];
  const hard = slate.filter(
    (game) =>
      fuzzySameSchool(game.home, team) || fuzzySameSchool(game.away, team),
  );
  if (hard.length) {
    const sorted = [...hard];
    sorted.sort(sortGames);
    return sorted;
  }

  const needle = team.toLowerCase();
  const fallbackMatches = slate.filter(
    (game) =>
      game.home.toLowerCase().includes(needle) || game.away.toLowerCase().includes(needle),
  );
  const sorted = [...fallbackMatches];
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
