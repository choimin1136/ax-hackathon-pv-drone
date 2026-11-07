import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dummyEnergy, energyComparison } from '../web/energy-dummy.mjs';
import { analyzeRecord, DEFAULTS } from '../web/value.mjs';
import { createInspectionHistory } from '../server/inspection-history.mjs';

const record = { startedAt: '2026-01-01T15:00:00Z', targets: ['A-3', 'B-2'], visited: ['A-3'], cells: [{ cell_id: 'A-3', status: 'check', candidates: [{ decision: 'pending' }] }] };

test('every visited cell gets a made-up power comparison, even without approvals', () => {
  const result = analyzeRecord(record, DEFAULTS);
  assert.equal(result.ids.length, 0, 'the value estimate still needs approvals');
  assert.deepEqual(result.energy.rows.map(r => r.id), ['A-3']);
  assert.equal(result.energy.day, '2026-01-02');
  assert.equal(result.energy.predicted, 36);
  assert.ok(result.energy.measured < result.energy.predicted);
  assert.equal(result.energy.saved, false);
});

test('saved figures are used and follow the capacity assumption', () => {
  const saved = { ...record, energy: { basis: 'dummy', day: '2026-01-02', lossPercent: { 'A-3': 10 } } };
  const a = energyComparison(saved, { capacity: 10, utilization: 15 }), b = energyComparison(saved, { capacity: 20, utilization: 15 });
  assert.deepEqual([a.saved, a.predicted, a.measured], [true, 36, 32.4]);
  assert.equal(b.predicted, 72);
  assert.deepEqual(dummyEnergy(record).lossPercent, { 'A-3': energyComparison(record, DEFAULTS).rows[0].lossPercent });
});

test('the server saves the made-up figures with each flight record', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'energy-'));
  try {
    const rows = [{ type: 'mission_start', t: 0, cells: ['A-1', 'A-2'] }, { type: 'frame', t: 5, cell_id: 'A-1' }, { type: 'mission_end', t: 9 }];
    await writeFile(path.join(dir, 'live.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
    const [saved] = await createInspectionHistory({ file: path.join(dir, 'history.json'), flightDir: dir }).list();
    assert.equal(saved.energy.basis, 'dummy');
    assert.deepEqual(Object.keys(saved.energy.lossPercent), ['A-1']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
