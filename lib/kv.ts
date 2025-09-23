const kvUrl = process.env.KV_REST_API_URL?.replace(/\/$/, "");
const kvToken = process.env.KV_REST_API_TOKEN?.trim();

const authHeader = kvToken ? `Bearer ${kvToken}` : null;
const headers = authHeader
  ? { Authorization: authHeader, "Content-Type": "application/json" }
  : undefined;

export const kvConfigured = Boolean(kvUrl && kvToken);

const encodeKey = (key: string) => encodeURIComponent(key);

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!kvConfigured || !kvUrl || !headers) return null;
  try {
    const res = await fetch(`${kvUrl}/get/${encodeKey(key)}`, {
      method: "GET",
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[kv] get failed for ${key}`, res.status);
      return null;
    }
    const payload = await res.json().catch(() => null);
    const raw = payload?.result ?? payload?.value ?? null;
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }
    return raw as T;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[kv] get threw for ${key}`, error);
    return null;
  }
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  if (!kvConfigured || !kvUrl || !headers) return false;
  try {
    const body: Record<string, unknown> = { value: JSON.stringify(value) };
    if (ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      body.expiration = Math.trunc(ttlSeconds);
    }
    const res = await fetch(`${kvUrl}/set/${encodeKey(key)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[kv] set failed for ${key}`, res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[kv] set threw for ${key}`, error);
    return false;
  }
}

export async function kvDel(key: string): Promise<boolean> {
  if (!kvConfigured || !kvUrl || !headers) return false;
  try {
    const res = await fetch(`${kvUrl}/del/${encodeKey(key)}`, {
      method: "POST",
      headers,
    });
    return res.ok;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[kv] del threw for ${key}`, error);
    return false;
  }
}
