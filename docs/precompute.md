# Nightly precomputes for college-alumni matchups

This service builds and caches matchup data that maps NFL fantasy production to college football matchups. It powers the nightly cron, the admin prewarm endpoint, and the CLI backfill script.

## Data flow

1. Fetch the college football schedule for the requested CFB week (CFBD by default, ESPN fallback).
2. Load NFL schedule data and build "week completion" windows (Tuesday 10:00 UTC after MNF).
3. Map the CFB week (or each game) to the latest completed NFL week according to the cutoff rule.
4. Fetch weekly NFL statlines and join them with roster and master data to resolve colleges.
5. Aggregate player points by college, compute per-matchup results, and optionally season-to-date summaries.
6. Persist the payload to Upstash Redis (REST), falling back to Vercel Blob when KV is unavailable.

## Environment variables

Documented in `.env.local.example`:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PRECOMPUTE_TOKEN` | Required token for `/api/admin/precompute`; send via header or `token` query param |
| `CFB_SCHEDULE_PROVIDER` | `cfbd` (default) or `espn` |
| `CFBD_API_KEY` | Required when using the CFBD provider |
| `APP_TZ` | Human-facing time zone (logs/docs), logic uses UTC |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional Redis configuration (legacy `KV_REST_API_URL`/`KV_REST_API_TOKEN` still supported) |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_URL` | Optional Blob fallback configuration |

## Mapping rules

* **CFB Week 1** always maps to **previous NFL season Week 18**.
* For **Weeks ≥ 2**, take the latest CFB kickoff in that week and select the last NFL window where `windowEndUTC <= kickoff` (window end = Tuesday 10:00 UTC after MNF).
* The API and CLI support `map=per-game` which counts individual game kickoffs and selects the dominant NFL week.

## Schedule providers

* **CFBD** (`CFB_SCHEDULE_PROVIDER=cfbd`): uses `https://api.collegefootballdata.com/games` (requires `CFBD_API_KEY`).
* **ESPN** (`CFB_SCHEDULE_PROVIDER=espn`): uses the public scoreboard API (`groups=80`, `seasontype=2|3`).

Games are normalized so school names align with roster/college data (see the synonym map in `utils/datasources.ts`).

## Storage

Results are written to Upstash Redis when available, using the keys:

* `alumni:v1:<season>:<cfbWeek>:matchups`
* `alumni:v1:<season>:<cfbWeek>:std`

If KV writes fail (or no credentials are present) the payload is uploaded to Vercel Blob at `alumni/<season>/<week>/<dataset>.json`. Metadata inside each payload includes season/week identifiers, mapping mode, row counts, and a preview of unmatched colleges.

## Interfaces

### Admin API

```
GET /api/admin/precompute?season=2025&cfbWeek=3&mode=both&map=per-week&force=1
Headers: X-Admin-Token: <ADMIN_PRECOMPUTE_TOKEN>
```

* Omitting `season`/`cfbWeek` defaults to the latest relevant week via `detectTargetCfbWeek`.
* `mode` → `matchups`, `std`, or `both` (default).
* `map` → `per-week` (default) or `per-game`.
* `force=1` rewrites cache entries even if they already exist.
* Returns `202 {status:"pending"}` when NFL stats are not yet published.
* When custom headers are unavailable (e.g., Vercel cron), append `&token=<ADMIN_PRECOMPUTE_TOKEN>` to the request URL.

### CLI

```
npm run precompute:one -- --season 2025 --cfbWeek 3 --map per-week --force
npm run precompute:one -- --season 2025 --range 1-13
npm run precompute:one -- --season 2025 --all --map per-game
```

The CLI mirrors the API logic and writes to the same cache keys.

### Vercel cron

`vercel.json` schedules a daily job at 09:00 UTC (~04:00 America/Chicago) that hits `/api/admin/precompute?mode=both&map=per-week&token=<ADMIN_PRECOMPUTE_TOKEN>` with the configured admin token secret.

## Operational notes

* Logs include the selected NFL week, mapping mode, and backend (`kv` or `blob`).
* Missing college matches are surfaced in the metadata to aid updates to the synonym map.
* When upstream NFL data has not been published, rerun after the Tuesday 10:00 UTC cutoff or backfill via CLI once stats are ready.
