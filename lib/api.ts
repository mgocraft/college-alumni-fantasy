import { NextResponse } from "next/server";

export class HttpError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, options?: { detail?: string; cause?: unknown }) {
    super(message, options);
    this.status = status;
    this.detail = options?.detail;
  }
}

const asError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
};

export const respondWithError = (scope: string, error: unknown, fallbackStatus = 500) => {
  const err = asError(error);
  // Always log to aid debugging, but avoid noisy stack traces in tests when scope is empty.
  if (scope) {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err);
  }

  if (err instanceof HttpError) {
    return NextResponse.json(
      err.detail ? { error: err.message, detail: err.detail } : { error: err.message },
      { status: err.status },
    );
  }

  const detail = err.cause instanceof Error ? err.cause.message : undefined;
  const body = detail ? { error: err.message, detail } : { error: err.message };
  return NextResponse.json(body, { status: fallbackStatus });
};

const coerceInt = (value: string | null, fallback: number): number => {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : NaN;
};

export const parseIntegerParam = (
  url: URL,
  key: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number => {
  const value = coerceInt(url.searchParams.get(key), fallback);
  if (!Number.isFinite(value)) {
    throw new HttpError(400, `${key} must be an integer value`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new HttpError(400, `${key} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new HttpError(400, `${key} must be at most ${options.max}`);
  }
  return value;
};

export const parseBooleanParam = (url: URL, key: string, fallback: boolean): boolean => {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  throw new HttpError(400, `${key} must be a boolean value`);
};

type StringParamOptions = {
  maxLength?: number;
  toLowerCase?: boolean;
  trim?: boolean;
  allowed?: readonly string[];
};

export const parseStringParam = (
  url: URL,
  key: string,
  fallback: string,
  options: StringParamOptions = {},
): string => {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === undefined) return fallback;
  const shouldTrim = options.trim !== false;
  const trimmed = shouldTrim ? raw.trim() : raw;
  const value = options.toLowerCase ? trimmed.toLowerCase() : trimmed;
  if (!value) return fallback;
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new HttpError(400, `${key} must be at most ${options.maxLength} characters long`);
  }
  if (options.allowed) {
    const match = options.allowed.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    if (!match) {
      throw new HttpError(400, `${key} must be one of: ${options.allowed.join(", ")}`);
    }
    return options.toLowerCase ? match : match;
  }
  return value;
};

export const parseRequiredString = (url: URL, key: string, options: StringParamOptions = {}): string => {
  const value = parseStringParam(url, key, "", options);
  if (!value) throw new HttpError(400, `${key} is required`);
  return value;
};

export const parseEnumParam = <T extends readonly string[]>(
  url: URL,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] => {
  const value = parseStringParam(url, key, fallback, { trim: true, toLowerCase: true });
  const match = allowed.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw new HttpError(400, `${key} must be one of: ${allowed.join(", ")}`);
  }
  return match;
};

type ListOptions = {
  delimiter?: string;
  transform?: (value: string) => string;
  allowed?: readonly string[];
  maxItems?: number;
  unique?: boolean;
};

export const parseDelimitedList = (
  url: URL,
  key: string,
  fallback: string[],
  options: ListOptions = {},
): string[] => {
  const raw = url.searchParams.get(key);
  if (!raw) return fallback;
  const delimiter = options.delimiter ?? ",";
  const values = raw
    .split(delimiter)
    .map((value) => (options.transform ? options.transform(value.trim()) : value.trim()))
    .filter((value) => value.length > 0);
  if (!values.length) return fallback;

  const uniqueValues = options.unique === false ? values : Array.from(new Set(values));
  if (options.maxItems !== undefined && uniqueValues.length > options.maxItems) {
    throw new HttpError(400, `${key} must contain at most ${options.maxItems} values`);
  }
  if (options.allowed) {
    const allowedLower = options.allowed.map((value) => value.toLowerCase());
    for (const value of uniqueValues) {
      if (!allowedLower.includes(value.toLowerCase())) {
        throw new HttpError(400, `${key} contains invalid value "${value}". Allowed: ${options.allowed.join(", ")}`);
      }
    }
  }
  return uniqueValues;
};

