
import { NextResponse } from "next/server";
import { fetchWeeklyLeaders, fetchWeeklyLeadersRange } from "@/lib/fnClient";
import { aggregateByCollegeMode } from "@/lib/scoring";

export const revalidate = Number(process.env.CACHE_SECONDS ?? 3600);

export async function GET(req: Request, { params }: { params: { school: string }}) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") ?? "2025");
  const startWeek = Number(url.searchParams.get("startWeek") ?? "1");
  const endWeek = Number(url.searchParams.get("endWeek") ?? "18");
  const format = url.searchParams.get("format") ?? "ppr";
  const mode = (url.searchParams.get("mode") as 'weekly'|'avg') ?? 'weekly';
  const includeK = (url.searchParams.get("includeK") ?? "true").toLowerCase() !== "false";
  const defense = (url.searchParams.get("defense") as 'none'|'approx') ?? 'none';
  const schoolParam = decodeURIComponent(params.school);

  try {
    const weeks = Array.from({ length: endWeek - startWeek + 1 }, (_,i)=> startWeek + i);
    const series = await Promise.all(weeks.map(async (w) => {
      const leaders = await fetchWeeklyLeaders({ week: w, format, position: "ALL" });
      let averages: Record<string,number>|undefined;
      if (mode==='avg' && w>1) {
        const hist = await fetchWeeklyLeadersRange({ startWeek:1, endWeek: w-1, format, position:"ALL" });
        const sums:Record<string,number>={}, counts:Record<string,number>={};
        for (const wk of hist) for (const p of wk as any[]) { const id=String(p.player_id); sums[id]=(sums[id]??0)+(p.points??0); counts[id]=(counts[id]??0)+1; }
        averages={}; for (const id of Object.keys(sums)) averages[id]=sums[id]/Math.max(1,counts[id]);
      }
      const bySchool = await aggregateByCollegeMode(leaders as any, w, format, mode, averages, { includeK, defense, season });
      const match = bySchool.find(r => r.school.toLowerCase() === schoolParam.toLowerCase());
      return match ? { week: w, totalPoints: match.totalPoints, performers: match.performers } : { week: w, totalPoints: 0, performers: [] };
    }));
    return NextResponse.json({ school: schoolParam, season, format, mode, includeK, defense, series });
  } catch (e:any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
