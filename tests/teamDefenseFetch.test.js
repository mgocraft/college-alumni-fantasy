const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { loadTsModule } = require('./helpers/loadTsModule');

test('team defense loader retries cache after gzip failure', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nflverse-cache-'));
  const previousCacheDir = process.env.NFLVERSE_CACHE_DIR;
  const previousNextCacheDir = process.env.NEXT_CACHE_DIR;
  process.env.NFLVERSE_CACHE_DIR = tmpDir;
  process.env.NEXT_CACHE_DIR = tmpDir;

  const httpModule = loadTsModule(path.resolve(__dirname, '../lib/http.ts'));
  const nflverseModule = loadTsModule(path.resolve(__dirname, '../lib/nflverse.ts'));

  const originalFetchBuffer = httpModule.fetchBuffer;

  const assetUrl = 'https://example.com/stats_team_week_2025.csv.gz';
  const releasePayload = JSON.stringify({
    assets: [
      {
        name: 'stats_team_week_2025.csv.gz',
        browser_download_url: assetUrl,
      },
    ],
  });

  const csv = [
    'season,week,team,sacks,interceptions,fumble_recoveries,safeties,defensive_touchdowns,return_touchdowns,points_allowed',
    '2025,1,PHI,3,2,1,0,1,0,10',
  ].join('\n');
  const goodBuffer = zlib.gzipSync(Buffer.from(csv, 'utf8'));
  const truncatedBuffer = goodBuffer.subarray(0, Math.max(0, goodBuffer.length - 10));

  let assetFetchCount = 0;

  httpModule.fetchBuffer = async (url, init) => {
    if (url.includes('/releases/tags/stats_team')) {
      return Buffer.from(releasePayload, 'utf8');
    }
    if (url === assetUrl) {
      if (init?.method === 'HEAD') {
        return Buffer.alloc(0);
      }
      assetFetchCount += 1;
      if (assetFetchCount === 1) {
        return truncatedBuffer;
      }
      return goodBuffer;
    }
    throw new Error(`Unexpected fetchBuffer call for ${url} (${init?.method ?? 'GET'})`);
  };

  t.after(() => {
    httpModule.fetchBuffer = originalFetchBuffer;
    if (previousCacheDir === undefined) delete process.env.NFLVERSE_CACHE_DIR;
    else process.env.NFLVERSE_CACHE_DIR = previousCacheDir;
    if (previousNextCacheDir === undefined) delete process.env.NEXT_CACHE_DIR;
    else process.env.NEXT_CACHE_DIR = previousNextCacheDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const { fetchTeamDefenseInputs } = nflverseModule;

  const rows = await fetchTeamDefenseInputs(2025, 1);
  assert.ok(assetFetchCount >= 2, 'expected asset fetch to retry after gzip failure');
  assert.equal(rows.length, 1, 'expected a team defense row');
  assert.equal(rows[0].team, 'PHI');
  assert.equal(rows[0].defensive_tds, 1);
});
