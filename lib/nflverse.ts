import { promises as fs } from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { gunzipSync } from "zlib";
import { HttpError } from "./api";

import { createErrorWithCause } from "./errors";

import { fetchBuffer } from "./http";
import { playerStatsUrl } from "./nflverseUrls";
import {
  loadPlayersMaster,
  buildCollegeMaps,
  resolveCollege as resolveCollegeFromMaster,
  buildPlayersLookup,
  resolvePlayerRow,
  collectPlayerRowIds,
  type PlayersMasterLookup,
} from "./playersMaster";
import {
  fetchRosterData,
  buildRosterCollegeLookup,
  resolveCollegeFromRoster,
  type RosterCollegeLookup,
} from "./roster";
import { normalize } from "./utils";
import type { Leader } from "./types";
import { DefenseUnavailableError, fetchDefenseApprox } from "./defense";

const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const DEFAULT_USER_AGENT = "college-alumni-fantasy/1.0 (+https://github.com/)";
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS ?? 3600);
const CACHE_MS = CACHE_SECONDS > 0 ? CACHE_SECONDS * 1000 : 0;

const TEAM_CODE_ALIASES: Record<string, string> = {
  ARI: "ARI",
  ARZ: "ARI",
  PHX: "ARI",
  ATL: "ATL",
  BAL: "BAL",
  BLT: "BAL",
  BUF: "BUF",
  CAR: "CAR",
  CHI: "CHI",
  CIN: "CIN",
  CLE: "CLE",
  CLV: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GB: "GB",
  GBP: "GB",
  GNB: "GB",
  HOU: "HOU",
  HST: "HOU",
  HTX: "HOU",
  IND: "IND",
  CLT: "IND",
  JAC: "JAX",
  JAX: "JAX",
  KAN: "KC",
  KCC: "KC",
  KC: "KC",
  LAC: "LAC",
  SD: "LAC",
  SDC: "LAC",
  SDG: "LAC",
  LAR: "LAR",
  LA: "LAR",
  RAM: "LAR",
  STL: "LAR",
  LV: "LV",
  LVR: "LV",
  OAK: "LV",
  MIA: "MIA",
  MIN: "MIN",
  NE: "NE",
  NEW: "NE",
  NWE: "NE",
  NO: "NO",
  NOL: "NO",
  NOR: "NO",
  NYG: "NYG",
  NYJ: "NYJ",
  PHI: "PHI",
  PHL: "PHI",
  PIT: "PIT",
  SEA: "SEA",
  SF: "SF",
  SFO: "SF",
  TB: "TB",
  TBB: "TB",
  TAM: "TB",
  TEN: "TEN",
  HTN: "TEN",
  OIL: "TEN",
  WAS: "WAS",
  WFT: "WAS",
  WSH: "WAS",
};

export const normalizeTeamAbbreviation = (input: string | null | undefined): string => {
  if (input === null || input === undefined) return "";
  const trimmed = String(input).trim().toUpperCase();
  if (!trimmed) return "";
  return TEAM_CODE_ALIASES[trimmed] ?? trimmed;
};
const resolveCacheRoot = (): string => {
  const configured = process.env.NFLVERSE_CACHE_DIR?.trim();
  if (configured) {
    const absolute = path.resolve(configured);
    if (!process.env.NFLVERSE_CACHE_DIR || process.env.NFLVERSE_CACHE_DIR !== absolute) {
      process.env.NFLVERSE_CACHE_DIR = absolute;
    }
    return absolute;
  }

  const nextCache = process.env.NEXT_CACHE_DIR?.trim();
  if (nextCache) {
    const combined = path.resolve(path.join(nextCache, "nflverse"));
    process.env.NFLVERSE_CACHE_DIR = combined;
    return combined;
  }

  const fallback = path.join(os.tmpdir(), "next-cache", "nflverse");
  process.env.NFLVERSE_CACHE_DIR = fallback;
  return fallback;
};

const CACHE_ROOT = resolveCacheRoot();
const HEADERS: Record<string, string> = {
  "User-Agent": process.env.NFLVERSE_USER_AGENT || DEFAULT_USER_AGENT,
  Accept: "text/csv,application/octet-stream,application/gzip",
};

const GITHUB_API_BASE = "https://api.github.com";
const NFLVERSE_REPO = "nflverse/nflverse-data";
const PLAYER_STATS_RELEASE_TAG = "stats_player";
const PLAYER_STATS_PREFIX = "stats_player_week_";
const PLAYER_STATS_EXTENSIONS = [".csv.gz", ".csv"] as const;
const TEAM_DEFENSE_RELEASE_TAG = "stats_team";
const TEAM_DEFENSE_PREFIX = "stats_team_week_";
const TEAM_DEFENSE_EXTENSIONS = [".parquet", ".csv.gz", ".csv"] as const;
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;

const resolveRequireBase = (): string => {
  if (typeof __filename === "string" && __filename.length) {
    try {
      return pathToFileURL(path.isAbsolute(__filename) ? __filename : path.join(process.cwd(), __filename)).href;
    } catch {
      // ignore and fall through to fallback
    }
  }
  return pathToFileURL(path.join(process.cwd(), "package.json")).href;
};

declare const __non_webpack_require__: NodeJS.Require | undefined;

const nodeRequire: NodeJS.Require =
  typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : createRequire(resolveRequireBase());

class ParquetNotSupportedError extends Error {
  constructor() {
    super("PARQUET_NOT_SUPPORTED");
    this.name = "ParquetNotSupportedError";
  }
}

let parquetSupport: boolean | null = null;

const isParquetSupported = (): boolean => {
  if (parquetSupport !== null) return parquetSupport;
  try {
    nodeRequire.resolve("parquetjs-lite");
    parquetSupport = true;
  } catch {
    parquetSupport = false;
  }
  return parquetSupport;
};

