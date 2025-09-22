import Link from "next/link";
import { loadSeasonSummary } from "@/lib/seasonSummary";

const DEFAULT_SEASON = 2025;
const DEFAULT_FORMAT = "ppr";
const DEFAULT_DEFENSE: "none" | "approx" = "approx";
const INCLUDE_K = true;

export const revalidate = Number(process.env.CACHE_SECONDS ?? 3600);

function formatPoints(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  return value.toFixed(1);
}

function formatTopPlayer(player?: { name: string; position?: string; team?: string; totalPoints: number }): string {
  if (!player) return "—";
  const position = (player.position || "").toUpperCase();
  const team = player.team?.trim();
  const extras = [position, team].filter(Boolean).join(position && team ? "/" : "");
  const details = extras ? ` (${extras})` : "";
  return `${player.name}${details} — ${formatPoints(player.totalPoints)} pts`;
}

export default async function HomePage() {
  let error: string | null = null;
  let summary: Awaited<ReturnType<typeof loadSeasonSummary>> | null = null;
  try {
    summary = await loadSeasonSummary({
      season: DEFAULT_SEASON,
      format: DEFAULT_FORMAT,
      includeK: INCLUDE_K,
      defense: DEFAULT_DEFENSE,
    });
  } catch (err) {
    console.error("Failed to load season summary", err);
    error = "Unable to load season summary right now. Please try again later.";
  }

  const lastWeekLabel = summary && summary.lastCompletedWeek > 0
    ? `Week ${summary.lastCompletedWeek} Points`
    : "Last Week Points";

  return (
    <div className="card">
      <h1>College Alumni Fantasy</h1>
      <p>Weekly fantasy points by <b>college</b> from pro players.</p>
      <p className="badge">nflverse data</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <Link className="btn" href="/schools">Browse Schools</Link>
        <Link className="btn" href="/rankings">Rankings</Link>
        <Link className="btn" href="/matchups">Simulate Matchups</Link>
        <Link className="btn" href="/standings">Standings</Link>
      </div>
      {error && <p style={{ color: "salmon", marginTop: 16 }}>{error}</p>}
      {!error && summary && summary.rows.length === 0 && (
        <p style={{ marginTop: 16 }}>Season data is not yet available for {summary.season}.</p>
      )}
      {!error && summary && summary.rows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>Season Leaders — {summary.season} ({summary.format.toUpperCase()} + DEF)</h2>
          <p style={{ marginTop: 4 }}>Totals reflect weekly best lineups through Week {summary.lastCompletedWeek}.</p>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Rank</th>
                  <th style={{ textAlign: "left" }}>School</th>
                  <th style={{ textAlign: "right" }}>Season Points</th>
                  <th style={{ textAlign: "right" }}>{lastWeekLabel}</th>
                  <th style={{ textAlign: "right" }}>Manager Mode Points</th>
                  <th style={{ textAlign: "left" }}>Top Scoring Player</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row, index) => (
                  <tr key={row.school} style={{ borderTop: "1px solid #1e293b" }}>
                    <td>#{index + 1}</td>
                    <td>
                      <Link href={`/schools/${encodeURIComponent(row.school)}`}>
                        {row.school}
                      </Link>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatPoints(row.weeklyTotal)}</td>
                    <td style={{ textAlign: "right" }}>{formatPoints(row.lastWeekPoints)}</td>
                    <td style={{ textAlign: "right" }}>{formatPoints(row.managerTotal)}</td>
                    <td>{formatTopPlayer(row.topPlayer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="footer">Powered by nflverse public releases — no API keys needed.</div>
    </div>
  );
}
