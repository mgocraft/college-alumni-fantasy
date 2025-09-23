import { kvGet, kvSet } from "@/lib/kv";
import { blobConfigured, blobHead, blobPutJson } from "@/lib/blob";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

const sanitizeForBlob = (key: string): string => {
  const normalized = key.replace(/[^a-zA-Z0-9:_/\-]/g, "-");
  const segments = normalized.split(":").filter(Boolean);
  return `alumni/${segments.join("/")}.json`;
};

export type PersistResult = {
  backend: "kv" | "blob";
  key: string;
  url?: string;
  skipped: boolean;
};

export async function persistJson(
  key: string,
  value: unknown,
  options: { ttlSeconds?: number; force?: boolean } = {},
): Promise<PersistResult> {
  const { ttlSeconds = DEFAULT_TTL_SECONDS, force = false } = options;
  if (!force) {
    const existing = await kvGet<unknown>(key);
    if (existing !== null && existing !== undefined) {
      return { backend: "kv", key, skipped: true };
    }
    if (blobConfigured) {
      const blobKey = sanitizeForBlob(key);
      const head = await blobHead(blobKey);
      if (head) {
        const path = typeof (head as { pathname?: unknown }).pathname === "string"
          ? (head as { pathname: string }).pathname
          : blobKey;
        const url = typeof (head as { url?: unknown }).url === "string"
          ? (head as { url: string }).url
          : undefined;
        return { backend: "blob", key: path, url, skipped: true };
      }
    }
  }
  const kvStored = await kvSet(key, value, ttlSeconds);
  if (kvStored) {
    return { backend: "kv", key, skipped: false };
  }
  const blobKey = sanitizeForBlob(key);
  const blobResult = await blobPutJson(blobKey, value);
  if (blobResult) {
    return { backend: "blob", key: blobResult.pathname, url: blobResult.url, skipped: false };
  }
  throw new Error("Failed to persist JSON. Configure Vercel KV or Blob credentials.");
}
