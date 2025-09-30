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

export function filterTeamGamesFromSlate(
  slate: CfbGame[],
  requestedTeam: string,
  options?: { debug?: boolean },
): CfbGame[] {
  const debug = Boolean(options?.debug);
  const team = requestedTeam.trim();
  if (!team) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn("[schedules] filterTeamGamesFromSlate empty team", { requestedTeam });
    }
    return [];
  }

  const normalized = normalizeSchool(team);
  const canonicalSource = normalized || team;
  const canonical = canonicalTeam(canonicalSource);
  if (debug || !normalized || !canonical) {
    const sample = slate.find((game) => game.home || game.away) ?? null;
    const sampleHomeCanonical = sample?.home ? canonicalTeam(sample.home) : "";
    const sampleAwayCanonical = sample?.away ? canonicalTeam(sample.away) : "";
    // eslint-disable-next-line no-console
    console.log("[schedules] filterTeamGamesFromSlate guard", {
      requestedTeam,
      normalized,
      canonical,
      sampleHome: sample?.home ?? null,
      sampleAway: sample?.away ?? null,
      sampleHomeCanonical,
      sampleAwayCanonical,
      slateLength: slate.length,
    });
  }

  if (!canonical) return [];

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

export async function getCfbTeamSeasonGames(
  season: number,
  team: string,
  options?: { debug?: boolean },
): Promise<CfbGame[]> {
  const debug = Boolean(options?.debug);
  const normalizedTeam = normalizeSchool(team);
  const seasonTypes: SeasonType[] = ["regular", "postseason"];
  const games: CfbGame[] = [];
  if (debug) {
    // eslint-disable-next-line no-console
    console.log("[schedules] team normalization", { team, normalizedTeam });
  }
  for (const seasonType of seasonTypes) {
    try {
      const { slate, error, status } = await getCfbSeasonSlate(season, seasonType, debug);
      if (debug) {
        // eslint-disable-next-line no-console
        console.log("[schedules] getCfbSeasonSlate response", {
          season,
          seasonType,
          slateLength: slate.length,
          error,
          status,
        });
      }
      if (error) {
        if (status && status !== 200) {
          await getCfbSeasonSlate(season, seasonType, true);
        }
        throw new Error(error);
      }
      const matches = filterTeamGamesFromSlate(slate, normalizedTeam, { debug });
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
