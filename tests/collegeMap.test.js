const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/loadTsModule');

const { resolveCollege } = loadTsModule(path.resolve(__dirname, '../lib/collegeMap.ts'));

const baseLeader = { position: 'QB', points: 0 };

const makeLeader = (overrides) => ({
  full_name: 'Test Player',
  player_id: '0',
  ...baseLeader,
  ...overrides,
});

test('canonicalizes mascot and NCAA suffixes', () => {
  const leader = makeLeader({
    player_id: '1',
    full_name: 'Sam Bradford',
    college: 'Oklahoma Sooners (NCAA)',
  });
  assert.equal(resolveCollege(leader), 'Oklahoma');
});

test('strips location hints and parentheses', () => {
  const leader = makeLeader({
    player_id: '2',
    full_name: 'Tom Brady',
    college: 'University of Michigan (Ann Arbor, MI)',
  });
  assert.equal(resolveCollege(leader), 'Michigan');
});

test('falls back to ID mapping when API provides placeholder', () => {
  const leader = makeLeader({
    player_id: 12,
    full_name: 'Joe Player',
    college: 'Unknown',
  });
  assert.equal(resolveCollege(leader), 'Michigan');
});

test('falls back to name mapping when ID lookup fails', () => {
  const leader = makeLeader({
    player_id: '999',
    full_name: 'Nico Collins',
    college: 'N/A',
  });
  assert.equal(resolveCollege(leader), 'Michigan');
});

test('returns Unknown when every mapping is missing', () => {
  const leader = makeLeader({
    player_id: '9999',
    full_name: 'Mystery Person',
    college: null,
  });
  assert.equal(resolveCollege(leader), 'Unknown');
});
