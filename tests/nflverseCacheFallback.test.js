const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { loadTsModule } = require('./helpers/loadTsModule');

test('stale cached stats are used when nflverse asset is temporarily missing', async (t) => {
  const season = 2099;
  const week = 1;
  const releaseTag = 'stats_player';
  const filename = `stats_player_week_${season}.csv.gz`;

  const cacheRoot = process.env.NFLVERSE_CACHE_DIR
    ? path.resolve(process.env.NFLVERSE_CACHE_DIR)
    : path.join(os.tmpdir(), 'next-cache', 'nflverse');

  const filePath = path.join(cacheRoot, releaseTag, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const statsCsv = [
    'season,week,player_gsis_id,player_display_name,recent_team,position,passing_yards,passing_tds,interceptions,rushing_yards,rushing_tds,receptions,receiving_yards,receiving_tds,fumbles_lost,field_goals_made,extra_points_made',
    `${season},${week},alpha,Unknown Player,HOU,WR,0,0,0,0,0,7,110,1,0,0,0`,
    `${season},${week},00-0033559,J. Hurts,PHI,QB,200,2,1,60,1,0,0,0,0,0,0`,
  ].join('\n');

  const statsBuffer = zlib.gzipSync(Buffer.from(statsCsv, 'utf8'));
  fs.writeFileSync(filePath, statsBuffer);

  const staleDate = new Date(Date.now() - (2 * 3600 * 1000));
  fs.utimesSync(filePath, staleDate, staleDate);

  const httpModule = loadTsModule(path.resolve(__dirname, '../lib/http.ts'));
  const { HttpError } = loadTsModule(path.resolve(__dirname, '../lib/api.ts'));

  let headCalls = 0;
  let getCalls = 0;
  const originalFetchBuffer = httpModule.fetchBuffer;

  httpModule.fetchBuffer = async (url, init) => {
    if (url.includes(`stats_player_week_${season}`)) {
      if ((init?.method || '').toUpperCase() === 'HEAD') {
        headCalls += 1;
        throw new HttpError(404, 'Not Found');
      }
      getCalls += 1;
      throw new Error(`Unexpected GET request for ${url}`);
    }
    return originalFetchBuffer(url, init);
  };

  t.after(() => {
    httpModule.fetchBuffer = originalFetchBuffer;
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  });

  const { fetchWeeklyPlayerStats } = loadTsModule(path.resolve(__dirname, '../lib/nflverse.ts'));
  const results = await fetchWeeklyPlayerStats(season, week);

  assert.equal(headCalls, 1);
  assert.equal(getCalls, 0);
  assert.equal(results.length, 2);

  const playerIds = results.map((row) => row.player_id);
  assert.ok(playerIds.includes('alpha'));
  assert.ok(playerIds.some((id) => id.includes('hurts') || id.includes('00-0033559')));
});
