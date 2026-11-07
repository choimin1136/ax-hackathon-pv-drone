import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

async function withApp(run, { code = 0 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sitl-'));
  const stub = path.join(dir, 'stub.mjs');
  await writeFile(stub, `import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--out-dir')) {
  writeFileSync('${dir}/args.json', JSON.stringify(args));
  setTimeout(() => process.exit(${code}), 100);
} else setTimeout(() => {}, 60000);`);
  const env = { SITL_BIN: process.execPath, SITL_DIR: dir, SITL_DEFAULTS: stub, PYTHON_BIN: process.execPath, MISSION_SCRIPT: stub, SITL_SPEEDUP: '5' };
  // The stub SITL ignores its arguments except that node needs a script, so point it at a sleeping file.
  await writeFile(path.join(dir, 'sleep.mjs'), 'setTimeout(() => {}, 60000);');
  const app = createApp({ flightDir: dir, sitlEnv: env, sitlHooks: { findSitl: async () => false, killSitl: async () => {} }, sitlArgsForTest: [path.join(dir, 'sleep.mjs')] });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (name, body = {}) => fetch(`${base}/api/sitl/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { await run({ base, post, dir }); }
  finally { await post('stop').catch(() => {}); app.close(); await rm(dir, { recursive: true, force: true }); }
}

test('anyone can read status and control SITL, and bad requests are refused', () => withApp(async ({ base, post }) => {
  const status = await (await fetch(`${base}/api/sitl/status`)).json();
  assert.deepEqual(status, { speedup: 5, sitl: false, flying: false, mission: 'idle' });
  assert.equal((await post('unknown')).status, 404);
  assert.equal((await fetch(`${base}/api/sitl/start`)).status, 405);
  assert.equal((await fetch(`${base}/api/sitl/start`, { method: 'POST', body: '{bad' })).status, 400);
  assert.equal((await fetch(`${base}/api/sitl/fly`, { method: 'POST', body: JSON.stringify({ cells: 'x'.repeat(2000) }) }).catch(() => ({ status: 400 }))).status, 400);
  assert.equal((await (await post('start')).json()).sitl, true);
  assert.equal((await (await post('start')).json()).sitl, true);
}));

test('starts SITL, flies chosen cells once and stops', () => withApp(async ({ base, post, dir }) => {
  assert.equal((await post('fly')).status, 409);
  const on = await (await post('start')).json();
  assert.equal(on.sitl, true);
  assert.equal((await post('fly', { cells: 'C-4;rm' })).status, 400);
  assert.equal((await post('fly', { cells: '../x' })).status, 400);
  const flying = await (await post('fly', { cells: 'C-4,C-5' })).json();
  assert.equal(flying.flying, true);
  assert.equal((await post('fly', { cells: 'C-4' })).status, 409);
  await new Promise(resolve => setTimeout(resolve, 400));
  const args = JSON.parse(await readFile(path.join(dir, 'args.json'), 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['--mission-id', 'live', '--out-dir', dir]);
  assert.deepEqual(args.slice(4), ['--cells', 'C-4,C-5']);
  const after = await (await fetch(`${base}/api/sitl/status`)).json();
  assert.equal(after.flying, false);
  assert.equal(after.mission, 'done');
  assert.equal((await (await post('stop')).json()).sitl, false);
}));

test('a failed mission is reported', () => withApp(async ({ base, post }) => {
  await post('start');
  await post('fly');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((await (await fetch(`${base}/api/sitl/status`)).json()).mission, 'failed');
}, { code: 1 }));
