// Playback logic for recorded ArduPilot SITL flights. Values come from the flight record, not from a real aircraft.
export const CELL_M = 20;
export const ROWS = ['A', 'B', 'C', 'D'];
export const COLS = 6;
export const HOME = { x_m: -30, y_m: 30 };
const ROUTE_ALT_M = 30;
const ROUTE_SPEED_MS = 10;
const ROUTE_CLIMB_MS = 3;
const ROUTE_HOLD_S = 2;
const CRUISE_RATIO = 0.95;
const CAPTURE_S = 2;

export function plantCells() {
  return ROWS.flatMap((row, r) => Array.from({ length: COLS }, (_, c) => ({ cell_id: `${row}-${c + 1}`, x_m: c * CELL_M, y_m: r * CELL_M })));
}

function lastIndexAtOrBefore(rows, t) {
  let low = 0, high = rows.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid].t <= t) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found;
}

export function positionAt(positions, t) {
  if (!positions.length) return null;
  const i = lastIndexAtOrBefore(positions, t);
  if (i < 0) return positions[0];
  const a = positions[i], b = positions[i + 1];
  if (!b || b.t === a.t) return a;
  const k = (t - a.t) / (b.t - a.t);
  return { ...a, t, x_m: a.x_m + (b.x_m - a.x_m) * k, y_m: a.y_m + (b.y_m - a.y_m) * k, rel_alt_m: a.rel_alt_m + (b.rel_alt_m - a.rel_alt_m) * k };
}

export function phaseAt(flight, t) {
  const position = positionAt(flight.positions, t);
  if (!position) return 'waiting';
  const cruiseAlt = Math.max(...flight.positions.map(p => p.rel_alt_m)) * CRUISE_RATIO;
  const lastFrame = flight.frames.at(-1);
  if (flight.complete && t >= flight.duration_s) return 'done';
  if (lastFrame && t >= lastFrame.t + CAPTURE_S) return position.rel_alt_m < cruiseAlt ? 'landing' : 'returning';
  if (!flight.frames.some(frame => frame.t <= t)) {
    if (position.rel_alt_m >= cruiseAlt) return 'moving';
    return flight.positions.slice(0, lastIndexAtOrBefore(flight.positions, t) + 1).some(p => p.rel_alt_m > 0.5) ? 'takeoff' : 'waiting';
  }
  return flight.frames.some(frame => t >= frame.t && t < frame.t + CAPTURE_S) ? 'capture' : 'moving';
}

export function stateAt(flight, t) {
  const position = positionAt(flight.positions, t);
  const visited = flight.frames.filter(frame => frame.t <= t);
  const phase = phaseAt(flight, t);
  const lastVisited = visited.at(-1);
  return { t, position, phase, visited, current: phase === 'capture' ? lastVisited?.cell_id ?? null : null, last_cell: lastVisited?.cell_id ?? null };
}

// A calculated path for cells picked on screen. It has the shape of a flight record but is not a SITL flight.
export function routeFlight(targets) {
  const grid = plantCells();
  const positions = [{ t: 0, ...HOME, rel_alt_m: 0, heading: 0 }];
  const frames = [];
  let t = ROUTE_ALT_M / ROUTE_CLIMB_MS;
  let at = HOME;
  const moveTo = point => {
    const dx = point.x_m - at.x_m, dy = point.y_m - at.y_m;
    positions.push({ t, x_m: at.x_m, y_m: at.y_m, rel_alt_m: ROUTE_ALT_M, heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 });
    t += Math.hypot(dx, dy) / ROUTE_SPEED_MS;
    positions.push({ t, x_m: point.x_m, y_m: point.y_m, rel_alt_m: ROUTE_ALT_M, heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 });
    at = point;
  };
  for (const cell_id of targets) {
    const cell = grid.find(item => item.cell_id === cell_id);
    moveTo(cell);
    frames.push({ t, cell_id, position: { x_m: cell.x_m, y_m: cell.y_m, rel_alt_m: ROUTE_ALT_M } });
    t += ROUTE_HOLD_S;
  }
  if (targets.length) {
    moveTo(HOME);
    t += ROUTE_ALT_M / ROUTE_CLIMB_MS;
    positions.push({ t, ...HOME, rel_alt_m: 0, heading: positions.at(-1).heading });
  }
  return { cells: [...targets], complete: true, duration_s: targets.length ? t : 0, positions, frames, logs: [] };
}

// Maps the mission card's cell progress onto the recorded flight time.
export function targetTime(flight, { phase, index, activeId }) {
  if (phase === 'idle') return 0;
  if (phase === 'complete') return flight.duration_s;
  const frame = flight.frames[index];
  if (!frame) return flight.duration_s;
  return activeId ? frame.t + CAPTURE_S : frame.t;
}

export function buildLog(flight) {
  const entries = [{ t: 0, source: 'mission', text: `미션 시작 · 대상 ${flight.cells.length}개 셀` }];
  for (const log of flight.logs ?? []) entries.push({ t: log.t, source: log.source ?? 'fc', text: log.text });
  for (const frame of flight.frames) entries.push({ t: frame.t, source: 'frame', text: frame.source_photo ? `${frame.cell_id} 도착 · 촬영 지점 (${frame.source_photo} 배정)` : `${frame.cell_id} 도착 · 재점검 촬영 지점` });
  if (flight.complete) entries.push({ t: flight.duration_s, source: 'mission', text: `미션 종료 · 프레임 ${flight.frames.length}/${flight.cells.length}` });
  return entries.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.t - b.t || a.index - b.index);
}

export function logUntil(entries, t) {
  return entries.slice(0, lastIndexAtOrBefore(entries, t) + 1);
}
