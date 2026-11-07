import test from 'node:test';
import assert from 'node:assert/strict';
import { cellTrends, priorityCells, weatherWeek } from '../web/analysis-insights.mjs';

const cell = (cell_id, status, candidates = []) => ({ cell_id, status, candidates });
const run = (startedAt, kind, cells, extra = {}) => ({ id: startedAt, startedAt, kind, phase: 'complete', cells, visited: cells.map(c => c.cell_id), ...extra });

test('priority lists hotspot cells of the latest full inspection, approved findings first', () => {
  const older = run('2026-11-07T10:00:00Z', 'full', [cell('A-1', 'check', [{ area_px: 999, score: 0.9 }])]);
  const latest = run('2026-11-07T12:00:00Z', 'full', [
    cell('B-1', 'check', [{ area_px: 300, score: 0.9, decision: 'pending' }]),
    cell('B-2', 'check', [{ area_px: 20, score: 0.6, decision: 'approved' }]),
    cell('B-3', 'no_candidate'),
    cell('B-4', 'check', [{ area_px: 50, score: 0.5 }, { area_px: 80, score: 0.7 }])
  ]);
  const selection = run('2026-11-07T13:00:00Z', 'selection', [cell('C-1', 'check', [{ area_px: 500, score: 1 }])]);
  const deleted = run('2026-11-07T14:00:00Z', 'full', [cell('D-1', 'check', [{ area_px: 500, score: 1 }])], { deletedAt: 'x' });
  const { record, rows } = priorityCells([older, latest, selection, deleted]);
  assert.equal(record, latest);
  assert.deepEqual(rows.map(r => [r.cell_id, r.approved, r.largest]), [['B-2', 1, 20], ['B-1', 0, 300], ['B-4', 0, 80]]);
  assert.deepEqual(priorityCells([]), { record: null, rows: [] });
});

test('trends show each detected cell over recent runs and put repeat findings first', () => {
  const runs = [
    run('2026-11-07T10:00:00Z', 'full', [cell('A-1', 'check'), cell('A-2', 'no_candidate')]),
    run('2026-11-07T11:00:00Z', 'selection', [cell('A-1', 'check')]),
    run('2026-11-07T12:00:00Z', 'full', [cell('A-1', 'no_candidate'), cell('A-2', 'check')]),
    { ...run('2026-11-07T13:00:00Z', 'full', [cell('A-2', 'check')]), phase: 'running' }
  ];
  const { runs: used, rows } = cellTrends(runs);
  assert.equal(used.length, 3, 'running flights are left out');
  assert.deepEqual(rows.map(r => [r.cell_id, r.hits, r.marks]), [['A-1', 2, ['check', 'check', 'no_candidate']], ['A-2', 1, ['no_candidate', null, 'check']]]);
});

test('the made-up forecast is stable for a date and never recommends rain', () => {
  const a = weatherWeek(new Date(2026, 10, 8)), b = weatherWeek(new Date(2026, 10, 8));
  assert.equal(a.days.length, 5);
  assert.deepEqual(a.days.map(d => [d.sky, d.wind]), b.days.map(d => [d.sky, d.wind]));
  assert.notEqual(a.best?.sky, '비');
  assert.ok(a.days.includes(a.best));
});
