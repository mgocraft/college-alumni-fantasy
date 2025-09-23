# College Alumni Fantasy — Full MVP

Next.js (App Router, TypeScript) that aggregates open nflverse weekly stats into **college alumni** scores.

Features:
- Lineup: **QB, TE, WR, WR, RB, RB, K (optional), FLEX (WR3/RB3/TE2)**.
- **Defense (approx)**: Adds a single **Defense** row per school; points are DST points distributed to IDPs by snap share, summing **top 11** contributors. Expand/hover to view contributors.
- **Selection Mode**: `weekly` (this week’s best) vs `avg` (manager-style picks by season-to-date average up through previous week).
- Endpoints: `/api/scores`, `/api/school/[school]`, `/api/matchup`, `/api/standings`, `/api/prewarm`.
- Pages: `/schools`, `/schools/[school]` (with line chart), `/rankings`, `/matchups`, `/standings`.

## Quickstart
```bash
npm install
cp .env.example .env.local
npm run dev
```

No API keys required — all data comes from nflverse public releases downloaded on demand and cached locally.

### Optional Parquet support

The app automatically falls back to CSV assets, so `parquetjs-lite` is *not* required to run locally or deploy. If you want to parse the nflverse Parquet releases directly (for faster team defense fetches), install it manually with:

```bash
npm install parquetjs-lite
```
