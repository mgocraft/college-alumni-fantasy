import { gunzipSync } from "node:zlib";

import { createErrorWithCause } from "./errors";
import { fetchBuffer } from "./http";
import { normalize } from "./utils";

const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";

type CsvRow = Record<string, string>;

type FetchBufferOptions = Parameters<typeof fetchBuffer>[2];

type AssetKind = "weekly" | "season" | "players";

type RosterAssetResult = { csv: string; source: string };

type FetchAssetOptions = {
  season: number;
  requestInit?: RequestInit;
  fetchOptions?: FetchBufferOptions;
};

const rosterAssetUrl = (kind: AssetKind, season: number): string => {
  if (kind === "weekly") {
    return `${RELEASE_BASE}/weekly_rosters/roster_week_${season}.csv.gz`;
  }
  if (kind === "season") {
    return `${RELEASE_BASE}/rosters/roster_${season}.csv`;
  }
  if (kind === "players") {
    return `${RELEASE_BASE}/players/players.csv`;
  }
  throw new Error(`Unknown roster asset kind: ${kind}`);
};

const decodeBuffer = (url: string, buffer: Buffer): string => {
  if (url.endsWith(".gz")) {
    try {
      const inflated = gunzipSync(buffer);
      return inflated.toString("utf8");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw createErrorWithCause(`[roster] Failed to gunzip ${url}: ${err.message}`, err);
    }
  }
  return buffer.toString("utf8");
};

const fetchRosterAsset = async (
  kind: AssetKind,
  options: FetchAssetOptions,
): Promise<RosterAssetResult> => {
  const url = rosterAssetUrl(kind, options.season);
  const buffer = await fetchBuffer(url, options.requestInit, options.fetchOptions);
  const csv = decodeBuffer(url, buffer);
  return { csv, source: url };
};

const normalizeRowValue = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const parseCsv = (text: string): CsvRow[] => {
  const rows: string[][] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === "\"") {
        if (normalized[i + 1] === "\"") {
          currentValue += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentValue += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      currentRow.push(currentValue);
      currentValue = "";
    } else if (char === "\n") {
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
  const headers = (rows.shift() ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  const result: CsvRow[] = [];
  for (const row of rows) {
    if (!row.some((cell) => cell && cell.trim().length)) continue;
    const entry: CsvRow = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      if (!key) continue;
      entry[key] = (row[i] ?? "").trim();
    }
    result.push(entry);
  }
  return result;
};

const findKey = (row: CsvRow | undefined, candidates: string[]): string | null => {
  if (!row) return null;
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return key;
    }
  }
  return null;
};

const getTeamValue = (row: CsvRow): string => {
  const candidates = ["team", "recent_team", "team_abbr", "team_code", "club_code"];
  for (const key of candidates) {
    const value = row[key];
    if (value && value.trim()) return value.trim();
  }
  return "";
};

const NAME_KEYS = ["full_name", "player_name", "player", "name"];
const ID_KEYS = ["gsis_id", "player_id", "nfl_id", "pfr_id"];
const COLLEGE_KEYS = ["college", "college_name", "college_short"];

type PlayerJoinOptions = {
  season: number;
  requestInit?: RequestInit;
  fetchOptions?: FetchBufferOptions;
};

type PlayerJoinResult = {
  map: Map<string, string>;
  idKey: string;
  collegeKey: string;
};

const buildPlayersCollegeMap = async (
  options: PlayerJoinOptions,
): Promise<PlayerJoinResult | null> => {
  const { csv } = await fetchRosterAsset("players", options);
  const players = parseCsv(csv);
  if (!players.length) return null;
  const sample = players[0];
  const idKey = findKey(sample, ID_KEYS);
  const collegeKey = findKey(sample, COLLEGE_KEYS);
  if (!idKey || !collegeKey) return null;
  const map = new Map<string, string>();
  for (const row of players) {
    const id = normalizeRowValue(row[idKey]);
    const college = normalizeRowValue(row[collegeKey]);
    if (id && college && !map.has(id)) {
      map.set(id, college);
    }
  }
  return { map, idKey, collegeKey };
};

export interface RosterRow {
  player_id: string;
  team: string;
  college: string;
  name: string;
}

export interface RosterFetchResult {
  season: number;
  source: string;
  csv: string;
  fields: { nameKey: string | null; idKey: string | null; collegeKey: string | null };
  rows: RosterRow[];
}

type FetchRosterOptions = {
  season: number;
  joinPlayers?: boolean;
  requestInit?: RequestInit;
  fetchOptions?: FetchBufferOptions;
};

