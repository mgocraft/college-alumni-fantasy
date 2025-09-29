const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

test('getCfbTeamSeasonGames filters normalized team from season slate', async (t) => {
  const modulePath = path.resolve(__dirname, '../utils/schedules.ts');
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';

  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    const parsed = new URL(url);
    const seasonType = parsed.searchParams.get('seasonType');

    assert.equal(parsed.searchParams.get('team'), null, 'expected no team filter in CFBD request');

    const payload = [];
    if (seasonType === 'regular') {
      payload.push({
        week: 1,
        home_team: 'Miami (FL)',
        away_team: 'Florida A&M',
        start_date: '2024-08-24',
      });
      payload.push({
        week: 1,
        home_team: 'Florida State',
        away_team: 'Georgia Tech',
        start_date: '2024-08-24',
      });
    }

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.CFBD_API_KEY;
    } else {
      process.env.CFBD_API_KEY = originalApiKey;
    }
  });

  const { getCfbTeamSeasonGames } = loadTsModule(modulePath);
  const games = await getCfbTeamSeasonGames(2024, 'miami');

  assert.equal(games.length, 1);
  assert.equal(games[0].home, 'Miami (FL)');
  assert.equal(games[0].away, 'Florida A&M');
  assert.equal(games[0].seasonType, 'regular');

  assert.equal(requests.length, 2);
  for (const request of requests) {
    const { searchParams } = new URL(request.url);
    assert.equal(request.options?.headers?.Authorization, 'Bearer test-key');
  }
});

