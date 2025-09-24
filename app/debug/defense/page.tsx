"use client";
import { useEffect, useState } from "react";
import { fetchDefense, type DefenseRow } from "@/utils/fetchDefense";

export default function DebugDefense() {
  const [rows, setRows] = useState<DefenseRow[]>([]);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    fetchDefense(2025).then(setRows).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="p-4 text-red-600">Error: {err}</div>;
  if (!rows.length) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Defense Debug (2025)</h1>
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Team</th>
            <th className="text-right">Week</th>
            <th className="text-right">PA</th>
            <th className="text-right">Sacks</th>
            <th className="text-right">INT</th>
            <th className="text-right">FR</th>
            <th className="text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .sort((a, b) => a.team.localeCompare(b.team))
            .map((r, i) => (
              <tr key={i}>
                <td>{r.team}</td>
                <td className="text-right">{r.week}</td>
                <td className="text-right">{r.points_allowed}</td>
                <td className="text-right">{r.sacks}</td>
                <td className="text-right">{r.interceptions}</td>
                <td className="text-right">{r.fumbles_recovered}</td>
                <td className="text-right font-semibold">{r.score}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
