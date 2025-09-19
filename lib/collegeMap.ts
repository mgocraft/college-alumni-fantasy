import idMap from "@/data/player_colleges_by_id.json";
import nameMap from "@/data/player_colleges.json";
import { normalize } from "./utils";
import type { Leader } from "./types";


type StringMap = Record<string, string>;

const PLACEHOLDER_PATTERNS = [
  /^unknown\b/i,
  /^n\/?a\b/i,
  /^no\s*college/i,
  /^none\b/i,
  /^null\b/i,
  /^tbd\b/i,
  /^tba\b/i,
  /^tbc\b/i,
  /^pending\b/i,
  /^undecided\b/i,
  /^unassigned\b/i,
  /^not\s+available/i,
  /^not\s+listed/i,
  /^not\s+reported/i,
  /^not\s+provided/i,
];

const PLACEHOLDER_SIMPLIFIED = new Set([
  "unknown",
  "unknowncollege",
  "unk",
  "nacollege",
  "na",
  "n/a",
  "none",
  "null",
  "tbd",
  "tba",
  "tbc",
  "pending",
  "undecided",
  "unassigned",
  "notavailable",
  "notlisted",
  "notreported",
  "notprovided",
]);

const CONNECTOR_WORDS = [
  "university",
  "universities",
  "univ",
  "uni",
  "college",
  "colleges",
  "school",
  "schools",
  "academy",
  "academies",
  "department",
  "departments",
  "program",
  "programs",
  "division",
  "divisions",
  "system",
  "systems",
  "campus",
  "campuses",
  "the",
  "of",
  "at",
  "in",
  "for",
  "from",
  "with",
  "without",
  "by",
  "via",
  "and",
  "amp",
  "de",
  "del",
  "da",
  "do",
  "dos",
  "das",
  "di",
  "dei",
  "du",
  "des",
  "van",
  "von",
  "der",
  "den",
  "el",
  "la",
  "los",
  "las",
  "club",
  "clubs",
  "men",
  "women",
  "team",
  "teams",
  "football",
  "ncaa",
  "ncaaf",
  "fbs",
  "fcs",
];

const MASCOT_WORDS = [
  "aggies",
  "wolverines",
  "sooners",
  "buckeyes",
  "tide",
  "crimson",
  "longhorns",
  "volunteers",
  "gators",
  "seminoles",
  "bulldogs",
  "wildcats",
  "tigers",
  "razorbacks",
  "trojans",
  "bruins",
  "cougars",
  "huskies",
  "panthers",
  "owls",
  "eagles",
  "hawks",
  "falcons",
  "wolves",
  "wolfpack",
  "lions",
  "nittany",
  "chippewas",
  "boilermakers",
  "badgers",
  "gophers",
  "cyclones",
  "cornhuskers",
  "jayhawks",
  "bearcats",
  "bearkats",
  "rebels",
  "mustangs",
  "horned",
  "frogs",
  "ducks",
  "beavers",
  "jaguars",
  "gamecocks",
  "aztecs",
  "hurricane",
  "hurricanes",
  "wave",
  "blazers",
  "knights",
  "minutemen",
  "roadrunners",
  "utes",
  "miners",
  "commodores",
  "hokies",
  "demon",
  "deacons",
  "hilltoppers",
  "mountaineers",
  "spiders",
  "thundering",
  "herd",
  "raiders",
  "raider",
  "warriors",
  "warrior",
  "rainbow",
  "spartan",
  "spartans",
  "flashes",
  "golden",
  "flame",
  "flames",
  "sun",
  "devils",
  "tar",
  "heels",
  "fighting",
  "irish",
  "illini",
  "dawgs",
  "cowboys",
  "cowboy",
  "cowgirls",
  "cowgirl",
  "bison",
  "bisons",
  "grizzlies",
  "lumberjacks",
  "salukis",
  "thunderbirds",
  "vandals",
  "lancers",
  "explorers",
  "dolphins",
  "phoenix",
  "paladins",
  "gaels",
  "skyhawks",
  "governors",
  "privateers",
  "rockets",
  "titans",
  "shockers",
  "shocks",
  "bears",
  "cardinal",
  "cardinals",
  "pirates",
  "dukes",
  "monarchs",
  "pilots",
  "moccasins",
  "mocs",
  "cajuns",
  "jayhawk",
  "lobos",
  "penguins",
  "seahawks",
  "seawolves",
  "jackrabbits",
  "bobcats",
  "bengals",
  "warhawks",
];

