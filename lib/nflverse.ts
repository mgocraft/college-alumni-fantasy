import { promises as fs } from "fs";
import path from "path";
import { HttpError } from "./api";
import { fetchWithRetry } from "./http";
import { normalize } from "./utils";
import type { Leader } from "./types";

const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const DEFAULT_USER_AGENT = "college-alumni-fantasy/1.0 (+https://github.com/)";
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS ?? 3600);
const CACHE_MS = CACHE_SECONDS > 0 ? CACHE_SECONDS * 1000 : 0;
const CACHE_ROOT = process.env.NFLVERSE_CACHE_DIR ? path.resolve(process.env.NFLVERSE_CACHE_DIR) : path.join(process.cwd(), ".next", "cache", "nflverse");
const HEADERS: Record<string, string> = {
  "User-Agent": process.env.NFLVERSE_USER_AGENT || DEFAULT_USER_AGENT,
  Accept: "text/csv,application/octet-stream",
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback;
};

const toPositiveMs = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const NFLVERSE_FETCH_ATTEMPTS = toPositiveInt(process.env.NFLVERSE_FETCH_ATTEMPTS ?? process.env.FETCH_ATTEMPTS, 3);
const NFLVERSE_FETCH_TIMEOUT_MS = toPositiveMs(process.env.NFLVERSE_FETCH_TIMEOUT_MS ?? process.env.FETCH_TIMEOUT_MS, 20000);
const NFLVERSE_FETCH_RETRY_DELAY_MS = toPositiveMs(process.env.NFLVERSE_FETCH_RETRY_DELAY_MS ?? process.env.FETCH_RETRY_DELAY_MS, 750);

type CsvRow = Record<string, string>;

const parseCsv = (text: string): CsvRow[] => {
  const rows: string[][] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') { currentValue += '"'; i += 1; }
        else { inQuotes = false; }
      } else {
        currentValue += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      currentRow.push(currentValue);
      currentValue = "";
    } else if (char === '\n') {
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
    } else {
      currentValue += char;
    }
  }
  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }
  if (!rows.length) return [];
  const headers = (rows.shift() ?? []).map(h => h.replace(/^\uFEFF/, '').trim());
  const result: CsvRow[] = [];
  for (const row of rows) {
    if (!row.some(cell => cell && cell.trim().length)) continue;
    const obj: CsvRow = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      if (!key) continue;
      obj[key] = (row[i] ?? "").trim();
    }
    result.push(obj);
  }
  return result;
};

type MapCollections = {
  byId: Map<string, NflversePlayer>;
  byGsis: Map<string, NflversePlayer>;
  byNameTeam: Map<string, NflversePlayer>;
  byName: Map<string, NflversePlayer>;
};

type RosterLookup = {
  byWeek: Map<number, MapCollections>;
  season: MapCollections;
};

export interface NflversePlayer {
  season: number;
  week: number;
  player_id: string;
  gsis_id?: string;
  nfl_id?: string;
  full_name: string;
  position?: string;
  team?: string;
  college?: string | null;
  college_name?: string | null;
}

export interface NflversePlayerStat {
  season: number;
  week: number;
  player_id: string;
  alt_ids: string[];
  name: string;
  team: string;
  position?: string;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles_lost: number;
  field_goals_made: number;
  extra_points_made: number;
}

export interface DefSnapRow {
  season: number;
  week: number;
  team: string;
  player_id: string;
  alt_ids: string[];
  name: string;
  defense_snaps: number;
}

export interface TeamDefenseInput {
  season: number;
  week: number;
  team: string;
  sacks: number;
  interceptions: number;
  fumble_recoveries: number;
  safeties: number;
  defensive_tds: number;
  return_tds: number;
  points_allowed: number;
}

export type DefenseWeek = {
  teams: {
    team: string;
    dstPoints: number;
    players: { player_id: string; snaps: number }[];
  }[];
};

