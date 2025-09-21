const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { loadTsModule } = require('./helpers/loadTsModule');

test('scores API uses stat fallback to populate colleges', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nflverse-test-'));
  const previousCacheDir = process.env.NFLVERSE_CACHE_DIR;
  const previousNextCacheDir = process.env.NEXT_CACHE_DIR;
  process.env.NFLVERSE_CACHE_DIR = tmpDir;
  process.env.NEXT_CACHE_DIR = tmpDir;

  const httpModule = loadTsModule(path.resolve(__dirname, '../lib/http.ts'));

  const statsCsv = [
    'season,week,player_gsis_id,player_display_name,recent_team,position,passing_yards,passing_tds,interceptions,rushing_yards,rushing_tds,receptions,receiving_yards,receiving_tds,fumbles_lost,field_goals_made,extra_points_made',
    '2025,1,alpha,Unknown Player,HOU,WR,0,0,0,0,0,7,110,1,0,0,0',
    '2025,1,00-0033559,J. Hurts,PHI,QB,200,2,1,60,1,0,0,0,0,0,0',
  ].join('\n');
  const statsBuffer = zlib.gzipSync(Buffer.from(statsCsv, 'utf8'));
  const playersCsv = [
    'player_id,gsis_id,full_name,recent_team,college_name',
    'alpha,,Unknown Player,HOU,Rice',
    ',00-0033559,Jalen Hurts,PHI,Oklahoma',
  ].join('\n');

  const originalFetchBuffer = httpModule.fetchBuffer;
  httpModule.fetchBuffer = async (url, init) => {
    if (url.includes('stats_player_week_2025')) {
      if (init?.method === 'HEAD') return Buffer.alloc(0);
      return statsBuffer;
    }
    if (url.includes('players.csv')) {
      return Buffer.from(playersCsv, 'utf8');
    }
    if (url.includes('roster_week_2025')) {
      throw new Error(`Roster fetch should not be attempted: ${url}`);
    }
    throw new Error(`Unexpected fetchBuffer call for ${url}`);
  };

  t.after(() => {
    httpModule.fetchBuffer = originalFetchBuffer;
    if (previousCacheDir === undefined) delete process.env.NFLVERSE_CACHE_DIR;
    else process.env.NFLVERSE_CACHE_DIR = previousCacheDir;
    if (previousNextCacheDir === undefined) delete process.env.NEXT_CACHE_DIR;
    else process.env.NEXT_CACHE_DIR = previousNextCacheDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const { GET } = loadTsModule(path.resolve(__dirname, '../app/api/scores/route.ts'));

  const response = await GET(new Request('http://test/api/scores?season=2025&week=1&format=ppr&mode=weekly'));
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.ok(Array.isArray(payload.results));
  assert.equal(payload.count, payload.results.length);

  const schools = payload.results.map((entry) => entry.school);
  assert.ok(new Set(schools).size >= 2, 'expected multiple schools from players master join');
  assert.ok(schools.includes('Rice'), 'expected Rice mapping from players master');
  assert.ok(schools.includes('Oklahoma'), 'expected Oklahoma mapping from players master alt id');
});