const STOP_WORDS = new Set<string>([...CONNECTOR_WORDS, ...MASCOT_WORDS]);

const LOCATION_PAIRS = new Set([
  "college station",
  "baton rouge",
  "salt lake",
  "west point",
  "fort worth",
  "fort collins",
  "los angeles",
  "las vegas",
  "las cruces",
  "ann arbor",
  "east lansing",
  "iowa city",
  "champaign urbana",
  "college park",
  "state college",
  "coral gables",
  "boca raton",
  "palo alto",
  "chestnut hill",
  "west lafayette",
  "mount pleasant",
  "san marcos",
  "new orleans",
  "winston salem",
  "south bend",
  "university park",
  "new brunswick",
  "fort wayne",
  "saint louis",
  "east hartford",
]);

const LOCATION_TOKENS = new Set([
  "tuscaloosa",
  "auburn",
  "starkville",
  "oxford",
  "gainesville",
  "athens",
  "knoxville",
  "lexington",
  "columbia",
  "fayetteville",
  "norman",
  "austin",
  "stillwater",
  "lawrence",
  "manhattan",
  "ames",
  "lincoln",
  "madison",
  "minneapolis",
  "evanston",
  "bloomington",
  "columbus",
  "piscataway",
  "berkeley",
  "stanford",
  "tucson",
  "tempe",
  "seattle",
  "pullman",
  "eugene",
  "corvallis",
  "logan",
  "provo",
  "reno",
  "lubbock",
  "morgantown",
  "clemson",
  "tallahassee",
  "durham",
  "charlottesville",
  "blacksburg",
  "pittsburgh",
  "syracuse",
  "atlanta",
  "orlando",
  "tampa",
  "nashville",
  "memphis",
  "ruston",
  "monroe",
  "lafayette",
  "denton",
  "conway",
  "boone",
  "statesboro",
  "mobile",
  "hattiesburg",
  "huntington",
  "murfreesboro",
  "kalamazoo",
  "ypsilanti",
  "dekalb",
  "harrisonburg",
  "lynchburg",
  "greenville",
  "norfolk",
  "storrs",
  "amherst",
  "bowling",
  "houston",
  "tulsa",
  "cincinnati",
  "waco",
  "louisville",
  "jackson",
  "charlotte",
  "boulder",
  "spokane",
  "ogden",
  "wichita",
  "frisco",
  "huntsville",
  "flagstaff",
  "laredo",
  "savannah",
  "hammond",
  "annapolis",
  "tacoma",
  "vegas",
  "cruces",
  "worth",
  "collins",
  "arbor",
  "gables",
  "raton",
  "usa",
  "us",
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "dc",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wi",
  "wv",
  "wy",
]);

