import { normalizeSchool } from "./datasources";

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

const fetchTeamGames = async (season: number, team: string, seasonType: SeasonType): Promise<CfbGame[]> => {
  const apiKey = process.env.CFBD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing CFBD_API_KEY environment variable");
  }
  const params = new URLSearchParams({
    year: String(season),
    team,
    seasonType,
  });
  const res = await fetch(`${CFBD_API_BASE}/games?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CFBD team schedule fetch failed: ${res.status}`);
  }
  const payload = (await res.json()) as RawCfbGame[];
  return payload.map((game) => mapTeamGame(season, seasonType, game));
};

export async function getCfbTeamSeasonGames(season: number, team: string): Promise<CfbGame[]> {
  const normalizedTeam = normalizeSchool(team);
  const seasonTypes: SeasonType[] = ["regular", "postseason"];
  const games: CfbGame[] = [];
  for (const seasonType of seasonTypes) {
    try {
      const fetched = await fetchTeamGames(season, normalizedTeam, seasonType);
      for (const game of fetched) {
        if (game.home === normalizedTeam || game.away === normalizedTeam) {
          games.push(game);
        }
      }
    } catch (error) {
      if (seasonType === "regular") throw error;
      // eslint-disable-next-line no-console
      console.warn(`Failed to load ${seasonType} games for ${team}:`, error);
    }
  }
  games.sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week;
    if (a.kickoffISO && b.kickoffISO) return a.kickoffISO.localeCompare(b.kickoffISO);
    if (a.kickoffISO) return -1;
    if (b.kickoffISO) return 1;
    return 0;
  });
  return games;
}
