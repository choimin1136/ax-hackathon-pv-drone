import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission, startMission, pauseMission, tickMission, summarize, ROUTE } from '../web/mission.mjs';

test('visits all 24 areas once and keeps failed capture out of no-candidate results', () => {
  let mission = startMission(createMission());
  for (let i = 0; i < 48; i++) mission = tickMission(mission);
  assert.equal(mission.phase, 'complete');
  assert.equal(new Set(mission.events.map(e => e.cell_id)).size, 24);
  assert.deepEqual(mission.events.map(e => e.cell_id).reverse(), ROUTE);
  assert.deepEqual(summarize(mission), { completed: 24, clear: 16, review: 7, retake: 1 });
  assert.equal(mission.cells.find(c => c.cell_id === 'C-6').status, 'retake');
  assert.deepEqual(tickMission(mission), mission);
});
test('pause freezes an active analysis and resume completes that same area', () => {
  let mission = tickMission(startMission(createMission()));
  assert.equal(mission.activeId, 'A-1');
  mission = pauseMission(mission);
  assert.equal(tickMission(mission), mission);
  mission = tickMission(startMission(mission));
  assert.equal(mission.index, 1);
  assert.equal(mission.events[0].cell_id, 'A-1');
});
test('replay starts clean without carrying over statuses or event counts', () => {
  let mission = startMission(createMission());
  for (let i = 0; i < 48; i++) mission = tickMission(mission);
  const replay = startMission(mission);
  assert.equal(replay.index, 0);
  assert.equal(replay.events.length, 0);
  assert.ok(replay.cells.every(c => c.status === 'pending'));
  assert.equal(replay.elapsed, 0);
});