export interface LoadWeekOptions {
  season: number;
  week: number;
  format: "standard" | "half-ppr" | "ppr" | string;
  includeDefense?: boolean;
}

export interface LoadWeekResult {
  leaders: Leader[];
  defenseData?: DefenseWeek;
}

const playersCache = new Map<number, NflversePlayer[]>();
const rosterLookupCache = new Map<number, RosterLookup>();
const playerStatsSeasonCache = new Map<number, Map<number, NflversePlayerStat[]>>();
const snapSeasonCache = new Map<number, Map<number, DefSnapRow[]>>();
const teamDefenseSeasonCache = new Map<number, Map<number, TeamDefenseInput[]>>();

const ensureCacheDir = async () => { await fs.mkdir(CACHE_ROOT, { recursive: true }); };

const readCache = async (key: string): Promise<string | null> => {
  const file = path.join(CACHE_ROOT, `${key}.csv`);
  try {
    const stat = await fs.stat(file);
    if (CACHE_MS > 0 && Date.now() - stat.mtimeMs > CACHE_MS) return null;
    return await fs.readFile(file, "utf-8");
  } catch { return null; }
};

const writeCache = async (key: string, contents: string) => {
  const file = path.join(CACHE_ROOT, `${key}.csv`);
  await ensureCacheDir();
  await fs.writeFile(file, contents, "utf-8");
};

async function fetchCsv(key: string, url: string): Promise<CsvRow[]> {
  const cached = await readCache(key);
  if (cached) return parseCsv(cached);
  try {
    const response = await fetchWithRetry(
      url,
      { headers: HEADERS, cache: "no-store" },
      {
        attempts: NFLVERSE_FETCH_ATTEMPTS,
        timeoutMs: NFLVERSE_FETCH_TIMEOUT_MS,
        retryDelayMs: NFLVERSE_FETCH_RETRY_DELAY_MS,
      },
    );
    const text = await response.text();
    await writeCache(key, text);
    return parseCsv(text);
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(error.status, `[nflverse] ${error.message}`, { cause: error });
    }
    if (error instanceof Error) {
      throw new Error(`[nflverse] ${error.message}`, { cause: error });
    }
    throw new Error(`[nflverse] ${String(error)}`);
  }
}

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const toInt = (value: unknown): number => Math.trunc(toNumber(value));

const toString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
};

const unique = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const collect = () => ({
  byId: new Map<string, NflversePlayer>(),
  byGsis: new Map<string, NflversePlayer>(),
  byNameTeam: new Map<string, NflversePlayer>(),
  byName: new Map<string, NflversePlayer>(),
});

const addToCollection = (col: MapCollections, player: NflversePlayer) => {
  const id = toString(player.player_id);
  if (id && !col.byId.has(id)) col.byId.set(id, player);
  const gsis = toString(player.gsis_id);
  if (gsis && !col.byGsis.has(gsis)) col.byGsis.set(gsis, player);
  const name = normalize(player.full_name ?? "");
  if (name) {
    const team = (player.team ?? "").toUpperCase();
    const nameTeam = `${name}|${team}`;
    if (!col.byNameTeam.has(nameTeam)) col.byNameTeam.set(nameTeam, player);
    if (!col.byName.has(name)) col.byName.set(name, player);
  }
};

const buildRosterLookup = (players: NflversePlayer[]): RosterLookup => {
  const byWeek = new Map<number, MapCollections>();
  const season = collect();
  for (const player of players) {
    addToCollection(season, player);
    const week = Number(player.week ?? 0);
    if (!byWeek.has(week)) byWeek.set(week, collect());
    addToCollection(byWeek.get(week)!, player);
  }
  return { byWeek, season };
};

const resolvePlayerId = (values: string[], fallback: string): string => {
  const [first] = unique(values.filter(v => v && v.trim().length));
  if (first && first.trim().length) return first.trim();
  return fallback;
};

