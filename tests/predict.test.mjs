import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPredictor } from '../server/predict.mjs';
import { createApp } from '../server/index.mjs';
import { missionFromFlight } from '../web/mission.mjs';

const answer = hot => ({ probability: hot ? 0.76 : 0.003, is_hotspot: hot, decision_threshold: 0.5, calibrated: false,
  result: { image_id: hot ? 'pos' : 'neg', prediction: { decision_status: hot ? 'hotspot_localized' : 'low_confidence_candidate' } },
  bboxes: hot ? [{ cx: 159, cy: 77, w: 10, h: 6, label: 1 }, { cx: 390, cy: 143, w: 3, h: 2, label: 1 }] : [],
  mask_png_base64: 'x', output: 'data:image/jpeg;base64,AAAA' });

async function withPhotos(names, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'photos-'));
  for (const name of names) await writeFile(path.join(dir, name), name);
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('sends the cell photo to the model once and returns a short result', () => withPhotos(['A-1.jpg', 'a.jpg', 'b.png', 'notes.txt'], async dir => {
  const sent = [];
  const fetchImpl = async (url, { body }) => { const file = body.get('file'); sent.push([url, file.name]); return new Response(JSON.stringify(answer(file.name === 'A-1.jpg'))); };
  const predictor = createPredictor({ env: { PHOTO_DIR: dir, MODEL_URL: 'http://model/predict' }, fetchImpl });
  assert.deepEqual(await predictor.status(), { configured: true, photos: 3 });
  const hot = await predictor.predict('A-1');
  assert.deepEqual({ ...hot, output: Boolean(hot.output) }, { cell_id: 'A-1', photo: 'A-1.jpg', image_id: 'pos', is_hotspot: true, probability: 0.76, threshold: 0.5, calibrated: false, decision_status: 'hotspot_localized', regions: [{ cx: 159, cy: 77, w: 10, h: 6 }, { cx: 390, cy: 143, w: 3, h: 2 }], output: true });
  assert.equal((await predictor.predict('A-2')).photo, 'a.jpg');
  assert.equal((await predictor.predict('A-3')).photo, 'b.png');
  await predictor.predict('A-1');
  assert.deepEqual(sent, [['http://model/predict', 'A-1.jpg'], ['http://model/predict', 'a.jpg'], ['http://model/predict', 'b.png']]);
  assert.equal((await predictor.predict('Z-9')).status, 400);
}));

test('reports missing photos and model failures, and retries a failed cell', () => withPhotos(['a.jpg'], async dir => {
  assert.equal((await createPredictor({ env: {} }).predict('A-1')).status, 503);
  let calls = 0;
  const fetchImpl = async () => { calls++; return calls === 1 ? new Response('busy', { status: 500 }) : new Response(JSON.stringify(answer(false))); };
  const predictor = createPredictor({ env: { PHOTO_DIR: dir }, fetchImpl });
  const failed = await predictor.predict('B-1');
  assert.deepEqual(failed, { status: 502, error: 'model unavailable' });
  assert.equal((await predictor.predict('B-1')).is_hotspot, false);
  assert.equal(calls, 2);
}));

test('the web server answers predictions for one cell', async () => {
  const predictor = { status: async () => ({ configured: false, photos: 0 }), predict: async id => id === 'C-4' ? { cell_id: id, is_hotspot: true, regions: [] } : { status: 503, error: 'no photos' } };
  const dir = await mkdtemp(path.join(tmpdir(), 'flights-'));
  const app = createApp({ flightDir: dir, predictor, sitlHooks: { findSitl: async () => false, killSitl: async () => {}, probe: async () => false } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/predict`)).json(), { configured: false, photos: 0 });
    assert.equal((await (await fetch(`${base}/api/predict/C-4`)).json()).is_hotspot, true);
    assert.equal((await fetch(`${base}/api/predict/A-1`)).status, 503);
  } finally { app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('cells wait for their model result and then show it', () => {
  const results = { 'A-1': ['check', 2], 'A-2': null };
  const mission = missionFromFlight(['A-1', 'A-2'], null, false, true, 10, id => results[id]);
  assert.deepEqual(mission.cells.slice(0, 3).map(c => [c.cell_id, c.status, c.candidate_count]), [['A-1', 'check', 2], ['A-2', 'pending', 0], ['A-3', 'pending', 0]]);
  assert.deepEqual(mission.events.map(e => e.cell_id), ['A-1']);
});
