export interface ClientFetchError extends Error {
  status?: number;
  data?: unknown;
}

const toDisplayUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  try {
    return "url" in input ? String((input as { url?: string }).url) : "request";
  } catch {
    return "request";
  }
};

const parseJson = (text: string, response: Response, requestUrl: string): unknown => {
  if (!text) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse JSON response from ${requestUrl}: ${(error as Error).message}`);
    }
  }
  return text;
};

const extractMessage = (payload: unknown, response: Response) => {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (response.statusText) return response.statusText;
  return `Request failed with status ${response.status}`;
};

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const requestUrl = toDisplayUrl(input);
  const text = await response.text();
  let payload: unknown;
  try {
    payload = parseJson(text, response, requestUrl);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const wrapped = new Error(err.message) as ClientFetchError;
    wrapped.status = response.status;
    wrapped.data = text;
    throw wrapped;
  }

  if (!response.ok) {
    const message = extractMessage(payload, response);
    const error = new Error(message) as ClientFetchError;
    error.status = response.status;
    error.data = payload;
    throw error;
  }

  return payload as T;
}

