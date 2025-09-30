import type { CfbGame, SeasonType } from "./cfbd";
import { getCfbSeasonSlate } from "./cfbd";
import { canonicalTeam, normalizeSchool } from "./schoolNames";

export { canonicalTeam, canonicalize, normalizeSchool, sameSchool } from "./schoolNames";

const sortGames = (a: CfbGame, b: CfbGame) => {
  if (a.week !== b.week) return a.week - b.week;
  if (a.kickoffISO && b.kickoffISO) return a.kickoffISO.localeCompare(b.kickoffISO);
  if (a.kickoffISO) return -1;
  if (b.kickoffISO) return 1;
  return 0;
};

export function filterTeamGamesFromSlate(slate: CfbGame[], requestedTeam: string): CfbGame[] {
  const team = requestedTeam.trim();
  if (!team) return [];
  const canonical = canonicalTeam(team);
  if (!canonical) return [];

  if (slate.length) {
    const sample = slate[0];
    const sampleHomeCanonical = sample.home ? canonicalTeam(sample.home) : "";
    const sampleAwayCanonical = sample.away ? canonicalTeam(sample.away) : "";
    // eslint-disable-next-line no-console
    console.log("filterTeamGamesFromSlate canonical", {
      canonical,
      sampleHomeCanonical,
      sampleAwayCanonical,
      sampleHome: sample.home,
      sampleAway: sample.away,
    });
  }

  const strictMatches = slate.filter((game) => {
    if (!game.home || !game.away) return false;
    return canonicalTeam(game.home) === canonical || canonicalTeam(game.away) === canonical;
  });
  if (strictMatches.length) {
    const sorted = [...strictMatches];
    sorted.sort(sortGames);
    return sorted;
  }

  const fallback = slate.filter((game) => {
    if (!game.home || !game.away) return false;
    const home = canonicalTeam(game.home);
    const away = canonicalTeam(game.away);
    if (!home || !away) return false;
    return (
      home.includes(canonical) ||
      away.includes(canonical) ||
      canonical.includes(home) ||
      canonical.includes(away)
    );
  });
  const sorted = [...fallback];
  sorted.sort(sortGames);
  return sorted;
}

export async function getCfbTeamSeasonGames(season: number, team: string): Promise<CfbGame[]> {
  const normalizedTeam = normalizeSchool(team);
  const seasonTypes: SeasonType[] = ["regular", "postseason"];
  const games: CfbGame[] = [];
  // eslint-disable-next-line no-console
  console.log("team normalization", { team, normalizedTeam });
  for (const seasonType of seasonTypes) {
    try {
      const { slate, error, status } = await getCfbSeasonSlate(season, seasonType);
      // eslint-disable-next-line no-console
      console.log("getCfbSeasonSlate response", {
        season,
        seasonType,
        slateLength: slate.length,
        error,
        status,
      });
      if (error) {
        if (status && status !== 200) {
          await getCfbSeasonSlate(season, seasonType, true);
        }
        throw new Error(error);
      }
      const matches = filterTeamGamesFromSlate(slate, normalizedTeam);
      for (const game of matches) {
        games.push(game);
      }
    } catch (error) {
      if (seasonType === "regular") throw error;
      // eslint-disable-next-line no-console
      console.warn(`Failed to load ${seasonType} games for ${team}:`, error);
    }
  }
  games.sort(sortGames);
  return games;
}
