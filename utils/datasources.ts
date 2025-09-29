import { fetchWeeklyPlayerStats, computeFantasyPoints, type NflversePlayerStat } from "@/lib/nflverse";
import {
  fetchRosterData,
  buildRosterCollegeLookup,
  resolveCollegeFromRoster,
  type RosterCollegeLookup,
} from "@/lib/roster";
import {
  loadPlayersMaster,
  buildCollegeMaps,
  resolveCollege as resolveCollegeFromMaster,
  buildPlayersLookup,
  resolvePlayerRow,
  collectPlayerRowIds,
  type PlayersMasterLookup,
  type PlayersMasterRow,
} from "@/lib/playersMaster";
import type { PlayerWeekly } from "./compute";

export type SeasonType = "regular" | "postseason";

export type CfbGame = {
  season: number;
  week: number;
  seasonType: SeasonType;
  home: string;
  away: string;
  kickoffISO: string;
  provider: "cfbd" | "espn";
};

export type WeeklyStatsRow = {
  player_id: string;
  alt_ids: string[];
  name: string;
  team: string;
  position?: string;
  points: number;
};

export type WeeklyStatsResult = {
  season: number;
  week: number;
  format: "ppr" | "half-ppr" | "standard";
  provider: "nflverse";
  rows: WeeklyStatsRow[];
};

export type RosterWithColleges = {
  season: number;
  source: string;
  rows: number;
  lookup: RosterCollegeLookup;
};

export type JoinedWeeklyResult = {
  rows: PlayerWeekly[];
  missing: WeeklyStatsRow[];
  matched: number;
};

export type NflScheduleGame = {
  season: number;
  week: number;
  gameType: string;
  kickoffISO: string;
  gameId?: string;
  homeTeam?: string;
  awayTeam?: string;
};

export type CfbWeekContext = {
  season: number;
  week: number;
  seasonType: SeasonType;
};

const CFBD_API_BASE = "https://api.collegefootballdata.com";
const ESPN_SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const NFL_SCHEDULE_BASE = "https://github.com/nflverse/nflverse-data/releases/download/schedules";

const parseProvider = (): "cfbd" | "espn" => {
  const raw = process.env.CFB_SCHEDULE_PROVIDER?.trim().toLowerCase();
  return raw === "espn" ? "espn" : "cfbd";
};

const cfbScheduleCache = new Map<string, CfbGame[]>();

const scheduleCacheKey = (season: number, week: number, seasonType: SeasonType, provider: string) =>
  `${provider}:${season}:${week}:${seasonType}`;

const MS_PER_MINUTE = 60 * 1000;

const parseIso = (value: string | undefined): Date | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDateParts = (value: string | undefined) => {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const parseTimeParts = (value: string | undefined) => {
  if (!value) return { hour: 18, minute: 0, second: 0 };
  const trimmed = value.trim();
  if (!trimmed || /tbd/i.test(trimmed)) return { hour: 18, minute: 0, second: 0 };
  const meridianMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/i);
  if (meridianMatch) {
    let hour = Number(meridianMatch[1]);
    const minute = Number(meridianMatch[2] ?? "0");
    const second = Number(meridianMatch[3] ?? "0");
    const meridian = meridianMatch[4]?.toUpperCase();
    if (meridian === "AM" && hour === 12) hour = 0;
    if (meridian === "PM" && hour < 12) hour += 12;
    return { hour, minute, second };
  }
  const parts = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (parts) {
    return { hour: Number(parts[1]), minute: Number(parts[2]), second: Number(parts[3] ?? "0") };
  }
  return { hour: 18, minute: 0, second: 0 };
};

const getZoneOffsetMinutes = (utcDate: Date, timeZone: string): number => {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(utcDate);
    const lookup: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") lookup[part.type] = part.value;
    }
    const zonedUtc = Date.UTC(
      Number(lookup.year),
      Number(lookup.month) - 1,
      Number(lookup.day),
      Number(lookup.hour),
      Number(lookup.minute),
      Number(lookup.second),
    );
    return Math.round((utcDate.getTime() - zonedUtc) / MS_PER_MINUTE);
  } catch {
    return 0;
  }
};

