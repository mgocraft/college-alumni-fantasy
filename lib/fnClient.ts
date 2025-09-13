
import { z } from "zod";
const API_BASE = "https://api.fantasynerds.com/v1/nfl";
const leader = z.object({ player_id: z.union([z.string(), z.number()]), full_name: z.string(), position: z.string(), team: z.string().optional(), points: z.number(), college: z.string().optional().nullable() });
const resp = z.object({ leaders: z.array(leader) }).or(z.array(leader));
export type Leader = z.infer<typeof leader>;
export async function fetchWeeklyLeaders(opts: { week: number; format?: string; position?: string }) {
  const key = process.env.FANTASYNERDS_API_KEY; if (!key) throw new Error("Missing FANTASYNERDS_API_KEY");
  const q = new URLSearchParams(); q.set("apikey", key); q.set("week", String(opts.week)); if (opts.format) q.set("format", opts.format); if (opts.position) q.set("position", opts.position);
  const url = `${API_BASE}/leaders?${q.toString()}`;
  const res = await fetch(url, { next: { revalidate: Number(process.env.CACHE_SECONDS ?? 3600) } });
  if (!res.ok) throw new Error(`FantasyNerds ${res.status}`);
  const j = await res.json();
  const parsed = resp.safeParse(j);
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.success ? parsed.data.leaders : (Array.isArray(j) ? j : j?.leaders ?? []);
  return list as Leader[];
}
export async function fetchWeeklyLeadersRange(opts: { startWeek: number; endWeek: number; format?: string; position?: string }) {
  const all: Leader[][] = [];
  for (let w=opts.startWeek; w<=opts.endWeek; w++) all.push(await fetchWeeklyLeaders({ week: w, format: opts.format, position: opts.position }));
  return all;
}