export const fetchRosterData = async (options: FetchRosterOptions): Promise<RosterFetchResult> => {
  const { season, joinPlayers = true, requestInit, fetchOptions } = options;
  let roster: RosterAssetResult | null = null;
  let weeklyError: unknown;
  try {
    roster = await fetchRosterAsset("weekly", { season, requestInit, fetchOptions });
  } catch (error) {
    weeklyError = error;
  }
  if (!roster) {
    try {
      roster = await fetchRosterAsset("season", { season, requestInit, fetchOptions });
    } catch (error) {
      if (weeklyError) {
        const err = error instanceof Error ? error : new Error(String(error));
        const weeklyMessage = weeklyError instanceof Error ? weeklyError.message : String(weeklyError);
        const message = `[roster] Failed to fetch weekly and season rosters for ${season}: ${err.message} (weekly: ${weeklyMessage})`;
        throw createErrorWithCause(message, err);
      }
      throw error;
    }
  }

  const rosterCsv = roster.csv;
  const rosterRows = parseCsv(rosterCsv);
  const sample = rosterRows[0];
  const nameKey = findKey(sample, NAME_KEYS);
  const idKey = findKey(sample, ID_KEYS);
  let collegeKey = findKey(sample, COLLEGE_KEYS);
  let playerCollegeJoin: PlayerJoinResult | null = null;
  if (!collegeKey && joinPlayers) {
    try {
      playerCollegeJoin = await buildPlayersCollegeMap({ season, requestInit, fetchOptions });
      if (playerCollegeJoin && playerCollegeJoin.collegeKey) {
        collegeKey = playerCollegeJoin.collegeKey;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[roster] Failed to load players.csv for join: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const playerCollegeMap = playerCollegeJoin?.map ?? null;

  const rows: RosterRow[] = [];
  for (const row of rosterRows) {
    const rawId = idKey ? row[idKey] : undefined;
    const id = normalizeRowValue(rawId || row.player_id || row.gsis_id || row.nfl_id || row.pfr_id);
    const rawName = nameKey ? row[nameKey] : undefined;
    const nameCandidates = [rawName, row.full_name, row.player_name, row.player, row.name];
    const name = normalizeRowValue(nameCandidates.find((value) => value && value.trim()));
    const team = normalizeRowValue(getTeamValue(row)).toUpperCase();
    const rawCollege = collegeKey ? row[collegeKey] : undefined;
    let college = normalizeRowValue(rawCollege);
    if (!college && playerCollegeMap && id) {
      college = normalizeRowValue(playerCollegeMap.get(id));
    }
    rows.push({
      player_id: id,
      team,
      college,
      name,
    });
  }

  return {
    season,
    source: roster.source,
    csv: rosterCsv,
    fields: { nameKey, idKey, collegeKey },
    rows,
  };
};

export interface RosterCollegeLookup {
  byId: Map<string, RosterRow>;
  byNameTeam: Map<string, RosterRow>;
}

export const buildRosterCollegeLookup = (rows: RosterRow[]): RosterCollegeLookup => {
  const byId = new Map<string, RosterRow>();
  const byNameTeam = new Map<string, RosterRow>();
  for (const row of rows) {
    const id = normalizeRowValue(row.player_id);
    const team = normalizeRowValue(row.team).toUpperCase();
    const college = normalizeRowValue(row.college);
    const name = normalizeRowValue(row.name);
    if (id && college && !byId.has(id)) {
      byId.set(id, { ...row, player_id: id, team, college, name });
    }
    if (college && name && team) {
      const key = `${normalize(name)}|${team}`;
      if (!byNameTeam.has(key)) {
        byNameTeam.set(key, { ...row, player_id: id || row.player_id, team, college, name });
      }
    }
  }
  return { byId, byNameTeam };
};

const appendCandidateId = (set: Set<string>, value: unknown) => {
  const id = normalizeRowValue(value);
  if (id) set.add(id);
};

export type RosterCandidate = {
  player_id?: unknown;
  alt_ids?: unknown[];
  player_name?: string;
  name?: string;
  team?: string;
};

export const resolveCollegeFromRoster = (
  candidate: RosterCandidate,
  lookup: RosterCollegeLookup,
): string | undefined => {
  const ids = new Set<string>();
  appendCandidateId(ids, candidate.player_id);
  if (Array.isArray(candidate.alt_ids)) {
    for (const value of candidate.alt_ids) appendCandidateId(ids, value);
  }
  for (const id of ids) {
    const entry = lookup.byId.get(id);
    if (entry && entry.college) return entry.college;
  }
  const rawName = candidate.player_name ?? candidate.name ?? "";
  const name = normalize(rawName || "");
  const team = normalizeRowValue(candidate.team).toUpperCase();
  if (name && team) {
    const key = `${name}|${team}`;
    const entry = lookup.byNameTeam.get(key);
    if (entry && entry.college) return entry.college;
  }
  return undefined;
};
