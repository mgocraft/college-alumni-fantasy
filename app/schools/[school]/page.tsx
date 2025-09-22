
'use client';
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchJson, friendlyErrorMessage } from "@/lib/clientFetch";
type Performer = { name:string; position:string; team?:string; points:number; college?:string|null; meta?:any };
type SeriesPoint = { week:number; totalPoints:number; performers:Performer[] };
type Api = { school:string; season:number; format:string; mode:'weekly'|'avg'; includeK:boolean; defense:'none'|'approx'; series: SeriesPoint[] };
export default function SchoolDetail({ params }: { params: { school: string } }) {
  const { school } = params; const sp = useSearchParams(); const router = useRouter();
  const [format,setFormat]=useState(sp.get("format")??"ppr"); const [season,setSeason]=useState(sp.get("season")??"2025");
  const [mode,setMode]=useState<"weekly"|"avg">((sp.get("mode") as any)??"weekly"); const [includeK,setIncludeK]=useState(true);
  const [defense,setDefense]=useState<'none'|'approx'>((sp.get("defense") as any)??'none');
  const [startWeek,setStartWeek]=useState(sp.get("startWeek")??"1"); const [endWeek,setEndWeek]=useState(sp.get("endWeek")??"18");
  const [data,setData]=useState<Api|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
  const refresh = async () => {
    const q = new URLSearchParams({ season, startWeek, endWeek, format, mode, includeK: String(includeK), defense }).toString();
    router.replace(`/schools/${encodeURIComponent(school)}?${q}`);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<Api>(`/api/school/${encodeURIComponent(school)}?${q}`);
      if (response && typeof response === "object" && "error" in response) {
        const message = typeof (response as { error?: unknown }).error === "string"
          ? String((response as { error?: unknown }).error)
          : `Unable to load data for ${school}`;
        throw new Error(message);
      }
      setData(response);
    } catch (e) {
      console.error(`Failed to load school detail for ${school}`, e);
      setData(null);
      setError(friendlyErrorMessage(e, `Unable to load data for ${school}`));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ void refresh(); }, [school]);
  const chartData = (data?.series??[]).map(p=>({ week: p.week, points: p.totalPoints }));

  const renderPerformer = (p: Performer) => {
    if ((p.position||'').toUpperCase()==='DEF' && p.meta?.contributors) {
      const tip = p.meta.contributors.map((c:any)=>`${c.label}: ${c.points.toFixed?c.points.toFixed(1):c.points}`).join('\n');
      return (<details style={{cursor:'pointer'}} title={tip}><summary>Defense — {p.points?.toFixed ? p.points.toFixed(1) : p.points} pts</summary>
        <ul>{p.meta.contributors.map((c:any,idx:number)=>(<li key={idx}>{c.label} — {c.points.toFixed?c.points.toFixed(2):c.points}</li>))}</ul>
      </details>);
    }
    return (<span>{p.name} ({p.position}{p.team?`/${p.team}`:''}){p.college?` — ${p.college}`:''} — {p.points}</span>);
  };

  if (loading) return <div className="card"><h2>Loading {school}…</h2></div>;
  if (error) return <div className="card"><h2>Error</h2><pre>{error}</pre></div>;

  return (<div className="card">
    <h2>{data?.school} — Week-by-Week ({data?.format?.toUpperCase()})</h2>
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
  </div>);
}
