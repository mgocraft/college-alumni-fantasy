import { gunzipSync } from "node:zlib";

export const DEFENSE_SOURCE = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/nflfastR-weekly/stats_team_week_${season}.csv`;

export const DEFENSE_SCORING = {
  sack: 1,
  interception: 2,
  fumble_recovery: 2,
  td: 6,
  safety: 2,
  block: 2,
  points_allowed: [
    { max: 0, pts: 10 },
    { max: 6, pts: 7 },
    { max: 13, pts: 4 },
    { max: 20, pts: 1 },
    { max: 27, pts: 0 },
    { max: 34, pts: -1 },
    { max: Number.POSITIVE_INFINITY, pts: -4 },
  ] as const,
} as const;

export class DefenseUnavailableError extends Error {
  source?: string;

  constructor(message: string, source?: string) {
    super(message);
    this.name = "DefenseUnavailableError";
    this.source = source;
  }
}

type CsvRow = Record<string, string>;

type KeyList = readonly string[];

const pickKey = (row: CsvRow, candidates: KeyList): string => {
  for (const key of candidates) {
    if (key in row) return key;
  }
  return "";
};

const TEAM_ALIAS: Record<string, string> = {
  JAX: "JAC",
  WSH: "WAS",
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
  LA: "LAR",
};

const normalizeTeam = (team?: string): string => {
  if (!team) return "";
  const trimmed = team.trim().toUpperCase();
  return TEAM_ALIAS[trimmed] ?? trimmed;
};

const sanitizeNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(/[^0-9.\-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseCsv = (text: string): CsvRow[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    const cols = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) ?? [];
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      const raw = cols[index] ?? "";
      row[header] = raw.replace(/^"|"$/g, "");
    });
    return row;
  });
};

const pointsAllowedBucket = (pointsAllowed: number): number => {
  for (const bucket of DEFENSE_SCORING.points_allowed) {
    if (pointsAllowed <= bucket.max) return bucket.pts;
  }
  return -4;
};

export type DefenseApproxRow = {
  team: string;
  week: number;
  points_allowed: number;
  sacks: number;
  interceptions: number;
  fumbles_recovered: number;
  score: number;
};

export type DefenseApproxResult = {
  season: number;
  week: number;
  source: string;
  mode: "approx-opponent-offense";
  rows: DefenseApproxRow[];
};

const KEY_CANDIDATES = {
  team: [
    "team",
    "team_abbr",
    "posteam",
    "abbr",
    "club_code",
    "team_code",
    "recent_team",
  ] as const,
  opponent: [
    "opponent",
    "opp",
    "defteam",
    "opp_abbr",
    "opponent_team",
    "opponent_team_abbr",
    "opp_team",
    "opp_club_code",
  ] as const,
  week: ["week", "game_week", "wk", "week_num", "week_number"] as const,
  pointsFor: ["points_scored", "points", "pts", "points_for", "points_for_total"] as const,
  sacks: ["sacks", "pass_sacks", "sacks_allowed", "pass_sacks_allowed", "sacks_taken"] as const,
  interceptions: [
    "interceptions",
    "int",
    "ints",
    "pass_interceptions",
    "interceptions_thrown",
    "pass_interceptions_thrown",
  ] as const,
  fumbles: [
    "fumbles_lost",
    "fumbles",
    "fumlost",
    "fumbles_lost_offense",
    "fumbles_lost_total",
  ] as const,
} as const satisfies Record<string, KeyList>;

const GZIP_HEADER = 0x1f;
const GZIP_HEADER_2 = 0x8b;

const getHeader = (headers: unknown, name: string): string | undefined => {
  if (!headers || typeof headers !== "object") return undefined;
  const candidate = (headers as { get?: (key: string) => unknown }).get;
  if (typeof candidate !== "function") return undefined;
  const value = candidate.call(headers, name);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return undefined;
  return String(value);
};

const shouldGunzip = (buffer: Buffer, headers?: unknown): boolean => {
  const encoding = getHeader(headers, "content-encoding");
  const contentType = getHeader(headers, "content-type");
  const check = (value: string | undefined): boolean =>
    typeof value === "string" && value.toLowerCase().includes("gzip");
  if (check(encoding) || check(contentType)) return true;
  return buffer.length >= 2 && buffer[0] === GZIP_HEADER && buffer[1] === GZIP_HEADER_2;
};

const decodeCsvBuffer = (buffer: Buffer, source: string, headers?: unknown): string => {
  if (buffer.length === 0) return "";
  if (!shouldGunzip(buffer, headers)) {
    return buffer.toString("utf-8");
  }
  try {
    return gunzipSync(buffer).toString("utf-8");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new Error(`Failed to unzip ${source}: ${err.message}`);
  }
};

async function fetchSeasonCsv(season: number): Promise<{ text: string; source: string }> {
  const baseSource = DEFENSE_SOURCE(season);
  const candidates = [baseSource, `${baseSource}.gz`];
  let lastUnavailable: DefenseUnavailableError | undefined;

  for (const source of candidates) {
    const response = await fetch(source, { redirect: "follow", cache: "no-store" });
    if (response.status === 404) {
      lastUnavailable = new DefenseUnavailableError("Team offense stats not available yet", source);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${source}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = decodeCsvBuffer(buffer, source, response.headers);
    return { text, source };
  }

  if (lastUnavailable) {
    throw lastUnavailable;
  }

  throw new DefenseUnavailableError("Team offense stats not available yet", candidates[candidates.length - 1]);
}

const toWeekNumber = (value: unknown): number | undefined => {
  const parsed = sanitizeNumber(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : undefined;
};

export async function fetchDefenseApprox({
  season,
  week,
}: {
  season: number;
  week?: number;
}): Promise<DefenseApproxResult> {
  let csvText: string;
  let source: string;
  try {
    const result = await fetchSeasonCsv(season);
    csvText = result.text;
    source = result.source;
  } catch (error) {
    if (error instanceof DefenseUnavailableError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new DefenseUnavailableError("stats file empty", source ?? DEFENSE_SOURCE(season));
  }

  const firstRow = rows[0];
  const teamKey = pickKey(firstRow, KEY_CANDIDATES.team);
  const opponentKey = pickKey(firstRow, KEY_CANDIDATES.opponent);
  const weekKey = pickKey(firstRow, KEY_CANDIDATES.week);
  const pointsForKey = pickKey(firstRow, KEY_CANDIDATES.pointsFor);
  const sacksKey = pickKey(firstRow, KEY_CANDIDATES.sacks);
  const interceptionsKey = pickKey(firstRow, KEY_CANDIDATES.interceptions);
  const fumblesKey = pickKey(firstRow, KEY_CANDIDATES.fumbles);

  const weekGroups = new Map<number, CsvRow[]>();
  for (const row of rows) {
    const weekValue = toWeekNumber(weekKey ? row[weekKey] : undefined);
    if (weekValue === undefined) continue;
    const list = weekGroups.get(weekValue) ?? [];
    list.push(row);
    weekGroups.set(weekValue, list);
  }

  const weekCandidates = Array.from(weekGroups.keys()).sort((a, b) => a - b);
  const requestedWeek = typeof week === "number" && Number.isFinite(week) && week > 0 ? Math.trunc(week) : undefined;
  const selectedWeek = requestedWeek ?? weekCandidates[weekCandidates.length - 1];

  const subset = selectedWeek ? weekGroups.get(selectedWeek) ?? [] : [];
  const offenseByTeam = new Map<string, CsvRow>();
  for (const row of subset) {
    const team = normalizeTeam(teamKey ? row[teamKey] : undefined);
    if (!team) continue;
    if (!offenseByTeam.has(team)) offenseByTeam.set(team, row);
  }

  const output: DefenseApproxRow[] = [];
  for (const row of subset) {
    const team = normalizeTeam(teamKey ? row[teamKey] : undefined);
    const opponent = normalizeTeam(opponentKey ? row[opponentKey] : undefined);
    if (!team || !opponent) continue;
    const opponentRow = offenseByTeam.get(opponent);
    if (!opponentRow) continue;

    const pointsAllowed = sanitizeNumber(pointsForKey ? opponentRow[pointsForKey] : undefined);
    const sacks = sanitizeNumber(sacksKey ? opponentRow[sacksKey] : undefined);
    const interceptions = sanitizeNumber(interceptionsKey ? opponentRow[interceptionsKey] : undefined);
    const fumblesRecovered = sanitizeNumber(fumblesKey ? opponentRow[fumblesKey] : undefined);

    const score =
      pointsAllowedBucket(pointsAllowed) +
      (sacks * DEFENSE_SCORING.sack) +
      (interceptions * DEFENSE_SCORING.interception) +
      (fumblesRecovered * DEFENSE_SCORING.fumble_recovery);

    output.push({
      team,
      week: selectedWeek ?? 0,
      points_allowed: pointsAllowed,
      sacks,
      interceptions,
      fumbles_recovered: fumblesRecovered,
      score,
    });
  }

  return {
    season,
    week: selectedWeek ?? 0,
    source: source ?? DEFENSE_SOURCE(season),
    mode: "approx-opponent-offense",
    rows: output,
  };
}