type GitHubAsset = {
  name: string;
  browser_download_url: string;
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
const NFLVERSE_FETCH_TIMEOUT_MS = toPositiveMs(
  process.env.NFLVERSE_FETCH_TIMEOUT_MS ?? process.env.FETCH_TIMEOUT_MS,
  20000,
);
const NFLVERSE_FETCH_RETRIES = Math.max(0, NFLVERSE_FETCH_ATTEMPTS - 1);

type CsvValue = string | number | boolean | null | undefined;
type CsvRow = Record<string, CsvValue>;

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

export class NflverseAssetMissingError extends HttpError {
  url: string;

  releaseTag: string;

  season: number;

  week?: number;

  urlHints: string[];

  code = "NFLVERSE_ASSET_MISSING" as const;

  constructor(params: { url: string; releaseTag: string; season: number; week?: number }) {
    super(404, "NFLVERSE_ASSET_MISSING", {
      detail: `NFLverse asset not yet available at ${params.url}`,
    });
    this.url = params.url;
    this.releaseTag = params.releaseTag;
    this.season = params.season;
    this.week = params.week;
    this.urlHints = [params.url];
  }
}

const logCsvSnapshot = (csv: string, context: string) => {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = lines[0] ?? "";
  const firstRow = lines[1] ?? "";
  // eslint-disable-next-line no-console
  console.error(`[nflverse] CSV parse issue for ${context}`, { headers, firstRow });
};

const parseCsvSafe = (csv: string, context: string): CsvRow[] => {
  try {
    return parseCsv(csv);
  } catch (error) {
    logCsvSnapshot(csv, context);
    const err = error instanceof Error ? error : new Error(String(error));

    throw createErrorWithCause(`[nflverse] Failed to parse CSV for ${context}: ${err.message}`, err);

  }
};

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
  playerStatsSource?: PlayerStatsSourceMeta;
}

type PlayerStatsSourceMeta = {
  requestedSeason: number;
  seasonLoaded: number;
  releaseTag: string;
  filename: string;
  url: string;
  format: "csv";
  compression: "none" | "gz";
};

const playerStatsSeasonCache = new Map<number, Map<number, NflversePlayerStat[]>>();
const playerStatsSeasonMeta = new Map<number, PlayerStatsSourceMeta>();
const playerStatsSeasonLoading: Map<number, Promise<Map<number, NflversePlayerStat[]>>> = new Map();
const snapSeasonCache = new Map<number, Map<number, DefSnapRow[]>>();
const teamDefenseSeasonCache = new Map<number, Map<number, TeamDefenseInput[]>>();
const playerColumnWarnings = new Set<number>();
const releaseAssetCache = new Map<string, { fetchedAt: number; assets: GitHubAsset[] }>();
const playerStatsParquetHints = new Map<number, string[]>();

type CollegeMaps = ReturnType<typeof buildCollegeMaps>;

type PlayersMasterData = {
  maps: CollegeMaps;
  lookup: PlayersMasterLookup;
  getRosterColleges: (season: number) => Promise<RosterCollegeLookup>;
};

let playersMasterDataPromise: Promise<PlayersMasterData> | null = null;

const ensurePlayersMasterData = async (): Promise<PlayersMasterData> => {
  if (!playersMasterDataPromise) {
    playersMasterDataPromise = (async () => {
      const rows = await loadPlayersMaster();
      const maps = buildCollegeMaps(rows);
      const lookup = buildPlayersLookup(rows);
      const rosterCache = new Map<number, RosterCollegeLookup>();
      const rosterPromises = new Map<number, Promise<RosterCollegeLookup>>();
      const requestInit: RequestInit = { headers: HEADERS };
      const fetchOptions = { timeoutMs: NFLVERSE_FETCH_TIMEOUT_MS, retries: NFLVERSE_FETCH_RETRIES };
      const ensureRoster = async (season: number): Promise<RosterCollegeLookup> => {
        const cached = rosterCache.get(season);
        if (cached) return cached;
        let promise = rosterPromises.get(season);
        if (!promise) {
          promise = (async () => {
            try {
              const { rows: rosterRows } = await fetchRosterData({
                season,
                requestInit,
                fetchOptions,
              });
              const lookup = buildRosterCollegeLookup(rosterRows);
              rosterCache.set(season, lookup);
              return lookup;
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              // eslint-disable-next-line no-console
              console.warn(`[nflverse] Failed to load roster colleges for ${season}: ${err.message}`);
              const fallback: RosterCollegeLookup = { byId: new Map(), byNameTeam: new Map() };
              rosterCache.set(season, fallback);
              return fallback;
            } finally {
              rosterPromises.delete(season);
            }
          })();
          rosterPromises.set(season, promise);
        }
        return promise;
      };
      return { maps, lookup, getRosterColleges: ensureRoster };
    })();
    playersMasterDataPromise = playersMasterDataPromise.catch((error) => {
      playersMasterDataPromise = null;
      throw error;
    });
  }
  return playersMasterDataPromise;
};

const getCachePath = (releaseTag: string, filename: string) => path.join(CACHE_ROOT, releaseTag, filename);

type CachedBuffer = { buffer: Buffer; stale: boolean; ageMs: number };

const readCachedBuffer = async (releaseTag: string, filename: string): Promise<CachedBuffer | null> => {
  const file = getCachePath(releaseTag, filename);
  try {
    const stat = await fs.stat(file);
    const ageMs = Date.now() - stat.mtimeMs;
    const stale = CACHE_MS > 0 && ageMs > CACHE_MS;
    const buffer = await fs.readFile(file);
    return { buffer, stale, ageMs };
  } catch {
    return null;
  }
};

const writeCachedBuffer = async (releaseTag: string, filename: string, contents: Buffer) => {
  const file = getCachePath(releaseTag, filename);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
};

const deleteCachedBuffer = async (releaseTag: string, filename: string) => {
  const file = getCachePath(releaseTag, filename);
  try {
    await fs.unlink(file);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return;
    // eslint-disable-next-line no-console
    console.warn("[nflverse] Failed to delete cached asset", {
      releaseTag,
      filename,
      error: err?.message ?? String(error),
    });
  }
};

type CsvAssetOptions = {
  releaseTag: string;
  filename: string;
  url: string;
  season: number;
  week?: number;
  gz?: boolean;
  requireHead?: boolean;
};

