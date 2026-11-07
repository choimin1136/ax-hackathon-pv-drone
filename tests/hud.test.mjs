import test from 'node:test';
import assert from 'node:assert/strict';
import { attitudeAt } from '../web/hud.mjs';
import { parseFlight, summarizeFlight } from '../server/index.mjs';

const row = (t, x_m, extra = {}) => JSON.stringify({ type: 'position', mission_id: 'm', t, position: { x_m, y_m: 0, rel_alt_m: 30 }, heading: 90, battery: 90, ...extra });

test('the instrument shows the attitude the flight controller recorded', () => {
  const text = [row(0, 0, { roll: 2, pitch: -6 }), row(1, 5, { roll: 4, pitch: -10 })].join('\n');
  const flight = summarizeFlight('m', parseFlight(text));
  assert.deepEqual([flight.positions[0].roll, flight.positions[0].pitch], [2, -6]);
  const attitude = attitudeAt(flight, 0.5);
  assert.equal(attitude.measured, true);
  assert.deepEqual([attitude.roll, attitude.pitch], [3, -8]);
  assert.equal(attitudeAt(flight, 1).speed, 5);
});

test('without recorded attitude the instrument estimates a nose-down tilt for forward flight', () => {
  const flight = summarizeFlight('m', parseFlight([row(0, 0), row(1, 5), row(2, 10)].join('\n')));
  const attitude = attitudeAt(flight, 2);
  assert.equal(attitude.measured, false);
  assert.ok(attitude.pitch < 0 && Math.abs(attitude.roll) < 1);
});
