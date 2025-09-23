const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const {
  buildNflWeekWindows,
  mapCfbWeekToSingleNflWeek,
  mapKickoffToNflWeek,
} = loadTsModule(path.resolve(__dirname, '../utils/weekMapping.ts'));
const { normalizeSchool } = loadTsModule(path.resolve(__dirname, '../utils/datasources.ts'));

test('mapCfbWeekToSingleNflWeek uses prior season for week 1', () => {
  const nflSchedule = [
    { season: 2024, week: 1, gameType: 'REG', kickoffISO: '2024-09-10T01:15:00Z' },
  ];
  const windows = buildNflWeekWindows(nflSchedule);
  const games = [
    { kickoffISO: '2024-08-31T20:00:00Z' },
    { kickoffISO: '2024-09-01T20:00:00Z' },
  ];
  const mapped = mapCfbWeekToSingleNflWeek(games, windows, 1, 2023);
  assert.deepEqual(mapped, { season: 2023, week: 18 });
});

test('mapKickoffToNflWeek respects Tuesday cutoff', () => {
  const nflSchedule = [
    { season: 2024, week: 1, gameType: 'REG', kickoffISO: '2024-09-10T01:15:00Z' },
    { season: 2024, week: 2, gameType: 'REG', kickoffISO: '2024-09-17T01:15:00Z' },
  ];
  const windows = buildNflWeekWindows(nflSchedule);
  const beforeCutoff = mapKickoffToNflWeek('2024-09-07T18:00:00Z', windows, 2023);
  assert.deepEqual(beforeCutoff, { season: 2023, week: 18 });
  const afterCutoff = mapKickoffToNflWeek('2024-09-12T18:00:00Z', windows, 2023);
  assert.deepEqual(afterCutoff, { season: 2024, week: 1 });
});

test('normalizeSchool maps common synonyms', () => {
  assert.equal(normalizeSchool('Miami'), 'Miami (FL)');
  assert.equal(normalizeSchool('Texas A&M'), 'Texas A&M');
  assert.equal(normalizeSchool('UTSA'), 'UTSA');
});
