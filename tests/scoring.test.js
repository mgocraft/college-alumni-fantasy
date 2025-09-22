const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const { aggregateByCollegeMode } = loadTsModule(path.resolve(__dirname, '../lib/scoring.ts'));

test('aggregateByCollegeMode splits semicolon-separated colleges', async () => {
  const leaders = [
    { player_id: '1', full_name: 'Dual Threat', position: 'QB', team: 'PHI', points: 25, college: 'School A; School B' },
    { player_id: '2', full_name: 'Runner A', position: 'RB', team: 'PHI', points: 10, college: 'School A' },
    { player_id: '3', full_name: 'Runner B', position: 'RB', team: 'PHI', points: 12, college: 'School B' },
    { player_id: '4', full_name: 'Receiver B', position: 'WR', team: 'PHI', points: 8, college: 'School B' },
    { player_id: '5', full_name: 'Receiver A', position: 'WR', team: 'PHI', points: 7, college: 'School A' },
    { player_id: '6', full_name: 'Tight A', position: 'TE', team: 'PHI', points: 6, college: 'School A' },
  ];

  const results = await aggregateByCollegeMode(leaders, 1, 'ppr', 'weekly', undefined, { includeK: false, defense: 'none' });

  assert.equal(results.length, 2);
  assert.equal(results.some((row) => row.school === 'Unknown'), false);

  const schoolA = results.find((row) => row.school === 'School A');
  const schoolB = results.find((row) => row.school === 'School B');
  assert.ok(schoolA, 'expected School A to exist');
  assert.ok(schoolB, 'expected School B to exist');

  assert.equal(schoolA.totalPoints, 48);
  assert.equal(schoolB.totalPoints, 45);

  const dualA = schoolA.performers.find((player) => player.name === 'Dual Threat');
  const dualB = schoolB.performers.find((player) => player.name === 'Dual Threat');
  assert.ok(dualA, 'expected Dual Threat in School A lineup');
  assert.ok(dualB, 'expected Dual Threat in School B lineup');
  assert.equal(dualA.college, 'School A');
  assert.equal(dualB.college, 'School B');
});
