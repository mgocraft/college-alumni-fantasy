const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadTsModule } = require('./helpers/loadTsModule');

const modulePath = path.resolve(__dirname, '../utils/cfbd.ts');

const restoreEnv = (key, original) => {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
};

test('getCfbSeasonSlate uses in-memory cache when KV is disabled', async (t) => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CFBD_API_KEY;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;

  process.env.CFBD_API_KEY = 'test-key';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const requests = [];
  global.fetch = async () => {
    requests.push('called');
    return {
      ok: true,
      status: 200,
      json: async () => [
        {
          week: 1,
          home_team: 'Miami (FL)',
          away_team: 'Florida A&M',
          start_date: '2024-08-24',
        },
      ],
    };
  };

  const { getCfbSeasonSlate, __resetCfbdCacheForTests } = loadTsModule(modulePath);
  __resetCfbdCacheForTests();

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv('CFBD_API_KEY', originalApiKey);
    restoreEnv('KV_REST_API_URL', originalKvUrl);
    restoreEnv('KV_REST_API_TOKEN', originalKvToken);
    __resetCfbdCacheForTests();
  });

  const first = await getCfbSeasonSlate(2024, 'regular');
  assert.equal(first.slate.length, 1);
  assert.equal(requests.length, 1);

  const second = await getCfbSeasonSlate(2024, 'regular');
  assert.equal(second.slate.length, 1);
  assert.equal(requests.length, 1, 'expected in-memory cache to avoid second fetch');
});
