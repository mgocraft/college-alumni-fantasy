
'use client';
import { useEffect, useState } from "react";
import Link from "next/link";
type Row = { school:string; week:number; format:string; totalPoints:number; performers:{name:string; position:string; team?:string; points:number; meta?:any}[] };
type Api = { season:number; week:number; format:string; mode:'weekly'|'avg'; includeK:boolean; defense:'none'|'approx'; count:number; results: Row[] };
export default function SchoolsPage() {
  const [data,setData] = useState<Api|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
  useEffect(()=>{ fetch(`/api/scores?season=2025&week=1&format=ppr&mode=weekly&includeK=true&defense=none`).then(r=>r.json()).then(j=>{ setData(j); setLoading(false); }).catch(e=>{ setError(String(e)); setLoading(false); }); }, []);
  if (loading) return <div className="card"><h2>Loading weekly alumni lineup scores…</h2></div>;
  if (error) return <div className="card"><h2>Error</h2><pre>{error}</pre></div>;
  return (<div className="card"><h2>Week {data?.week} — Alumni Lineup Scores (QB, TE, WR, WR, RB, RB, K?, FLEX)</h2>
    <div className="list">
      {data?.results.map(row => (<div key={row.school} className="card">
        <h3 style={{marginTop:0}}><Link href={`/schools/${encodeURIComponent(row.school)}`}>{row.school}</Link></h3>
        <div className="badge">{row.totalPoints.toFixed(1)} pts</div>
        <ul>{row.performers.slice(0,5).map((p,idx)=>(<li key={idx}>{p.name} ({p.position}{p.team?`/${p.team}`:''}) — {p.points}</li>))}</ul>
      </div>))}
    </div>
  </div>);
}
