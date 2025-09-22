
'use client';
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson, friendlyErrorMessage } from "@/lib/clientFetch";
type Performer = { name:string; position:string; team?:string; points:number; college?:string|null; meta?:any };
type Row = { school:string; week:number; format:string; totalPoints:number; performers:Performer[] };
type Api = { season:number; week:number; format:string; mode:'weekly'|'avg'; includeK:boolean; defense:'none'|'approx'; count:number; results: Row[] };
export default function SchoolsPage() {
  const [data,setData] = useState<Api|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchJson<Api>(`/api/scores?season=2025&week=1&format=ppr&mode=weekly&includeK=true&defense=none`);
        if (response && typeof response === "object" && "error" in response) {
          const message = typeof (response as { error?: unknown }).error === "string"
            ? String((response as { error?: unknown }).error)
            : "Unable to load school list";
          throw new Error(message);
        }
        if (!cancelled) {
          setData(response);
        }
      } catch (e) {
        console.error("Failed to load school list", e);
        if (!cancelled) {
          setData(null);
          setError(friendlyErrorMessage(e, "Unable to load school list"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  if (loading) return <div className="card"><h2>Loading weekly alumni lineup scores…</h2></div>;
  if (error) return <div className="card"><h2>Error</h2><pre>{error}</pre></div>;
  return (<div className="card"><h2>Week {data?.week} — Alumni Lineup Scores (QB, TE, WR, WR, RB, RB, K?, FLEX)</h2>
    <div className="list">
      {data?.results.map(row => (<div key={row.school} className="card">
        <h3 style={{marginTop:0}}><Link href={`/schools/${encodeURIComponent(row.school)}`}>{row.school}</Link></h3>
        <div className="badge">{row.totalPoints.toFixed(1)} pts</div>
        <ul>{row.performers.slice(0,5).map((p,idx)=>(<li key={idx}>{p.name} ({p.position}{p.team?`/${p.team}`:''}){p.college?` — ${p.college}`:''} — {p.points}</li>))}</ul>
      </div>))}
    </div>
  </div>);
}
