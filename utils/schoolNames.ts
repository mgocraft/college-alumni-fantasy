import { normalizeSchool as normalizeSchoolBase } from "./datasources";

const SYN: Record<string, string> = {
  "miami": "miami (fl)",
  "miami fl": "miami (fl)",
  "miami fla": "miami (fl)",
  "miami hurricanes": "miami (fl)",
  "texas a and m": "texas a&m",
  "texas a m": "texas a&m",
  "texas am": "texas a&m",
  "ole miss": "ole miss",
  "the ohio state": "ohio state",
  "ohio st": "ohio state",
  "ohio st.": "ohio state",
  "ohio state buckeyes": "ohio state",
  "ohio st buckeyes": "ohio state",
  "alabama crimson tide": "alabama",
  "crimson tide": "alabama",
  "bama": "alabama",
  "alab": "alabama",
};

export function canonicalTeam(raw?: string) {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(university|the|of|at)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  s = SYN[s] ?? s;

  return s;
}

const canonicalSlug = (raw?: string) => canonicalTeam(raw).replace(/[^a-z0-9]+/g, "");

export function canonicalize(raw?: string) {
  if (!raw) return "";
  return canonicalSlug(raw);
}

const DISPLAY_OVERRIDES: Record<string, string> = (() => {
  const entries: Array<[string, string]> = [
    ["Miami", "Miami (FL)"],
    ["Miami (FL)", "Miami (FL)"],
    ["Texas A&M", "Texas A&M"],
    ["Texas A and M", "Texas A&M"],
    ["Ole Miss", "Ole Miss"],
    ["Ohio State", "Ohio State"],
    ["Ohio St", "Ohio State"],
    ["Ohio St.", "Ohio State"],
    ["The Ohio State", "Ohio State"],
    ["Ohio State Buckeyes", "Ohio State"],
    ["Alabama", "Alabama"],
    ["Alabama Crimson Tide", "Alabama"],
    ["Crimson Tide", "Alabama"],
    ["Alab", "Alabama"],
  ];
  return entries.reduce<Record<string, string>>((acc, [raw, value]) => {
    const slug = canonicalSlug(raw);
    if (slug) acc[slug] = value;
    return acc;
  }, {});
})();

export function normalizeSchool(n?: string) {
  if (!n) return "";
  const cleaned = n
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const slug = canonicalSlug(cleaned);
  const override = DISPLAY_OVERRIDES[slug];
  if (override) return override;
  const base = normalizeSchoolBase(cleaned);
  return base || cleaned;
}

export function sameSchool(a?: string, b?: string) {
  return canonicalTeam(a) === canonicalTeam(b);
}

