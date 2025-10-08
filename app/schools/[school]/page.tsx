
'use client';

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchJson, friendlyErrorMessage } from "@/lib/clientFetch";
import type { SlateDiagnostics } from "@/types/alumniTeam";

type Performer = {
  name: string;
  position: string;
  team?: string;
  points: number;
  college?: string | null;
  meta?: any;
};

type SeriesPoint = {
  week: number;
  totalPoints: number;
  performers: Performer[];
};

type Api = {
  school: string;
  season: number;
  format: string;
  mode: "weekly" | "avg";
  includeK: boolean;
  defense: "none" | "approx";
  series: SeriesPoint[];
};

type GameResultRow = {
  cfbWeek: number;
  cfbDate: string;
  homeAway: "Home" | "Away";
  opponent: string;
  usPts: number | null;
  oppPts: number | null;
  result: "W" | "L" | "T" | null;
  status: "final" | "pending" | "scheduled";
  nflSeason: number;
  nflWeek: number;
  nflWindowStart: string;
  nflWindowEnd: string;
};

type GameResultsResponse = {
  team: string;
  season: number;
  rows: GameResultRow[];
  cached?: boolean;
  meta?: SlateDiagnostics;
};

type PendingGameResults = {
  status: "pending";
  message: string;
  season: number;
  week: number;
  meta?: SlateDiagnostics;
};

const decodeSchoolParam = (value: string): string => {
  if (!value) return value;
  let current = value;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
};

