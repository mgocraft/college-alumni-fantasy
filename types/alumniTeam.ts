export type SlateMatchSample = {
  week: number;
  kickoffISO: string | null;
  home: string;
  away: string;
  homeCanonical: string | null;
  awayCanonical: string | null;
};

export type SlateDiagnostics = {
  requestedSlug: string;
  requestedTeamOriginal: string;
  requestedTeam: string;
  normalizedTeam: string;
  provider: "cfbd";
  filter: {
    input: string;
    normalized: string;
    canonical: string | null;
  };
  slate: {
    total: number;
    regular: { count: number; status?: number; error?: string };
    postseason: { count: number; status?: number; error?: string };
  };
  matches: {
    count: number;
    sample: SlateMatchSample[];
  };
  probes?: Record<string, unknown>;
};
