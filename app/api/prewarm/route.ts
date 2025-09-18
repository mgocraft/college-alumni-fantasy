
import { NextResponse } from "next/server";
import { fetchText } from "@/lib/http";
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

type PrewarmResult = {
  url: string;
  ok: boolean;
  status?: number;
  attempts: number;
  durationMs: number;
  error?: string;
  urlHints?: string[];
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input: Record<string, unknown> = {
    query: Object.fromEntries(url.searchParams.entries()),
  };
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
    const maxRetries = Math.max(0, PREWARM_ATTEMPTS - 1);

    const parseResponse = (text: string, href: string) => {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        throw new Error(`Invalid JSON from ${href}: ${err.message}`);
      }
    };

    const worker = async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= reqs.length) break;
        const href = reqs[currentIndex];
        const started = Date.now();
        let retries = 0;
        try {
          const text = await fetchText(
            href,
            { cache: "no-store" },
            {
              timeoutMs: PREWARM_TIMEOUT_MS,
              retries: maxRetries,
              onRetry: () => { retries += 1; },
            },
          );
          const payload = parseResponse(text, href);
          const durationMs = Date.now() - started;
          if (payload && typeof payload === "object" && "error" in payload && (payload as { error?: unknown }).error) {
            const message = typeof (payload as { error?: unknown }).error === "string"
              ? String((payload as { error?: unknown }).error)
              : JSON.stringify((payload as { error?: unknown }).error);
            const urlHintsValue = (payload as { urlHints?: unknown }).urlHints;
            const hints = Array.isArray(urlHintsValue)
              ? urlHintsValue.map((hint: unknown) => String(hint))
              : undefined;
            results[currentIndex] = {
              url: href,
              ok: false,
              status: 200,
              attempts: retries + 1,
              durationMs,
              error: message,
              urlHints: hints,
            };
          } else {
            results[currentIndex] = {
              url: href,
              ok: true,
              status: 200,
              attempts: retries + 1,
              durationMs,
            };
          }
        } catch (caught) {
          const durationMs = Date.now() - started;
          const err = caught instanceof Error ? caught : new Error(String(caught));
          const status = err instanceof HttpError
            ? err.status
            : typeof (err as any)?.status === "number"
              ? Number((err as any).status)
              : undefined;
          let urlHints: string[] | undefined;
          if (err instanceof HttpError) {
            const detail = err.detail;
            if (detail) {
              try {
                const parsed = JSON.parse(detail);
                if (Array.isArray(parsed?.urlHints)) {
                  urlHints = parsed.urlHints.map((hint: unknown) => String(hint));
                } else if (parsed && typeof parsed === "object" && typeof parsed.url === "string") {
                  urlHints = [parsed.url];
                }
              } catch {
                // ignore parse errors on detail snapshot
              }
            }
            if (!urlHints && Array.isArray(err.urlHints)) {
              urlHints = err.urlHints.map((hint) => String(hint));
            }
          }
          results[currentIndex] = {
            url: href,
            ok: false,
            status,
            attempts: retries + 1,
            durationMs,
            error: err.message,
            urlHints,
          };
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const warmed = results.filter((entry) => entry.ok).length;
    const failed = results.length - warmed;
    const errors = results
      .filter((entry) => !entry.ok)
      .map((entry) => {
        const statusPart = entry.status ? ` [${entry.status}]` : "";
        const hintPart = entry.urlHints?.length ? ` (hints: ${entry.urlHints.join(", ")})` : "";
        const message = entry.error ?? "Request failed";
        return `${entry.url}${statusPart}: ${message}${hintPart}`;
      });
    return NextResponse.json({
      requested: reqs.length,
      warmed,
      failed,
      errors,
      results,
    });
  } catch (error) {
    return respondWithError("GET /api/prewarm", error, { input });
  }
}
