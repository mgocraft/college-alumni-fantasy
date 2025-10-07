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

test('mapCfbWeekToSingleNflWeek aligns early CFB weeks to preseason and regular season NFL weeks', () => {
  const nflSchedule = [
    { season: 2024, week: 1, gameType: 'PRE', kickoffISO: '2024-08-11T00:00:00Z' },
    { season: 2024, week: 2, gameType: 'PRE', kickoffISO: '2024-08-18T00:00:00Z' },
    { season: 2024, week: 3, gameType: 'PRE3', kickoffISO: '2024-08-25T00:00:00Z' },
    { season: 2024, week: 4, gameType: 'REGULAR_SEASON', kickoffISO: '2024-09-10T01:15:00Z' },
    { season: 2024, week: 5, gameType: 'REG', kickoffISO: '2024-09-17T01:15:00Z' },
  ];
  const windows = buildNflWeekWindows(nflSchedule);

  const week1Games = [
    { kickoffISO: '2024-08-24T20:00:00Z' },
    { kickoffISO: '2024-08-25T02:00:00Z' },
  ];
  const mappedWeek1 = mapCfbWeekToSingleNflWeek(week1Games, windows, 1, 2023);
  assert.deepEqual(mappedWeek1, { season: 2024, week: 3 });

  const week2Games = [{ kickoffISO: '2024-08-31T18:00:00Z' }];
  const mappedWeek2 = mapCfbWeekToSingleNflWeek(week2Games, windows, 2, 2023);
  assert.deepEqual(mappedWeek2, { season: 2024, week: 4 });

  const week3Games = [{ kickoffISO: '2024-09-07T18:00:00Z' }];
  const mappedWeek3 = mapCfbWeekToSingleNflWeek(week3Games, windows, 3, 2023);
  assert.deepEqual(mappedWeek3, { season: 2024, week: 5 });
});

test('mapCfbWeekToSingleNflWeek still returns aligned weeks when kickoff data is missing', () => {
  const nflSchedule = [
    { season: 2024, week: 1, gameType: 'PRE', kickoffISO: '2024-08-11T00:00:00Z' },
    { season: 2024, week: 2, gameType: 'PRE3', kickoffISO: '2024-08-18T00:00:00Z' },
    { season: 2024, week: 3, gameType: 'PRESEASON', kickoffISO: '2024-08-25T00:00:00Z' },
    { season: 2024, week: 4, gameType: 'REG', kickoffISO: '2024-09-10T01:15:00Z' },
    { season: 2024, week: 5, gameType: 'REGULAR', kickoffISO: '2024-09-17T01:15:00Z' },
  ];
  const windows = buildNflWeekWindows(nflSchedule);

  const mappedWeek1 = mapCfbWeekToSingleNflWeek([], windows, 1, 2023);
  assert.deepEqual(mappedWeek1, { season: 2024, week: 3 });

  const mappedWeek2 = mapCfbWeekToSingleNflWeek([], windows, 2, 2023);
  assert.deepEqual(mappedWeek2, { season: 2024, week: 4 });

  const mappedWeek3 = mapCfbWeekToSingleNflWeek([], windows, 3, 2023);
  assert.deepEqual(mappedWeek3, { season: 2024, week: 5 });
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
  assert.equal(normalizeSchool('Ohio State Buckeyes'), 'Ohio State');
  assert.equal(normalizeSchool('The Ohio State'), 'Ohio State');
  assert.equal(normalizeSchool('Alabama Crimson Tide'), 'Alabama');
});
