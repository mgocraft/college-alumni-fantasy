export const runtime = "nodejs"; // required for zlib
import { NextRequest } from "next/server";
import { fetchRosterData } from "@/lib/roster";

export async function GET(req: NextRequest) {
  try {
    const season = Number(req.nextUrl.searchParams.get("season") ?? "2025");
    const wantCsv = req.nextUrl.searchParams.get("format") === "csv";
    const roster = await fetchRosterData({ season });

    if (wantCsv) {
      return new Response(roster.csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "s-maxage=300, stale-while-revalidate=86400",
        },
      });
    }

    const rows = roster.rows.map((row) => ({
      name: row.name,
      id: row.player_id,
      team: row.team,
      college: row.college,
    }));

    return Response.json(
      { season: roster.season, source: roster.source, fields: roster.fields, total: rows.length, rows },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" } },
    );
  } catch (e:any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