const UPPERCASE_TOKENS = new Set([
  "lsu",
  "usc",
  "ucla",
  "byu",
  "tcu",
  "smu",
  "ucf",
  "usf",
  "uab",
  "utsa",
  "utep",
  "fau",
  "fiu",
  "ecu",
  "uconn",
  "umass",
]);
const RAW_OVERRIDES: Array<[string, string]> = [
  ["LSU", "LSU"],
  ["Louisiana State", "LSU"],
  ["USC", "USC"],
  ["Southern California", "USC"],
  ["Southern Cal", "USC"],
  ["UCLA", "UCLA"],
  ["University of California Los Angeles", "UCLA"],
  ["BYU", "BYU"],
  ["Brigham Young", "BYU"],
  ["TCU", "TCU"],
  ["Texas Christian", "TCU"],
  ["SMU", "SMU"],
  ["Southern Methodist", "SMU"],
  ["UCF", "UCF"],
  ["Central Florida", "UCF"],
  ["University of Central Florida", "UCF"],
  ["USF", "USF"],
  ["South Florida", "USF"],
  ["University of South Florida", "USF"],
  ["UAB", "UAB"],
  ["Alabama Birmingham", "UAB"],
  ["University of Alabama Birmingham", "UAB"],
  ["UTSA", "UTSA"],
  ["Texas San Antonio", "UTSA"],
  ["University of Texas San Antonio", "UTSA"],
  ["UTEP", "UTEP"],
  ["Texas El Paso", "UTEP"],
  ["University of Texas El Paso", "UTEP"],
  ["FAU", "FAU"],
  ["Florida Atlantic", "FAU"],
  ["Florida Atlantic University", "FAU"],
  ["FIU", "FIU"],
  ["Florida International", "FIU"],
  ["Florida International University", "FIU"],
  ["ECU", "ECU"],
  ["East Carolina", "ECU"],
  ["East Carolina University", "ECU"],
  ["UConn", "UConn"],
  ["Connecticut", "UConn"],
  ["University of Connecticut", "UConn"],
  ["UMass", "UMass"],
  ["Massachusetts", "UMass"],
  ["University of Massachusetts", "UMass"],
  ["NC State", "NC State"],
  ["North Carolina State", "NC State"],
  ["Ole Miss", "Ole Miss"],
  ["Penn State", "Penn State"],
  ["Pennsylvania State", "Penn State"],
  ["Ohio State", "Ohio State"],
  ["Florida State", "Florida State"],
  ["Oklahoma State", "Oklahoma State"],
  ["Arizona State", "Arizona State"],
  ["Iowa State", "Iowa State"],
  ["Kansas State", "Kansas State"],
  ["Mississippi State", "Mississippi State"],
  ["Michigan State", "Michigan State"],
  ["Oregon State", "Oregon State"],
  ["Washington State", "Washington State"],
  ["Boise State", "Boise State"],
  ["San Diego State", "San Diego State"],
  ["San Jose State", "San Jose State"],
  ["Fresno State", "Fresno State"],
  ["Colorado State", "Colorado State"],
  ["Utah State", "Utah State"],
  ["Appalachian State", "Appalachian State"],
  ["Ball State", "Ball State"],
  ["Kent State", "Kent State"],
  ["Texas State", "Texas State"],
  ["Georgia State", "Georgia State"],
  ["Georgia Southern", "Georgia Southern"],
  ["South Alabama", "South Alabama"],
  ["Southern Miss", "Southern Miss"],
  ["Louisiana Tech", "Louisiana Tech"],
  ["Louisiana Lafayette", "Louisiana"],
  ["Louisiana-Lafayette", "Louisiana"],
  ["Louisiana Monroe", "Louisiana-Monroe"],
  ["Louisiana-Monroe", "Louisiana-Monroe"],
  ["UL Lafayette", "Louisiana"],
  ["ULL", "Louisiana"],
  ["ULM", "Louisiana-Monroe"],
  ["Prairie View A and M", "Prairie View A&M"],
  ["Prairie View A&M", "Prairie View A&M"],
  ["Florida A and M", "Florida A&M"],
  ["Florida A&M", "Florida A&M"],
  ["Alabama A and M", "Alabama A&M"],
  ["North Carolina A and T", "North Carolina A&T"],
  ["North Carolina A&T", "North Carolina A&T"],
  ["Bethune Cookman", "Bethune-Cookman"],
  ["Sam Houston State", "Sam Houston State"],
  ["Sam Houston", "Sam Houston"],
  ["Jackson State", "Jackson State"],
  ["Grambling State", "Grambling State"],
  ["Southern University", "Southern"],
  ["Alcorn State", "Alcorn State"],
  ["Tennessee State", "Tennessee State"],
  ["Norfolk State", "Norfolk State"],
  ["North Carolina Central", "North Carolina Central"],
  ["Howard", "Howard"],
  ["Hampton", "Hampton"],
  ["Morgan State", "Morgan State"],
  ["Delaware State", "Delaware State"],
  ["Liberty", "Liberty"],
  ["Jacksonville State", "Jacksonville State"],
  ["James Madison", "James Madison"],
  ["Old Dominion", "Old Dominion"],
  ["Middle Tennessee", "Middle Tennessee"],
  ["Middle Tennessee State", "Middle Tennessee"],
  ["Western Kentucky", "Western Kentucky"],
  ["New Mexico State", "New Mexico State"],
  ["New Mexico", "New Mexico"],
  ["Tulane Green Wave", "Tulane"],
  ["North Texas Mean Green", "North Texas"],
  ["Minnesota Golden Gophers", "Minnesota"],
  ["California Golden Bears", "California"],
  ["Kent State Golden Flashes", "Kent State"],
  ["Southern Miss Golden Eagles", "Southern Miss"],
  ["Kansas Jayhawks", "Kansas"],
  ["Georgia Bulldogs", "Georgia"],
  ["Florida Gators", "Florida"],
  ["Alabama Crimson Tide", "Alabama"],
  ["Tennessee Volunteers", "Tennessee"],
  ["South Carolina Gamecocks", "South Carolina"],
  ["Oklahoma Sooners", "Oklahoma"],
  ["Texas Longhorns", "Texas"],
  ["Baylor Bears", "Baylor"],
  ["Houston Cougars", "Houston"],
  ["Cincinnati Bearcats", "Cincinnati"],
  ["Stanford Cardinal", "Stanford"],
  ["Oregon Ducks", "Oregon"],
  ["Washington Huskies", "Washington"],
  ["Notre Dame Fighting Irish", "Notre Dame"],
  ["USC Trojans", "USC"],
  ["UCLA Bruins", "UCLA"],
  ["TCU Horned Frogs", "TCU"],
  ["SMU Mustangs", "SMU"],
  ["BYU Cougars", "BYU"],
  ["UCF Knights", "UCF"],
  ["USF Bulls", "USF"],
  ["UAB Blazers", "UAB"],
  ["UTSA Roadrunners", "UTSA"],
  ["UTEP Miners", "UTEP"],
  ["FAU Owls", "FAU"],
  ["FIU Panthers", "FIU"],
  ["ECU Pirates", "ECU"],
  ["UConn Huskies", "UConn"],
  ["UMass Minutemen", "UMass"],
  ["Air Force Falcons", "Air Force"],
  ["Navy Midshipmen", "Navy"],
  ["Army Black Knights", "Army"],
  ["Army West Point", "Army"],
  ["United States Military", "Army"],
  ["United States Naval", "Navy"],
  ["United States Air Force", "Air Force"],
  ["Pitt Panthers", "Pitt"],
  ["Pittsburgh Panthers", "Pittsburgh"],
  ["Syracuse Orange", "Syracuse"],
  ["Virginia Tech Hokies", "Virginia Tech"],
  ["Virginia Cavaliers", "Virginia"],
  ["Boston College Eagles", "Boston College"],
  ["Wake Forest Demon Deacons", "Wake Forest"],
  ["Georgia Tech Yellow Jackets", "Georgia Tech"],
  ["Miami Hurricanes", "Miami (FL)"],
  ["Miami Florida", "Miami (FL)"],
  ["Miami Fla", "Miami (FL)"],
  ["Miami FL", "Miami (FL)"],
  ["University of Miami", "Miami (FL)"],
  ["Miami (FL)", "Miami (FL)"],
  ["University of Miami (FL)", "Miami (FL)"],
  ["Miami Ohio", "Miami (OH)"],
  ["Miami University", "Miami (OH)"],
  ["Miami OH", "Miami (OH)"],
  ["Miami (OH)", "Miami (OH)"],
  ["North Texas Green", "North Texas"],
  ["Tulane Green", "Tulane"],
  ["Oklahoma Sooners (NCAA)", "Oklahoma"],
  ["University of Michigan", "Michigan"],
  ["Michigan Wolverines", "Michigan"],
  ["University of Oklahoma", "Oklahoma"],
  ["University of Georgia", "Georgia"],
  ["University of Florida", "Florida"],
];
const toAscii = (value: string): string => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