const HEAD_RETRIES = Math.min(1, NFLVERSE_FETCH_RETRIES);

type AssetBufferOptions = {
  releaseTag: string;
  filename: string;
  url: string;
  season: number;
  week?: number;
  requireHead?: boolean;
};

type AssetBufferResult = {
  buffer: Buffer;
  usedCached: boolean;
};

async function fetchAssetBuffer(options: AssetBufferOptions): Promise<AssetBufferResult> {
  const { releaseTag, filename, url, season, week, requireHead = true } = options;
  const cached = await readCachedBuffer(releaseTag, filename);
  const cachedBuffer = cached?.buffer;
  const cachedIsStale = cached?.stale ?? false;
  let raw: Buffer | undefined;
  let usedCached = false;

  if (cachedBuffer && !cachedIsStale) {
    raw = cachedBuffer;
    usedCached = true;
  }

  const logFallback = (reason: string, error?: unknown) => {
    const context: Record<string, unknown> = {
      releaseTag,
      filename,
      url,
      season,
      week,
      reason,
    };
    if (cached) {
      context.stale = cached.stale;
      context.cachedAgeMs = cached.ageMs;
    }
    if (error instanceof Error) {
      context.error = error.message;
    } else if (error) {
      context.error = String(error);
    }
    // eslint-disable-next-line no-console
    console.warn("NFLVERSE_STALE_FALLBACK", context);
  };

  const applyStaleCache = (reason: string, error?: unknown): boolean => {
    if (!cachedBuffer) return false;
    raw = cachedBuffer;
    usedCached = true;
    logFallback(reason, error);
    return true;
  };

  let shouldFetch = !raw;

  if (shouldFetch && requireHead) {
    try {
      await fetchBuffer(
        url,
        { method: "HEAD", headers: HEADERS, cache: "no-store" },
        { timeoutMs: NFLVERSE_FETCH_TIMEOUT_MS, retries: HEAD_RETRIES },
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        if (applyStaleCache("head-404")) {
          shouldFetch = false;
        } else {
          // eslint-disable-next-line no-console
          console.warn("NFLVERSE_MISS", { releaseTag, url, season, week, status: error.status });
          throw new NflverseAssetMissingError({ url, releaseTag, season, week });
        }
      } else if (error instanceof HttpError) {
        throw new HttpError(error.status, `[nflverse] ${error.message}`, { cause: error });
      } else {
        const err = error instanceof Error ? error : new Error(String(error));
        throw createErrorWithCause(`[nflverse] HEAD ${url} failed: ${err.message}`, err);
      }
    }
  }

  if (shouldFetch && !raw) {
    try {
      raw = await fetchBuffer(
        url,
        { headers: HEADERS, cache: "no-store" },
        { timeoutMs: NFLVERSE_FETCH_TIMEOUT_MS, retries: NFLVERSE_FETCH_RETRIES },
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        if (!applyStaleCache("get-404", error)) {
          throw new NflverseAssetMissingError({ url, releaseTag, season, week });
        }
      } else if (applyStaleCache("get-error", error)) {
        // cached fallback already applied
      } else if (error instanceof HttpError) {
        throw new HttpError(error.status, `[nflverse] ${error.message}`, { cause: error });
      } else {
        const err = error instanceof Error ? error : new Error(String(error));
        throw createErrorWithCause(`[nflverse] Failed to fetch ${url}: ${err.message}`, err);
      }
    }
  }

  if (!raw && !applyStaleCache("no-data")) {
    throw new NflverseAssetMissingError({ url, releaseTag, season, week });
  }

  const source = raw!;
  if (!usedCached) {
    await writeCachedBuffer(releaseTag, filename, source);
  }
  return { buffer: source, usedCached };
}

async function fetchCsvAsset(options: CsvAssetOptions): Promise<CsvRow[]> {
  const { releaseTag, filename, gz = false } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { buffer } = await fetchAssetBuffer(options);
    let text: string;
    if (gz) {
      try {
        text = gunzipSync(buffer).toString("utf-8");
      } catch (error) {
        lastError = error;
        await deleteCachedBuffer(releaseTag, filename);
        if (attempt === 0) {
          continue;
        }
        const err = error instanceof Error ? error : new Error(String(error));
        // eslint-disable-next-line no-console
        console.error(`[nflverse] Failed to unzip ${releaseTag}/${filename}`, err);
        throw createErrorWithCause(`[nflverse] Failed to unzip ${releaseTag}/${filename}: ${err.message}`, err);
      }
    } else {
      text = buffer.toString("utf-8");
    }
    try {
      return parseCsvSafe(text, `${releaseTag}/${filename}`);
    } catch (error) {
      lastError = error;
      await deleteCachedBuffer(releaseTag, filename);
      if (attempt === 0) {
        continue;
      }
      throw error;
    }
  }
  const err = lastError instanceof Error
    ? lastError
    : new Error(`Failed to load CSV for ${releaseTag}/${filename}`);
  throw err;
}

const recordParquetHint = (season: number, url: string) => {
  const existing = playerStatsParquetHints.get(season) ?? [];
  if (existing.includes(url)) return;
  playerStatsParquetHints.set(season, [...existing, url]);
};

const buildGitHubHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "User-Agent": HEADERS["User-Agent"] ?? DEFAULT_USER_AGENT,
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const fetchReleaseAssets = async (tag: string): Promise<GitHubAsset[]> => {
  const now = Date.now();
  const cached = releaseAssetCache.get(tag);
  if (cached && now - cached.fetchedAt < RELEASE_CACHE_TTL_MS) {
    return cached.assets;
  }

  const url = `${GITHUB_API_BASE}/repos/${NFLVERSE_REPO}/releases/tags/${tag}`;
  const headers = buildGitHubHeaders();
  let buffer: Buffer;
  try {
    buffer = await fetchBuffer(url, { headers, cache: "no-store" }, {
      timeoutMs: NFLVERSE_FETCH_TIMEOUT_MS,
      retries: NFLVERSE_FETCH_RETRIES,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      releaseAssetCache.set(tag, { fetchedAt: now, assets: [] });
      return [];
    }
    throw error;
  }

  let assets: GitHubAsset[] = [];
  try {
    const parsed = JSON.parse(buffer.toString("utf-8"));
    const list = Array.isArray(parsed?.assets) ? parsed.assets : [];
    assets = list
      .filter((asset: unknown): asset is GitHubAsset =>
        Boolean(
          asset &&
          typeof (asset as { name?: unknown }).name === "string" &&
          typeof (asset as { browser_download_url?: unknown }).browser_download_url === "string",
        ),
      )
      .map((asset: GitHubAsset) => ({ name: asset.name, browser_download_url: asset.browser_download_url }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw createErrorWithCause(`[nflverse] Failed to parse GitHub release response for ${tag}: ${err.message}`, err);
  }

  releaseAssetCache.set(tag, { fetchedAt: Date.now(), assets });
  return assets;
};

let parquetModulePromise: Promise<unknown> | null = null;

const loadParquetReader = async (): Promise<{ openBuffer: (buffer: Buffer) => Promise<any> }> => {
  if (!isParquetSupported()) {
    throw new ParquetNotSupportedError();
  }
  if (!parquetModulePromise) {
    parquetModulePromise = import("parquetjs-lite").then((mod) => {
      const anyMod = mod as unknown as {
        ParquetReader?: { openBuffer: (buffer: Buffer) => Promise<any> };
        default?: { ParquetReader?: { openBuffer: (buffer: Buffer) => Promise<any> } };
      };
      const reader = anyMod?.ParquetReader ?? anyMod?.default?.ParquetReader;
      if (!reader || typeof reader.openBuffer !== "function") {
        throw new Error("ParquetReader export not found in parquetjs-lite");
      }
      return reader;
    });
  }
  const reader = await parquetModulePromise;
  return reader as { openBuffer: (buffer: Buffer) => Promise<any> };
};

const parseParquetBuffer = async (buffer: Buffer, context: string): Promise<CsvRow[]> => {
  let reader: { getCursor: () => any; close: () => Promise<void> } | null = null;
  try {
    const ParquetReader = await loadParquetReader();
    reader = await ParquetReader.openBuffer(buffer);
    if (!reader) {
      throw new Error("[nflverse] Failed to open Parquet buffer for reader initialization");
    }
    const cursor = reader.getCursor();
    const rows: CsvRow[] = [];
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const record = await cursor.next();
      if (!record) break;
      const row: CsvRow = {};
      for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
        if (!key) continue;
        if (value === undefined) continue;
        if (value === null) {
          row[key] = null;
        } else if (value instanceof Date) {
          row[key] = value.toISOString();
        } else if (Array.isArray(value)) {
          row[key] = value.map((entry) => String(entry)).join(",");
        } else if (typeof value === "bigint") {
          row[key] = value.toString();
        } else if (typeof value === "object") {
          row[key] = JSON.stringify(value);
        } else {
          row[key] = value as CsvValue;
        }
      }
      rows.push(row);
    }
    return rows;
  } catch (error) {
    if (error instanceof ParquetNotSupportedError) {
      throw error;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    throw createErrorWithCause(`[nflverse] Failed to parse Parquet for ${context}: ${err.message}`, err);
  } finally {
    if (reader) {
      try {
        await reader.close();
      } catch (closeError) {
        const err = closeError instanceof Error ? closeError : new Error(String(closeError));
        // eslint-disable-next-line no-console
        console.warn(`[nflverse] Failed to close Parquet reader for ${context}: ${err.message}`);
      }
    }
  }
};

type ReleaseAssetSelection = {
  releaseTag: string;
  filename: string;
  url: string;
  format: "csv" | "parquet";
  compression: "none" | "gz";
};

const buildAssetSelection = (
  releaseTag: string,
  asset: GitHubAsset,
  extension: string,
): ReleaseAssetSelection => ({
  releaseTag,
  filename: asset.name,
  url: asset.browser_download_url,
  format: extension === ".parquet" ? "parquet" : "csv",
  compression: extension === ".csv.gz" ? "gz" : "none",
});

const listReleaseAssetCandidates = (
  releaseTag: string,
  prefix: string,
  candidates: GitHubAsset[],
  extensions: readonly string[],
): ReleaseAssetSelection[] => {
  if (!candidates.length) return [];
  const results: ReleaseAssetSelection[] = [];
  const seen = new Set<string>();
  for (const ext of extensions) {
    const exact = candidates.find((asset) => asset.name === `${prefix}${ext}`);
    if (exact && !seen.has(exact.name)) {
      results.push(buildAssetSelection(releaseTag, exact, ext));
      seen.add(exact.name);
    }
  }
  for (const ext of extensions) {
    for (const asset of candidates) {
      if (seen.has(asset.name)) continue;
      if (asset.name.endsWith(ext)) {
        results.push(buildAssetSelection(releaseTag, asset, ext));
        seen.add(asset.name);
        break;
      }
    }
  }
  return results;
};

const tryLegacyPlayerStatsRows = async (season: number): Promise<PlayerStatsRowsResult | null> => {
  const filename = `stats_player_week_${season}.csv.gz`;
  const url = playerStatsUrl(season);
  try {
    const { buffer } = await fetchAssetBuffer({
      releaseTag: PLAYER_STATS_RELEASE_TAG,
      filename,
      url,
      season,
      requireHead: true,
    });
    let text: string;
    try {
      text = gunzipSync(buffer).toString("utf-8");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw createErrorWithCause(`[nflverse] Failed to unzip ${PLAYER_STATS_RELEASE_TAG}/${filename}: ${err.message}`, err);
    }
    const rows = parseCsvSafe(text, `${PLAYER_STATS_RELEASE_TAG}/${filename}`);
    return {
      rows,
      asset: {
        seasonLoaded: season,
        releaseTag: PLAYER_STATS_RELEASE_TAG,
        filename,
        url,
        format: "csv",
        compression: "gz",
      },
    };
  } catch (error) {
    if (error instanceof NflverseAssetMissingError) return null;
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
};

type PlayerStatsAssetInfo = {
  seasonLoaded: number;
  releaseTag: string;
  filename: string;
  url: string;
  format: "csv";
  compression: "none" | "gz";
};

const locatePlayerStatsAsset = async (season: number): Promise<PlayerStatsAssetInfo | null> => {
  const assets = await fetchReleaseAssets(PLAYER_STATS_RELEASE_TAG);
  if (!assets.length) return null;
  const prefix = `${PLAYER_STATS_PREFIX}${season}`;
  const matches = assets.filter((asset) => asset.name?.startsWith(prefix));
  if (!matches.length) {
    const parquetCandidate = assets.find((asset) => asset.name?.startsWith(prefix) && asset.name.endsWith(".parquet"));
    if (parquetCandidate) {
      recordParquetHint(season, parquetCandidate.browser_download_url);
    }
    return null;
  }

  for (const ext of PLAYER_STATS_EXTENSIONS) {
    const exactName = `${prefix}${ext}`;
    const candidate = matches.find((asset) => asset.name === exactName);
    if (candidate) {
      return {
        seasonLoaded: season,
        releaseTag: PLAYER_STATS_RELEASE_TAG,
        filename: candidate.name,
        url: candidate.browser_download_url,
        format: "csv",
        compression: ext === ".csv.gz" ? "gz" : "none",
      };
    }
  }

  const fallback = matches.find((asset) =>
    PLAYER_STATS_EXTENSIONS.some((ext) => asset.name.endsWith(ext)),
  );

  if (fallback) {
    const ext = PLAYER_STATS_EXTENSIONS.find((entry) => fallback.name.endsWith(entry)) ?? PLAYER_STATS_EXTENSIONS[0];
    return {
      seasonLoaded: season,
      releaseTag: PLAYER_STATS_RELEASE_TAG,
      filename: fallback.name,
      url: fallback.browser_download_url,
      format: "csv",
      compression: ext === ".csv.gz" ? "gz" : "none",
    };
  }

  const parquetOnly = matches.find((asset) => asset.name.endsWith(".parquet"));
  if (parquetOnly) {
    recordParquetHint(season, parquetOnly.browser_download_url);
  }

  return null;
};

type PlayerStatsRowsResult = {
  rows: CsvRow[];
  asset: PlayerStatsAssetInfo;
};

const resolvePlayerStatsAsset = async (season: number): Promise<PlayerStatsAssetInfo> => {
  const hints: string[] = [];
  const seasonsToTry = season > 1900 ? [season, season - 1] : [season];
  for (const candidate of seasonsToTry) {
    const asset = await locatePlayerStatsAsset(candidate);
    if (asset) {
      if (candidate !== season) {
        const parquetHints = playerStatsParquetHints.get(season);
        if (parquetHints?.length) hints.push(...parquetHints);
      }
      return asset;
    }
    const parquetHints = playerStatsParquetHints.get(candidate);
    if (parquetHints?.length) {
      hints.push(...parquetHints);
    }
  }

  const error = new NflverseAssetMissingError({
    url: playerStatsUrl(season),
    releaseTag: PLAYER_STATS_RELEASE_TAG,
    season,
  });
  if (hints.length) {
    for (const hint of hints) {
      if (!error.urlHints.includes(hint)) {
        error.urlHints.push(hint);
      }
    }
  }
  throw error;
};

const loadPlayerStatsRows = async (season: number): Promise<PlayerStatsRowsResult> => {
  const legacy = await tryLegacyPlayerStatsRows(season);
  if (legacy) return legacy;
  const asset = await resolvePlayerStatsAsset(season);
  const { buffer } = await fetchAssetBuffer({
    releaseTag: asset.releaseTag,
    filename: asset.filename,
    url: asset.url,
    season: asset.seasonLoaded,
    requireHead: false,
  });
  let text: string;
  if (asset.compression === "gz") {
    try {
      text = gunzipSync(buffer).toString("utf-8");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw createErrorWithCause(`[nflverse] Failed to unzip ${asset.releaseTag}/${asset.filename}: ${err.message}`, err);
    }
  } else {
    text = buffer.toString("utf-8");
  }
  const rows = parseCsvSafe(text, `${asset.releaseTag}/${asset.filename}`);
  return { rows, asset };
};


const PLAYER_COLUMN_GROUPS: { field: string; aliases: string[] }[] = [
  { field: "passing_yards", aliases: ["passing_yards", "pass_yards", "pass_yds"] },
  { field: "passing_tds", aliases: ["passing_tds", "pass_tds", "pass_td"] },
  { field: "interceptions", aliases: ["interceptions", "int", "ints", "pass_interceptions"] },
  { field: "rushing_yards", aliases: ["rushing_yards", "rush_yards", "rush_yds"] },
  { field: "rushing_tds", aliases: ["rushing_tds", "rush_tds", "rush_td"] },
  { field: "receptions", aliases: ["receptions", "receiving_receptions", "rec", "rec_receptions"] },
  { field: "receiving_yards", aliases: ["receiving_yards", "rec_yards", "rec_yds"] },
  { field: "receiving_tds", aliases: ["receiving_tds", "rec_tds", "rec_td"] },
  {
    field: "fumbles_lost",
    aliases: [
      "fumbles_lost",
      "fumbles_lost_total",
      "fumbles_lost_offense",
      "rushing_fumbles_lost",
      "receiving_fumbles_lost",
      "sack_fumbles_lost",
    ],
  },
  { field: "field_goals_made", aliases: ["field_goals_made", "fg_made", "fg"] },
  { field: "extra_points_made", aliases: ["extra_points_made", "xp_made", "xpt"] },
  {
    field: "player_id",
    aliases: [
      "player_id",
      "player_gsis_id",
      "gsis_id",
      "gsis_it_id",
      "gsis_player_id",
      "nfl_id",
      "pfr_id",
      "pfr_player_id",
      "esb_id",
    ],
  },
  { field: "player_name", aliases: ["full_name", "player", "player_name", "player_display_name"] },
  { field: "team", aliases: ["team", "posteam", "team_abbr", "club_code", "team_code", "recent_team"] },
  { field: "position", aliases: ["position", "pos", "depth_chart_position"] },
  { field: "week", aliases: ["week", "game_week", "week_num", "week_number"] },
  { field: "season", aliases: ["season"] },
];

const verifyPlayerStatColumns = (rows: CsvRow[], season: number) => {
  if (!rows.length || playerColumnWarnings.has(season)) return;
  const sample = rows[0];
  const missing = PLAYER_COLUMN_GROUPS
    .filter((group) => !group.aliases.some((alias) => alias in sample))
    .map((group) => group.field);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn("[nflverse] Missing expected stat columns", {
      season,
      missing,
      headers: Object.keys(sample),
    });
  }
  playerColumnWarnings.add(season);
};

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

const resolvePlayerId = (values: string[], fallback: string): string => {
  const [first] = unique(values.filter(v => v && v.trim().length));
  if (first && first.trim().length) return first.trim();
  return fallback;
};

const resolveIdCandidates = (row: CsvRow): string[] => unique([
  toString(row.player_id),
  toString(row.player_gsis_id),
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
  const display = toString(row.player_display_name);
  if (display) return display;
  const player = toString(row.player);
  if (player) return player;
  const playerName = toString(row.player_name);
  if (playerName) return playerName;
  const first = toString(row.first_name);
  const last = toString(row.last_name);
  return `${first} ${last}`.trim();
};

const resolveTeam = (row: CsvRow): string => normalizeTeamAbbreviation(
  toString(row.recent_team || row.team || row.posteam || row.team_abbr || row.club_code || row.team_code),
);

const resolvePosition = (row: CsvRow): string => toString(row.position || row.pos || row.depth_chart_position);

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

const loadSeasonPlayerStats = async (season: number): Promise<Map<number, NflversePlayerStat[]>> => {
  const cached = playerStatsSeasonCache.get(season);
  if (cached) return cached;

  const pending = playerStatsSeasonLoading.get(season);
  if (pending) return pending;

  const loadPromise = (async () => {
    const { rows, asset } = await loadPlayerStatsRows(season);
    verifyPlayerStatColumns(rows, asset.seasonLoaded);
    const grouped = new Map<number, NflversePlayerStat[]>();
    for (const row of rows) {
      const parsed = parsePlayerStatRow(row, asset.seasonLoaded);
      if (!parsed || (parsed.season && parsed.season !== asset.seasonLoaded)) continue;
      if (!grouped.has(parsed.week)) grouped.set(parsed.week, []);
      grouped.get(parsed.week)!.push(parsed);
    }

    const storeMeta = (seasonKey: number, requestedSeason: number) => {
      const meta: PlayerStatsSourceMeta = {
        requestedSeason,
        seasonLoaded: asset.seasonLoaded,
        releaseTag: asset.releaseTag,
        filename: asset.filename,
        url: asset.url,
        format: asset.format,
        compression: asset.compression,
      };
      playerStatsSeasonCache.set(seasonKey, grouped);
      playerStatsSeasonMeta.set(seasonKey, meta);
    };

    storeMeta(asset.seasonLoaded, asset.seasonLoaded);
    if (asset.seasonLoaded !== season) {
      storeMeta(season, season);
      const hints = playerStatsParquetHints.get(season);
      // eslint-disable-next-line no-console
      console.warn(
        "[nflverse] Falling back to previous season weekly stats",
        { requestedSeason: season, loadedSeason: asset.seasonLoaded, hints },
      );
    } else if (!playerStatsSeasonCache.has(season)) {
      storeMeta(season, season);
    }

    return grouped;
  })().finally(() => {
    playerStatsSeasonLoading.delete(season);
  });

  playerStatsSeasonLoading.set(season, loadPromise);
  return loadPromise;
};

export async function fetchWeeklyPlayerStats(season: number, week: number): Promise<NflversePlayerStat[]> {
  const grouped = await loadSeasonPlayerStats(season);
  return grouped.get(week) ?? [];
}

const loadSeasonSnapCounts = async (season: number): Promise<Map<number, DefSnapRow[]>> => {
  if (snapSeasonCache.has(season)) return snapSeasonCache.get(season)!;
  const rows = await fetchCsvAsset({
    releaseTag: "snap_counts",
    filename: `snap_counts_${season}.csv`,
    url: `${RELEASE_BASE}/snap_counts/snap_counts_${season}.csv`,
    season,
  });
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
  const prefix = `${TEAM_DEFENSE_PREFIX}${season}`;
  const assets = await fetchReleaseAssets(TEAM_DEFENSE_RELEASE_TAG);
  const candidates = assets.filter((asset) => asset.name?.startsWith(prefix));
  const assetOptions = listReleaseAssetCandidates(
    TEAM_DEFENSE_RELEASE_TAG,
    prefix,
    candidates,
    TEAM_DEFENSE_EXTENSIONS,
  );

  if (!assetOptions.length) {
    const expectedUrl = `${RELEASE_BASE}/${TEAM_DEFENSE_RELEASE_TAG}/${prefix}${TEAM_DEFENSE_EXTENSIONS[0]}`;
    const error = new NflverseAssetMissingError({
      url: expectedUrl,
      releaseTag: TEAM_DEFENSE_RELEASE_TAG,
      season,
    });
    for (const candidate of candidates) {
      if (!error.urlHints.includes(candidate.browser_download_url)) {
        error.urlHints.push(candidate.browser_download_url);
      }
    }
    // eslint-disable-next-line no-console
    console.warn("[nflverse] stats_team asset not found", {
      releaseTag: TEAM_DEFENSE_RELEASE_TAG,
      season,
      prefix,
      candidates: candidates.map((asset) => asset.name),
    });
    throw error;
  }

  let selected: ReleaseAssetSelection | null = null;
  let rows: CsvRow[] | null = null;

  optionLoop: for (const option of assetOptions) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { buffer } = await fetchAssetBuffer({
          releaseTag: option.releaseTag,
          filename: option.filename,
          url: option.url,
          season,
        });
        if (option.format === "parquet") {
          rows = await parseParquetBuffer(buffer, `${option.releaseTag}/${option.filename}`);
        } else {
          let text: string;
          if (option.compression === "gz") {
            try {
              text = gunzipSync(buffer).toString("utf-8");
            } catch (error) {
              await deleteCachedBuffer(option.releaseTag, option.filename);
              if (attempt === 0) {
                continue;
              }
              const err = error instanceof Error ? error : new Error(String(error));
              // eslint-disable-next-line no-console
              console.error(`[nflverse] Failed to unzip ${option.releaseTag}/${option.filename}`, err);
              throw createErrorWithCause(
                `[nflverse] Failed to unzip ${option.releaseTag}/${option.filename}: ${err.message}`,
                err,
              );
            }
          } else {
            text = buffer.toString("utf-8");
          }
          try {
            rows = parseCsvSafe(text, `${option.releaseTag}/${option.filename}`);
          } catch (error) {
            await deleteCachedBuffer(option.releaseTag, option.filename);
            if (attempt === 0) {
              continue;
            }
            throw error;
          }
        }
        selected = option;
        break optionLoop;
      } catch (error) {
        if (option.format === "parquet" && error instanceof ParquetNotSupportedError) {
          // eslint-disable-next-line no-console
          console.warn("[nflverse] Parquet not supported, retrying with fallback", {
            season,
            prefix,
            filename: option.filename,
          });
          break;
        }
        throw error;
      }
    }
  }

  if (!selected || !rows) {
    if (assetOptions.some((asset) => asset.format === "parquet")) {
      throw new HttpError(500, "PARQUET_NOT_SUPPORTED", {
        detail: "Install parquetjs-lite to parse stats_team parquet assets.",
        code: "PARQUET_NOT_SUPPORTED",
      });
    }
    const expectedUrl = `${RELEASE_BASE}/${TEAM_DEFENSE_RELEASE_TAG}/${prefix}${TEAM_DEFENSE_EXTENSIONS[0]}`;
    const error = new NflverseAssetMissingError({
      url: expectedUrl,
      releaseTag: TEAM_DEFENSE_RELEASE_TAG,
      season,
    });
    for (const candidate of candidates) {
      if (!error.urlHints.includes(candidate.browser_download_url)) {
        error.urlHints.push(candidate.browser_download_url);
      }
    }
    throw error;
  }

  // eslint-disable-next-line no-console
  console.info("[nflverse] Using stats_team asset", {
    season,
    releaseTag: selected.releaseTag,
    filename: selected.filename,
    format: selected.format,
    compression: selected.compression,
    prefix,
  });

  const rowsValue = rows as CsvRow[];
  const grouped = new Map<number, TeamDefenseInput[]>();
  for (const row of rowsValue) {
    const parsed = parseTeamDefenseRow(row, season);
    if (!parsed || (parsed.season && parsed.season !== season)) continue;
    if (!grouped.has(parsed.week)) grouped.set(parsed.week, []);
    grouped.get(parsed.week)!.push(parsed);
  }
  teamDefenseSeasonCache.set(season, grouped);
  return grouped;
};

