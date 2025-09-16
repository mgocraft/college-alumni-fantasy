
import { NextResponse } from "next/server";
import { aggregateByCollegeMode } from "@/lib/scoring";
import { loadWeek, computeHistoricalAverages } from "@/lib/nflverse";

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
    const includeDefense = defense === 'approx';
    const series = await Promise.all(weeks.map(async (w) => {
      const weekPromise = loadWeek({ season, week: w, format, includeDefense });
      const averagesPromise: Promise<Record<string, number> | undefined> =
        mode === 'avg' && w > 1 ? computeHistoricalAverages(season, w, format) : Promise.resolve(undefined);
      const [{ leaders, defenseData }, averages] = await Promise.all([weekPromise, averagesPromise]);
      const bySchool = await aggregateByCollegeMode(leaders, w, format, mode, averages, { includeK, defense, defenseData });
      const match = bySchool.find(r => r.school.toLowerCase() === schoolParam.toLowerCase());
      return match ? { week: w, totalPoints: match.totalPoints, performers: match.performers } : { week: w, totalPoints: 0, performers: [] };
    }));
    return NextResponse.json({ school: schoolParam, season, format, mode, includeK, defense, series });
  } catch (e:any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
