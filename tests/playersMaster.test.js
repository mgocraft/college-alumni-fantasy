const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const {
  buildCollegeMaps,
  resolveCollege,
  buildPlayersLookup,
  resolvePlayerRow,
} = loadTsModule(path.resolve(__dirname, '../lib/playersMaster.ts'));

const sampleRows = [
  { player_id: 'alpha', full_name: 'Alpha Example', recent_team: 'HOU', college_name: 'Rice' },
  { gsis_id: '00-0033559', full_name: 'Jalen Hurts', team: 'PHI', college_name: 'Oklahoma' },
  { player_id: 'gamma', full_name: 'Mystery Person', recent_team: 'FA', college_name: '' },
];

const collegeMaps = buildCollegeMaps(sampleRows);
const lookup = buildPlayersLookup(sampleRows);

test('resolveCollege prefers player id mapping', () => {
  const result = resolveCollege({ player_id: 'alpha', player_name: 'Someone', team: 'HOU' }, collegeMaps);
  assert.equal(result, 'Rice');
});

test('resolveCollege falls back to name and team', () => {
  const result = resolveCollege({ player_id: 'beta', player_name: 'Jalen Hurts', team: 'phi' }, collegeMaps);
  assert.equal(result, 'Oklahoma');
});

test('resolveCollege returns Unknown when no mapping found', () => {
  const result = resolveCollege({ player_id: 'delta', player_name: 'Unknown', team: 'UNK' }, collegeMaps);
  assert.equal(result, 'Unknown');
});

test('resolvePlayerRow finds player by alternate id candidates', () => {
  const row = resolvePlayerRow({ player_id: 'not-used', alt_ids: ['00-0033559'], player_name: 'J. Hurts', team: 'PHI' }, lookup);
  assert.ok(row);
  assert.equal(row.full_name, 'Jalen Hurts');
});

test('resolvePlayerRow falls back to normalized name', () => {
  const row = resolvePlayerRow({ player_id: 'missing', alt_ids: [], player_name: 'alpha    example', team: 'hou' }, lookup);
  assert.ok(row);
  assert.equal(row.player_id, 'alpha');
});

