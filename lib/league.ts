
export type MatchRecord = { season:number; week:number; format:string; mode:'weekly'|'avg'; home:string; away:string; homePoints:number; awayPoints:number; winner:'home'|'away'|'tie'; timestamp:number; };
export type StandingsRow = { school:string; wins:number; losses:number; ties:number; pointsFor:number; pointsAgainst:number; };
const RECORDS_PATH = process.env.RECORDS_PATH || "data/records.json";
const ENABLE_WRITE = (process.env.ENABLE_WRITE || "true").toLowerCase() === "true";
import { promises as fs } from "fs";
export async function loadRecords(): Promise<MatchRecord[]> { try { return JSON.parse(await fs.readFile(RECORDS_PATH, "utf-8")); } catch { return []; } }
export async function saveRecord(r: MatchRecord) { if (!ENABLE_WRITE) return; const arr = await loadRecords(); arr.push(r); await fs.mkdir(RECORDS_PATH.split('/').slice(0,-1).join('/'), { recursive: true }); await fs.writeFile(RECORDS_PATH, JSON.stringify(arr,null,2), "utf-8"); }
export function computeStandings(records: MatchRecord[]): StandingsRow[] {
  const map = new Map<string, StandingsRow>(); const row = (s:string)=> map.get(s) ?? (map.set(s,{school:s,wins:0,losses:0,ties:0,pointsFor:0,pointsAgainst:0}), map.get(s)!);
  for (const r of records) { const h=row(r.home), a=row(r.away); h.pointsFor+=r.homePoints; h.pointsAgainst+=r.awayPoints; a.pointsFor+=r.awayPoints; a.pointsAgainst+=r.homePoints;
    if (r.winner==='home'){h.wins++; a.losses++;} else if(r.winner==='away'){a.wins++; h.losses++;} else {h.ties++; a.ties++;} }
  return Array.from(map.values()).sort((x,y)=>{ const xp=(x.wins+x.ties*0.5)/Math.max(1,x.wins+x.losses+x.ties); const yp=(y.wins+y.ties*0.5)/Math.max(1,y.wins+y.losses+y.ties);
    if (yp!==xp) return yp-xp; const xd=x.pointsFor-x.pointsAgainst, yd=y.pointsFor-y.pointsAgainst; return yd-xd; });
}