const resolveIdCandidates = (row: CsvRow): string[] => unique([
  toString(row.player_id),
  toString(row.gsis_id),
  toString(row.gsis_it_id),
  toString(row.gsis_player_id),
  toString(row.nfl_id),
  toString(row.pfr_id),
  toString(row.pfr_player_id),
  toString(row.esb_id),
]);

const resolveName = (row: CsvRow): string => {
  const full = toString(row.full_name);
  if (full) return full;
  const player = toString(row.player);
  if (player) return player;
  const playerName = toString(row.player_name);
  if (playerName) return playerName;
  const first = toString(row.first_name);
  const last = toString(row.last_name);
  return `${first} ${last}`.trim();
};

const resolveTeam = (row: CsvRow): string => {
  const team = toString(row.recent_team || row.team || row.posteam || row.team_abbr || row.club_code || row.team_code);
  return team.toUpperCase();
};

const resolvePosition = (row: CsvRow): string => toString(row.position || row.pos || row.depth_chart_position);

const resolveCollege = (row: CsvRow): string => {
  const college = toString(row.college_name || row.college || row.school);
  return college || "";
};

const parseFumbles = (row: CsvRow): number => {
  const direct = toNumber(row.fumbles_lost ?? row.fumbles_lost_total ?? row.fumbles_lost_offense);
  if (direct > 0) return direct;
  const parts = [
    toNumber(row.rushing_fumbles_lost),
    toNumber(row.receiving_fumbles_lost),
    toNumber(row.fumbles_lost ?? 0),
    toNumber(row.sack_fumbles_lost),
    toNumber(row.kickoff_fumbles_lost),
    toNumber(row.punt_fumbles_lost),
  ];
  const sum = parts.reduce((acc, val) => acc + val, 0);
  return sum;
};

const getRosterLookup = async (season: number): Promise<RosterLookup> => {
  if (rosterLookupCache.has(season)) return rosterLookupCache.get(season)!;
  const players = await fetchPlayers(season);
  const lookup = buildRosterLookup(players);
  rosterLookupCache.set(season, lookup);
  return lookup;
};

const matchPlayer = (lookup: RosterLookup, stat: { week: number; player_id: string; alt_ids: string[]; name: string; team: string }): NflversePlayer | undefined => {
  const weekLookup = lookup.byWeek.get(Number(stat.week));
  const candidates = unique([stat.player_id, ...stat.alt_ids]);
  for (const id of candidates) {
    if (weekLookup?.byId.has(id)) return weekLookup.byId.get(id);
  }
  for (const id of candidates) {
    if (lookup.season.byId.has(id)) return lookup.season.byId.get(id);
  }
  for (const id of candidates) {
    if (weekLookup?.byGsis.has(id)) return weekLookup.byGsis.get(id);
  }
  for (const id of candidates) {
    if (lookup.season.byGsis.has(id)) return lookup.season.byGsis.get(id);
  }
  const name = normalize(stat.name ?? "");
  if (name) {
    const teamKey = `${name}|${(stat.team ?? "").toUpperCase()}`;
    if (weekLookup?.byNameTeam.has(teamKey)) return weekLookup.byNameTeam.get(teamKey);
    if (lookup.season.byNameTeam.has(teamKey)) return lookup.season.byNameTeam.get(teamKey);
    if (weekLookup?.byName.has(name)) return weekLookup.byName.get(name);
    if (lookup.season.byName.has(name)) return lookup.season.byName.get(name);
  }
  return undefined;
};

