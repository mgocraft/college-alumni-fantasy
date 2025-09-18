import { HttpError } from "./api";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback;
};

const parsePositiveMs = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const DEFAULT_ATTEMPTS = parsePositiveInt(process.env.FETCH_ATTEMPTS, 3);
const DEFAULT_TIMEOUT_MS = parsePositiveMs(process.env.FETCH_TIMEOUT_MS, 15000);
const DEFAULT_RETRY_DELAY_MS = parsePositiveMs(process.env.FETCH_RETRY_DELAY_MS, 750);

export interface RetryInfo {
  attempt: number;
  error: Error;
  url: string;
}

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  onAttemptFailure?: (info: RetryInfo) => void;
}

const shouldRetryStatus = (status?: number) => {
  if (status === undefined) return true;
  return status >= 500 || status === 408 || status === 429;
};

const normalizeError = (error: unknown, url: string, timeoutMs: number): Error => {
  if (error instanceof HttpError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error(`Request to ${url} timed out after ${timeoutMs}ms`, { cause: error });
    }
    return error;
  }
  return new Error(String(error));
};

const toHttpError = (error: Error, url: string): HttpError => {
  if (error instanceof HttpError) return error;
  const status = typeof (error as any)?.status === "number" ? Number((error as any).status) : undefined;
  const message = error.message || `Request to ${url} failed`;
  return new HttpError(status ?? 500, message, { cause: error });
};

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const error = new HttpError(
          response.status,
          `Request to ${url} failed with status ${response.status} ${response.statusText || ""}`.trim(),
        );
        if (attempt >= attempts || !shouldRetryStatus(response.status)) {
          throw error;
        }
        lastError = error;
        options.onAttemptFailure?.({ attempt, error, url });
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : retryDelayMs * attempt;
        await sleep(delay);
        continue;
      }
      return response;
    } catch (caught) {
      let error = normalizeError(caught, url, timeoutMs);
      if (!(error instanceof HttpError) && typeof (error as any)?.status === "number") {
        error = toHttpError(error, url);
      }
      lastError = error;
      const status = error instanceof HttpError ? error.status : undefined;
      if (attempt >= attempts || (status !== undefined && !shouldRetryStatus(status))) {
        throw error;
      }
      options.onAttemptFailure?.({ attempt, error, url });
      await sleep(retryDelayMs * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) {
    const error = lastError instanceof HttpError ? lastError : toHttpError(lastError, url);
    throw new HttpError(error.status ?? 500, `Failed to fetch ${url} after ${attempts} attempts`, { cause: error });
  }

  throw new HttpError(500, `Failed to fetch ${url} after ${attempts} attempts`);
}

