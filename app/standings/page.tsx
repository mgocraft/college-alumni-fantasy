
'use client';
import { useEffect, useState } from "react";
import { fetchJson, friendlyErrorMessage } from "@/lib/clientFetch";
type Row = { school:string; wins:number; losses:number; ties:number; pointsFor:number; pointsAgainst:number };
type Api = { recordsCount:number; standings: Row[] };
export default function StandingsPage() {
  const [data,setData]=useState<Api|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchJson<Api>("/api/standings");
        if (response && typeof response === "object" && "error" in response) {
          const message = typeof (response as { error?: unknown }).error === "string"
            ? String((response as { error?: unknown }).error)
            : "Unable to load standings";
          throw new Error(message);
        }
        if (!cancelled) setData(response);
      } catch (e) {
        console.error("Failed to load standings", e);
        if (!cancelled) {
          setData(null);
          setError(friendlyErrorMessage(e, "Unable to load standings"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);
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
