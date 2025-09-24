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
  team: ["team", "team_abbr", "posteam", "abbr"] as const,
  opponent: ["opponent", "opp", "defteam", "opp_abbr"] as const,
  week: ["week", "game_week", "wk"] as const,
  pointsFor: ["points_scored", "points", "pts"] as const,
  sacks: ["sacks", "pass_sacks", "sacks_allowed"] as const,
  interceptions: ["interceptions", "int", "ints", "pass_interceptions"] as const,
  fumbles: ["fumbles_lost", "fumbles", "fumlost"] as const,
} as const satisfies Record<string, KeyList>;

async function fetchSeasonCsv(season: number): Promise<string> {
  const source = DEFENSE_SOURCE(season);
  const response = await fetch(source, { redirect: "follow", cache: "no-store" });
  if (response.status === 404) {
    throw new DefenseUnavailableError("Team offense stats not available yet", source);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source}`);
  }
  return response.text();
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
  try {
    csvText = await fetchSeasonCsv(season);
  } catch (error) {
    if (error instanceof DefenseUnavailableError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new DefenseUnavailableError("stats file empty", DEFENSE_SOURCE(season));
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
    source: DEFENSE_SOURCE(season),
    mode: "approx-opponent-offense",
    rows: output,
  };
}
