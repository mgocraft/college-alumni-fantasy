
import { NextResponse } from "next/server";
import { fetchWeeklyLeaders, fetchWeeklyLeadersRange } from "@/lib/fnClient";
import { aggregateByCollegeMode } from "@/lib/scoring";

export const revalidate = Number(process.env.CACHE_SECONDS ?? 3600);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") ?? "2025");
  const week = Number(url.searchParams.get("week") ?? "1");
  const format = url.searchParams.get("format") ?? "ppr";
  const mode = (url.searchParams.get("mode") as 'weekly'|'avg') ?? 'weekly';
  const includeK = (url.searchParams.get("includeK") ?? "true").toLowerCase() !== "false";
  const defense = (url.searchParams.get("defense") as 'none'|'approx') ?? 'none';

  try {
    const leaders = await fetchWeeklyLeaders({ week, format, position: "ALL" });
    let averages: Record<string,number>|undefined;
    if (mode==='avg' && week>1) {
      const hist = await fetchWeeklyLeadersRange({ startWeek:1, endWeek: week-1, format, position: "ALL" });
      const sums:Record<string,number>={}, counts:Record<string,number>={};
      for (const w of hist) for (const p of w as any[]) { const id=String(p.player_id); sums[id]=(sums[id]??0)+(p.points??0); counts[id]=(counts[id]??0)+1; }
      averages = {}; for (const id of Object.keys(sums)) averages[id] = sums[id] / Math.max(1, counts[id]);
    }
    const bySchool = await aggregateByCollegeMode(leaders as any, week, format, mode, averages, { includeK, defense, season });
    return NextResponse.json({ season, week, format, mode, includeK, defense, count: bySchool.length, results: bySchool });
  } catch (e:any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
