#!/usr/bin/env node

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 15000);

const endpoints = [
  {
    name: "health",
    path: "/api/health",
    validate: (data) => data && data.status === "ok",
  },
  {
    name: "standings",
    path: "/api/standings",
    validate: (data) => Array.isArray(data?.standings),
  },
  {
    name: "scores",
    path: "/api/scores?season=2025&week=1&format=ppr&mode=weekly&includeK=true&defense=none",
    validate: (data) => Array.isArray(data?.results) && data.results.length >= 0,
  },
];

const fetchWithTimeout = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const parseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${(error).message}`);
  }
};

const run = async () => {
  let success = true;
  for (const endpoint of endpoints) {
    const url = new URL(endpoint.path, baseUrl).toString();
    process.stdout.write(`Checking ${endpoint.name} (${url})... `);
    try {
      const response = await fetchWithTimeout(url);
      let data;
      try {
        data = await parseBody(response);
      } catch (error) {
        throw new Error(`${error.message} [${endpoint.name}]`);
      }
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data
          ? (data.error ?? response.statusText)
          : response.statusText || `HTTP ${response.status}`;
        throw new Error(typeof message === "string" ? message : JSON.stringify(message));
      }
      if (endpoint.validate && !endpoint.validate(data)) {
        throw new Error("Validation failed");
      }
      console.log("ok");
    } catch (error) {
      success = false;
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === "AbortError") {
        err.message = `Request timed out after ${timeoutMs}ms`;
      }
      console.log(`failed\n  ${err.message}`);
    }
  }
  if (!success) {
    console.error("Smoke test failed");
    process.exit(1);
  } else {
    console.log("All endpoints responded successfully.");
  }
};

run().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(err.message);
  process.exit(1);
});