const parsePlayerStatRow = (row: CsvRow, fallbackSeason: number): NflversePlayerStat | null => {
  const season = toInt(row.season) || fallbackSeason;
  const week = toInt(row.week ?? row.game_week ?? row.week_num ?? row.week_number);
  if (!week) return null;
  const name = resolveName(row);
  const team = resolveTeam(row);
  const candidates = resolveIdCandidates(row);
  const fallbackId = name ? `${normalize(name)}|${team}` : `${team}|${week}`;
  const playerId = resolvePlayerId(candidates, fallbackId);
  const alt_ids = unique([...candidates, playerId].filter(Boolean));
  return {
    season,
    week,
    player_id: playerId,
    alt_ids,
    name,
    team,
    position: resolvePosition(row),
    passing_yards: toNumber(row.passing_yards ?? row.pass_yards ?? row.pass_yds),
    passing_tds: toNumber(row.passing_tds ?? row.pass_tds ?? row.pass_td),
    interceptions: toNumber(row.interceptions ?? row.int ?? row.ints ?? row.pass_interceptions),
    rushing_yards: toNumber(row.rushing_yards ?? row.rush_yards ?? row.rush_yds),
    rushing_tds: toNumber(row.rushing_tds ?? row.rush_tds ?? row.rush_td),
    receptions: toNumber(row.receptions ?? row.receiving_receptions ?? row.rec ?? row.rec_receptions),
    receiving_yards: toNumber(row.receiving_yards ?? row.rec_yards ?? row.rec_yds),
    receiving_tds: toNumber(row.receiving_tds ?? row.rec_tds ?? row.rec_td),
    fumbles_lost: parseFumbles(row),
    field_goals_made: toNumber(row.field_goals_made ?? row.fg_made ?? row.fg),
    extra_points_made: toNumber(row.extra_points_made ?? row.xp_made ?? row.xpt),
  };
};

const parseRosterRow = (row: CsvRow, fallbackSeason: number): NflversePlayer | null => {
  const season = toInt(row.season) || fallbackSeason;
  const week = toInt(row.week ?? row.game_week ?? row.week_num ?? row.week_number);
  const name = resolveName(row);
  if (!name) return null;
  const team = resolveTeam(row);
  const candidates = resolveIdCandidates(row);
  const fallbackId = `${normalize(name)}|${team}`;
  const playerId = resolvePlayerId(candidates, fallbackId);
  const gsis = toString(row.gsis_id || row.gsis_it_id);
  const college = resolveCollege(row) || null;
  return {
    season,
    week,
    player_id: playerId,
    gsis_id: gsis || undefined,
    nfl_id: toString(row.nfl_id) || undefined,
    full_name: name,
    position: resolvePosition(row) || undefined,
    team: team || undefined,
    college,
    college_name: college,
  };
};

const parseSnapRow = (row: CsvRow, fallbackSeason: number): DefSnapRow | null => {
  const season = toInt(row.season) || fallbackSeason;
  const week = toInt(row.week ?? row.game_week ?? row.week_num ?? row.week_number);
  if (!week) return null;
  const name = resolveName(row);
  const team = resolveTeam(row);
  const candidates = resolveIdCandidates(row);
  const fallbackId = name ? `${normalize(name)}|${team}` : `${team}|${week}`;
  const playerId = resolvePlayerId(candidates, fallbackId);
  return {
    season,
    week,
    team,
    player_id: playerId,
    alt_ids: unique([...candidates, playerId].filter(Boolean)),
    name,
    defense_snaps: toNumber(row.defense_snaps ?? row.def_snaps ?? row.defensive_snaps ?? 0),
  };
};

