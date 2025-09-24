export const runtime = "nodejs";
import { NextRequest } from "next/server";
import { DEFENSE_SOURCE, DefenseUnavailableError, fetchDefenseApprox } from "@/lib/defense";

const normalizeSeason = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 2025;
  return Math.trunc(value);
};

const normalizeWeek = (value: number | undefined): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
};

export async function GET(req: NextRequest) {
  const seasonParam = Number(req.nextUrl.searchParams.get("season") ?? "2025");
  const weekParamRaw = req.nextUrl.searchParams.get("week");
  const weekParam = weekParamRaw !== null ? Number(weekParamRaw) : undefined;
  const season = normalizeSeason(seasonParam);
  const week = normalizeWeek(weekParam);

  try {
    const result = await fetchDefenseApprox({ season, week });
    return Response.json(result, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch (error) {
    if (error instanceof DefenseUnavailableError) {
      const source = error.source ?? DEFENSE_SOURCE(season);
      return Response.json(
        { season, mode: "unavailable", error: error.message, source },
        { status: 503, headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=3600" } },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ season, error: message }, { status: 500 });
  }
}
