import { promises as fs } from "fs";
import path from "path";
import { createErrorWithCause } from "./errors";

export type MatchRecord = {
  season: number;
  week: number;
  format: string;
  mode: "weekly" | "avg";
  home: string;
  away: string;
  homePoints: number;
  awayPoints: number;
  winner: "home" | "away" | "tie";
  timestamp: number;
};

export type StandingsRow = {
  school: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
};

const RECORDS_PATH = process.env.RECORDS_PATH || "data/records.json";
const ENABLE_WRITE = (process.env.ENABLE_WRITE || "true").toLowerCase() === "true";

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: string }).code === "ENOENT";

const recordsDir = () => path.dirname(path.resolve(RECORDS_PATH));

export async function loadRecords(): Promise<MatchRecord[]> {
  try {
    const raw = await fs.readFile(RECORDS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid data in ${RECORDS_PATH}: expected an array`);
    }
    return parsed as MatchRecord[];
  } catch (error) {
    if (isEnoent(error)) return [];
    if (error instanceof Error) {
      throw createErrorWithCause(`Failed to load records from ${RECORDS_PATH}: ${error.message}`, error);
    }
    throw error;
  }
}

export async function saveRecord(record: MatchRecord) {
  if (!ENABLE_WRITE) return;
  const records = await loadRecords();
  records.push(record);
  await fs.mkdir(recordsDir(), { recursive: true });
  await fs.writeFile(RECORDS_PATH, JSON.stringify(records, null, 2), "utf-8");
}

export function computeStandings(records: MatchRecord[]): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();

  const ensureRow = (school: string): StandingsRow => {
    if (!rows.has(school)) {
      rows.set(school, {
        school,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      });
    }
    return rows.get(school)!;
  };

  for (const record of records) {
    const home = ensureRow(record.home);
    const away = ensureRow(record.away);

    home.pointsFor += record.homePoints;
    home.pointsAgainst += record.awayPoints;
    away.pointsFor += record.awayPoints;
    away.pointsAgainst += record.homePoints;

    if (record.winner === "home") {
      home.wins += 1;
      away.losses += 1;
    } else if (record.winner === "away") {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.ties += 1;
      away.ties += 1;
    }
  }

  const toWinPct = (row: StandingsRow) => {
    const games = row.wins + row.losses + row.ties;
    if (games === 0) return 0;
    return (row.wins + row.ties * 0.5) / games;
  };

  return Array.from(rows.values()).sort((a, b) => {
    const pctDiff = toWinPct(b) - toWinPct(a);
    if (pctDiff !== 0) return pctDiff;
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    return diffB - diffA;
  });
}
