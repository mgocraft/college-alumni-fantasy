import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import { HttpsProxyAgent } from "next/dist/compiled/https-proxy-agent";
import { HttpError } from "./api";

const PROXY_ENV_ORDER = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

const getProxyUrl = (): string | undefined => {
  for (const key of PROXY_ENV_ORDER) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
};

const parseNoProxyList = (): string[] => {
  const value = process.env.NO_PROXY || process.env.no_proxy;
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const NO_PROXY = parseNoProxyList();
const PROXY_URL = getProxyUrl();
let HTTPS_PROXY_AGENT: InstanceType<typeof HttpsProxyAgent> | undefined;

const getDefaultPort = (protocol: string): string | undefined => {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return undefined;
};

const shouldBypassProxy = (url: string): boolean => {
  if (!NO_PROXY.length) return false;
  let host: string | undefined;
  let port: string | undefined;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = parsed.port || getDefaultPort(parsed.protocol);
  } catch {
    return false;
  }
  if (!host) return false;
  for (const pattern of NO_PROXY) {
    if (pattern === "*") return true;
    let candidate = pattern;
    let patternPort: string | undefined;
    const colonIndex = pattern.lastIndexOf(":");
    if (colonIndex > 0 && colonIndex < pattern.length - 1) {
      const possiblePort = pattern.slice(colonIndex + 1);
      if (/^\d+$/.test(possiblePort)) {
        patternPort = possiblePort;
        candidate = pattern.slice(0, colonIndex);
      }
    }
    if (patternPort && port && patternPort !== port) continue;
    if (!candidate) continue;
    if (candidate.startsWith(".")) {
      const suffix = candidate.slice(1);
      if (host === suffix || host.endsWith(`.${suffix}`)) return true;
    } else if (host === candidate || host.endsWith(`.${candidate}`)) {
      return true;
    }
  }
  return false;
};

const ensureProxyAgent = () => {
  if (!PROXY_URL) return undefined;
  if (!HTTPS_PROXY_AGENT) {
    try {
      HTTPS_PROXY_AGENT = new HttpsProxyAgent(PROXY_URL);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[http] Failed to configure proxy agent", error);
      HTTPS_PROXY_AGENT = undefined;
    }
  }
  return HTTPS_PROXY_AGENT;
};

const shouldUseProxy = (url: string): boolean => Boolean(PROXY_URL) && !shouldBypassProxy(url);

const toNodeHeaders = (headers?: HeadersInit): OutgoingHttpHeaders => {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: OutgoingHttpHeaders = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<OutgoingHttpHeaders>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  return { ...headers };
};

const toHeadersInit = (headers: IncomingHttpHeaders): HeadersInit => {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (!value || !key) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined) entries.push([key, v]);
      }
    } else {
      entries.push([key, value]);
    }
  }
  return entries;
};

const proxyFetch = (url: string, init: RequestInit): Promise<Response> => {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const headers = toNodeHeaders(init.headers);
  const requestOptions: HttpsRequestOptions = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    method: init.method ?? "GET",
    headers,
  };
  if (isHttps && shouldUseProxy(url)) {
    const agent = ensureProxyAgent();
    if (agent) {
      requestOptions.agent = agent;
    }
  }
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const requestFn = isHttps ? https.request : http.request;
    const req = requestFn(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        const body = Buffer.concat(chunks);
        const response = new Response(body, {
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          headers: toHeadersInit(res.headers),
        });
        resolve(response);
      });
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    const { signal } = init;
    if (signal) {
      if (signal.aborted) {
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        req.destroy(abortError);
        return;
      }
      const onAbort = () => {
        if (settled) return;
        settled = true;
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        req.destroy(abortError);
        reject(abortError);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => {
        signal.removeEventListener("abort", onAbort);
      });
    }

    if (init.body) {
      if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
        req.write(init.body);
      } else if (init.body instanceof URLSearchParams) {
        req.write(init.body.toString());
      } else {
        req.write(String(init.body));
      }
    }

    req.end();
  });
};

type RetryInfo = {
  attempt: number;
  url: string;
  error: Error;
};

type FetchOptions = {
  timeoutMs?: number;
  retries?: number;
  onRetry?: (info: RetryInfo) => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const BASE_BACKOFF_MS = 300;

const sanitizeSnippet = (value: string): string => {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
};

const shouldRetryStatus = (status?: number): boolean => {
  if (status === undefined) return true;
  if (status >= 500) return true;
  return status === 408 || status === 429;
};

const toHttpError = (url: string, error: unknown, fallbackStatus = 500): HttpError => {
  if (error instanceof HttpError) return error;
  const err = error instanceof Error ? error : new Error(String(error));
  const status = typeof (err as any)?.status === "number" ? Number((err as any).status) : fallbackStatus;
  return new HttpError(status, `Request to ${url} failed: ${err.message}`, { cause: err });
};

const performRequest = async (
  url: string,
  init: RequestInit = {},
  options: FetchOptions = {},
): Promise<Response> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestInit: RequestInit = { ...(init ?? {}), signal: controller.signal };
      const response = await (shouldUseProxy(url) ? proxyFetch(url, requestInit) : fetch(url, requestInit));
      if (response.ok) {
        return response;
      }
      const snippet = await response.text().then(sanitizeSnippet).catch(() => "");
      const message = `Request to ${url} failed with status ${response.status} ${response.statusText || ""}`.trim();
      const errorBody = snippet ? `Body: ${snippet}` : "Body: <empty>";
      const error = new HttpError(response.status, `${message}. ${errorBody}`);
      error.detail = snippet;
      if (attempt < retries && shouldRetryStatus(response.status)) {
        options.onRetry?.({ attempt: attempt + 1, url, error });
        const delay = BASE_BACKOFF_MS * (2 ** attempt);
        await sleep(delay);
        continue;
      }
      throw error;
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught));
      const isAbort = err.name === "AbortError";
      const status = typeof (err as any)?.status === "number" ? Number((err as any).status) : undefined;
      if (attempt < retries && (isAbort || shouldRetryStatus(status))) {
        options.onRetry?.({ attempt: attempt + 1, url, error: err });
        const delay = BASE_BACKOFF_MS * (2 ** attempt);
        await sleep(delay);
        continue;
      }
      if (isAbort) {
        throw new HttpError(504, `Request to ${url} timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw toHttpError(url, err, status ?? 500);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new HttpError(500, `Request to ${url} failed after ${retries + 1} attempts`);
};

export async function fetchText(
  url: string,
  init?: RequestInit,
  options?: FetchOptions,
): Promise<string> {
  const response = await performRequest(url, init, options);
  return response.text();
}

export async function fetchBuffer(
  url: string,
  init?: RequestInit,
  options?: FetchOptions,
): Promise<Buffer> {
  const response = await performRequest(url, init, options);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
