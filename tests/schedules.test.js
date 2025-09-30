const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const { filterTeamGamesFromSlate } = loadTsModule(path.resolve(__dirname, '../utils/schedules.ts'));

test('filterTeamGamesFromSlate matches canonical nicknames', () => {
  const slate = [
    {
      season: 2024,
      week: 13,
      seasonType: 'regular',
      kickoffISO: '2024-11-30T17:00:00.000Z',
      home: 'Ohio State',
      away: 'Michigan',
    },
  ];

  const results = filterTeamGamesFromSlate(slate, 'Ohio State Buckeyes');

  assert.equal(results.length, 1);
  assert.equal(results[0].home, 'Ohio State');
  assert.equal(results[0].away, 'Michigan');
});

