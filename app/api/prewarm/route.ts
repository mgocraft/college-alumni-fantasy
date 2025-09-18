
import { NextResponse } from "next/server";
import { fetchWithRetry } from "@/lib/http";
import {
  HttpError,
  parseBooleanParam,
  parseDelimitedList,
  parseEnumParam,
  parseIntegerParam,
  respondWithError,
} from "@/lib/api";

export const runtime = "nodejs";
export const revalidate = 0;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback;
};

const parsePositiveMs = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const PREWARM_MAX_REQUESTS = parsePositiveInt(process.env.PREWARM_MAX_REQUESTS, 200);
const PREWARM_CONCURRENCY = parsePositiveInt(process.env.PREWARM_CONCURRENCY, 4);
const PREWARM_ATTEMPTS = parsePositiveInt(process.env.PREWARM_ATTEMPTS, 2);
const PREWARM_TIMEOUT_MS = parsePositiveMs(process.env.PREWARM_TIMEOUT_MS ?? process.env.FETCH_TIMEOUT_MS, 15000);
const PREWARM_RETRY_DELAY_MS = parsePositiveMs(process.env.PREWARM_RETRY_DELAY_MS ?? process.env.FETCH_RETRY_DELAY_MS, 750);

type PrewarmResult = {
  url: string;
  ok: boolean;
  status?: number;
  attempts: number;
  durationMs: number;
  error?: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const season = parseIntegerParam(url, "season", 2025, { min: 1900, max: 2100 });
    const startWeek = parseIntegerParam(url, "startWeek", 1, { min: 1, max: 30 });
    const defaultEndWeek = Math.max(18, startWeek);
    const endWeek = parseIntegerParam(url, "endWeek", defaultEndWeek, { min: startWeek, max: 30 });
    const formats = parseDelimitedList(url, "formats", ["ppr"], {
      transform: (value) => value.toLowerCase(),
      maxItems: 10,
    });
    const modes = parseDelimitedList(url, "modes", ["weekly"], {
      transform: (value) => value.toLowerCase(),
      allowed: ["weekly", "avg"],
      maxItems: 5,
    });
    const includeK = parseBooleanParam(url, "includeK", true);
    const defense = parseEnumParam(url, "defense", ["none", "approx"] as const, "none");
    const base = `${url.origin}/api/scores`;
    const reqs: string[] = [];
    for (const fmt of formats) {
      for (const mode of modes) {
        for (let w = startWeek; w <= endWeek; w += 1) {
          const qs = new URLSearchParams({
            season: String(season),
            week: String(w),
            format: fmt,
            mode,
            includeK: String(includeK),
            defense,
          });
          reqs.push(`${base}?${qs.toString()}`);
        }
      }
    }

    if (reqs.length > PREWARM_MAX_REQUESTS) {
      throw new HttpError(400, `Too many requests: ${reqs.length}. Reduce the range or list size (max ${PREWARM_MAX_REQUESTS}).`);
    }

    if (reqs.length === 0) {
      return NextResponse.json({ requested: 0, warmed: 0, failed: 0, results: [] });
    }

    const results: PrewarmResult[] = new Array(reqs.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(PREWARM_CONCURRENCY, reqs.length));

    const worker = async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= reqs.length) break;
        const href = reqs[currentIndex];
        const started = Date.now();
        let retries = 0;
        try {
          const response = await fetchWithRetry(
            href,
            { cache: "no-store" },
            {
              attempts: PREWARM_ATTEMPTS,
              timeoutMs: PREWARM_TIMEOUT_MS,
              retryDelayMs: PREWARM_RETRY_DELAY_MS,
              onAttemptFailure: () => { retries += 1; },
            },
          );
          results[currentIndex] = {
            url: href,
            ok: true,
            status: response.status,
            attempts: retries + 1,
            durationMs: Date.now() - started,
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const status = err instanceof HttpError
            ? err.status
            : typeof (err as any)?.status === "number"
              ? Number((err as any).status)
              : undefined;
          results[currentIndex] = {
            url: href,
            ok: false,
            status,
            attempts: retries + 1,
            durationMs: Date.now() - started,
            error: err.message,
          };
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const warmed = results.filter((entry) => entry.ok).length;
    const failed = results.length - warmed;
    return NextResponse.json({
      requested: reqs.length,
      warmed,
      failed,
      results,
    });
  } catch (error) {
    return respondWithError("GET /api/prewarm", error);
  }
}
