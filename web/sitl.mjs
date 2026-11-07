import { buildLog, logUntil, routeFlight, targetTime } from './flight.mjs';
import { createScene, createViewToggle, followRoute } from './flight-scene.mjs';

const PHASES = { waiting: '이륙 대기', takeoff: '이륙', moving: '셀로 이동', capture: '촬영 지점 도착', returning: '복귀', landing: '착륙', done: '비행 종료' };
const SOURCES = { fc: 'FC', mission: 'MISSION', frame: 'FRAME' };
const RECORD_ID = 'mission_01';
const LIVE_ID = 'live';
const POLL_MS = 2000;
const LANDING_MS = 6000;
const CELL_COLORS = { pending: '#7d8fa9', no_candidate: '#087d57', caution: '#d18a12', check: '#c63038', retake: '#713bc2' };

const root = document.getElementById('sitl');
root.innerHTML = `
  <div class="sitl-stage">
    <canvas id="sitl-canvas" role="img" aria-label="이륙장에서 출발해 가상 발전소 위를 비행하는 드론의 3D 화면. 현재 값은 아래 비행 상태에서 확인할 수 있습니다."></canvas>
    <span id="sitl-source" class="sitl-source">기록 불러오는 중</span>
    <span class="sitl-hint" aria-hidden="true">H: 이륙장 · 드래그: 회전 · 셀 클릭: 상세</span>
  </div>
  <p class="sitl-copy">드론 위치·고도·로그는 ArduPilot SITL에서 실행한 비행 기록이고, 셀 색은 예시 판정입니다. 실제 드론 비행이 아닙니다.</p>
  <dl class="sitl-facts">
    <div><dt>상태</dt><dd id="sitl-phase">—</dd></div>
    <div><dt>최근 셀</dt><dd id="sitl-cell">—</dd></div>
    <div><dt>고도</dt><dd id="sitl-alt">—</dd></div>
    <div><dt>위치 (x, y)</dt><dd id="sitl-pos">—</dd></div>
    <div><dt>방향</dt><dd id="sitl-heading">—</dd></div>
    <div><dt>배터리 (시뮬)</dt><dd id="sitl-battery">—</dd></div>
    <div><dt>도착 셀</dt><dd id="sitl-frames">—</dd></div>
    <div><dt>비행 시간 (기록)</dt><dd id="sitl-time">—</dd></div>
  </dl>
  <div class="sitl-log-title"><h3>비행 로그</h3><span id="sitl-log-count"></span></div>
  <ol id="sitl-log" class="sitl-log" tabindex="0" aria-label="비행 로그"></ol>
  <p id="sitl-error" class="sitl-error" role="alert" hidden></p>`;

const $ = id => document.getElementById(id);
const card = document.querySelector('.map-card');
let flight = null, entries = [], pollId = 0, shown = -1;
let mission = null, missionKey = '', live = false;
let record = null, reflight = null, routeKey = '';

