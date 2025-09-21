import { fetchBuffer } from "./http";
import { playersMasterCandidates } from "./nflverseUrls";
import { normalize } from "./utils";

export type PlayersMasterRow = {
  player_id?: string;
  gsis_id?: string;
  nfl_id?: string;
  pfr_id?: string;
  full_name?: string;
  player_name?: string;
  recent_team?: string;
  team?: string;
  position?: string;
  college?: string;
  college_name?: string;
  [key: string]: unknown;
};

const parseCsv = (text: string): PlayersMasterRow[] => {
  const rows: string[][] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let current = "";
  let currentRow: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === "\"") {
        if (normalized[i + 1] === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      currentRow.push(current);
      current = "";
    } else if (char === "\n") {
      currentRow.push(current);
      rows.push(currentRow);
      currentRow = [];
      current = "";
    } else {
      current += char;
    }
  }
  if (current.length > 0 || currentRow.length > 0) {
    currentRow.push(current);
    rows.push(currentRow);
  }
  if (!rows.length) return [];
  const headers = (rows.shift() ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  const result: PlayersMasterRow[] = [];
  for (const row of rows) {
    if (!row.some((cell) => cell && cell.trim().length)) continue;
    const entry: PlayersMasterRow = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      if (!key) continue;
      entry[key] = (row[i] ?? "").trim();
    }
    result.push(entry);
  }
  return result;
};

export async function loadPlayersMaster(): Promise<PlayersMasterRow[]> {
  let lastErr: unknown;
  for (const url of playersMasterCandidates) {
    try {
      const buf = await fetchBuffer(url);
      const text = Buffer.from(buf).toString("utf-8");
      const parsed = parseCsv(text);
      return parsed.filter(Boolean);
    } catch (error) {
      lastErr = error;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`PLAYERS_MASTER_FETCH_FAILED: ${message}`);
}

const norm = (value: unknown): string => (value ?? "").toString().trim();
const nameKey = (value: string) => normalize(value ?? "");
const nkey = (name: string, team: string) => `${name.toLowerCase().replace(/\s+/g, " ")}|${team.toUpperCase()}`;

const appendIdCandidate = (set: Set<string>, value: unknown) => {
  const id = norm(value);
  if (id) set.add(id);
};

const collectIds = (row: PlayersMasterRow): string[] => {
  const ids = new Set<string>();
  const fields = [
    "player_id",
    "gsis_id",
    "gsis_it_id",
    "gsis_player_id",
    "nfl_id",
    "pfr_id",
    "pfr_player_id",
    "esb_id",
    "espn_id",
    "sportradar_id",
    "yahoo_id",
    "rotowire_id",
    "rotoworld_id",
    "fantasypros_id",
    "cfbref_id",
    "sleeper_id",
    "draftkings_id",
    "fanduel_id",
  ];
  for (const field of fields) {
    appendIdCandidate(ids, (row as Record<string, unknown>)[field]);
  }
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null) continue;
    const lower = key.toLowerCase();
    if (lower === "id" || lower.endsWith("_id") || lower.endsWith("id")) {
      appendIdCandidate(ids, value);
    }
  }
  return Array.from(ids);
};

export function buildCollegeMaps(rows: PlayersMasterRow[]) {
  const byId = new Map<string, string>();
  const byNameTeam = new Map<string, string>();

  for (const r of rows) {
    const name = norm(r.full_name ?? r.player_name);
    const team = norm(r.team ?? r.recent_team);
    const college = norm(r.college_name ?? r.college);

    if (college) {
      for (const id of collectIds(r)) {
        if (id) byId.set(id, college);
      }
    }
    if (name && team && college) byNameTeam.set(nkey(name, team), college);
  }

  return { byId, byNameTeam };
}

export function resolveCollege(
  stat: { player_id?: unknown; player_name?: string; team?: string },
  maps: { byId: Map<string, string>; byNameTeam: Map<string, string> },
): string {
  const id = norm(stat.player_id);
  const name = norm(stat.player_name ?? "");
  const team = norm(stat.team ?? "");
  return maps.byId.get(id) || maps.byNameTeam.get(nkey(name, team)) || "Unknown";
}

export type PlayersMasterLookup = {
  byId: Map<string, PlayersMasterRow>;
  byNameTeam: Map<string, PlayersMasterRow>;
  byName: Map<string, PlayersMasterRow>;
};

export function buildPlayersLookup(rows: PlayersMasterRow[]): PlayersMasterLookup {
  const byId = new Map<string, PlayersMasterRow>();
  const byNameTeam = new Map<string, PlayersMasterRow>();
  const byName = new Map<string, PlayersMasterRow>();

  for (const row of rows) {
    for (const id of collectIds(row)) {
      if (!byId.has(id)) byId.set(id, row);
    }
    const name = norm(row.full_name ?? row.player_name ?? "");
    const team = norm(row.team ?? row.recent_team ?? "");
    const nk = name ? nameKey(name) : "";
    if (nk && !byName.has(nk)) byName.set(nk, row);
    if (name && team) {
      const key = nkey(name, team);
      if (!byNameTeam.has(key)) byNameTeam.set(key, row);
    }
  }
  return { byId, byNameTeam, byName };
}

export function resolvePlayerRow(
  stat: { player_id?: unknown; alt_ids?: unknown[]; player_name?: string; name?: string; team?: string },
  lookup: PlayersMasterLookup,
): PlayersMasterRow | undefined {
  const ids = new Set<string>();
  appendIdCandidate(ids, stat.player_id);
  if (Array.isArray(stat.alt_ids)) {
    for (const candidate of stat.alt_ids) appendIdCandidate(ids, candidate);
  }
  for (const id of ids) {
    if (lookup.byId.has(id)) return lookup.byId.get(id);
  }
  const rawName = stat.player_name ?? stat.name ?? "";
  const name = norm(rawName);
  const team = norm(stat.team ?? "");
  if (name && team) {
    const key = nkey(name, team);
    if (lookup.byNameTeam.has(key)) return lookup.byNameTeam.get(key);
  }
  if (name) {
    const key = nameKey(name);
    if (lookup.byName.has(key)) return lookup.byName.get(key);
  }
  return undefined;
}
