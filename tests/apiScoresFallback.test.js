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

  const { HttpError } = loadTsModule(path.resolve(__dirname, '../lib/api.ts'));
  const httpModule = loadTsModule(path.resolve(__dirname, '../lib/http.ts'));

  const statsCsv = [
    'season,week,player_id,player,team,position,passing_yards,passing_tds,interceptions,rushing_yards,rushing_tds,receptions,receiving_yards,receiving_tds,fumbles_lost,field_goals_made,extra_points_made,gsis_id',
    '2025,1,alpha,Unknown Player,HOU,WR,0,0,0,0,0,7,110,1,0,0,0,12',
    '2025,1,beta,J. Hurts,PHI,QB,200,2,1,60,1,0,0,0,0,0,0,00-0033559',
  ].join('\n');
  const statsBuffer = zlib.gzipSync(Buffer.from(statsCsv, 'utf8'));

  const originalFetchBuffer = httpModule.fetchBuffer;
  httpModule.fetchBuffer = async (url, init) => {
    if (url.includes('stats_player_week_2025')) {
      if (init?.method === 'HEAD') return Buffer.alloc(0);
      return statsBuffer;
    }
    if (url.includes('roster_week_2025')) {
      throw new HttpError(404, 'Not Found');
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
  assert.ok(new Set(schools).size > 1, 'expected multiple schools when falling back to stat-derived roster');
  assert.ok(schools.some((school) => school !== 'Unknown'), 'expected at least one mapped college from stat-derived roster');
  assert.ok(schools.includes('Michigan'), 'expected stat-derived roster to include Michigan mapping from alt ids');
});