const combineDateAndTime = (date: string | undefined, time: string | undefined, zone: "utc" | "America/New_York"): Date | null => {
  const dateParts = parseDateParts(date);
  if (!dateParts) return null;
  const timeParts = parseTimeParts(time);
  const base = new Date(Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
  ));
  if (zone === "utc") return base;
  const offsetMinutes = getZoneOffsetMinutes(base, zone);
  return new Date(base.getTime() + offsetMinutes * MS_PER_MINUTE);
};

const toIso = (date: Date | null): string | null => {
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime()).toISOString();
};

const normalizeCfbdKickoff = (game: Record<string, unknown>, season: number): string => {
  const candidates: (string | undefined)[] = [
    typeof game.start_date === "string" ? game.start_date : undefined,
    typeof game.start_time === "string" ? game.start_time : undefined,
    typeof game.kickoff === "string" ? game.kickoff : undefined,
  ];
  for (const candidate of candidates) {
    const parsed = parseIso(candidate);
    if (parsed) {
      const iso = toIso(parsed);
      if (iso) return iso;
    }
  }
  const dateField = typeof game.start_date === "string" ? game.start_date.split("T")[0] : undefined;
  const timeField = typeof game.start_time === "string" ? game.start_time : undefined;
  const combined = combineDateAndTime(dateField, timeField, "America/New_York");
  const isoCombined = toIso(combined);
  if (isoCombined) return isoCombined;
  const fallback = new Date(Date.UTC(season, 8, 1, 18, 0, 0));
  return fallback.toISOString();
};

const normalizeEspnKickoff = (event: Record<string, unknown>): string => {
  const dateValue =
    typeof (event as { date?: unknown }).date === "string"
      ? (event as { date?: string }).date
      : typeof (event as { startDate?: unknown }).startDate === "string"
        ? (event as { startDate?: string }).startDate
        : undefined;
  const parsed = parseIso(dateValue);
  if (parsed) return parsed.toISOString();
  return new Date().toISOString();
};

const SCHOOL_SYNONYMS: Record<string, string> = {
  "miami": "Miami (FL)",
  "miami-fl": "Miami (FL)",
  "miami-fla": "Miami (FL)",
  "miami-oh": "Miami (OH)",
  "ohio-state-buckeyes": "Ohio State",
  "the-ohio-state": "Ohio State",
  "utsa": "UTSA",
  "uab": "UAB",
  "ucf": "UCF",
  "usc": "USC",
  "ole-miss": "Ole Miss",
  "pitt": "Pittsburgh",
  "pittsburgh": "Pittsburgh",
  "smu": "SMU",
  "tcu": "TCU",
  "texas-am": "Texas A&M",
  "texas-a-m": "Texas A&M",
  "appalachian-st": "Appalachian State",
  "appalachian-state": "Appalachian State",
  "louisiana-lafayette": "Louisiana",
  "louisiana": "Louisiana",
  "nevada-las-vegas": "UNLV",
  "unlv": "UNLV",
  "florida-intl": "FIU",
  "florida-international": "FIU",
  "florida-atlantic": "FAU",
  "fau": "FAU",
  "lsu": "LSU",
  "byu": "BYU",
  "alabama-crimson-tide": "Alabama",
  "st-johns": "St. John's",
  "saint-johns": "St. John's",
  "southern-cal": "USC",
  "southern-california": "USC",
  "utexas-san-antonio": "UTSA",
};

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const slugifySchool = (name: string): string => slug(name.trim());

export const normalizeSchool = (name: string): string => {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return trimmed;
  const key = slug(trimmed);
  return SCHOOL_SYNONYMS[key] ?? trimmed;
};

export class StatsNotAvailableError extends Error {
  code = "NOT_PUBLISHED" as const;
  season: number;
  week: number;

  constructor(season: number, week: number, message = "NFL stats not yet published") {
    super(message);
    this.season = season;
    this.week = week;
  }
}

const mapCfbdGame = (season: number, week: number, seasonType: SeasonType, provider: "cfbd" | "espn", game: Record<string, unknown>): CfbGame => ({
  season,
  week,
  seasonType,
  home: normalizeSchool(String((game as { home_team?: unknown }).home_team ?? (game as { home?: unknown }).home ?? "")),
  away: normalizeSchool(String((game as { away_team?: unknown }).away_team ?? (game as { away?: unknown }).away ?? "")),
  kickoffISO: normalizeCfbdKickoff(game, season),
  provider,
});

