import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPredictor } from '../server/predict.mjs';
import { createApp } from '../server/index.mjs';
import { missionFromFlight } from '../web/mission.mjs';
import { candidatesFor } from '../web/review.mjs';

const answer = hot => ({ probability: hot ? 0.76 : 0.003, is_hotspot: hot, decision_threshold: 0.5, calibrated: false,
  result: { image_id: hot ? 'pos' : 'neg', prediction: { decision_status: hot ? 'hotspot_localized' : 'low_confidence_candidate' },
    localization: { image_size: [640, 512], regions: hot ? [{ bbox_xywh: [154, 74, 10, 6], area_px: 49, mean_segmentation_score: 0.78 }, { bbox_xywh: [389, 143, 3, 2], area_px: 6, mean_segmentation_score: 0.55 }] : [] } },
  bboxes: hot ? [{ cx: 159, cy: 77, w: 10, h: 6, label: 1 }, { cx: 390, cy: 143, w: 3, h: 2, label: 1 }] : [],
  mask_png_base64: 'x', output: 'data:image/jpeg;charset=utf-8;base64,/9j/AA==' });

async function withPhotos(names, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'photos-'));
  for (const name of names) { await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), name); }
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('sends the cell photo to the model once and returns a short result', () => withPhotos(['A-1.jpg', 'a.jpg', 'b.png', 'notes.txt'], async dir => {
  const sent = [];
  const fetchImpl = async (url, { body }) => { const file = body.get('file'); sent.push([url, file.name]); return new Response(JSON.stringify(answer(file.name === 'A-1.jpg'))); };
  let draw = 0;
  const predictor = createPredictor({ env: { PHOTO_DIR: dir, MODEL_URL: 'http://model/predict' }, fetchImpl, random: () => draw });
  assert.deepEqual(await predictor.status(), { configured: true, photos: 3 });
  const hot = await predictor.predict('A-1');
  assert.deepEqual({ ...hot, output: Boolean(hot.output) }, { cell_id: 'A-1', photo: 'A-1.jpg', image_id: 'pos', is_hotspot: true, probability: 0.76, threshold: 0.5, calibrated: false, decision_status: 'hotspot_localized', image_size: [640, 512], regions: [{ bbox: [154, 74, 10, 6], area_px: 49, score: 0.78 }, { bbox: [389, 143, 3, 2], area_px: 6, score: 0.55 }], output: true });
  assert.equal((await predictor.predict('A-2')).photo, 'a.jpg');
  assert.equal((await predictor.predict('A-3')).photo, 'b.png');
  await predictor.predict('A-1');
  assert.deepEqual(sent, [['http://model/predict', 'A-1.jpg'], ['http://model/predict', 'a.jpg'], ['http://model/predict', 'b.png']]);
  assert.equal((await predictor.predict('Z-9')).status, 400);
  assert.equal((await predictor.predict('A-2')).photo, 'a.jpg', 'a cell keeps its photo during a flight');
  predictor.shuffle();
  draw = 0.99;
  assert.equal((await predictor.predict('A-2')).photo, 'b.png', 'a new flight draws again');
  assert.equal((await predictor.predict('A-1')).photo, 'A-1.jpg', 'a photo named after the cell always wins');
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

test('finds photos in AI Hub style subfolders and skips label files', () => withPhotos(['TS_Positive/p1.jpg', 'TS_Normal/n1.jpg', 'TL_Positive/p1.json'], async dir => {
  const sent = [];
  const fetchImpl = async (url, { body }) => { sent.push(body.get('file').name); return new Response(JSON.stringify(answer(true))); };
  const predictor = createPredictor({ env: { PHOTO_DIR: dir }, fetchImpl, random: () => 0 });
  assert.deepEqual(await predictor.status(), { configured: true, photos: 2 });
  // random() = 0 makes A-1 the flight's hotspot cell, so it takes the photo from the hotspot folder.
  assert.equal((await predictor.predict('A-1')).photo, path.join('TS_Positive', 'p1.jpg'));
  assert.equal((await predictor.predict('A-2')).photo, path.join('TS_Normal', 'n1.jpg'));
  assert.deepEqual(sent, ['p1.jpg', 'n1.jpg']);
}));

test('the detail view reads back only listed photos and the model overlay', () => withPhotos(['TS_Positive/p1.jpg', 'notes.txt'], async dir => {
  const predictor = createPredictor({ env: { PHOTO_DIR: dir }, fetchImpl: async () => new Response(JSON.stringify(answer(true))) });
  const photo = await predictor.photo(path.join('TS_Positive', 'p1.jpg'));
  assert.deepEqual([photo.type, String(photo.data)], ['image/jpeg', path.join('TS_Positive', 'p1.jpg')]);
  const overlay = await predictor.overlay(path.join('TS_Positive', 'p1.jpg'));
  assert.deepEqual([overlay.type, [...overlay.data.subarray(0, 2)]], ['image/jpeg', [0xff, 0xd8]]);
  for (const name of ['notes.txt', '../secret.jpg', path.join(dir, 'TS_Positive', 'p1.jpg'), null]) assert.equal(await predictor.photo(name), null, String(name));
}));

test('a model-judged cell lists the model regions as candidates with stable ids', () => {
  const cell = { cell_id: 'B-2', status: 'check', candidate_count: 2, model: { photo: 'p.jpg', regions: [{ bbox: [154, 74, 10, 6], area_px: 49, score: 0.78 }, { bbox: [1, 2, 3, 4], area_px: 12, score: 0.6 }] } };
  assert.deepEqual(candidatesFor(cell), [{ id: 'B-2-h1', bbox: [154, 74, 10, 6], area_px: 49, score: 0.78 }, { id: 'B-2-h2', bbox: [1, 2, 3, 4], area_px: 12, score: 0.6 }]);
  const mission = missionFromFlight(['B-2'], null, false, true, 3, () => ['check', 2, cell.model]);
  assert.deepEqual(mission.cells.find(c => c.cell_id === 'B-2').model, cell.model);
  assert.equal(candidatesFor({ cell_id: 'A-1', candidate_count: 1 })[0].id, 'A-1-h1');
});

test('every full flight has one early hotspot cell, re-drawn until the model flags it', () => withPhotos(['TS_Positive/p1.jpg', 'TS_Positive/p2.jpg', 'TS_Positive/p3.jpg', 'TS_Normal/n1.jpg', 'TS_Normal/n2.jpg'], async dir => {
  // p1 is labelled positive but the model misses it; p2 and p3 are flagged.
  const fetchImpl = async (url, { body }) => new Response(JSON.stringify(answer(body.get('file').name !== 'p1.jpg' && body.get('file').name.startsWith('p'))));
  const draws = [0.5, 0, 0, 0];
  const predictor = createPredictor({ env: { PHOTO_DIR: dir }, fetchImpl, random: () => draws.shift() ?? 0 });
  const hot = predictor.hotCell();
  assert.equal(hot, 'B-6', 'the cell is drawn from the first two rows');
  const [first, again] = await Promise.all([predictor.predict(hot), predictor.predict(hot)]);
  assert.deepEqual([first.is_hotspot, first.photo], [true, path.join('TS_Positive', 'p2.jpg')], 'the missed photo is swapped');
  assert.equal(again.photo, first.photo, 'concurrent requests share one answer');
  assert.equal((await predictor.predict(hot)).photo, first.photo, 'the cell keeps its photo during the flight');
  predictor.shuffle();
  assert.ok(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'B-6', 'B-5', 'B-4', 'B-3', 'B-2', 'B-1'].includes(predictor.hotCell()));
}));
