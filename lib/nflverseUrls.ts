export const playersMasterCandidates = [
  'https://raw.githubusercontent.com/nflverse/nflfastR-roster/master/data/players.csv',
  'https://www.nflverse.com/data/roster/players.csv',
];

export function playerStatsUrl(season: number) {
  return `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;
}
