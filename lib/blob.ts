const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
const blobBaseUrl = (process.env.BLOB_URL?.trim() || "https://blob.vercel-storage.com").replace(/\/$/, "");

const normalizePath = (key: string): string => {
  const trimmed = key.startsWith("/") ? key.slice(1) : key;
  return trimmed.replace(/\s+/g, "-");
};

const buildUrl = (key: string) => `${blobBaseUrl}/${normalizePath(key)}`;

export const blobConfigured = Boolean(blobToken);

export async function blobPutJson(key: string, value: unknown): Promise<{ url: string; pathname: string } | null> {
  if (!blobToken) return null;
  const target = buildUrl(key);
  try {
    const res = await fetch(target, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${blobToken}`,
        "Content-Type": "application/json",
        "x-add-random-suffix": "false",
      },
      body: JSON.stringify(value),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[blob] put failed for ${target}`, res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json().catch(() => null);
    const pathname = typeof data?.pathname === "string" ? data.pathname : new URL(target).pathname;
    const url = typeof data?.url === "string" ? data.url : target;
    return { url, pathname };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[blob] put threw for ${target}`, error);
    return null;
  }
}

export async function blobHead(key: string) {
  if (!blobToken) return null;
  const target = buildUrl(key);
  try {
    const res = await fetch(target, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${blobToken}` },
    });
    if (!res.ok) return null;
    return { url: target, pathname: new URL(target).pathname };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[blob] head threw for ${target}`, error);
    return null;
  }
}

export async function blobDelete(key: string): Promise<boolean> {
  if (!blobToken) return false;
  const target = buildUrl(key);
  try {
    const res = await fetch(target, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${blobToken}` },
    });
    return res.ok;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[blob] delete threw for ${target}`, error);
    return false;
  }
}
