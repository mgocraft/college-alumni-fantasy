
'use client';
import { useState } from "react";
import { fetchJson, friendlyErrorMessage } from "@/lib/clientFetch";
type Performer = { name:string; position:string; team?:string; points:number; meta?:any };
type MatchResp = { season:number; week:number; format:string; mode:'weekly'|'avg'; includeK:boolean; defense:'none'|'approx';
  home:string; away:string; homePoints:number; awayPoints:number; winner:'home'|'away'|'tie'; homeLineup:Performer[]; awayLineup:Performer[] };
export default function MatchupsPage() {
  const [season,setSeason]=useState("2025"); const [week,setWeek]=useState("2"); const [format,setFormat]=useState("ppr");
  const [mode,setMode]=useState<"weekly"|"avg">("weekly"); const [includeK,setIncludeK]=useState(true); const [defense,setDefense]=useState<'none'|'approx'>('none');
  const [home,setHome]=useState("Michigan"); const [away,setAway]=useState("Oklahoma"); const [record,setRecord]=useState(false);
  const [data,setData]=useState<MatchResp|null>(null); const [loading,setLoading]=useState(false); const [error,setError]=useState<string|null>(null);

  const renderPerf = (p:any) => {
    if ((p.position||'').toUpperCase()==='DEF' && p.meta?.contributors) {
      const tip = p.meta.contributors.map((c:any)=>`${c.label}: ${c.points.toFixed?c.points.toFixed(1):c.points}`).join('\n');
      return (<details style={{cursor:'pointer'}} title={tip}><summary>Defense — {p.points?.toFixed?p.points.toFixed(1):p.points} pts</summary>
        <ul>{p.meta.contributors.map((c:any,idx:number)=>(<li key={idx}>{c.label} — {c.points.toFixed?c.points.toFixed(2):c.points}</li>))}</ul>
      </details>);
    }
    return (<span>{p.name} ({p.position}{p.team?`/${p.team}`:''}) — {p.points}</span>);
  };

  const simulate = async () => {
    try {
      setLoading(true); setError(null);
      const q = new URLSearchParams({ season, week, format, mode, includeK: String(includeK), defense, home, away, record: String(record) }).toString();
      const response = await fetchJson<MatchResp>(`/api/matchup?${q}`);
      if (response && typeof response === "object" && "error" in response) {
        const message = typeof (response as { error?: unknown }).error === "string"
          ? String((response as { error?: unknown }).error)
          : "Unable to simulate matchup";
        throw new Error(message);
      }
      setData(response);
    } catch (e) {
      console.error("Failed to simulate matchup", e);
      setData(null);
      setError(friendlyErrorMessage(e, "Unable to simulate matchup"));
    } finally { setLoading(false); }
  };

  return (<div className="card">
    <h2>Simulate Alumni Matchup</h2>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, margin:'12px 0' }}>
      <label>Season <input type="number" value={season} onChange={e=>setSeason(e.target.value)} style={{ marginLeft:8, width:100 }}/></label>
      <label>Week <input type="number" min={1} max={18} value={week} onChange={e=>setWeek(e.target.value)} style={{ marginLeft:8, width:80 }}/></label>
      <label>Format <select value={format} onChange={e=>setFormat(e.target.value)} style={{ marginLeft:8 }}><option value="ppr">PPR</option><option value="half-ppr">Half-PPR</option><option value="standard">Standard</option></select></label>
      <label>Selection Mode <select value={mode} onChange={e=>setMode(e.target.value as any)} style={{ marginLeft:8 }}><option value="weekly">Weekly best</option><option value="avg">Manager (avg to date)</option></select></label>
      <label>Include K <input type="checkbox" checked={includeK} onChange={e=>setIncludeK(e.target.checked)} style={{ marginLeft:8 }}/></label>
      <label>Defense <select value={defense} onChange={e=>setDefense(e.target.value as any)} style={{ marginLeft:8 }}><option value="none">None</option><option value="approx">Approx (snap share)</option></select></label>
      <label>Home <input value={home} onChange={e=>setHome(e.target.value)} style={{ marginLeft:8 }}/></label>
      <label>Away <input value={away} onChange={e=>setAway(e.target.value)} style={{ marginLeft:8 }}/></label>
      <label><input type="checkbox" checked={record} onChange={e=>setRecord(e.target.checked)} /> Record result</label>
      <button className="btn" onClick={simulate}>Simulate</button>
    </div>
    {loading && <div>Simulating…</div>}
    {error && <div style={{ color:'salmon' }}><b>Error:</b> {error}</div>}
    {data && (<div style={{ marginTop:16 }}>
      <h3>{data.home} vs {data.away} — Week {data.week} ({data.format.toUpperCase()}, {data.mode}{data.includeK?', K':''}{data.defense!=='none'?', DEF':''})</h3>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div className="card"><h4>{data.home}</h4><div className="badge">{data.homePoints.toFixed(1)} pts</div>
          <ul>{data.homeLineup.map((p:any, idx:number)=>(<li key={idx}>{renderPerf(p)}</li>))}</ul>
        </div>
        <div className="card"><h4>{data.away}</h4><div className="badge">{data.awayPoints.toFixed(1)} pts</div>
          <ul>{data.awayLineup.map((p:any, idx:number)=>(<li key={idx}>{renderPerf(p)}</li>))}</ul>
        </div>
      </div>
      <h3 style={{ marginTop:12 }}>Result: {data.winner==='tie' ? 'Tie' : (data.winner==='home' ? data.home : data.away) + ' wins'}</h3>
    </div>)}
  </div>);
}
