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

test('aggregateByCollegeMode credits defense points when team aliases differ', async () => {
  const leaders = [
    { player_id: '10', full_name: 'QB Example', position: 'QB', team: 'KC', points: 20, college: 'Alias U' },
    { player_id: '11', full_name: 'RB One', position: 'RB', team: 'KC', points: 10, college: 'Alias U' },
    { player_id: '12', full_name: 'RB Two', position: 'RB', team: 'KC', points: 9, college: 'Alias U' },
    { player_id: '13', full_name: 'WR Alpha', position: 'WR', team: 'KC', points: 8, college: 'Alias U' },
    { player_id: '14', full_name: 'WR Beta', position: 'WR', team: 'KC', points: 7, college: 'Alias U' },
    { player_id: '15', full_name: 'TE Example', position: 'TE', team: 'KC', points: 6, college: 'Alias U' },
    { player_id: '16', full_name: 'Corner Star', position: 'CB', team: 'KC', points: 0, college: 'Alias U' },
    { player_id: '17', full_name: 'Safety Ace', position: 'S', team: 'KC', points: 0, college: 'Alias U' },
    { player_id: '18', full_name: 'Linebacker Pro', position: 'LB', team: 'KC', points: 0, college: 'Alias U' },
  ];

  const defenseData = {
    teams: [
      {
        team: 'KAN',
        dstPoints: 12,
        players: [
          { player_id: '16', snaps: 40 },
          { player_id: '17', snaps: 30 },
          { player_id: '18', snaps: 30 },
        ],
      },
    ],
  };

  const results = await aggregateByCollegeMode(leaders, 1, 'ppr', 'weekly', undefined, {
    includeK: false,
    defense: 'approx',
    defenseData,
  });

  assert.equal(results.length, 1);
  const [row] = results;
  assert.equal(row.school, 'Alias U');
  assert.equal(row.totalPoints, 72);

  const defRow = row.performers.find((player) => (player.position || '').toUpperCase() === 'DEF');
  assert.ok(defRow, 'expected defense performer row');
  assert.equal(defRow.points, 12);
  assert.ok(Array.isArray(defRow.meta?.contributors), 'expected contributor list');
  assert.equal(defRow.meta.contributors.length, 3);
  const contributorLabels = defRow.meta.contributors.map((entry) => entry.label);
  assert.ok(contributorLabels.some((label) => label.includes('Corner')), 'expected named contributor');
});

test('aggregateByCollegeMode normalizes school names consistently', async () => {
  const leaders = [
    { player_id: '200', full_name: 'QB Buckeye', position: 'QB', team: 'PHI', points: 20, college: 'The Ohio State' },
    { player_id: '201', full_name: 'RB Scarlet', position: 'RB', team: 'PHI', points: 15, college: 'Ohio State Buckeyes' },
    { player_id: '202', full_name: 'RB Gray', position: 'RB', team: 'PHI', points: 12, college: 'Ohio St.' },
    { player_id: '203', full_name: 'WR Olave', position: 'WR', team: 'PHI', points: 11, college: 'Ohio State University' },
    { player_id: '204', full_name: 'WR Smith', position: 'WR', team: 'PHI', points: 9, college: 'Ohio State' },
    { player_id: '205', full_name: 'TE Bosa', position: 'TE', team: 'PHI', points: 7, college: 'Ohio State Buckeyes' },
    { player_id: '210', full_name: 'QB Cane', position: 'QB', team: 'MIA', points: 19, college: 'Miami Hurricanes' },
    { player_id: '211', full_name: 'RB Orange', position: 'RB', team: 'MIA', points: 14, college: 'Miami' },
    { player_id: '212', full_name: 'RB Green', position: 'RB', team: 'MIA', points: 13, college: 'Miami (FL)' },
    { player_id: '213', full_name: 'WR Teal', position: 'WR', team: 'MIA', points: 10, college: 'Miami Fla' },
    { player_id: '214', full_name: 'WR Aqua', position: 'WR', team: 'MIA', points: 9, college: 'Miami FL' },
    { player_id: '215', full_name: 'TE Wave', position: 'TE', team: 'MIA', points: 6, college: 'Miami (FL)' },
  ];

  const results = await aggregateByCollegeMode(leaders, 1, 'ppr', 'weekly', undefined, {
    includeK: false,
    defense: 'none',
  });

  const schoolNames = results.map((row) => row.school).sort();
  assert.deepEqual(schoolNames, ['Miami (FL)', 'Ohio State']);

  const ohioState = results.find((row) => row.school === 'Ohio State');
  assert.ok(ohioState, 'expected Ohio State row');
  assert.ok(
    ohioState.performers.every((player) => player.college === 'Ohio State'),
    'expected Ohio State performers to use normalized name',
  );

  const miami = results.find((row) => row.school === 'Miami (FL)');
  assert.ok(miami, 'expected Miami row');
  assert.ok(
    miami.performers.every((player) => player.college === 'Miami (FL)'),
    'expected Miami performers to use normalized name',
  );
});
