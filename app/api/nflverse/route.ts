export const runtime = "nodejs"; // required for zlib
import { NextRequest } from "next/server";
import zlib from "zlib";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

function asset(kind: "weekly"|"season"|"players", season?: number) {
  if (kind === "weekly")  return `${BASE}/weekly_rosters/roster_week_${season}.csv.gz`;
  if (kind === "season")  return `${BASE}/rosters/roster_${season}.csv`;
  if (kind === "players") return `${BASE}/players/players.csv`;
  throw new Error("bad kind");
}

async function fetchBuf(url: string) {
  const r = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

function parseCsv(txt: string) {
  const lines = txt.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g,"").trim());
  return lines.slice(1).map(line => {
    const cols = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    const row: Record<string,string> = {};
    headers.forEach((h,i)=> row[h] = (cols[i]||"").replace(/^"|"$/g,""));
    return row;
  });
}

export async function GET(req: NextRequest) {
  try {
    const season = Number(req.nextUrl.searchParams.get("season") ?? "2025");
    const wantCsv = req.nextUrl.searchParams.get("format") === "csv";

    // Try weekly first; fallback to season snapshot
    let rosterBuf: Buffer|undefined, rosterSrc = "";
    try { rosterBuf = await fetchBuf(asset("weekly", season)); rosterSrc = asset("weekly", season); } catch {}
    if (!rosterBuf) { rosterBuf = await fetchBuf(asset("season", season)); rosterSrc = asset("season", season); }

    if (rosterSrc.endsWith(".gz")) rosterBuf = zlib.gunzipSync(rosterBuf!);
    const rosterCsv = rosterBuf!.toString("utf8");

    if (wantCsv) {
      return new Response(rosterCsv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "s-maxage=300, stale-while-revalidate=86400"
        }
      });
    }

    const roster = parseCsv(rosterCsv);
    const sample = roster[0] ?? {};
    const nameKey = ["full_name","player_name","player","name"].find(k => k in sample);
    let collegeKey: string | null = ["college","college_name","college_short"].find(k => k in sample) ?? null;
    const idKey = ["gsis_id","player_id","nfl_id","pfr_id"].find(k => k in sample) ?? null;

    // If roster lacks college, join using players.csv
    let pMap: Map<string,string> | null = null;
    if (!collegeKey) {
      const playersCsv = (await fetchBuf(asset("players"))).toString("utf8");
      const players = parseCsv(playersCsv);
      const ps = players[0] ?? {};
      const pCollege = ["college","college_name","college_short"].find(k => k in ps);
      const pId = ["gsis_id","player_id","nfl_id","pfr_id"].find(k => k in ps);
      if (pId && pCollege) {
        pMap = new Map(players.map(p => [p[pId], p[pCollege]]));
        collegeKey = pCollege; // meta only
      }
    }

    const rows = roster.map(r => {
      let college = (collegeKey ? r[collegeKey] : "") || "";
      if (!college && pMap && idKey && r[idKey]) college = pMap.get(r[idKey]) || "";
      return {
        name: r[nameKey ?? "player"] || "",
        id: idKey ? r[idKey] : "",
        team: r.team || r.recent_team || r.team_abbr || "",
        college
      };
    });

    return Response.json(
      { season, source: rosterSrc, fields: { nameKey, idKey, collegeKey }, total: rows.length, rows },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" } }
    );
  } catch (e:any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
