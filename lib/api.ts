import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { assignErrorCause, getErrorCause } from "./errors";

const ensureNextCacheDir = () => {
  if (typeof process === "undefined") return;

  const existing = process.env.NEXT_CACHE_DIR?.trim();
  const fallback = path.join(os.tmpdir(), "next-cache");
  const target = existing && existing.length > 0 ? existing : fallback;

  if (!existing) {
    process.env.NEXT_CACHE_DIR = target;
  }

  const nflverseCache = process.env.NFLVERSE_CACHE_DIR?.trim();
  if (!nflverseCache) {
    process.env.NFLVERSE_CACHE_DIR = path.join(target, "nflverse");
  }


  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "EEXIST") return;
    // eslint-disable-next-line no-console
    console.warn(`[api] Failed to ensure NEXT_CACHE_DIR at ${target}`, err);
  }
};

ensureNextCacheDir();

export class HttpError extends Error {
  status: number;

  detail?: string;

  urlHints?: string[];

  code?: string;

  constructor(status: number, message: string, options?: { detail?: string; cause?: unknown; urlHints?: string[]; code?: string }) {

    super(message);
    if (options && "cause" in options) {
      assignErrorCause(this, options.cause);
    }

    this.status = status;
    this.detail = options?.detail;
    this.urlHints = options?.urlHints;
    if (options?.code) this.code = options.code;
  }
}

const asError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
};

type ErrorResponseOptions = {
  fallbackStatus?: number;
  input?: unknown;
  urlHints?: string[];
};

const mergeHints = (...lists: (string[] | undefined)[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const hint of list) {
      if (!hint) continue;
      const trimmed = hint.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
};

export const respondWithError = (scope: string, error: unknown, options: ErrorResponseOptions = {}) => {
  const { fallbackStatus = 500, input, urlHints } = options;
  const err = asError(error);
  if (scope) {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err);
  }

  if (err instanceof HttpError) {
    const hints = mergeHints(urlHints, err.urlHints);
    if ((err as { code?: string }).code === "NFLVERSE_ASSET_MISSING") {
      const payload: Record<string, unknown> = {
        error: err.message,
        url: (err as { url?: string }).url,
        season: (err as { season?: number }).season,
        week: (err as { week?: number }).week,
        hint: "This file is published after games are processed.",
      };
      if (input !== undefined) payload.input = input;
      if (hints.length) payload.urlHints = hints;
      return NextResponse.json(payload, { status: err.status });
    }
    const payload: Record<string, unknown> = err.detail
      ? { error: err.message, detail: err.detail }
      : { error: err.message };
    if (input !== undefined) payload.input = input;
    if (hints.length) payload.urlHints = hints;
    return NextResponse.json(payload, { status: err.status });
  }


  const cause = getErrorCause(err);
  const detail = cause instanceof Error ? cause.message : undefined;

  const payload: Record<string, unknown> = detail ? { error: err.message, detail } : { error: err.message };
  if (input !== undefined) payload.input = input;
  const hints = mergeHints(urlHints);
  if (hints.length) payload.urlHints = hints;
  return NextResponse.json(payload, { status: fallbackStatus });
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

