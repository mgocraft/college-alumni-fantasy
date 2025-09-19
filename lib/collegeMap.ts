
import idMap from "@/data/player_colleges_by_id.json";
import nameMap from "@/data/player_colleges.json";
import { normalize } from "./utils";
import type { Leader } from "./types";

const sanitizeCollege = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const lower = trimmed.toLowerCase();
  const condensed = lower.replace(/[\s./_-]+/g, "");
  if (!condensed.length) return null;
  if (condensed.startsWith("unknown")) return null;
  if (condensed.startsWith("nocollege")) return null;
  if (condensed === "na" || condensed === "none" || condensed === "null" || condensed === "tbd") return null;
  if (condensed === "notavailable" || condensed === "tobedetermined") return null;
  if (lower.startsWith("n/a") || lower.startsWith("na/")) return null;
  return trimmed;
};

export function resolveCollege(leader: Leader): string {
  const apiCollege = sanitizeCollege((leader as any).college);
  if (apiCollege) return apiCollege;
  const pid = String((leader as any).player_id ?? "");
  if (pid && (idMap as Record<string,string>)[pid]) return (idMap as Record<string,string>)[pid];
  const byName = (nameMap as Record<string,string>)[normalize(leader.full_name)];
  return byName ?? "Unknown";
}
