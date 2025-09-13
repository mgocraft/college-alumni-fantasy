
import { NextResponse } from "next/server";
import { loadRecords, computeStandings } from "@/lib/league";
export const revalidate = 0;
export async function GET() { const records = await loadRecords(); const standings = computeStandings(records); return NextResponse.json({ recordsCount: records.length, standings }); }
