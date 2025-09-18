
import { NextResponse } from "next/server";
import { loadRecords, computeStandings } from "@/lib/league";
import { respondWithError } from "@/lib/api";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  try {
    const records = await loadRecords();
    const standings = computeStandings(records);
    return NextResponse.json({ recordsCount: records.length, standings });
  } catch (error) {
    return respondWithError("GET /api/standings", error);
  }
}