export async function fetchTeamDefenseInputs(season: number, week: number): Promise<TeamDefenseInput[]> {
  let grouped: Map<number, TeamDefenseInput[]> | undefined;
  try {
    grouped = await loadSeasonTeamDefense(season);
    const official = grouped.get(week) ?? [];
    if (official.length > 0) return official;
    if (grouped) {
      // eslint-disable-next-line no-console
      console.info("[nflverse] stats_team defense empty for week, using offense fallback", { season, week });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[nflverse] Failed to load stats_team defense, using offense fallback", {
      season,
      week,
      error,
    });
  }

  try {
    const approx = await fetchDefenseApprox({ season, week });
    if (!approx.rows.length) return grouped?.get(week) ?? [];
    return approx.rows.map((row) => ({
      season,
      week: row.week,
      team: row.team,
      sacks: row.sacks,
      interceptions: row.interceptions,
      fumble_recoveries: row.fumbles_recovered,
      safeties: 0,
      defensive_tds: 0,
      return_tds: 0,
      points_allowed: row.points_allowed,
    }));
  } catch (error) {
    if (error instanceof DefenseUnavailableError) {
      return grouped?.get(week) ?? [];
    }
    throw error;
  }
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
    const team = normalizeTeamAbbreviation(snap.team);
    if (!team || !snap.player_id) continue;
    if (!snapMap.has(team)) snapMap.set(team, new Map());
    const playerMap = snapMap.get(team)!;
    const id = snap.player_id;
    playerMap.set(id, (playerMap.get(id) ?? 0) + snap.defense_snaps);
  }
  const dstMap = new Map<string, number>();
  for (const teamInput of teams) {
    const team = normalizeTeamAbbreviation(teamInput.team);
    if (!team) continue;
    dstMap.set(team, computeDstPoints(teamInput));
  }
  const teamsSet = new Set<string>([...snapMap.keys(), ...dstMap.keys()]);
  const resultTeams: DefenseWeek["teams"] = [];
  for (const team of teamsSet) {
    const normalizedTeam = normalizeTeamAbbreviation(team);
    if (!normalizedTeam) continue;
    const playerMap = snapMap.get(normalizedTeam) ?? new Map();
    const players = Array.from(playerMap.entries())
      .filter(([, snaps]) => snaps > 0)
      .map(([player_id, snaps]) => ({ player_id, snaps }));
    resultTeams.push({
      team: normalizedTeam,
      dstPoints: Number((dstMap.get(normalizedTeam) ?? 0).toFixed(2)),
      players,
    });
  }
  return { teams: resultTeams };
};

