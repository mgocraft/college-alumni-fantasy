
import { NextResponse } from "next/server";
export const revalidate = 0;
export async function GET(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") ?? "2025");
  const startWeek = Number(url.searchParams.get("startWeek") ?? "1");
  const endWeek = Number(url.searchParams.get("endWeek") ?? "18");
  const formats = (url.searchParams.get("formats") ?? "ppr").split(",");
  const modes = (url.searchParams.get("modes") ?? "weekly").split(",");
  const includeK = (url.searchParams.get("includeK") ?? "true").toLowerCase() !== "false";
  const defense = (url.searchParams.get("defense") as 'none'|'approx') ?? 'none';
  const base = `${url.origin}/api/scores`;
  const reqs: string[] = [];
  for (const fmt of formats) for (const mode of modes) for (let w=startWeek; w<=endWeek; w++) {
    const qs = new URLSearchParams({ season: String(season), week: String(w), format: fmt, mode, includeK: String(includeK), defense });
    reqs.push(`${base}?${qs.toString()}`);
  }
  const results = await Promise.allSettled(reqs.map(href => fetch(href, { cache: "no-store" }).then(r => r.ok ? href : Promise.reject(`${href} -> ${r.status}`))));
  const ok = results.filter(r=>r.status==='fulfilled').length, fail = results.length - ok;
  return NextResponse.json({ requested: reqs.length, warmed: ok, failed: fail });
}
