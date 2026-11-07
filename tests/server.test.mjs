import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, parseFlight } from '../server/index.mjs';

const lines = [
  { type: 'mission_start', mission_id: 'm1', t: 0, cells: ['A-1', 'A-2'] },
  { type: 'position', mission_id: 'm1', t: 0.5, position: { x_m: 0, y_m: 0, rel_alt_m: 3 }, heading: 340, battery: 99 },
  { type: 'frame', mission_id: 'm1', t: 9, vehicle_id: 'sitl_01', cell_id: 'A-1', waypoint: 1, source_photo: 'photo_001.jpg', position: { x_m: 0, y_m: 0, rel_alt_m: 30 }, battery: 98, captured_at: 'x' },
  { type: 'log', mission_id: 'm1', t: 12, source: 'fc', text: 'Mission: 1 WP' },
  { type: 'mission_end', mission_id: 'm1', t: 40, frames: 1, planned: 2 }
];

async function withServer(run) {
  const flightDir = await mkdtemp(path.join(tmpdir(), 'flight-'));
  await writeFile(path.join(flightDir, 'm1.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n{"type":"pos');
  const app = createApp({ flightDir });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${app.address().port}`); }
  finally { app.close(); await rm(flightDir, { recursive: true }); }
}

test('returns a flight as positions and frames and ignores a half-written line', () => withServer(async base => {
  const body = await (await fetch(`${base}/api/missions/m1`)).json();
  assert.deepEqual(body.cells, ['A-1', 'A-2']);
  assert.equal(body.complete, true);
  assert.equal(body.duration_s, 40);
  assert.deepEqual(body.positions, [{ t: 0.5, x_m: 0, y_m: 0, rel_alt_m: 3, heading: 340, battery: 99 }]);
  assert.equal(body.frames[0].cell_id, 'A-1');
  assert.deepEqual(body.logs, [{ t: 12, source: 'fc', text: 'Mission: 1 WP' }]);
  assert.deepEqual((await (await fetch(`${base}/api/missions`)).json()).missions, ['m1']);
  assert.equal(parseFlight('{"a":1}\n{bad').length, 1);
}));

test('rejects unknown and unsafe mission ids', () => withServer(async base => {
  assert.equal((await fetch(`${base}/api/missions/none`)).status, 404);
  assert.equal((await fetch(`${base}/api/missions/bad.id`)).status, 400);
  assert.equal((await fetch(`${base}/api/missions/..%2F..%2Fpackage`)).status, 404);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
}));

test('serves the same pages behind a proxy path prefix and without it', async () => {
  const app = createApp({ basePath: '/i/token/' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    assert.equal((await fetch(`${base}/i/token/`)).status, 200);
    assert.equal((await fetch(`${base}/i/token/app.mjs`)).status, 200);
    assert.equal((await fetch(`${base}/i/token/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
    const redirect = await fetch(`${base}/i/token`, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/i/token/');
    assert.equal((await fetch(`${base}/i/other/`)).status, 404);
    assert.equal((await fetch(`${base}/i/token/..%2F..%2Fpackage.json`)).status, 404);
  } finally { app.close(); }
});

test('serves the dashboard but nothing outside web assets', () => withServer(async base => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(`${base}/app.mjs`)).status, 200);
  assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/README.md`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
}));
