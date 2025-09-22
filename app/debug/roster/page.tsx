"use client";
import { useEffect, useState } from "react";
import { fetchRoster, RosterRow } from "@/utils/fetchRoster";

export default function DebugRoster() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    fetchRoster(2025).then(setRows).catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="p-4 text-red-600">Error: {err}</div>;
  if (!rows.length) return <div className="p-4">Loading…</div>;

  const withCollege = rows.filter(r => r.college);
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Roster Debug (2025)</h1>
      <div>Rows: {rows.length} · With college: {withCollege.length}</div>
      <table className="min-w-full text-sm">
        <thead><tr><th className="text-left">Name</th><th className="text-left">Team</th><th className="text-left">College</th></tr></thead>
        <tbody>
          {rows.slice(0,200).map((r,i)=>(
            <tr key={i}><td>{r.name}</td><td>{r.team}</td><td>{r.college || <span className="text-red-600">Unknown</span>}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
