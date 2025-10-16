import Image from "next/image";
import Link from "next/link";
import { loadSeasonSummary } from "@/lib/seasonSummary";
import { DefenseUnavailableError, fetchDefenseApprox } from "@/lib/defense";
import { affiliateAds } from "@/data/affiliateAds";

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
  let defenseBanner: string | null = null;
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

  try {
    const defense = await fetchDefenseApprox({ season: DEFAULT_SEASON });
    if (defense.rows.length === 0) {
      defenseBanner = "Defense stats not posted yet; check back later.";
    } else if (defense.rows.every((row) => Number(row.score) === 0)) {
      console.warn("[home] Defense approx returned zero scores", {
        season: DEFAULT_SEASON,
        week: defense.week,
      });
    }
  } catch (err) {
    if (err instanceof DefenseUnavailableError) {
      defenseBanner = "Defense stats not posted yet; check back later.";
    } else {
      console.error("Failed to load defense status", err);
    }
  }

  const lastWeekLabel = summary && summary.lastCompletedWeek > 0
    ? `Week ${summary.lastCompletedWeek} Points`
    : "Last Week Points";

  const seasonTitle = summary
    ? `Season Leaders — ${summary.season} (${summary.format.toUpperCase()} + DEF)`
    : `Season Leaders — ${DEFAULT_SEASON} (${DEFAULT_FORMAT.toUpperCase()} + DEF)`;

  const weekDescription = summary?.lastCompletedWeek
    ? `Totals reflect weekly best lineups through Week ${summary.lastCompletedWeek}.`
    : "Totals update as soon as weekly stat releases drop.";

  return (
    <main className="page page--flush">
      <div className="toolbar">
        <div className="toolbar__inner">
          <h1 className="toolbar__title">College Alumni Fantasy Football</h1>
          <div className="toolbar__actions">
            <Link className="btn" href="/schools">Browse Schools</Link>
            <Link className="btn" href="/rankings">Rankings</Link>
            <Link className="btn" href="/matchups">Simulate Matchups</Link>
            <Link className="btn" href="/standings">Standings</Link>
            <Link className="btn" href="/about">About</Link>
          </div>
        </div>
      </div>

      <section className="card hero">
        <p className="hero__subtitle">
          Imagine every college program suiting up a fantasy roster built entirely from its alumni. We collect the
          weekly scoring, simulate each school&apos;s schedule with those totals, and track the aggregate results so you
          can return every week to see how your favorite program is stacking up.
        </p>
        {defenseBanner && (
          <p className="alert alert--warning">
            {defenseBanner}
          </p>
        )}
      </section>

      <section className="card ad-shelf">
        <div className="ad-slot-grid">
          {affiliateAds.map((ad) => (
            <a
              key={ad.id}
              className="ad-slot"
              href={ad.href}
              target="_blank"
              rel="noopener noreferrer sponsored"
            >
              <div className="ad-slot__media">
                <Image
                  alt={ad.image.alt}
                  className="ad-slot__image"
                  fill
                  loading="lazy"
                  sizes="(min-width: 1024px) 360px, (min-width: 640px) 60vw, 90vw"
                  src={ad.image.src}
                />
              </div>
              <div className="ad-slot__body">
                <div className="ad-slot__label">{ad.label}</div>
                <div className="ad-slot__cta">{ad.cta}</div>
                {ad.disclaimer && (
                  <div className="ad-slot__disclaimer">{ad.disclaimer}</div>
                )}
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">{seasonTitle}</h2>
        <p className="section-subtitle">{weekDescription}</p>
        {error && (
          <p className="alert alert--error">{error}</p>
        )}
        {!error && summary && summary.rows.length === 0 && (
          <p className="alert alert--warning">Season data is not yet available for {summary.season}.</p>
        )}
        {!error && summary && summary.rows.length > 0 && (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>School</th>
                  <th style={{ textAlign: "right" }}>Season Points</th>
                  <th style={{ textAlign: "right" }}>{lastWeekLabel}</th>
                  <th style={{ textAlign: "right" }}>Record</th>
                  <th>Top Scoring Player</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row, index) => (
                  <tr key={row.school}>
                    <td>#{index + 1}</td>
                    <td>
                      <Link href={`/schools/${encodeURIComponent(row.school)}`}>
                        {row.school}
                      </Link>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatPoints(row.weeklyTotal)}</td>
                    <td style={{ textAlign: "right" }}>{formatPoints(row.lastWeekPoints)}</td>
                    <td style={{ textAlign: "right" }}>{row.record ?? "—"}</td>
                    <td>{formatTopPlayer(row.topPlayer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </main>
  );
}