const mapEspnGame = (season: number, week: number, seasonType: SeasonType, event: Record<string, unknown>): CfbGame | null => {
  const competitions = Array.isArray((event as { competitions?: unknown }).competitions)
    ? ((event as { competitions?: unknown }).competitions as unknown[])
    : [];
  const competition = (competitions[0] ?? null) as Record<string, unknown> | null;
  if (!competition) return null;
  const competitors = Array.isArray((competition as { competitors?: unknown }).competitors)
    ? ((competition as { competitors?: unknown }).competitors as Record<string, unknown>[])
    : [];
  const home = competitors.find((entry) => String((entry as { homeAway?: unknown }).homeAway ?? "").toLowerCase() === "home");
  const away = competitors.find((entry) => String((entry as { homeAway?: unknown }).homeAway ?? "").toLowerCase() === "away");
  if (!home || !away) return null;
  const homeName = String((home as { team?: { displayName?: unknown; location?: unknown; name?: unknown } }).team?.displayName
    ?? (home as { team?: { location?: unknown } }).team?.location
    ?? (home as { team?: { name?: unknown } }).team?.name
    ?? "");
  const awayName = String((away as { team?: { displayName?: unknown; location?: unknown; name?: unknown } }).team?.displayName
    ?? (away as { team?: { location?: unknown } }).team?.location
    ?? (away as { team?: { name?: unknown } }).team?.name
    ?? "");
  if (!homeName || !awayName) return null;
  const kickoffISO = normalizeEspnKickoff(competition ?? event);
  return {
    season,
    week,
    seasonType,
    home: normalizeSchool(homeName),
    away: normalizeSchool(awayName),
    kickoffISO,
    provider: "espn",
  };
};