const parseTeamDefenseRow = (row: CsvRow, fallbackSeason: number): TeamDefenseInput | null => {
  const season = toInt(row.season) || fallbackSeason;
  const week = toInt(row.week ?? row.game_week ?? row.week_num ?? row.week_number);
  if (!week) return null;
  const team = resolveTeam(row);
  if (!team) return null;
  const returnTds =
    toNumber(row.punt_return_tds ?? row.special_teams_touchdowns ?? row.return_touchdowns) +
    toNumber(row.kick_return_tds);
  const defensiveTds =
    toNumber(row.defensive_touchdowns ?? row.defensive_tds ?? row.def_tds ?? row.def_td ?? row.defense_touchdowns) +
    toNumber(row.int_touchdowns ?? row.interception_tds);
  const safeties = toNumber(row.defense_safeties ?? row.safeties ?? row.safety);
  const sacks = toNumber(row.defense_sacks ?? row.sacks ?? row.def_sacks);
  const interceptions = toNumber(row.defense_interceptions ?? row.interceptions ?? row.def_ints ?? row.def_int);
  const fumbles =
    toNumber(row.defense_fumbles_recovered ?? row.fumbles_recovered ?? row.def_fumble_rec ?? row.defense_fumbles ?? 0) +
    toNumber(row.forced_fumbles_recovered);
  const pointsAllowed =
    toNumber(row.points_allowed ?? row.points_against ?? row.opp_points ?? row.opp_score ?? row.opponent_points);
  return {
    season,
    week,
    team,
    sacks,
    interceptions,
    fumble_recoveries: fumbles,
    safeties,
    defensive_tds: defensiveTds,
    return_tds: returnTds,
    points_allowed: pointsAllowed,
  };
};

export async function fetchPlayers(season: number): Promise<NflversePlayer[]> {
  if (playersCache.has(season)) return playersCache.get(season)!;
  const rows = await fetchCsv(`roster_weekly_${season}`, `${RELEASE_BASE}/nflfastR-roster/roster_weekly_${season}.csv`);
  const parsed = rows
    .map((row) => parseRosterRow(row, season))
    .filter((p): p is NflversePlayer => Boolean(p) && (p as NflversePlayer).season === season);
  playersCache.set(season, parsed);
  rosterLookupCache.delete(season);
  return parsed;
}

const loadSeasonPlayerStats = async (season: number): Promise<Map<number, NflversePlayerStat[]>> => {
  if (playerStatsSeasonCache.has(season)) return playerStatsSeasonCache.get(season)!;
  const rows = await fetchCsv(`stats_player_week_${season}`, `${RELEASE_BASE}/nflfastR-weekly/stats_player_week_${season}.csv`);
  const grouped = new Map<number, NflversePlayerStat[]>();
  for (const row of rows) {
    const parsed = parsePlayerStatRow(row, season);
    if (!parsed || (parsed.season && parsed.season !== season)) continue;
    if (!grouped.has(parsed.week)) grouped.set(parsed.week, []);
    grouped.get(parsed.week)!.push(parsed);
  }
  playerStatsSeasonCache.set(season, grouped);
  return grouped;
};

export async function fetchWeeklyPlayerStats(season: number, week: number): Promise<NflversePlayerStat[]> {
  const grouped = await loadSeasonPlayerStats(season);
  return grouped.get(week) ?? [];
}

const loadSeasonSnapCounts = async (season: number): Promise<Map<number, DefSnapRow[]>> => {
  if (snapSeasonCache.has(season)) return snapSeasonCache.get(season)!;
  const rows = await fetchCsv(`snap_counts_${season}`, `${RELEASE_BASE}/snap_counts/snap_counts_${season}.csv`);
  const grouped = new Map<number, DefSnapRow[]>();
  for (const row of rows) {
    const parsed = parseSnapRow(row, season);
    if (!parsed || (parsed.season && parsed.season !== season)) continue;
    if (parsed.defense_snaps <= 0) continue;
    if (!grouped.has(parsed.week)) grouped.set(parsed.week, []);
    grouped.get(parsed.week)!.push(parsed);
  }
  snapSeasonCache.set(season, grouped);
  return grouped;
};

export async function fetchDefensiveSnaps(season: number, week: number): Promise<DefSnapRow[]> {
  const grouped = await loadSeasonSnapCounts(season);
  return grouped.get(week) ?? [];
}

