import { NextResponse } from "next/server";
import { respondWithError } from "@/lib/api";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
  } catch (error) {
    return respondWithError("GET /api/health", error, { input: {} });
  }
}

