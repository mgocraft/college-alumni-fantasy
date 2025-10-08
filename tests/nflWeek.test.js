const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const {
  estimateNflWeekForDate,
  nflWeekWindowUtc,
  preseasonWeekCapForSeason,
} = loadTsModule(path.resolve(__dirname, '../utils/nflWeek.ts'));

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

test('estimateNflWeekForDate maps late August kickoffs to preseason week windows', () => {
  const season = 2025;
  const kickoff = new Date(Date.UTC(2025, 7, 30, 0, 0, 0));
  const estimate = estimateNflWeekForDate(season, kickoff, 1);
  assert.equal(estimate.week, 3);
  assert.equal(estimate.rawWeek, 0);

  const weekOneWindow = nflWeekWindowUtc(season, 1);
  const weekOneStartMs = new Date(weekOneWindow.startISO).getTime();
  const earliestOffset = -(preseasonWeekCapForSeason(season) + 1);
  const expectedStartMs = weekOneStartMs + Math.max(estimate.rawWeek - 1, earliestOffset) * WEEK_MS;
  const expectedStart = new Date(expectedStartMs).toISOString();
  const expectedEnd = new Date(expectedStartMs + WEEK_MS).toISOString();

  assert.equal(expectedEnd, weekOneWindow.startISO);
  assert.equal(estimate.startISO, expectedStart);
  assert.equal(estimate.endISO, expectedEnd);
});

test('estimateNflWeekForDate caps preseason mapping to earliest supported week', () => {
  const season = 2019;
  const kickoff = new Date(Date.UTC(2019, 6, 20, 0, 0, 0));
  const estimate = estimateNflWeekForDate(season, kickoff, 1);
  const maxPreseasonWeek = preseasonWeekCapForSeason(season);
  assert.equal(estimate.week, 0);
  assert(estimate.week <= maxPreseasonWeek);
  assert(estimate.rawWeek < 1);

  const weekOneWindow = nflWeekWindowUtc(season, 1);
  const weekOneStartMs = new Date(weekOneWindow.startISO).getTime();
  const earliestOffset = -(preseasonWeekCapForSeason(season) + 1);
  const expectedStartMs = weekOneStartMs + Math.max(estimate.rawWeek - 1, earliestOffset) * WEEK_MS;
  const expectedStart = new Date(expectedStartMs).toISOString();
  const expectedEnd = new Date(expectedStartMs + WEEK_MS).toISOString();

  assert.equal(estimate.startISO, expectedStart);
  assert.equal(estimate.endISO, expectedEnd);
});

test('estimateNflWeekForDate retains regular season behavior', () => {
  const season = 2024;
  const kickoff = new Date(Date.UTC(2024, 8, 15, 17, 25, 0));
  const estimate = estimateNflWeekForDate(season, kickoff, 1);
  assert.equal(estimate.week, 2);
  assert.equal(estimate.rawWeek, 2);

  const window = nflWeekWindowUtc(season, 2);
  assert.equal(estimate.startISO, window.startISO);
  assert.equal(estimate.endISO, window.endISO);
});
