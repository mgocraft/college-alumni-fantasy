
'use client';
import { useEffect, useState } from "react";
import Link from "next/link";
type Row = { school:string; totalPoints:number; performers:any[] };
type Api = { season:number; week:number; format:string; mode:'weekly'|'avg'; includeK:boolean; defense:'none'|'approx'; count:number; results: Row[] };
export default function RankingsPage() {
  const [season,setSeason]=useState("2025"), [week,setWeek]=useState("1"), [format,setFormat]=useState("ppr");
  const [mode,setMode]=useState<"weekly"|"avg">("weekly");
  const [data,setData]=useState<Api|null>(null), [loading,setLoading]=useState(false), [error,setError]=useState<string|null>(null);
  const load=()=>{ setLoading(true); setError(null);
    const q=new URLSearchParams({ season, week, format, mode, includeK:String(true), defense:'none' }).toString();
    fetch(`/api/scores?${q}`).then(r=>r.json()).then(j=>{ setData(j); setLoading(false); }).catch(e=>{ setError(String(e)); setLoading(false); });
  };
  useEffect(()=>{ load(); }, []);
  return (<div className="card"><h2>Rankings — Week {data?.week ?? week} ({data?.format?.toUpperCase() ?? format.toUpperCase()})</h2>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12, margin:'12px 0' }}>
      <label>Season<input type="number" value={season} onChange={e=>setSeason(e.target.value)} style={{ marginLeft:8, width:100 }}/></label>
      <label>Week<input type="number" min={1} max={18} value={week} onChange={e=>setWeek(e.target.value)} style={{ marginLeft:8, width:80 }}/></label>
      <label>Format<select value={format} onChange={e=>setFormat(e.target.value)} style={{ marginLeft:8 }}><option value="ppr">PPR</option><option value="half-ppr">Half-PPR</option><option value="standard">Standard</option></select></label>
      <label>Selection Mode<select value={mode} onChange={e=>setMode(e.target.value as any)} style={{ marginLeft:8 }}><option value="weekly">Weekly best</option><option value="avg">Manager (avg to date)</option></select></label>
      <button className="btn" onClick={load}>Update</button>
      <Link className="btn" href="/schools">Browse All</Link>
    </div>
    {loading && <div>Loading…</div>}{error && <div style={{color:'salmon'}}><b>Error:</b> {error}</div>}
    <div style={{ overflowX:'auto', marginTop:12 }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
      <thead><tr><th style={{textAlign:'left'}}>Rank</th><th style={{textAlign:'left'}}>School</th><th style={{textAlign:'right'}}>Points</th><th style={{textAlign:'left'}}>Top Performers</th></tr></thead>
      <tbody>{data?.results?.map((row:any, idx:number)=>(<tr key={row.school} style={{ borderTop:'1px solid #1e293b' }}>
        <td>#{idx+1}</td><td><Link href={`/schools/${encodeURIComponent(row.school)}`}>{row.school}</Link></td>
        <td style={{ textAlign:'right' }}>{row.totalPoints.toFixed(1)}</td>
        <td><ul>{row.performers.slice(0,3).map((p:any,i:number)=>(<li key={i}>{p.name} ({p.position}{p.team?`/${p.team}`:''}) — {p.points}</li>))}</ul></td>
      </tr>))}</tbody></table></div>
  </div>);
}
