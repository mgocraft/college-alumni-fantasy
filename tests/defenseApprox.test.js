const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const modulePath = path.resolve(__dirname, '../lib/defense.ts');

const SAMPLE_CSV = [
  'season,week_num,club_code,opp_club_code,points_for,pass_sacks_allowed,interceptions_thrown,fumbles_lost_offense',
  '2025,3,PHI,DAL,24,1,0,1',
  '2025,3,DAL,PHI,21,3,2,2',
].join('\n');

test('fetchDefenseApprox reads modern team columns', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => SAMPLE_CSV,
  });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const { fetchDefenseApprox } = loadTsModule(modulePath);
  const result = await fetchDefenseApprox({ season: 2025, week: 3 });

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