const unslugSchoolParam = (value: string): string => {
  const decoded = decodeSchoolParam(value);
  const spaced = decoded.replace(/[-_]+/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};
export default function SchoolDetail({ params }: { params: { school: string } }) {
  const { school } = params;
  const sp = useSearchParams();
  const searchString = sp.toString();
  const debugRequested = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("debug") === "1";
  }, [searchString]);
  const normalizedSchool = unslugSchoolParam(school);
  const schoolSlug = encodeURIComponent(normalizedSchool);
  const config = useMemo(
    () => {
      const params = new URLSearchParams(searchString);
      const season = params.get("season") ?? "2025";
      const format = params.get("format") ?? "ppr";
      const includeKParam = params.get("includeK");
      const includeK = includeKParam === "false" ? false : true;
      const defenseParam = params.get("defense");
      const defense: "none" | "approx" = defenseParam === "none" ? "none" : "approx";
      const startWeek = params.get("startWeek") ?? "1";
      const endWeek = params.get("endWeek") ?? "18";
      return { season, format, includeK, defense, startWeek, endWeek };
    },
    [searchString],
  );
  const configKey = useMemo(() => JSON.stringify(config), [config]);
  const seriesQuery = useMemo(() => {
    const params = new URLSearchParams({
      season: config.season,
      startWeek: config.startWeek,
      endWeek: config.endWeek,
      format: config.format,
      includeK: String(config.includeK),
      defense: config.defense,
    });
    if (debugRequested) params.set("debug", "1");
    return params.toString();
  }, [configKey, debugRequested]);
  const [weeklyData, setWeeklyData] = useState<Api | null>(null);
  const [managerData, setManagerData] = useState<Api | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameResults, setGameResults] = useState<GameResultsResponse | null>(null);
  const [gameResultsLoading, setGameResultsLoading] = useState(true);
  const [gameResultsError, setGameResultsError] = useState<string | null>(null);
  const [gameResultsPending, setGameResultsPending] = useState<PendingGameResults | null>(null);
  const parsedSeason = Number.parseInt(config.season, 10);
  const loadGameResults = async (seasonValue: string) => {
    setGameResultsLoading(true);
    setGameResultsError(null);
    setGameResultsPending(null);
    const parsed = Number.parseInt(seasonValue, 10);
    if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) {
      setGameResults(null);
      setGameResultsError(`Enter a valid season to load game results for ${normalizedSchool}.`);
      setGameResultsLoading(false);
      return;
    }
    try {
      const teamPath = `/api/alumni/team/${parsed}/${schoolSlug}`;
      const url = debugRequested ? `${teamPath}?debug=1` : teamPath;
      const response = await fetchJson<GameResultsResponse | PendingGameResults>(url);
      if (response && typeof response === "object" && "status" in response && response.status === "pending") {
        setGameResults(null);
        setGameResultsPending(response);
        return;
      }
      if (response && typeof response === "object" && "rows" in response) {
        setGameResults(response as GameResultsResponse);
        setGameResultsPending(null);
        return;
      }
      throw new Error(`Unexpected response loading game results for ${normalizedSchool}`);
    } catch (e) {
      console.error(`Failed to load game results for ${normalizedSchool}`, e);
      setGameResults(null);
      setGameResultsPending(null);
      setGameResultsError(friendlyErrorMessage(e, `Unable to load game results for ${normalizedSchool}`));
    } finally {
      setGameResultsLoading(false);
    }
  };
  const loadSeries = async () => {
    setLoading(true);
    setError(null);
    try {
      const [weeklyResponse, managerResponse] = await Promise.all([
        fetchJson<Api>(`/api/school/${schoolSlug}?${seriesQuery}&mode=weekly`),
        fetchJson<Api>(`/api/school/${schoolSlug}?${seriesQuery}&mode=avg`),
      ]);
      const weeklyError = (weeklyResponse as { error?: unknown }).error;
      if (typeof weeklyError === "string" && weeklyError.trim()) {
        throw new Error(weeklyError);
      }
      const managerError = (managerResponse as { error?: unknown }).error;
      if (typeof managerError === "string" && managerError.trim()) {
        throw new Error(managerError);
      }
      setWeeklyData(weeklyResponse);
      setManagerData(managerResponse);
    } catch (e) {
      console.error(`Failed to load school detail for ${normalizedSchool}`, e);
      setWeeklyData(null);
      setManagerData(null);
      setError(friendlyErrorMessage(e, `Unable to load data for ${normalizedSchool}`));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGameResults(config.season);
    void loadSeries();
  }, [config.season, schoolSlug, seriesQuery, debugRequested]);
  const weeklySeries = weeklyData?.series ?? [];
  const managerSeries = managerData?.series ?? [];
  const weeklyMap = new Map(weeklySeries.map((row) => [row.week, row]));
  const managerMap = new Map(managerSeries.map((row) => [row.week, row]));
  const allWeeks = Array.from(new Set<number>([
    ...weeklyMap.keys(),
    ...managerMap.keys(),
  ])).sort((a, b) => a - b);
  const combinedWeekRows = allWeeks.map((week) => ({
    week,
    weekly: weeklyMap.get(week) ?? { week, totalPoints: 0, performers: [] as Performer[] },
    manager: managerMap.get(week) ?? { week, totalPoints: 0, performers: [] as Performer[] },
  }));
  const meta = weeklyData ?? managerData;
  const formatLabel = (meta?.format ?? config.format ?? "ppr").toUpperCase();
  const defenseLabel = config.defense === "approx" ? " + DEF" : "";
  const sortedGameResults = (gameResults?.rows ?? []).slice().sort((a,b)=>{
    if (a.cfbWeek !== b.cfbWeek) return a.cfbWeek - b.cfbWeek;
    return a.cfbDate.localeCompare(b.cfbDate);
  });
  const maxRelevantWeek = (() => {
    let max = 0;
    for (const row of sortedGameResults) {
      if (row.status !== "scheduled" && Number.isFinite(row.nflWeek)) {
        max = Math.max(max, row.nflWeek);
      }
    }
    if (max === 0) {
      for (const entry of combinedWeekRows) {
        if (Number.isFinite(entry.week)) {
          max = Math.max(max, entry.week);
        }
      }
    }
    return max;
  })();
  const limitedWeekRows = maxRelevantWeek > 0
    ? combinedWeekRows.filter((entry) => entry.week <= maxRelevantWeek)
    : combinedWeekRows;
  const chartData = limitedWeekRows.map((entry) => ({
    week: entry.week,
    weeklyPoints: entry.weekly.totalPoints,
    managerPoints: entry.manager.totalPoints,
  }));
  const windowLabel = (start: string, end: string) => {
    const format = (value: string) => (value ? value.replace('T', ' ').slice(0, 16) : '—');
    return `${format(start)} → ${format(end)}`;
  };
  const formatGamePoints = (row: GameResultRow) => {
    const status = row.status ?? (row.result ? 'final' : 'scheduled');
    const haveNumbers = typeof row.usPts === 'number' && typeof row.oppPts === 'number';
    const base = haveNumbers ? `${row.usPts!.toFixed(1)}–${row.oppPts!.toFixed(1)}` : null;
    if (base) {
      if (row.result) return `${base} (${row.result})`;
      if (status === 'pending') return `${base} (pending)`;
      if (status === 'scheduled') return `${base} (scheduled)`;
      return base;
    }
    if (status === 'pending') return 'Pending';
    if (status === 'scheduled') return 'Scheduled';
    return '—';
  };
  const gameResultsSeasonLabel = gameResults?.season ?? (Number.isFinite(parsedSeason) ? parsedSeason : new Date().getFullYear());
  const debugMeta = gameResults?.meta ?? gameResultsPending?.meta;
  const debugListStyle = { margin: '4px 0 0', paddingLeft: 16 } as const;
  const formatDebugValue = (value?: string | null) => {
    if (typeof value === 'string') {
      return value.length ? value : '∅ (empty)';
    }
    if (value === null || value === undefined) return '∅ (empty)';
    return String(value);
  };
  const debugCard = debugMeta ? (
    <details
      style={{
        marginTop: 12,
        background: '#0b1220',
        borderRadius: 12,
        border: '1px solid #1e293b',
        padding: 12,
        color: '#cbd5f5',
      }}
      open={debugRequested}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Debug slate fetch</summary>
      <div style={{ marginTop: 8, fontSize: '0.85rem', lineHeight: 1.5 }}>
        <div>
          <strong>Request</strong>
          <ul style={debugListStyle}>
            <li>Slug: {formatDebugValue(debugMeta.requestedSlug)}</li>
            <li>Display: {formatDebugValue(debugMeta.requestedTeam)}</li>
            <li>Original: {formatDebugValue(debugMeta.requestedTeamOriginal)}</li>
            <li>Normalized: {formatDebugValue(debugMeta.normalizedTeam)}</li>
          </ul>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Filter</strong>
          <ul style={debugListStyle}>
            <li>Input: {formatDebugValue(debugMeta.filter.input)}</li>
            <li>Normalized: {formatDebugValue(debugMeta.filter.normalized)}</li>
            <li>Canonical: {formatDebugValue(debugMeta.filter.canonical)}</li>
          </ul>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Slate counts</strong>
          <ul style={debugListStyle}>
            <li>Total: {debugMeta.slate.total}</li>
            <li>
              Regular: {debugMeta.slate.regular.count}
              {typeof debugMeta.slate.regular.status === 'number' ? ` (status ${debugMeta.slate.regular.status})` : ''}
              {debugMeta.slate.regular.error ? (
                <span style={{ color: '#f87171' }}> — {debugMeta.slate.regular.error}</span>
              ) : null}
            </li>
            <li>
              Postseason: {debugMeta.slate.postseason.count}
              {typeof debugMeta.slate.postseason.status === 'number' ? ` (status ${debugMeta.slate.postseason.status})` : ''}
              {debugMeta.slate.postseason.error ? (
                <span style={{ color: '#f87171' }}> — {debugMeta.slate.postseason.error}</span>
              ) : null}
            </li>
          </ul>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Matches</strong>
          <div>Count: {debugMeta.matches.count}</div>
          {debugMeta.matches.sample.length ? (
            <ul style={debugListStyle}>
              {debugMeta.matches.sample.map((sample, idx) => (
                <li key={`${sample.week}-${sample.home}-${sample.away}-${idx}`}>
                  W{sample.week ?? '—'}: {sample.home} ({sample.homeCanonical || '—'}) vs {sample.away} ({sample.awayCanonical || '—'})
                  {sample.kickoffISO ? ` @ ${sample.kickoffISO.slice(0, 10)}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ marginTop: 4, fontStyle: 'italic', color: '#94a3b8' }}>No matched game sample.</p>
          )}
        </div>
        {debugMeta.probes ? (
          <div style={{ marginTop: 8 }}>
            <strong>Probes</strong>
            <ul style={debugListStyle}>
              {Object.entries(debugMeta.probes).map(([key, value]) => (
                <li key={key}>
                  <span style={{ fontWeight: 500 }}>{key}</span>
                  {Array.isArray(value) ? (
                    value.length ? (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                        {value.map((entry, entryIdx) => (
                          <li key={`${key}-${entryIdx}`}>{entry}</li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ marginLeft: 4, color: '#94a3b8' }}> — no matches</span>
                    )
                  ) : typeof value === 'object' && value ? (
                    <pre
                      style={{
                        marginTop: 4,
                        padding: 8,
                        background: '#0f172a',
                        borderRadius: 8,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  ) : (
                    <span style={{ marginLeft: 4 }}> — {String(value ?? '—')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  ) : null;
  let gameResultsBody: ReactNode;
  if (gameResultsLoading) {
    gameResultsBody = <p>Loading game results…</p>;
  } else if (gameResultsError) {
    gameResultsBody = (<div>
      <h3>Error</h3>
      <pre style={{ whiteSpace:'pre-wrap' }}>{gameResultsError}</pre>
    </div>);
  } else if (gameResultsPending) {
    gameResultsBody = (
      <p>
        NFL stats for {gameResultsPending.season} Week {gameResultsPending.week} are not published yet. Check back soon.
      </p>
    );
  } else if (!sortedGameResults.length) {
    const missingTeam = gameResults?.team ?? normalizedSchool;
    gameResultsBody = (
      <p style={{ marginTop: 12, fontSize: '0.9rem', color: '#94a3b8' }}>
        No games found for “{missingTeam}”. Try “Ohio State” (not OSU), or refresh—schedule names can vary.
      </p>
    );
  } else {
    gameResultsBody = (
      <>
        <div style={{ overflowX:'auto', marginTop:12 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.9rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign:'left', padding:'6px 8px' }}>CFB Wk</th>
                <th style={{ textAlign:'left', padding:'6px 8px' }}>CFB Date</th>
                <th style={{ textAlign:'left', padding:'6px 8px' }}>H/A</th>
                <th style={{ textAlign:'left', padding:'6px 8px' }}>Opponent</th>
                <th style={{ textAlign:'right', padding:'6px 8px' }}>Alumni Pts (Us–Opp)</th>
                <th style={{ textAlign:'left', padding:'6px 8px' }}>NFL Week</th>
                <th style={{ textAlign:'left', padding:'6px 8px' }}>NFL Window (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {sortedGameResults.map((row, idx) => (
                <tr key={`${row.cfbWeek}-${row.homeAway}-${row.opponent}-${idx}`} style={{ borderTop:'1px solid #1e293b' }}>
                  <td style={{ padding:'6px 8px' }}>W{row.cfbWeek}</td>
                  <td style={{ padding:'6px 8px' }}>{row.cfbDate || 'TBD'}</td>
                  <td style={{ padding:'6px 8px' }}>{row.homeAway}</td>
                  <td style={{ padding:'6px 8px' }}>{row.opponent}</td>
                  <td style={{ padding:'6px 8px', textAlign:'right' }}>
                    {formatGamePoints(row)}
                  </td>
                  <td style={{ padding:'6px 8px' }}>{row.nflSeason}-W{row.nflWeek}</td>
                  <td style={{ padding:'6px 8px' }}>{windowLabel(row.nflWindowStart, row.nflWindowEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop:8, fontSize:'0.75rem', color:'#94a3b8' }}>
          NFL window reflects a Tuesday-to-Tuesday UTC cutoff; swap to true schedule ranges when available.
        </p>
      </>
    );
  }

  const renderPerformer = (p: Performer) => {
    const normalizedPosition = (p.position ?? "").trim().toUpperCase();
    if (normalizedPosition==='DEF' && p.meta?.contributors) {
      const tip = p.meta.contributors.map((c:any)=>`${c.label}: ${c.points.toFixed?c.points.toFixed(1):c.points}`).join('\n');
      return (<details style={{cursor:'pointer'}} title={tip}><summary>Defense — {p.points?.toFixed ? p.points.toFixed(1) : p.points} pts</summary>
        <ul>{p.meta.contributors.map((c:any,idx:number)=>(<li key={idx}>{c.label} — {c.points.toFixed?c.points.toFixed(2):c.points}</li>))}</ul>
      </details>);
    }
    const positionLabel = (p.position ?? "").trim();
    return (<span>{p.name} ({positionLabel}{p.team?`/${p.team}`:''}){p.college?` — ${p.college}`:''} — {p.points}</span>);
  };

  if (loading) return <div className="card"><h2>Loading {normalizedSchool}…</h2></div>;
  if (error) return <div className="card"><h2>Error</h2><pre>{error}</pre></div>;

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div className="card">
        <h2>{meta?.school ?? normalizedSchool} — Week-by-Week ({formatLabel}{defenseLabel})</h2>
        <p style={{ marginTop: 8, color: '#94a3b8', fontSize: '0.9rem' }}>
          Top Scoring (weekly best) and Manager Mode (rolling lineup) totals are displayed together.
        </p>
        <div style={{ width:'100%', height:320, background:'#0b1220', borderRadius:12, padding:12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="weeklyPoints" name="Top Scoring" stroke="#38bdf8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="managerPoints" name="Manager Mode" stroke="#f97316" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ margin:'16px 0' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Week</th>
                <th style={{ textAlign: 'right' }}>Top Scoring Pts</th>
                <th style={{ textAlign: 'left' }}>Top Scoring Starters</th>
                <th style={{ textAlign: 'right' }}>Manager Mode Pts</th>
                <th style={{ textAlign: 'left' }}>Manager Starters</th>
              </tr>
            </thead>
            <tbody>
              {limitedWeekRows.map((row) => (
                <tr key={row.week} style={{ borderTop: '1px solid #1e293b' }}>
                  <td>W{row.week}</td>
                  <td style={{ textAlign: 'right' }}>{row.weekly.totalPoints.toFixed(1)}</td>
                  <td>
                    <ul>
                      {row.weekly.performers.map((p, idx) => (
                        <li key={idx}>{renderPerformer(p)}</li>
                      ))}
                    </ul>
                  </td>
                  <td style={{ textAlign: 'right' }}>{row.manager.totalPoints.toFixed(1)}</td>
                  <td>
                    <ul>
                      {row.manager.performers.map((p, idx) => (
                        <li key={idx}>{renderPerformer(p)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>{normalizedSchool} — Game Results ({gameResultsSeasonLabel})</h2>
        {debugCard}
        {gameResultsBody}
      </div>
    </div>
  );
}