async function getCfbWeekGamesFromCfbd(season: number, week: number, seasonType: SeasonType): Promise<CfbGame[]> {
  const apiKey = process.env.CFBD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing CFBD_API_KEY environment variable");
  }
  const params = new URLSearchParams({ year: String(season), week: String(week), seasonType });
  const url = `${CFBD_API_BASE}/games?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CFBD schedule fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>[];
  return data.map((game) => mapCfbdGame(season, week, seasonType, "cfbd", game));
}

async function getCfbWeekGamesFromEspn(season: number, week: number, seasonType: SeasonType): Promise<CfbGame[]> {
  const seasontypeParam = seasonType === "postseason" ? "3" : "2";
  const params = new URLSearchParams({
    week: String(week),
    seasontype: seasontypeParam,
    groups: "80",
    limit: "400",
    year: String(season),
  });
  const url = `${ESPN_SCOREBOARD_BASE}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ESPN schedule fetch failed: ${res.status}`);
  }
  const payload = (await res.json()) as Record<string, unknown>;
  const events = Array.isArray(payload.events) ? (payload.events as Record<string, unknown>[]) : [];
  const games: CfbGame[] = [];
  for (const event of events) {
    const mapped = mapEspnGame(season, week, seasonType, event);
    if (mapped) games.push(mapped);
  }
  return games;
}

export async function getCfbWeekGames(
  season: number,
  week: number,
  seasonType: SeasonType = "regular",
): Promise<CfbGame[]> {
  const provider = parseProvider();
  const cacheKey = scheduleCacheKey(season, week, seasonType, provider);
  if (cfbScheduleCache.has(cacheKey)) {
    return cfbScheduleCache.get(cacheKey)!.map((game) => ({ ...game }));
  }
  const games = provider === "espn"
    ? await getCfbWeekGamesFromEspn(season, week, seasonType)
    : await getCfbWeekGamesFromCfbd(season, week, seasonType);
  cfbScheduleCache.set(cacheKey, games);
  return games.map((game) => ({ ...game }));
}

const playersMasterCache: {
  rows: PlayersMasterRow[] | null;
  lookup: PlayersMasterLookup | null;
  colleges: ReturnType<typeof buildCollegeMaps> | null;
} = {
  rows: null,
  lookup: null,
  colleges: null,
};

const ensurePlayersMaster = async () => {
  if (playersMasterCache.rows && playersMasterCache.lookup && playersMasterCache.colleges) {
    return {
      rows: playersMasterCache.rows,
      lookup: playersMasterCache.lookup,
      colleges: playersMasterCache.colleges,
    };
  }
  const rows = await loadPlayersMaster();
  const lookup = buildPlayersLookup(rows);
  const colleges = buildCollegeMaps(rows);
  playersMasterCache.rows = rows;
  playersMasterCache.lookup = lookup;
  playersMasterCache.colleges = colleges;
  return { rows, lookup, colleges };
};

const mapStatRow = (stat: NflversePlayerStat, format: "ppr" | "half-ppr" | "standard"): WeeklyStatsRow => ({
  player_id: stat.player_id,
  alt_ids: Array.isArray(stat.alt_ids) ? stat.alt_ids : [],
  name: String(stat.name ?? "Unknown"),
  team: String(stat.team ?? ""),
  position: stat.position ? String(stat.position).toUpperCase() : undefined,
  points: computeFantasyPoints(stat, format),
});

export async function getWeeklyStats(
  season: number,
  week: number,
  format: "ppr" | "half-ppr" | "standard" = "ppr",
): Promise<WeeklyStatsResult> {
  const stats = await fetchWeeklyPlayerStats(season, week);
  if (!stats.length) {
    throw new StatsNotAvailableError(season, week);
  }
  return {
    season,
    week,
    format,
    provider: "nflverse",
    rows: stats.map((stat) => mapStatRow(stat, format)),
  };
}

export async function getRosterWithColleges(season: number): Promise<RosterWithColleges> {
  const roster = await fetchRosterData({ season, joinPlayers: true });
  const lookup = buildRosterCollegeLookup(roster.rows);
  return {
    season,
    source: roster.source,
    rows: roster.rows.length,
    lookup,
  };
}

const resolveCollege = (
  stat: WeeklyStatsRow,
  roster: RosterCollegeLookup,
  master: { lookup: PlayersMasterLookup; colleges: ReturnType<typeof buildCollegeMaps> },
): string | undefined => {
  const rosterCollege = resolveCollegeFromRoster(
    {
      player_id: stat.player_id,
      alt_ids: stat.alt_ids,
      player_name: stat.name,
      team: stat.team,
    },
    roster,
  );
  if (rosterCollege && rosterCollege.trim()) {
    return rosterCollege;
  }
  const playerRow = resolvePlayerRow(
    { player_id: stat.player_id, alt_ids: stat.alt_ids, player_name: stat.name, team: stat.team },
    master.lookup,
  );
  if (playerRow) {
    for (const id of collectPlayerRowIds(playerRow)) {
      const byId = master.colleges.byId.get(id);
      if (byId) return byId;
    }
    const college =
      (typeof playerRow.college_name === "string" && playerRow.college_name.trim())
        ? playerRow.college_name
        : typeof playerRow.college === "string" && playerRow.college.trim()
          ? playerRow.college
          : undefined;
    if (college) return college;
  }
  const resolved = resolveCollegeFromMaster(
    { player_id: stat.player_id, player_name: stat.name, team: stat.team },
    master.colleges,
  );
  return resolved && resolved !== "Unknown" ? resolved : undefined;
};

export async function joinStatsToColleges(
  stats: WeeklyStatsResult,
  roster: RosterWithColleges,
): Promise<JoinedWeeklyResult> {
  const master = await ensurePlayersMaster();
  const rows: PlayerWeekly[] = [];
  const missing: WeeklyStatsRow[] = [];
  for (const stat of stats.rows) {
    const college = resolveCollege(stat, roster.lookup, master);
    const normalized = college ? normalizeSchool(college) : undefined;
    if (!normalized) {
      missing.push(stat);
    }
    rows.push({
      player_id: stat.player_id,
      points: stat.points,
      college: normalized,
      name: stat.name,
      team: stat.team,
      sourceWeek: stats.week,
    });
  }
  return { rows, missing, matched: rows.length - missing.length };
}

const nflScheduleCache = new Map<number, NflScheduleGame[]>();

const parseCsv = (text: string): Record<string, string>[] => {
  const rows: string[][] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let current: string[] = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === "\"") {
        if (normalized[i + 1] === "\"") {
          value += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      current.push(value);
      value = "";
    } else if (char === "\n") {
      current.push(value);
      rows.push(current);
      current = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value.length > 0 || current.length > 0) {
    current.push(value);
    rows.push(current);
  }
  if (!rows.length) return [];
  const headers = (rows.shift() ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows
    .filter((row) => row.some((cell) => cell && cell.trim().length))
    .map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i += 1) {
        const key = headers[i];
        if (!key) continue;
        obj[key] = (row[i] ?? "").trim();
      }
      return obj;
    });
};

const parseNflKickoff = (row: Record<string, string>, season: number): string => {
  const isoCandidates = [
    row.start_time,
    row.start_time_utc,
    row.game_datetime,
    row.gamedatetime,
    row.gametime,
    row.kickoff,
  ];
  for (const candidate of isoCandidates) {
    const parsed = parseIso(candidate);
    if (parsed) return parsed.toISOString();
  }
  const combined = combineDateAndTime(row.gamedate, row.gametime, "America/New_York");
  const isoCombined = toIso(combined);
  if (isoCombined) return isoCombined;
  const fallback = new Date(Date.UTC(season, 8, 1, 17, 0, 0));
  return fallback.toISOString();
};

const GAME_TYPE_WHITELIST = new Set([
  "REG",
  "REGULAR",
  "regular",
  "POST",
  "POSTSEASON",
  "postseason",
  "WC",
  "DIV",
  "CONF",
  "CON",
  "SB",
]);

export async function getNflSchedule(season: number): Promise<NflScheduleGame[]> {
  if (nflScheduleCache.has(season)) {
    return nflScheduleCache.get(season)!.map((game) => ({ ...game }));
  }
  const url = `${NFL_SCHEDULE_BASE}/sched_${season}.csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`NFL schedule fetch failed: ${res.status}`);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  const games: NflScheduleGame[] = [];
  for (const row of rows) {
    const gameType = row.game_type || row.gameType || row.game_type2 || row.season_type || "";
    if (gameType && !GAME_TYPE_WHITELIST.has(gameType)) continue;
    const weekValue = Number(row.week || row.game_week || row.week_number || row.weeknum);
    if (!Number.isFinite(weekValue)) continue;
    const kickoffISO = parseNflKickoff(row, season);
    games.push({
      season,
      week: weekValue,
      gameType: gameType || "REG",
      kickoffISO,
      gameId: row.game_id || row.gsis_id || row.gsid,
      homeTeam: row.home_team || row.home || row.home_team_abbr,
      awayTeam: row.away_team || row.away || row.away_team_abbr,
    });
  }
  games.sort((a, b) => a.week - b.week || a.kickoffISO.localeCompare(b.kickoffISO));
  nflScheduleCache.set(season, games);
  return games.map((game) => ({ ...game }));
}

const guessCfbSeason = (now: Date): number => {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
};

export async function detectTargetCfbWeek(now: Date = new Date()): Promise<CfbWeekContext> {
  const season = guessCfbSeason(now);
  let fallbackWeek = 1;
  let fallbackType: SeasonType = "regular";
  let consecutiveEmpty = 0;
  for (let week = 1; week <= 20; week += 1) {
    let games = await getCfbWeekGames(season, week, "regular");
    let seasonType: SeasonType = "regular";
    if (!games.length) {
      games = await getCfbWeekGames(season, week, "postseason");
      if (games.length) seasonType = "postseason";
    }
    if (!games.length) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3 && week > 4) break;
      continue;
    }
    consecutiveEmpty = 0;
    const sorted = games.slice().sort((a, b) => a.kickoffISO.localeCompare(b.kickoffISO));
    const earliest = new Date(sorted[0].kickoffISO);
    if (now.getTime() < earliest.getTime()) {
      return { season, week, seasonType };
    }
    fallbackWeek = week;
    fallbackType = seasonType;
  }
  return { season, week: fallbackWeek, seasonType: fallbackType };
}