const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function renderFacts(state, t) {
  const p = state.position;
  $('sitl-phase').textContent = PHASES[state.phase];
  $('sitl-cell').textContent = state.last_cell ?? '—';
  $('sitl-alt').textContent = p ? `${p.rel_alt_m.toFixed(1)} m` : '—';
  $('sitl-pos').textContent = p ? `${p.x_m.toFixed(1)}, ${p.y_m.toFixed(1)} m` : '—';
  $('sitl-heading').textContent = p?.heading == null ? '—' : `${Math.round(p.heading)}°`;
  $('sitl-battery').textContent = p?.battery == null ? '—' : `${p.battery}%`;
  $('sitl-frames').textContent = `${state.visited.length} / ${flight.cells.length}`;
  $('sitl-time').textContent = `${clock(t)} / ${clock(flight.duration_s)}`;
  if (mission && mission.phase !== 'idle' && p?.battery != null) $('battery').textContent = `${p.battery}%`;
}
function renderLog(t) {
  const visible = logUntil(entries, t);
  $('sitl-log-count').textContent = `${visible.length} / ${entries.length}`;
  if (visible.length === shown) return;
  const list = $('sitl-log');
  if (visible.length < shown || shown < 0) list.replaceChildren();
  for (const entry of visible.slice(list.children.length)) {
    const li = document.createElement('li');
    const time = document.createElement('time'); time.textContent = clock(entry.t);
    const tag = document.createElement('span'); tag.className = `sitl-tag ${entry.source}`; tag.textContent = SOURCES[entry.source] ?? entry.source;
    const text = document.createElement('span'); text.textContent = entry.text;
    li.append(time, tag, text);
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
  shown = visible.length;
}

const scene = createScene($('sitl-canvas'), {
  fillOf(id, state) {
    if (live || !mission) return state?.visited.some(frame => frame.cell_id === id) ? CELL_COLORS.no_candidate : CELL_COLORS.pending;
    return CELL_COLORS[mission.cells.find(cell => cell.cell_id === id)?.status] ?? CELL_COLORS.pending;
  },
  isActive: (id, state) => (live ? state?.current : reflight ? reflight.activeId : mission?.activeId) === id,
  onCellClick: id => [...document.querySelectorAll('#cell-grid .cell')].find(button => button.querySelector('.cell-id')?.textContent === id)?.click(),
  onRender(state, t) { renderFacts(state, t); renderLog(t); }
});

// The mission button drives the recorded flight so the drone and the site map stay on the same cell.
function followMission() {
  if (!flight || live || !mission || reflight) return;
  const speed = Number($('speed').value);
  if (mission.phase === 'idle') { shown = -1; scene.setTime(0); return; }
  if (mission.phase === 'paused') { scene.stop(); scene.render(); return; }
  if (mission.index === 0 && !mission.activeId && scene.time() > 0) { shown = -1; scene.setTime(0); }
  const ms = mission.phase === 'complete' ? LANDING_MS / speed : 1000 / speed;
  scene.flyTo(targetTime(flight, mission), ms);
}
// While a reflight runs, the overview shows the same calculated route as the reinspection map.
function followReflight(next) {
  const active = next && next.phase !== 'idle' ? next : null;
  if (!active) {
    if (!reflight) return false;
    reflight = null; routeKey = '';
    showFlight(record);
    shown = -1;
    scene.setTime(mission?.phase === 'complete' ? record.duration_s : 0);
    return true;
  }
  reflight = active;
  const key = active.targets.join(',');
  if (key !== routeKey) {
    routeKey = key;
    showFlight(routeFlight(active.targets), '경로 시뮬레이션');
    shown = -1;
    scene.setTime(0);
  }
  followRoute(scene, flight, active, Number(document.querySelector('#reinspection [data-speed]').value));
  return true;
}
function showError(message) {
  $('sitl-error').hidden = !message;
  $('sitl-error').textContent = message ?? '';
}
function setSource(text, isLive = false) {
  $('sitl-source').textContent = text;
  $('sitl-source').classList.toggle('live', isLive);
}
async function fetchFlight(id) {
  const response = await fetch(`./api/missions/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json();
}
function showFlight(next, source) {
  flight = next;
  entries = buildLog(flight);
  scene.setFlight(flight);
  setSource(source ?? (flight.complete ? 'SITL 비행 기록' : '● SITL 비행 중'), !source && !flight.complete);
}
function applyFlight(next) {
  record = next;
  showFlight(next);
}
function pollLive() {
  clearTimeout(pollId);
  pollId = setTimeout(async () => {
    try {
      applyFlight(await fetchFlight(LIVE_ID));
      scene.setTime(flight.duration_s);
      showError(null);
    } catch { showError('비행 상태를 새로 받지 못했습니다. 다시 시도합니다.'); }
    if (flight.complete) { live = false; scene.render(); } else pollLive();
  }, POLL_MS);
}

const toggle = createViewToggle(next => {
  card.dataset.mapView = next;
  if (next === '2d') window.dispatchEvent(new Event('resize'));
});
card.querySelector('.card-heading').append(toggle.element);
toggle.set('3d');

document.addEventListener('mission:change', event => {
  mission = event.detail;
  const next = mission.reflight;
  const key = `${mission.phase}:${mission.index}:${mission.activeId}:${$('speed').value}:${next?.targets.join(',')}:${next?.phase}:${next?.index}:${next?.activeId}:${document.querySelector('#reinspection [data-speed]')?.value}`;
  if (key === missionKey) { scene.render(); return; }
  missionKey = key;
  if (!live && record && followReflight(next)) return;
  followMission();
});

try {
  const { missions } = await (await fetch('./api/missions')).json();
  const liveFlight = missions.includes(LIVE_ID) ? await fetchFlight(LIVE_ID) : null;
  if (liveFlight && !liveFlight.complete) {
    live = true;
    applyFlight(liveFlight);
    scene.setTime(liveFlight.duration_s);
    pollLive();
  } else {
    applyFlight(await fetchFlight(RECORD_ID));
    followMission();
  }
  scene.render();
} catch {
  setSource('기록 없음');
  toggle.set('2d');
  showError('비행 기록을 불러오지 못했습니다.');
}
