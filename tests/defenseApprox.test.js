const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');

const { loadTsModule } = require('./helpers/loadTsModule');

const modulePath = path.resolve(__dirname, '../lib/defense.ts');

const SAMPLE_CSV = [
  'season,week_num,club_code,opp_club_code,points_for,pass_sacks_allowed,interceptions_thrown,fumbles_lost_offense',
  '2025,3,PHI,DAL,24,1,0,1',
  '2025,3,DAL,PHI,21,3,2,2',
].join('\n');

test('fetchDefenseApprox reads modern team columns', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  const buffer = Buffer.from(SAMPLE_CSV, 'utf8');
  global.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer,
      headers: new Map(),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const { fetchDefenseApprox } = loadTsModule(modulePath);
  const result = await fetchDefenseApprox({ season: 2025, week: 3 });

  const expectedSource = 'https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv';
  assert.equal(result.source, expectedSource);
  assert.deepEqual(requests, [expectedSource]);
  assert.equal(result.week, 3);
  assert.equal(result.rows.length, 2);

  const phi = result.rows.find((row) => row.team === 'PHI');
  assert.ok(phi, 'expected PHI defense row');
  assert.equal(phi.points_allowed, 21);
  assert.equal(phi.sacks, 3);
  assert.equal(phi.interceptions, 2);
  assert.equal(phi.fumbles_recovered, 2);
  assert.equal(phi.score, 11);

  const dal = result.rows.find((row) => row.team === 'DAL');
  assert.ok(dal, 'expected DAL defense row');
  assert.equal(dal.points_allowed, 24);
  assert.equal(dal.sacks, 1);
  assert.equal(dal.interceptions, 0);
  assert.equal(dal.fumbles_recovered, 1);
  assert.equal(dal.score, 3);
});

test('fetchDefenseApprox falls back to gzipped assets', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  const plainBuffer = Buffer.from(SAMPLE_CSV, 'utf8');
  const gzBuffer = zlib.gzipSync(plainBuffer);
  global.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith('.csv')) {
      return {
        ok: false,
        status: 404,
        headers: new Map(),
      };
    }
    if (url.endsWith('.csv.gz')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => gzBuffer,
        headers: new Map([["content-type", "application/gzip"]]),
      };
    }
    throw new Error(`Unexpected fetch url ${url}`);
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const { fetchDefenseApprox } = loadTsModule(modulePath);
  const result = await fetchDefenseApprox({ season: 2025, week: 3 });

  const primarySource = 'https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv';
  assert.equal(result.source, `${primarySource}.gz`);
  assert.deepEqual(requests, [primarySource, `${primarySource}.gz`]);
  assert.equal(result.rows.length, 2);
});
