import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME, buildLog, logUntil, plantCells, positionAt, phaseAt, routeFlight, stateAt, targetTime } from '../web/flight.mjs';
import { ROUTE, createMission, startMission, tickMission } from '../web/mission.mjs';
import { parseFlight, summarizeFlight } from '../server/index.mjs';

const at = (t, x_m, y_m, rel_alt_m) => ({ t, x_m, y_m, rel_alt_m, heading: 90, battery: 100 - t });
const flight = {
  cells: ['A-1', 'A-2'], complete: true, duration_s: 60,
  positions: [at(0, 0, 0, 0), at(2, 0, 0, 0), at(5, 0, 0, 15), at(10, 0, 0, 30), at(20, 20, 0, 30), at(40, 0, 0, 30), at(50, 0, 0, 10), at(60, 0, 0, 0)],
  frames: [{ t: 11, cell_id: 'A-1', source_photo: 'photo_001.jpg' }, { t: 20, cell_id: 'A-2', source_photo: 'photo_002.jpg' }],
  logs: [{ t: 10, source: 'fc', text: 'Mission: 1 WP' }]
};

test('plant cells match the flight grid', () => {
  const cells = plantCells();
  assert.equal(cells.length, 24);
  assert.deepEqual(cells.find(c => c.cell_id === 'C-4'), { cell_id: 'C-4', x_m: 60, y_m: 40 });
});

test('interpolates position and stays inside the record', () => {
  assert.equal(positionAt(flight.positions, 15).x_m, 10);
  assert.equal(positionAt(flight.positions, -1).rel_alt_m, 0);
  assert.equal(positionAt(flight.positions, 999).t, 60);
  assert.equal(positionAt([], 1), null);
});

test('phase follows the recorded flight from takeoff to landing', () => {
  assert.equal(phaseAt(flight, 0), 'waiting');
  assert.equal(phaseAt(flight, 5), 'takeoff');
  assert.equal(phaseAt(flight, 10.5), 'moving');
  assert.equal(phaseAt(flight, 12), 'capture');
  assert.equal(phaseAt(flight, 15), 'moving');
  assert.equal(phaseAt(flight, 30), 'returning');
  assert.equal(phaseAt(flight, 50), 'landing');
  assert.equal(phaseAt(flight, 60), 'done');
});

test('visited cells and log entries appear only once their time has passed', () => {
  assert.equal(stateAt(flight, 10).visited.length, 0);
  assert.equal(stateAt(flight, 12).current, 'A-1');
  assert.equal(stateAt(flight, 15).current, null);
  assert.equal(stateAt(flight, 15).last_cell, 'A-1');
  const log = buildLog(flight);
  assert.deepEqual(log.map(e => e.t), [0, 10, 11, 20, 60]);
  assert.equal(logUntil(log, 10.5).length, 2);
  assert.equal(logUntil(log, 60).at(-1).text, '미션 종료 · 프레임 2/2');
});

test('a faster flight uses a shorter capture window so stops do not overlap', () => {
  const fast = { ...flight, capture_s: 0.25 };
  assert.equal(phaseAt(flight, 12), 'capture');
  assert.equal(phaseAt(fast, 11.1), 'capture');
  assert.equal(phaseAt(fast, 12), 'moving');
  assert.equal(stateAt(fast, 12).current, null);
});

test('an in-progress flight has no end entry and never reports done', () => {
  const live = { ...flight, complete: false, duration_s: 15, positions: flight.positions.slice(0, 4), frames: flight.frames.slice(0, 1) };
  assert.notEqual(phaseAt(live, 15), 'done');
  assert.ok(buildLog(live).every(e => !e.text.startsWith('미션 종료')));
});

test('mission progress keeps the recorded drone on the same cell as the site map', () => {
  const record = summarizeFlight('mission_01', parseFlight(readFileSync(new URL('../drone/sample_flight/mission_01.jsonl', import.meta.url), 'utf8')));
  assert.deepEqual(record.frames.map(frame => frame.cell_id), ROUTE);
  assert.equal(targetTime(record, createMission()), 0);
  let mission = startMission(createMission());
  let previous = 0;
  for (let i = 0; i < 48; i += 1) {
    mission = tickMission(mission);
    const time = targetTime(record, mission);
    assert.ok(time >= previous, `time moved back at tick ${i}`);
    previous = time;
    if (mission.activeId) assert.equal(stateAt(record, time - 1).current, mission.activeId);
  }
  assert.equal(mission.phase, 'complete');
  assert.equal(targetTime(record, mission), record.duration_s);
});

test('a calculated route leaves the pad, visits picked cells in order and lands back', () => {
  const route = routeFlight(['C-4', 'C-5']);
  assert.deepEqual(route.positions[0], { t: 0, ...HOME, rel_alt_m: 0, heading: 0 });
  assert.deepEqual(route.frames.map(frame => frame.cell_id), ['C-4', 'C-5']);
  assert.equal(stateAt(route, route.frames[0].t + 1).current, 'C-4');
  const c4 = positionAt(route.positions, route.frames[0].t);
  assert.deepEqual([c4.x_m, c4.y_m, c4.rel_alt_m], [60, 40, 30]);
  const end = positionAt(route.positions, route.duration_s);
  assert.deepEqual([end.x_m, end.y_m, end.rel_alt_m], [HOME.x_m, HOME.y_m, 0]);
  assert.equal(stateAt(route, route.duration_s).phase, 'done');
  assert.equal(targetTime(route, { phase: 'running', index: 0, activeId: 'C-4' }), route.frames[0].t + 2);
  assert.equal(routeFlight([]).duration_s, 0);
  assert.equal(buildLog(route)[1].text, 'C-4 도착 · 재점검 촬영 지점');
  assert.equal(stateAt(routeFlight([]), 0).position.x_m, HOME.x_m);
});

test('recorded SITL flights play through every planned cell', () => {
  for (const [id, cells] of [['mission_01', 24], ['retry_01', 2]]) {
    const text = readFileSync(new URL(`../drone/sample_flight/${id}.jsonl`, import.meta.url), 'utf8');
    const recorded = summarizeFlight(id, parseFlight(text));
    const end = stateAt(recorded, recorded.duration_s);
    assert.equal(end.visited.length, cells);
    assert.equal(end.phase, 'done');
    for (const frame of recorded.frames) assert.equal(stateAt(recorded, frame.t + 1).current, frame.cell_id);
    const grid = plantCells();
    for (const frame of recorded.frames) {
      const cell = grid.find(c => c.cell_id === frame.cell_id);
      assert.ok(Math.hypot(frame.position.x_m - cell.x_m, frame.position.y_m - cell.y_m) < 5, `${id} ${frame.cell_id} ${JSON.stringify(frame.position)}`);
    }
  }
});
