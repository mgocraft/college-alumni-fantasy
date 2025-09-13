
'use client';
import { useEffect, useState } from "react";
type Row = { school:string; wins:number; losses:number; ties:number; pointsFor:number; pointsAgainst:number };
type Api = { recordsCount:number; standings: Row[] };
export default function StandingsPage() {
  const [data,setData]=useState<Api|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
  useEffect(()=>{ fetch('/api/standings').then(r=>r.json()).then(j=>{ setData(j); setLoading(false); }).catch(e=>{ setError(String(e)); setLoading(false); }); }, []);
  if (loading) return <div className="card"><h2>Loading Standings…</h2></div>;
  if (error) return <div className="card"><h2>Error</h2><pre>{error}</pre></div>;
  return (<div className="card"><h2>Standings</h2><div className="badge">{data?.recordsCount ?? 0} recorded games</div>
    <div style={{ overflowX:'auto', marginTop:12 }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
      <thead><tr><th style={{textAlign:'left'}}>School</th><th>W</th><th>L</th><th>T</th><th style={{textAlign:'right'}}>PF</th><th style={{textAlign:'right'}}>PA</th><th style={{textAlign:'right'}}>Diff</th></tr></thead>
      <tbody>{data?.standings?.map(row=>(<tr key={row.school} style={{ borderTop:'1px solid #1e293b' }}>
        <td>{row.school}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.ties}</td><td style={{textAlign:'right'}}>{row.pointsFor.toFixed(1)}</td><td style={{textAlign:'right'}}>{row.pointsAgainst.toFixed(1)}</td><td style={{textAlign:'right'}}>{(row.pointsFor-row.pointsAgainst).toFixed(1)}</td>
      </tr>))}</tbody>
    </table></div></div>);
}
