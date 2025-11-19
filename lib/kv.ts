const kvUrl = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)?.replace(/\/$/, "");
const kvToken = (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();

export const kvConfigured = Boolean(kvUrl && kvToken);

const safeKey = (key: string): string => encodeURIComponent(key);

const parseValue = <T>(raw: unknown): T | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
};

type KvResponse<T> = { result?: T };

async function kvFetch<T>(path: string, init?: RequestInit): Promise<KvResponse<T> | null> {
  if (!kvConfigured || !kvUrl || !kvToken) return null;
  try {
    const res = await fetch(`${kvUrl}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${kvToken}`,
        ...(init?.method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV request failed: ${res.status}`);
    return (await res.json()) as KvResponse<T>;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[kv] request failed for ${path}`, error);
    return null;
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const response = await kvFetch<unknown>(`get/${safeKey(key)}`);
  if (!response) return null;
  return parseValue<T>(response.result);
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  const body = {
    value: JSON.stringify(value),
    ...(ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? { ex: Math.trunc(ttlSeconds) }
      : {}),
  };
  const response = await kvFetch<string>(`set/${safeKey(key)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return response?.result === "OK";
}

export async function kvDel(key: string): Promise<boolean> {
  const response = await kvFetch<number | string>(`del/${safeKey(key)}`, { method: "POST" });
  const result = response?.result;
  return typeof result === "number" ? result > 0 : Boolean(result);
}
