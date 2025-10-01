
'use client';

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchJson, friendlyErrorMessage } from "@/lib/clientFetch";
import type { SlateDiagnostics } from "@/types/alumniTeam";
import { useDefenseStatus } from "@/utils/useDefenseStatus";

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
  const router = useRouter();
  const debugRequested = sp.get("debug") === "1";
  const normalizedSchool = unslugSchoolParam(school);
  const schoolSlug = encodeURIComponent(normalizedSchool);
  const initialDefenseParam = sp.get("defense") as "none" | "approx" | null;
  const [format, setFormat] = useState(sp.get("format") ?? "ppr");
  const [season, setSeason] = useState(sp.get("season") ?? "2025");
  const [mode, setMode] = useState<"weekly" | "avg">((sp.get("mode") as any) ?? "weekly");
  const [includeK, setIncludeK] = useState(true);
  const [defense, setDefense] = useState<"none" | "approx">(
    initialDefenseParam === "none" ? "none" : "approx",
  );
  const [startWeek, setStartWeek] = useState(sp.get("startWeek") ?? "1");
  const [endWeek, setEndWeek] = useState(sp.get("endWeek") ?? "18");
  const [data, setData] = useState<Api | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameResults, setGameResults] = useState<GameResultsResponse | null>(null);
  const [gameResultsLoading, setGameResultsLoading] = useState(true);
  const [gameResultsError, setGameResultsError] = useState<string | null>(null);
  const [gameResultsPending, setGameResultsPending] = useState<PendingGameResults | null>(null);
  const parsedSeason = Number.parseInt(season, 10);
  const parsedEndWeek = Number.parseInt(endWeek, 10);
  const defenseStatus = useDefenseStatus({
    season: Number.isFinite(parsedSeason) && parsedSeason > 0 ? parsedSeason : 2025,
    week: Number.isFinite(parsedEndWeek) && parsedEndWeek > 0 ? parsedEndWeek : undefined,
    enabled: defense === 'approx',
  });
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
  const refresh = async () => {
    const params = new URLSearchParams({
      season,
      startWeek,
      endWeek,
      format,
      mode,
      includeK: String(includeK),
      defense,
    });
    if (debugRequested) params.set("debug", "1");
    const q = params.toString();
    router.replace(`/schools/${schoolSlug}?${q}`);
    setLoading(true);
    setError(null);
    void loadGameResults(season);
    try {
      const response = await fetchJson<Api>(`/api/school/${schoolSlug}?${q}`);
      if (response && typeof response === "object" && "error" in response) {
        const message = typeof (response as { error?: unknown }).error === "string"
          ? String((response as { error?: unknown }).error)
          : `Unable to load data for ${normalizedSchool}`;
        throw new Error(message);
      }
      setData(response);
    } catch (e) {
      console.error(`Failed to load school detail for ${normalizedSchool}`, e);
      setData(null);
      setError(friendlyErrorMessage(e, `Unable to load data for ${normalizedSchool}`));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ void refresh(); }, [schoolSlug]);
  const chartData = (data?.series??[]).map(p=>({ week: p.week, points: p.totalPoints }));
  const sortedGameResults = (gameResults?.rows ?? []).slice().sort((a,b)=>{
    if (a.cfbWeek !== b.cfbWeek) return a.cfbWeek - b.cfbWeek;
    return a.cfbDate.localeCompare(b.cfbDate);
  });
  const windowLabel = (start: string, end: string) => {
    const format = (value: string) => (value ? value.replace('T', ' ').slice(0, 16) : '—');
    return `${format(start)} → ${format(end)}`;
  };
  const formatGamePoints = (row: GameResultRow) => {
    if (typeof row.usPts === 'number' && typeof row.oppPts === 'number' && row.result) {
      return `${row.usPts.toFixed(1)}–${row.oppPts.toFixed(1)} (${row.result})`;
    }
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
        <h2>{data?.school} — Week-by-Week ({data?.format?.toUpperCase()} + DEF)</h2>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12, margin:'12px 0' }}>
          <label>Season<input type="number" value={season} onChange={e=>setSeason(e.target.value)} style={{ marginLeft:8, width:100 }}/></label>
          <label>Format<select value={format} onChange={e=>setFormat(e.target.value)} style={{ marginLeft:8 }}><option value="ppr">PPR</option><option value="half-ppr">Half-PPR</option><option value="standard">Standard</option></select></label>
          <label>Selection Mode<select value={mode} onChange={e=>setMode(e.target.value as any)} style={{ marginLeft:8 }}><option value="weekly">Weekly best</option><option value="avg">Manager (avg to date)</option></select></label>
          <label>Include K <input type="checkbox" checked={includeK} onChange={e=>setIncludeK(e.target.checked)} style={{ marginLeft:8 }}/></label>
          <label>Defense<select value={defense} onChange={e=>setDefense(e.target.value as any)} style={{ marginLeft:8 }}><option value="none">None</option><option value="approx">Approx (snap share)</option></select></label>
          <label>Start Week<input type="number" min={1} max={18} value={startWeek} onChange={e=>setStartWeek(e.target.value)} style={{ marginLeft:8, width:80 }}/></label>
          <label>End Week<input type="number" min={1} max={18} value={endWeek} onChange={e=>setEndWeek(e.target.value)} style={{ marginLeft:8, width:80 }}/></label>
          <button className="btn" onClick={refresh}>Update</button>
        </div>
        {defense === 'approx' && defenseStatus.message && (
          <div className="badge" style={{ marginTop: 8, background: '#f97316', color: '#0b1220' }}>
            Defense stats not posted yet; check back later.
          </div>
        )}
        <div style={{ width:'100%', height:320, background:'#0b1220', borderRadius:12, padding:12 }}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="week"/><YAxis/><Tooltip/><Line type="monotone" dataKey="points" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>
        </div>
        <div style={{ margin:'16px 0' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={{textAlign:'left'}}>Week</th><th style={{textAlign:'right'}}>Points</th><th style={{textAlign:'left'}}>Starters</th></tr></thead>
            <tbody>{data?.series?.map(row=>(<tr key={row.week} style={{ borderTop:'1px solid #1e293b' }}>
              <td>W{row.week}</td><td style={{ textAlign:'right' }}>{row.totalPoints.toFixed(1)}</td>
              <td><ul>{row.performers.map((p,idx)=>(<li key={idx}>{renderPerformer(p)}</li>))}</ul></td>
            </tr>))}</tbody>
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
