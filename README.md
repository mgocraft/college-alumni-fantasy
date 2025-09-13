# College Alumni Fantasy — Full MVP

Next.js (App Router, TypeScript) that aggregates FantasyNerds weekly leaders into **college alumni** scores.

Features:
- Lineup: **QB, TE, WR, WR, RB, RB, K (optional), FLEX (WR3/RB3/TE2)**.
- **Defense (approx)**: Adds a single **Defense** row per school; points are DST points distributed to IDPs by snap share, summing **top 11** contributors. Expand/hover to view contributors.
- **Selection Mode**: `weekly` (this week’s best) vs `avg` (manager-style picks by season-to-date average up through previous week).
- Endpoints: `/api/scores`, `/api/school/[school]`, `/api/matchup`, `/api/standings`, `/api/prewarm`.
- Pages: `/schools`, `/schools/[school]` (with line chart), `/rankings`, `/matchups`, `/standings`.

## Quickstart
```bash
npm install
cp .env.example .env.local  # set FANTASYNERDS_API_KEY
npm run dev
```