const stripParentheticals = (value: string): string => value.replace(/\([^)]*\)/g, " ");

const collapseLetterTokens = (tokens: string[]): string[] => {
  const result: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (!buffer.length) return;
    result.push(buffer.join(""));
    buffer = [];
  };
  for (const token of tokens) {
    if (token.length === 1 && /[a-z]/.test(token)) {
      buffer.push(token);
      continue;
    }
    flush();
    result.push(token);
  }
  flush();
  return result;
};

const transformToken = (token: string): string | null => {
  if (!token) return null;
  if (/\d/.test(token)) return null;
  const lower = token.toLowerCase();
  if (STOP_WORDS.has(lower)) return null;
  if (lower === "st") return "st";
  if (lower === "ste" || lower === "saint") return "saint";
  if (lower === "ft") return "ft";
  if (lower === "mt") return "mt";
  if (lower === "intl" || lower === "int") return "international";
  if (lower === "tech" || lower === "technology" || lower === "technological") return "tech";
  if (lower === "polytechnic" || lower === "polytechnics") return "polytechnic";
  if (lower === "agricultural" || lower === "agriculture" || lower === "mechanical") return lower;
  return lower;
};

const stripLocationTokens = (tokens: string[]): string[] => {
  if (tokens.length <= 1) return tokens.slice();
  const result = tokens.slice();
  let changed = true;
  while (changed && result.length > 1) {
    changed = false;
    if (result.length > 1) {
      const last = result[result.length - 1];
      const prev = result[result.length - 2];
      const pair = `${prev} ${last}`;
      if (LOCATION_PAIRS.has(pair)) {
        result.splice(result.length - 2, 2);
        changed = true;
        continue;
      }
    }
    const tail = result[result.length - 1];
    if (LOCATION_TOKENS.has(tail) && result.length > 1) {
      result.pop();
      changed = true;
    }
  }
  return result;
};

