
import { promises as fs } from "fs";
export type DefenseWeekFile = { teams: { team: string; dstPoints: number; players: { player_id: string | number; snaps: number }[]; }[]; };
export async function loadDefenseWeek(season: number, week: number): Promise<DefenseWeekFile | null> {
  const p = `data/defense/${season}/week-${week}.json`; try { const raw = await fs.readFile(p, "utf-8"); return JSON.parse(raw); } catch { return null; }
}
