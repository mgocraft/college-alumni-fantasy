
import { NextResponse } from "next/server";
import { aggregateByCollegeMode } from "@/lib/scoring";
import { loadWeek, computeHistoricalAverages } from "@/lib/nflverse";
import { saveRecord, MatchRecord } from "@/lib/league";
export const revalidate = 0;
export async function GET(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") ?? "2025");
  const week = Number(url.searchParams.get("week") ?? "1");
  const format = url.searchParams.get("format") ?? "ppr";
  const mode = (url.searchParams.get("mode") as 'weekly'|'avg') ?? 'weekly';
  const includeK = (url.searchParams.get("includeK") ?? "true").toLowerCase() !== "false";
  const defense = (url.searchParams.get("defense") as 'none'|'approx') ?? 'none';
  const home = url.searchParams.get("home") || "";
  const away = url.searchParams.get("away") || "";
  const doRecord = (url.searchParams.get("record") || "false").toLowerCase() === "true";
  if (!home || !away) return NextResponse.json({ error: "Missing ?home or ?away" }, { status: 400 });
  try {
    const includeDefense = defense === 'approx';
    const weekPromise = loadWeek({ season, week, format, includeDefense });
    const averagesPromise: Promise<Record<string, number> | undefined> =
      mode === 'avg' && week > 1 ? computeHistoricalAverages(season, week, format) : Promise.resolve(undefined);
    const [{ leaders, defenseData }, averages] = await Promise.all([weekPromise, averagesPromise]);
    const bySchool = await aggregateByCollegeMode(leaders, week, format, mode, averages, { includeK, defense, defenseData });
    const a = bySchool.find(r => r.school.toLowerCase() === home.toLowerCase());
    const b = bySchool.find(r => r.school.toLowerCase() === away.toLowerCase());
    const homePoints = a?.totalPoints ?? 0, awayPoints = b?.totalPoints ?? 0;
    const winner: 'home'|'away'|'tie' = homePoints>awayPoints ? 'home' : awayPoints>homePoints ? 'away' : 'tie';
    const payload = { season, week, format, mode, includeK, defense, home, away, homePoints, awayPoints, winner, homeLineup: a?.performers ?? [], awayLineup: b?.performers ?? [] };
    if (doRecord) { const rec: MatchRecord = { season, week, format, mode, home, away, homePoints, awayPoints, winner, timestamp: Date.now() }; await saveRecord(rec); }
    return NextResponse.json(payload);
  } catch (e:any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
