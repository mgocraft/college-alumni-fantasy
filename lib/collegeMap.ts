
import idMap from "@/data/player_colleges_by_id.json";
import nameMap from "@/data/player_colleges.json";
import { normalize } from "./utils";
import type { Leader } from "./types";
export function resolveCollege(leader: Leader): string {
  const apiCollege = (leader as any).college;
  if (apiCollege && typeof apiCollege === "string" && apiCollege.trim().length) return apiCollege;
  const pid = String((leader as any).player_id ?? "");
  if (pid && (idMap as Record<string,string>)[pid]) return (idMap as Record<string,string>)[pid];
  const byName = (nameMap as Record<string,string>)[normalize(leader.full_name)];
  return byName ?? "Unknown";
}
