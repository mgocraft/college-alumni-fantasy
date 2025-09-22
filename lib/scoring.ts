
import type { Leader, SchoolAggregate } from "./types";
import type { DefenseWeek } from "./nflverse";

type Mode = 'weekly' | 'avg';
type DefenseMode = 'none' | 'approx';

function byPosition(players: Leader[], pos: string) { return players.filter(p => (p.position||'').toUpperCase() === pos.toUpperCase()); }
function isDefPos(pos?: string) { const p=(pos||'').toUpperCase(); return ['LB','DB','DL','DE','DT','S','CB','OLB','ILB','EDGE','FS','SS','NT'].includes(p); }
function sortBy(points: Record<string, number>) { return (a: Leader, b: Leader) => (points[String(b.player_id)] ?? 0) - (points[String(a.player_id)] ?? 0); }
function lineupForSchool(players: Leader[], selectorPoints: Record<string, number>, includeK: boolean) {
  const qbs=byPosition(players,'QB').sort(sortBy(selectorPoints)), rbs=byPosition(players,'RB').sort(sortBy(selectorPoints)), wrs=byPosition(players,'WR').sort(sortBy(selectorPoints)), tes=byPosition(players,'TE').sort(sortBy(selectorPoints)), ks=byPosition(players,'K').sort(sortBy(selectorPoints));
  const pick=(arr:Leader[], n:number)=>arr.slice(0, Math.max(0,n));
  const chosen: Leader[] = []; chosen.push(...pick(qbs,1), ...pick(tes,1), ...pick(wrs,2), ...pick(rbs,2)); if (includeK) chosen.push(...pick(ks,1));
  const chosenIds=new Set(chosen.map(p=>String(p.player_id))); const remWR=wrs.filter(p=>!chosenIds.has(String(p.player_id))), remRB=rbs.filter(p=>!chosenIds.has(String(p.player_id))), remTE=tes.filter(p=>!chosenIds.has(String(p.player_id)));
  const flex=[...pick(remWR,1),...pick(remRB,1),...pick(remTE,1)].sort(sortBy(selectorPoints)); if (flex.length) chosen.push(flex[0]); return chosen;
}

const cleanCollegeValue = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

const extractCollegeNames = (college: Leader['college']): string[] => {
  const sources = Array.isArray(college)
    ? college
    : college === null || college === undefined
      ? []
      : [college];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const source of sources) {
    if (source === null || source === undefined) continue;
    const parts = String(source)
      .split(';')
      .map(cleanCollegeValue)
      .filter(Boolean);
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(part);
    }
  }
  return result;
};

const normalizeCollegeName = (value: string): string => {
  if (!value) return 'Unknown';
  const lower = value.toLowerCase();
  return lower === 'unknown' ? 'Unknown' : value;
};

export async function aggregateByCollegeMode(
  leaders: Leader[], week: number, format: string, mode: Mode, historicalAverages: Record<string, number> | undefined,
  opts: { includeK: boolean; defense: DefenseMode; defenseData?: DefenseWeek } = { includeK: true, defense: 'none' }
): Promise<SchoolAggregate[]> {
  const thisWeekPoints: Record<string, number> = {}; for (const l of leaders) thisWeekPoints[String(l.player_id)] = l.points || 0;
  const selectorPoints = (mode==='avg' && historicalAverages) ? historicalAverages : thisWeekPoints;

  // group by college
  const groups = new Map<string, Leader[]>();
  for (const leader of leaders) {
    const extracted = extractCollegeNames(leader.college).map(normalizeCollegeName);
    const colleges = extracted.filter((name, _idx, arr) => name !== 'Unknown' || arr.length === 1);
    const targets = colleges.length ? colleges : ['Unknown'];
    for (const college of targets) {
      if (!groups.has(college)) groups.set(college, []);
      groups.get(college)!.push({ ...leader, college } as Leader);
    }
  }

  const defenseData = opts.defense === 'approx' ? (opts.defenseData ?? null) : null;
  const teamDefense: Record<string, { dstPoints:number; totalSnaps:number; snapsById:Record<string,number> }> = {};
  if (defenseData) for (const t of defenseData.teams) { const total=t.players.reduce((s:any,p:any)=>s+(p.snaps||0),0); const map:Record<string,number>={}; for (const p of t.players) map[String(p.player_id)] = p.snaps||0; teamDefense[t.team.toUpperCase()] = { dstPoints: t.dstPoints||0, totalSnaps: total, snapsById: map }; }

  const results: SchoolAggregate[] = [];
  for (const [school, players] of groups) {
    const chosen = lineupForSchool(players, selectorPoints, opts.includeK);
    let total = chosen.reduce((s, p) => s + (thisWeekPoints[String(p.player_id)] ?? 0), 0);

    if (opts.defense==='approx' && defenseData) {
      const defs = players.filter(p => isDefPos(p.position));
      const credits: { player: Leader; credit: number }[] = [];
      for (const p of defs) {
        const team=(p.team||'').toUpperCase(); const t=teamDefense[team]; if (!t || t.totalSnaps<=0) continue;
        const snaps=t.snapsById[String(p.player_id)] ?? 0; const share=snaps/t.totalSnaps; const credit=t.dstPoints*share; if (credit>0) credits.push({ player: p, credit });
      }
      credits.sort((a,b)=>b.credit-a.credit); const top11=credits.slice(0,11); const defPoints = Number(top11.reduce((s,c)=>s+c.credit,0).toFixed(2));
      total += defPoints;
      // Add display-only DEF row with contributor list
      // @ts-ignore
      chosen.push({ player_id:`DEF-${school}-${week}`, full_name:'Defense', position:'DEF', team: undefined, points: defPoints as any, meta: { contributors: top11.map(x=>({ label: (x.player as any)?.full_name || `ID ${(x.player as any)?.player_id ?? ''}`, points: Number(x.credit.toFixed(2)) })) } } as any);
    }

    results.push({
      school, week, format, totalPoints: Number(total.toFixed(2)),
      performers: chosen.map(p => ({
        name: (p as any).full_name,
        position: (p as any).position,
        team: (p as any).team,
        points: thisWeekPoints[String((p as any).player_id)] ?? (p as any).points,
        college: (p as Leader).college,
        meta: (p as any).meta
      }))
    });
  }
  results.sort((a,b)=>b.totalPoints - a.totalPoints); return results;
}