const loadSeasonTeamDefense = async (season: number): Promise<Map<number, TeamDefenseInput[]>> => {
  if (teamDefenseSeasonCache.has(season)) return teamDefenseSeasonCache.get(season)!;
  const rows = await fetchCsv(`stats_team_week_${season}`, `${RELEASE_BASE}/nflfastR-weekly/stats_team_week_${season}.csv`);
  const grouped = new Map<number, TeamDefenseInput[]>();
  for (const row of rows) {
    const parsed = parseTeamDefenseRow(row, season);
    if (!parsed || (parsed.season && parsed.season !== season)) continue;
    if (!grouped.has(parsed.week)) grouped.set(parsed.week, []);
    grouped.get(parsed.week)!.push(parsed);
  }
  teamDefenseSeasonCache.set(season, grouped);
  return grouped;
};

export async function fetchTeamDefenseInputs(season: number, week: number): Promise<TeamDefenseInput[]> {
  const grouped = await loadSeasonTeamDefense(season);
  return grouped.get(week) ?? [];
}

export const computeFantasyPoints = (stat: NflversePlayerStat, format: string): number => {
  const ppr = format === "ppr" ? 1 : format === "half-ppr" ? 0.5 : 0;
  const passing = (stat.passing_yards / 25) + (stat.passing_tds * 4) - (stat.interceptions * 2);
  const rushing = (stat.rushing_yards / 10) + (stat.rushing_tds * 6);
  const receiving = (stat.receiving_yards / 10) + (stat.receiving_tds * 6) + (stat.receptions * ppr);
  const fumbles = stat.fumbles_lost * -2;
  const kicking = (stat.field_goals_made * 3) + (stat.extra_points_made * 1);
  const total = passing + rushing + receiving + fumbles + kicking;
  return Number(total.toFixed(2));
};

const dstPointsAllowedBonus = (pointsAllowed: number): number => {
  if (pointsAllowed <= 0) return 10;
  if (pointsAllowed <= 6) return 7;
  if (pointsAllowed <= 13) return 4;
  if (pointsAllowed <= 20) return 1;
  if (pointsAllowed <= 27) return 0;
  if (pointsAllowed <= 34) return -1;
  return -4;
};

export const computeDstPoints = (input: TeamDefenseInput): number => {
  const base =
    (input.sacks * 1) +
    (input.interceptions * 2) +
    (input.fumble_recoveries * 2) +
    (input.safeties * 2) +
    (input.defensive_tds * 6) +
    (input.return_tds * 6);
  const bonus = dstPointsAllowedBonus(input.points_allowed);
  return Number((base + bonus).toFixed(2));
};

const buildDefenseWeek = (snaps: DefSnapRow[], teams: TeamDefenseInput[]): DefenseWeek => {
  const snapMap = new Map<string, Map<string, number>>();
  for (const snap of snaps) {
    const team = (snap.team || "").toUpperCase();
    if (!team || !snap.player_id) continue;
    if (!snapMap.has(team)) snapMap.set(team, new Map());
    const playerMap = snapMap.get(team)!;
    const id = snap.player_id;
    playerMap.set(id, (playerMap.get(id) ?? 0) + snap.defense_snaps);
  }
  const dstMap = new Map<string, number>();
  for (const teamInput of teams) {
    const team = (teamInput.team || "").toUpperCase();
    dstMap.set(team, computeDstPoints(teamInput));
  }
  const teamsSet = new Set<string>([...snapMap.keys(), ...dstMap.keys()]);
  const resultTeams: DefenseWeek["teams"] = [];
  for (const team of teamsSet) {
    const playerMap = snapMap.get(team) ?? new Map();
    const players = Array.from(playerMap.entries())
      .filter(([, snaps]) => snaps > 0)
      .map(([player_id, snaps]) => ({ player_id, snaps }));
    resultTeams.push({
      team,
      dstPoints: Number((dstMap.get(team) ?? 0).toFixed(2)),
      players,
    });
  }
  return { teams: resultTeams };
};