const ensureDefenseLeaders = (
  leaders: Leader[],
  leaderMap: Map<string, Leader>,
  snaps: DefSnapRow[],
  playersData: PlayersMasterData,
  rosterLookup: RosterCollegeLookup,
) => {
  for (const snap of snaps) {
    const id = snap.player_id;
    if (!id) continue;
    const key = String(id);
    const playerRow = resolvePlayerRow(
      { player_id: snap.player_id, alt_ids: snap.alt_ids, player_name: snap.name, team: snap.team },
      playersData.lookup,
    );
    const rawTeam = (snap.team || (playerRow?.team as string) || (playerRow?.recent_team as string) || "").toString().trim();
    const normalizedTeam = normalizeTeamAbbreviation(rawTeam);
    const team = normalizedTeam || undefined;
    const resolvedName =
      (typeof playerRow?.full_name === "string" && playerRow.full_name.trim()) ? playerRow.full_name :
      (typeof playerRow?.player_name === "string" && playerRow.player_name.trim()) ? playerRow.player_name :
      snap.name || "Unknown";
    const positionSource =
      (typeof playerRow?.position === "string" && playerRow.position.trim()) ? playerRow.position :
      (typeof (playerRow as { depth_chart_position?: unknown })?.depth_chart_position === "string"
        && (playerRow as { depth_chart_position?: string }).depth_chart_position!.trim())
        ? (playerRow as { depth_chart_position?: string }).depth_chart_position!
        : (typeof (playerRow as { gsis_position?: unknown })?.gsis_position === "string"
        && (playerRow as { gsis_position?: string }).gsis_position!.trim())
        ? (playerRow as { gsis_position?: string }).gsis_position!
        : "";
    const position = (positionSource || "DEF").toUpperCase();
    const rosterAltIds: string[] = [];
    if (Array.isArray(snap.alt_ids)) rosterAltIds.push(...snap.alt_ids);
    if (playerRow) rosterAltIds.push(...collectPlayerRowIds(playerRow));
    const rosterCollege = resolveCollegeFromRoster(
      {
        player_id: snap.player_id ?? playerRow?.player_id,
        alt_ids: rosterAltIds,
        player_name: resolvedName,
        team,
      },
      rosterLookup,
    );
    const resolvedCollege =
      rosterCollege ??
      resolveCollegeFromMaster(
        { player_id: playerRow?.player_id ?? snap.player_id, player_name: resolvedName, team },
        playersData.maps,
      );
    if (!leaderMap.has(key)) {
      const leader: Leader = {
        player_id: id,
        full_name: resolvedName,
        position,
        team,
        points: 0,
        college: resolvedCollege,
      };
      leaders.push(leader);
      leaderMap.set(key, leader);
    } else {
      const existing = leaderMap.get(key)!;
      if (!existing.team && team) existing.team = team;
      if ((!existing.position || existing.position === "") && position) existing.position = position;
      if ((!existing.college || existing.college === "Unknown") && resolvedCollege !== "Unknown") {
        existing.college = resolvedCollege;
      }
    }
  }
};

