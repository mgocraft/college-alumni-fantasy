
import { NextResponse } from "next/server";
import { aggregateByCollegeMode } from "@/lib/scoring";
import { loadWeek, computeHistoricalAverages } from "@/lib/nflverse";

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
    const includeDefense = defense === 'approx';
    const weekPromise = loadWeek({ season, week, format, includeDefense });
    const averagesPromise: Promise<Record<string, number> | undefined> =
      mode === 'avg' && week > 1 ? computeHistoricalAverages(season, week, format) : Promise.resolve(undefined);
    const [{ leaders, defenseData }, averages] = await Promise.all([weekPromise, averagesPromise]);
    const bySchool = await aggregateByCollegeMode(leaders, week, format, mode, averages, { includeK, defense, defenseData });
    return NextResponse.json({ season, week, format, mode, includeK, defense, count: bySchool.length, results: bySchool });
  } catch (e:any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