const ensureDefenseLeaders = (leaders: Leader[], leaderMap: Map<string, Leader>, snaps: DefSnapRow[], lookup: RosterLookup) => {
  for (const snap of snaps) {
    const id = snap.player_id;
    if (!id) continue;
    if (!leaderMap.has(id)) {
      const match = matchPlayer(lookup, { week: snap.week, player_id: snap.player_id, alt_ids: snap.alt_ids, name: snap.name, team: snap.team });
      const position = (match?.position || "DEF").toUpperCase();
      const rawTeam = match?.team || snap.team;
      const team = rawTeam ? rawTeam.toUpperCase() : undefined;
      const college = match?.college ?? match?.college_name ?? null;
      const leader: Leader = {
        player_id: id,
        full_name: match?.full_name || snap.name || "Unknown",
        position,
        team,
        points: 0,
        college,
      };
      leaders.push(leader);
      leaderMap.set(id, leader);
    } else {
      const existing = leaderMap.get(id)!;
      if (!existing.team && snap.team) existing.team = snap.team.toUpperCase();
      if (!existing.position || existing.position === "") {
        const match = matchPlayer(lookup, { week: snap.week, player_id: snap.player_id, alt_ids: snap.alt_ids, name: snap.name, team: snap.team });
        if (match?.position) existing.position = match.position.toUpperCase();
        if (!existing.college && (match?.college || match?.college_name)) existing.college = match.college ?? match.college_name ?? null;
      }
    }
  }
};

export async function loadWeek(options: LoadWeekOptions): Promise<LoadWeekResult> {
  const season = options.season;
  const week = options.week;
  const format = options.format;
  const includeDefense = options.includeDefense ?? false;
  const [stats, lookup] = await Promise.all([
    fetchWeeklyPlayerStats(season, week),
    getRosterLookup(season),
  ]);
  const leaders: Leader[] = [];
  const leaderMap = new Map<string, Leader>();
  for (const stat of stats) {
    const match = matchPlayer(lookup, stat);
    const rawTeam = match?.team || stat.team || undefined;
    const team = rawTeam ? rawTeam.toUpperCase() : undefined;
    const position = (match?.position || stat.position || "").toUpperCase();
    const college = match?.college ?? match?.college_name ?? null;
    const points = computeFantasyPoints(stat, format);
    const leader: Leader = {
      player_id: stat.player_id,
      full_name: match?.full_name || stat.name || "Unknown",
      position,
      team,
      points,
      college,
    };
    leaders.push(leader);
    leaderMap.set(String(stat.player_id), leader);
  }
  let defenseData: DefenseWeek | undefined;
  if (includeDefense) {
    const [snaps, defenseInputs] = await Promise.all([
      fetchDefensiveSnaps(season, week),
      fetchTeamDefenseInputs(season, week),
    ]);
    ensureDefenseLeaders(leaders, leaderMap, snaps, lookup);
    defenseData = buildDefenseWeek(snaps, defenseInputs);
  }
  return { leaders, defenseData };
}

export async function computeHistoricalAverages(season: number, week: number, format: string): Promise<Record<string, number>> {
  if (week <= 1) return {};
  const grouped = await loadSeasonPlayerStats(season);
  const sums = new Map<string, { total: number; count: number }>();
  for (let w = 1; w < week; w += 1) {
    const stats = grouped.get(w) ?? [];
    for (const stat of stats) {
      const pts = computeFantasyPoints(stat, format);
      const prev = sums.get(stat.player_id) ?? { total: 0, count: 0 };
      prev.total += pts;
      prev.count += 1;
      sums.set(stat.player_id, prev);
    }
  }
  const averages: Record<string, number> = {};
  for (const [playerId, entry] of sums.entries()) {
    if (entry.count > 0) averages[playerId] = Number((entry.total / entry.count).toFixed(2));
  }
  return averages;
}