export async function loadWeek(options: LoadWeekOptions): Promise<LoadWeekResult> {
  const season = options.season;
  const week = options.week;
  const format = options.format;
  const includeDefense = options.includeDefense ?? false;
  let playersData: PlayersMasterData;
  try {
    playersData = await ensurePlayersMasterData();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new HttpError(500, "PLAYERS_MASTER_FETCH_FAILED", {
      detail: err.message,
      cause: err,
      code: "PLAYERS_MASTER_FETCH_FAILED",
    });
  }
  const stats = await fetchWeeklyPlayerStats(season, week);
  const playerStatsSource = playerStatsSeasonMeta.get(season);
  const effectiveSeason = playerStatsSource?.seasonLoaded ?? season;
  const rosterLookup = await playersData.getRosterColleges(effectiveSeason);
  const leaders: Leader[] = [];
  const leaderMap = new Map<string, Leader>();
  for (const stat of stats) {
    const playerRow = resolvePlayerRow(stat, playersData.lookup);
    const name =
      (typeof playerRow?.full_name === "string" && playerRow.full_name.trim()) ? playerRow.full_name :
      (stat.name && stat.name.trim()) ? stat.name :
      (typeof playerRow?.player_name === "string" && playerRow.player_name.trim()) ? playerRow.player_name :
      "Unknown";
    const teamRaw =
      (stat.team && stat.team.trim()) ? stat.team :
      (typeof playerRow?.team === "string" && playerRow.team.trim()) ? playerRow.team :
      (typeof playerRow?.recent_team === "string" && playerRow.recent_team.trim()) ? playerRow.recent_team :
      "";
    const normalizedTeam = normalizeTeamAbbreviation(teamRaw);
    const team = normalizedTeam || undefined;
    const positionSource =
      (stat.position && stat.position.trim()) ? stat.position :
      (typeof playerRow?.position === "string" && playerRow.position.trim()) ? playerRow.position :
      (typeof (playerRow as { depth_chart_position?: unknown })?.depth_chart_position === "string"
        && (playerRow as { depth_chart_position?: string }).depth_chart_position!.trim())
        ? (playerRow as { depth_chart_position?: string }).depth_chart_position!
        : (typeof (playerRow as { gsis_position?: unknown })?.gsis_position === "string"
        && (playerRow as { gsis_position?: string }).gsis_position!.trim())
        ? (playerRow as { gsis_position?: string }).gsis_position!
        : "";
    const position = (positionSource || "").toUpperCase();
    const rosterAltIds: string[] = [];
    if (Array.isArray(stat.alt_ids)) rosterAltIds.push(...stat.alt_ids);
    if (playerRow) rosterAltIds.push(...collectPlayerRowIds(playerRow));
    const rosterCollege = resolveCollegeFromRoster(
      {
        player_id: stat.player_id ?? playerRow?.player_id,
        alt_ids: rosterAltIds,
        player_name: playerRow?.full_name ?? playerRow?.player_name ?? stat.name,
        name,
        team,
      },
      rosterLookup,
    );
    const college =
      rosterCollege ??
      resolveCollegeFromMaster(
        { player_id: playerRow?.player_id ?? stat.player_id, player_name: playerRow?.full_name ?? name, team },
        playersData.maps,
      );
    const points = computeFantasyPoints(stat, format);
    const leader: Leader = {
      player_id: stat.player_id,
      full_name: name,
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
      fetchDefensiveSnaps(effectiveSeason, week),
      fetchTeamDefenseInputs(effectiveSeason, week),
    ]);
    ensureDefenseLeaders(leaders, leaderMap, snaps, playersData, rosterLookup);
    defenseData = buildDefenseWeek(snaps, defenseInputs);
  }
  return { leaders, defenseData, playerStatsSource };
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