const collectTokens = (value: string): string[] => {
  const ascii = toAscii(value);
  const base = stripParentheticals(ascii).replace(/[’']/g, "").replace(/&/g, " and ");
  const raw = base.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const collapsed = collapseLetterTokens(raw);
  const tokens: string[] = [];
  for (const token of collapsed) {
    const mapped = transformToken(token);
    if (!mapped) continue;
    tokens.push(mapped);
  }
  if (tokens.length > 1 && tokens[0] === "college") {
    tokens.shift();
  }
  return tokens;
};

const toTitleCase = (tokens: string[]): string =>
  tokens
    .map((token) => {
      if (UPPERCASE_TOKENS.has(token)) return token.toUpperCase();
      if (token === "st") return "St.";
      if (token === "ft") return "Ft.";
      if (token === "mt") return "Mt.";
      if (token === "saint") return "Saint";
      if (token.length <= 2) return token.toUpperCase();
      if (token.startsWith("mc") && token.length > 2) {
        return `Mc${token[2].toUpperCase()}${token.slice(3)}`;
      }
      return token[0].toUpperCase() + token.slice(1);
    })
    .join(" ");

const tokensToKey = (tokens: string[]): string => tokens.join(" ");

const COLLEGE_OVERRIDES = new Map<string, string>();
for (const [alias, canonical] of RAW_OVERRIDES) {
  const tokens = collectTokens(alias);
  if (!tokens.length) continue;
  const key = tokensToKey(tokens);
  if (!COLLEGE_OVERRIDES.has(key)) {
    COLLEGE_OVERRIDES.set(key, canonical);
  }
  const trimmed = stripLocationTokens(tokens);
  if (trimmed.length && trimmed.length !== tokens.length) {
    const trimmedKey = tokensToKey(trimmed);
    if (!COLLEGE_OVERRIDES.has(trimmedKey)) {
      COLLEGE_OVERRIDES.set(trimmedKey, canonical);
    }
  }
}

const sanitizeCollegeValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(lower))) return null;
  const simple = lower.replace(/[^a-z0-9]+/g, "");
  if (!simple.length) return null;
  if (PLACEHOLDER_SIMPLIFIED.has(simple)) return null;
  return trimmed;
};

const canonicalizeCollege = (value: string): string => {
  const tokens = collectTokens(value);
  if (!tokens.length) return value.trim();
  const baseKey = tokensToKey(tokens);
  const baseOverride = COLLEGE_OVERRIDES.get(baseKey);
  if (baseOverride) return baseOverride;
  const trimmed = stripLocationTokens(tokens);
  const key = tokensToKey(trimmed.length ? trimmed : tokens);
  const override = COLLEGE_OVERRIDES.get(key);
  if (override) return override;
  const finalTokens = trimmed.length ? trimmed : tokens;
  return toTitleCase(finalTokens);
};

const canonicalizeCollegeValue = (value: unknown): string | null => {
  const sanitized = sanitizeCollegeValue(value);
  if (!sanitized) return null;
  return canonicalizeCollege(sanitized);
};

export function resolveCollege(leader: Leader): string {
  const apiCollege = canonicalizeCollegeValue((leader as any).college);
  if (apiCollege) return apiCollege;

  const pidRaw = (leader as any).player_id;
  const pid = typeof pidRaw === "number" || typeof pidRaw === "string" ? String(pidRaw) : "";
  if (pid) {
    const mapped = canonicalizeCollegeValue((idMap as StringMap)[pid]);
    if (mapped) return mapped;
  }

  const nameKey = normalize(leader.full_name);
  if (nameKey) {
    const mapped = canonicalizeCollegeValue((nameMap as StringMap)[nameKey]);
    if (mapped) return mapped;
  }

  return "Unknown";
}
