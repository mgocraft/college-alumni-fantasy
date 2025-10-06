const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const { getNflSchedule } = loadTsModule(path.resolve(__dirname, '../utils/datasources.ts'));

test('getNflSchedule retains preseason variants', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  const csv = [
    'game_type,week,start_time',
    'PRE3,3,2024-08-25T00:00:00Z',
    'REG,1,2024-09-10T00:00:00Z',
  ].join('\n');
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => csv,
    };
  };
  try {
    const games = await getNflSchedule(2099);
    assert.equal(calls, 1);
    assert.equal(games.length, 2);
    const preseason = games.find((game) => game.gameType.startsWith('PRE'));
    assert.ok(preseason, 'expected preseason game to be present');
    assert.equal(preseason.week, 3);
    assert.equal(preseason.gameType, 'PRE3');
  } finally {
    global.fetch = originalFetch;
  }
});
