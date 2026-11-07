import { buildLog, logUntil, routeFlight, targetTime } from './flight.mjs';
import { createScene, createViewToggle, followRoute } from './flight-scene.mjs';
import { missionFromFlight } from './mission.mjs';

const PHASES = { waiting: '이륙 대기', takeoff: '이륙', moving: '셀로 이동', capture: '촬영 지점 도착', returning: '복귀', landing: '착륙', done: '비행 종료' };
const SOURCES = { fc: 'FC', mission: 'MISSION', frame: 'FRAME' };
const STAGES = { gps: '위치 확인 중', mission: '미션 업로드 중', arming: '시동 준비 중', takeoff: '이륙 중' };
const RECORD_ID = 'mission_01';
const LIVE_HASH = '#overview-live';
const DEMO_HASH = '#overview';
const POLL_MS = 1000;
const CAPTURE_S = 2;
const LANDING_MS = 6000;
const CONFIRM_MS = 5000;
const CELL_COLORS = { pending: '#7d8fa9', no_candidate: '#087d57', caution: '#d18a12', check: '#c63038', retake: '#713bc2' };
const NOTES = {
  demo: '구역 판정은 예시이고, 비행은 저장된 SITL 기록입니다.<br>실제 드론과 AI는 연결되지 않았습니다.',
  live: '서버의 ArduPilot SITL을 실행합니다. 실제 드론 비행이 아니며,<br>구역 판정은 예시이고 AI는 연결되지 않았습니다.'
};

const root = document.getElementById('sitl');
root.innerHTML = `
  <div class="sitl-stage">
    <canvas id="sitl-canvas" role="img" aria-label="이륙장에서 출발해 가상 발전소 위를 비행하는 드론의 3D 화면. 현재 값은 아래 비행 상태에서 확인할 수 있습니다."></canvas>
    <span id="sitl-source" class="sitl-source">기록 불러오는 중</span>
    <span class="sitl-hint" aria-hidden="true">H: 이륙장 · 드래그: 회전 · 셀 클릭: 상세</span>
  </div>
  <p id="sitl-copy" class="sitl-copy"></p>
  <dl class="sitl-facts">
    <div><dt>상태</dt><dd id="sitl-phase">—</dd></div>
    <div><dt>고도</dt><dd id="sitl-alt">—</dd></div>
    <div><dt>위치 (x, y)</dt><dd id="sitl-pos">—</dd></div>
    <div><dt id="sitl-time-label">비행 시간</dt><dd id="sitl-time">—</dd></div>
  </dl>
  <p id="sitl-error" class="sitl-error" role="alert" hidden></p>`;

const logCard = document.createElement('section');
logCard.className = 'flight-log-card';
logCard.setAttribute('aria-label', '드론 비행 로그');
logCard.innerHTML = '<div class="sitl-log-title"><h3>드론 로그</h3><span id="sitl-log-count"></span></div><ol id="sitl-log" class="sitl-log" tabindex="0" aria-label="드론 비행 로그"></ol>';
document.querySelector('.side-column').append(logCard);

const controls = document.createElement('div');
controls.id = 'live-controls';
controls.className = 'live-controls';
controls.innerHTML = `
  <div class="live-status" role="status"><span id="live-pill" class="sim-pill" data-state="off">확인 중</span></div>
  <label>비행 범위<select id="live-cells"><option value="">전체 24셀</option><option value="C-4,C-5,C-6">재점검 3셀 (C-4, C-5, C-6)</option></select></label>
  <div class="live-buttons"><button id="live-power" type="button" disabled>SITL 켜기</button><button id="live-fly" class="primary" type="button" disabled>▶ 비행 시작</button></div>
  <p id="live-message" class="sim-message" role="status"></p>`;
document.getElementById('play').before(controls);

const $ = id => document.getElementById(id);
const card = document.querySelector('.map-card');
let mode = null, record = null, flight = null, entries = [], shown = -1;
let mission = null, missionKey = '', reflight = null, routeKey = '';
let status = null, busy = false, wasFlying = false, stageKey = '', stageSince = 0, pollId = 0;
let confirmOffUntil = 0, confirmTimer = 0, liveKey = '', polled = false;
// The SITL flight started from the reinspection screen; its arrivals drive the reinspection progress.
let reflightLive = null, reflightKey = '';

const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Live records keep real seconds, so times on screen are converted to simulated flight time.
const flightSpeed = () => flight?.speedup ?? 1;
function renderFacts(state, t) {
  const p = state.position;
  $('sitl-phase').textContent = PHASES[state.phase];
  $('sitl-alt').textContent = p ? `${p.rel_alt_m.toFixed(1)} m` : '—';
  $('sitl-pos').textContent = p ? `${p.x_m.toFixed(1)}, ${p.y_m.toFixed(1)} m` : '—';
  const speed = flightSpeed();
  $('sitl-time-label').textContent = speed > 1 ? `비행 시간 (${speed}배속 환산)` : '비행 시간';
  $('sitl-time').textContent = mode === 'live' ? clock(t * speed) : `${clock(t)} / ${clock(flight.duration_s)}`;
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
    const time = document.createElement('time'); time.textContent = clock(entry.t * flightSpeed());
    const tag = document.createElement('span'); tag.className = `sitl-tag ${entry.source}`; tag.textContent = SOURCES[entry.source] ?? entry.source;
    const text = document.createElement('span'); text.textContent = entry.text;
    li.append(time, tag, text);
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
  shown = visible.length;
}
// In the drone-linked view the recorded arrivals decide which cells show a result, so cell clicks work the same way.
function syncReflight(state, t) {
  if (!reflightLive || !flight || flight === record) return;
  const finished = flight.complete && t >= flight.duration_s;
  const done = state.visited.filter(frame => frame.cell_id !== state.current).length;
  const key = `${done}:${state.current}:${finished}`;
  if (key === reflightKey) return;
  reflightKey = key;
  document.dispatchEvent(new CustomEvent('reflight:set', { detail: { targets: reflightLive, phase: finished ? 'complete' : 'running', index: finished ? reflightLive.length : done, activeId: finished ? null : state.current, elapsed: Math.floor(t * flightSpeed()) } }));
}
function syncLiveMission(state, t) {
  if (mode !== 'live' || reflight || reflightLive) return;
  const finished = flight.complete && t >= flight.duration_s;
  const key = `${state.visited.length}:${state.current}:${finished}:${status?.flying}`;
  if (key === liveKey) return;
  liveKey = key;
  const next = missionFromFlight(state.visited.map(frame => frame.cell_id), state.current, finished, Boolean(status?.flying), Math.floor(t * flightSpeed()));
  document.dispatchEvent(new CustomEvent('mission:set', { detail: { mission: next } }));
}

const scene = createScene($('sitl-canvas'), {
  fillOf(id) {
    return CELL_COLORS[mission?.cells.find(cell => cell.cell_id === id)?.status] ?? CELL_COLORS.pending;
  },
  isActive: (id, state) => (reflightLive ? state?.current : reflight ? reflight.activeId : mission?.activeId) === id,
  onCellClick: id => [...document.querySelectorAll('#cell-grid .cell')].find(button => button.querySelector('.cell-id')?.textContent === id)?.click(),
  onRender(state, t) {
    renderFacts(state, t); renderLog(t); syncLiveMission(state, t); syncReflight(state, t);
    if (reflightLive && flight && flight !== record) document.dispatchEvent(new CustomEvent('sitl:flight', { detail: { flight, t } }));
  }
});

function showFlight(next, source) {
  flight = next;
  entries = next ? buildLog(next) : [];
  scene.setFlight(next);
  shown = -1;
  $('sitl-log').replaceChildren();
  $('sitl-log-count').textContent = next ? '' : '0 / 0';
  $('sitl-source').textContent = source;
}
function clearFacts() {
  for (const id of ['phase', 'alt', 'pos', 'time']) $(`sitl-${id}`).textContent = '—';
}
function followMission() {
  if (mode !== 'demo' || !flight || !mission || reflight) return;
  const speed = Number($('speed').value);
  if (mission.phase === 'idle') { shown = -1; scene.setTime(0); return; }
  if (mission.phase === 'paused') { scene.stop(); scene.render(); return; }
  if (mission.index === 0 && !mission.activeId && scene.time() > 0) { shown = -1; scene.setTime(0); }
  const ms = mission.phase === 'complete' ? LANDING_MS / speed : 1000 / speed;
  scene.flyTo(targetTime(flight, mission), ms);
}
// While a reflight runs, the map shows the same calculated route as the reinspection map.
function followReflight(next) {
  const active = next && next.phase !== 'idle' ? next : null;
  if (mode === 'live' && reflightLive) {
    if (active) { scene.render(); return true; }
    reflightLive = null; reflightKey = '';
    document.dispatchEvent(new CustomEvent('sitl:flight', { detail: null }));
    scene.render();
    return true;
  }
  if (!active) {
    if (!reflight) return false;
    reflight = null; routeKey = '';
    if (mode === 'demo') {
      showFlight(record, 'SITL 비행 기록');
      scene.setTime(mission?.phase === 'complete' ? record.duration_s : 0);
    } else loadLive(false).catch(() => {});
    return true;
  }
  reflight = active;
  const key = active.targets.join(',');
  if (key !== routeKey) {
    routeKey = key;
    showFlight(routeFlight(active.targets), '경로 시뮬레이션');
    scene.setTime(0);
  }
  followRoute(scene, flight, active, Number(document.querySelector('#reinspection [data-speed]').value));
  return true;
}
function showError(message) {
  $('sitl-error').hidden = !message;
  $('sitl-error').textContent = message ?? '';
}
async function fetchFlight(id) {
  const response = await fetch(`./api/missions/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json();
}

function renderControls() {
  const power = $('live-power'), fly = $('live-fly'), pill = $('live-pill');
  if (!status) { power.disabled = fly.disabled = true; pill.textContent = polled ? '서버 확인 불가' : '확인 중'; pill.dataset.state = 'off'; return; }
  const seconds = Math.max(0, Math.round((Date.now() - stageSince) / 1000));
  const starting = status.sitl && !status.ready;
  const waiting = status.flying && STAGES[status.stage] && !flight?.frames.length;
  pill.dataset.state = status.flying ? 'flying' : status.ready ? 'on' : status.sitl ? 'busy' : 'off';
  if (waiting) { pill.textContent = `${STAGES[status.stage]} · ${seconds}초`; pill.dataset.state = 'busy'; }
  else if (status.flying) pill.textContent = `● 비행 중 · ${status.speedup}배속`;
  else if (starting) pill.textContent = `SITL 켜는 중 · ${seconds}초`;
  else pill.textContent = status.sitl ? `SITL 준비됨 · ${status.speedup}배속` : 'SITL 꺼짐';
  const confirming = status.sitl && Date.now() < confirmOffUntil;
  power.textContent = confirming ? '⚠ 한 번 더 누르면 꺼짐' : status.sitl ? 'SITL 끄기' : 'SITL 켜기';
  power.classList.toggle('sim-warning', confirming);
  power.disabled = busy;
  fly.disabled = busy || !status.ready;
  fly.textContent = status.flying ? '비행 중' : '▶ 비행 시작';
  $('live-cells').disabled = status.flying;
}
function setMessage(text, isError = false) {
  $('live-message').textContent = text;
  $('live-message').classList.toggle('error', isError);
}
async function loadLive(follow) {
  const response = await fetch('./api/missions/live');
  if (!response.ok) { if (!flight) showFlight(null, 'SITL 비행 없음'); return; }
  const next = await response.json();
  if (!next.positions.length) return;
  next.speedup = status?.speedup ?? 1;
  next.capture_s = CAPTURE_S / next.speedup;
  const fresh = !flight || next.duration_s < scene.time() || flight === record;
  showFlightKeepLog(next, fresh);
  if (follow && !fresh) scene.flyTo(next.duration_s, POLL_MS);
  else scene.setTime(next.duration_s);
}
function showFlightKeepLog(next, fresh) {
  flight = next;
  entries = buildLog(next);
  scene.setFlight(next);
  if (fresh) { shown = -1; $('sitl-log').replaceChildren(); }
  $('sitl-source').textContent = next.complete ? 'SITL 최근 비행' : '● SITL 비행 중';
}
async function poll() {
  if (mode !== 'live') return;
  try {
    const response = await fetch('./api/sitl/status');
    if (!response.ok) throw new Error(String(response.status));
    const next = await response.json();
    const key = `${next.sitl}:${next.ready}:${next.flying}:${next.stage}`;
    if (key !== stageKey) { stageKey = key; stageSince = Date.now(); }
    status = next;
    if (mode !== 'live') return;
    const recordExists = !status.flying || !['gps', 'mission', 'arming'].includes(status.stage);
    if (!reflight && recordExists && (status.flying || wasFlying)) await loadLive(status.flying);
    if (wasFlying && !status.flying && reflightLive && status.mission !== 'done') {
      reflightLive = null; reflightKey = '';
      document.dispatchEvent(new CustomEvent('reflight:set', { detail: { phase: 'idle', targets: [], index: 0, activeId: null, elapsed: 0, notice: 'SITL 재비행이 완료되지 않았습니다. SITL 상태를 확인한 뒤 다시 시작하세요.' } }));
    }
    if (wasFlying && !status.flying) setMessage(status.mission === 'done' ? '비행을 마치고 착륙했습니다.' : '비행이 완료되지 않았습니다. SITL 상태를 확인한 뒤 다시 시도하세요.', status.mission !== 'done');
    wasFlying = status.flying;
  } catch { status = null; }
  polled = true;
  renderControls();
}
async function act(name, body, doneMessage, { reflightRun = false } = {}) {
  busy = true; renderControls();
  setMessage('요청 중입니다…');
  try {
    const response = await fetch(`./api/sitl/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) { setMessage(response.status === 409 ? '지금은 실행할 수 없습니다. SITL 준비 상태와 진행 중인 비행을 확인하세요.' : '요청을 처리하지 못했습니다.', true); return false; }
    status = await response.json();
    stageKey = ''; stageSince = Date.now();
    setMessage(doneMessage);
    if (name === 'stop') wasFlying = false;
    if (name === 'fly') {
      wasFlying = true; liveKey = '';
      if (!reflightRun) { reflightLive = null; document.dispatchEvent(new CustomEvent('mission:set', { detail: { reset: true } })); }
      showFlight(null, '● SITL 비행 준비 중');
      clearFacts();
      scene.setTime(0);
    }
    return true;
  } catch { setMessage('서버에 연결하지 못했습니다.', true); return false; }
  finally { busy = false; renderControls(); }
}
// Reinspection asks first; in the drone-linked view the reflight becomes a real SITL flight.
document.addEventListener('reflight:start', event => {
  if (mode !== 'live') return;
  event.preventDefault();
  const { targets } = event.detail;
  if (!status?.ready || status.flying) {
    event.detail.notice = !status?.sitl ? 'SITL이 꺼져 있습니다. 점검 현황에서 SITL을 켠 뒤 다시 시작하세요.' : status.flying ? '다른 비행이 진행 중입니다. 끝난 뒤 다시 시작하세요.' : 'SITL이 아직 준비 중입니다. 잠시 후 다시 시작하세요.';
    return;
  }
  event.detail.started = true;
  reflightLive = [...targets]; reflightKey = '';
  // Drop the previous flight now so its finished state is not reported as this reflight.
  showFlight(null, '● SITL 재비행 준비 중'); clearFacts(); scene.setTime(0);
  act('fly', { cells: targets.join(',') }, `선택 구역 ${targets.length}곳을 SITL로 재비행합니다.`, { reflightRun: true }).then(ok => {
    if (ok) return;
    reflightLive = null;
    document.dispatchEvent(new CustomEvent('reflight:set', { detail: { phase: 'idle', targets: [], index: 0, activeId: null, elapsed: 0, notice: 'SITL 재비행을 시작하지 못했습니다. 점검 현황에서 SITL 상태를 확인하세요.' } }));
  });
});
function resetConfirm() {
  confirmOffUntil = 0;
  clearTimeout(confirmTimer);
}
// Anyone can use these buttons, so turning SITL off takes a second click within a few seconds.
$('live-power').addEventListener('click', () => {
  if (!status?.sitl) { resetConfirm(); act('start', null, 'SITL을 켜는 중입니다. 준비되면 비행 시작 버튼이 켜집니다.'); return; }
  if (Date.now() < confirmOffUntil) { resetConfirm(); act('stop', null, 'SITL을 껐습니다.'); return; }
  confirmOffUntil = Date.now() + CONFIRM_MS;
  setMessage(status.flying ? '⚠ 지금 비행 중입니다. 끄면 비행이 중단되고 다른 사람의 화면도 멈춥니다. 5초 안에 다시 누르면 꺼집니다.' : '⚠ 다른 사람이 사용 중일 수 있습니다. 5초 안에 다시 누르면 SITL이 꺼집니다.', true);
  renderControls();
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => { confirmOffUntil = 0; setMessage(''); renderControls(); }, CONFIRM_MS);
});
$('live-fly').addEventListener('click', () => {
  if (status?.flying) { setMessage('⚠ 이미 비행 중입니다. 끝날 때까지 기다려 주세요. 새 비행은 시작하지 않았습니다.', true); return; }
  act('fly', { cells: $('live-cells').value || null }, '비행을 시작했습니다. 위 단계 표시로 진행을 확인하세요.');
});

async function applyMode(next) {
  if (next === mode) return;
  mode = next;
  card.closest('#overview').dataset.mode = next;
  scene.stop();
  reflight = null; routeKey = ''; missionKey = ''; liveKey = '';
  clearInterval(pollId);
  $('sitl-copy').textContent = next === 'live'
    ? '서버에서 실행 중인 ArduPilot SITL의 실시간 위치와 로그입니다. 셀 색은 예시 판정이며, 실제 드론 비행이 아닙니다.'
    : '드론 위치·고도·로그는 ArduPilot SITL에서 실행한 비행 기록이고, 셀 색은 예시 판정입니다. 실제 드론 비행이 아닙니다.';
  document.querySelector('.simulation-note').innerHTML = NOTES[next];
  showFlight(next === 'demo' ? record : null, next === 'demo' ? 'SITL 비행 기록' : 'SITL 비행 없음');
  clearFacts();
  scene.setTime(0);
  document.dispatchEvent(new CustomEvent('mission:set', { detail: { reset: true } }));
  if (next === 'live') {
    showError(null);
    stageSince = Date.now(); stageKey = ''; wasFlying = false;
    await poll();
    const { missions } = await fetch('./api/missions').then(response => response.json()).catch(() => ({ missions: [] }));
    if (missions.includes('live')) await loadLive(false).catch(() => {});
    if (mode !== 'live') return;
    pollId = setInterval(poll, POLL_MS);
  } else {
    followMission();
    if (!record) showError('비행 기록을 불러오지 못했습니다.');
  }
}
setInterval(() => { if (mode === 'live') renderControls(); }, 1000);

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
  if (mode === 'live' && reflightLive) $('mission-copy').textContent = next?.phase === 'complete' ? '재점검 대상 구역의 SITL 재비행을 마쳤습니다.' : '재점검 대상 구역을 SITL로 다시 비행하고 있습니다.';
  else if (mode === 'live' && !next?.targets.length) { $('mission-copy').textContent = status?.flying ? '서버의 SITL 드론이 구역을 비행하고 있습니다.' : 'SITL을 켠 뒤 비행을 시작하세요. 도착한 구역부터 결과가 표시됩니다.'; }
  if (key === missionKey) { scene.render(); return; }
  missionKey = key;
  if ((record || mode === 'live') && followReflight(next)) return;
  if (mode === 'demo') followMission();
  else scene.render();
});
document.addEventListener('dashboard:viewchange', event => {
  const hash = `#${event.detail.id}`;
  if (!record && !mode) return;
  if (hash === LIVE_HASH) applyMode('live');
  else if (hash === DEMO_HASH) applyMode('demo');
});

fetchFlight(RECORD_ID).then(next => { record = next; }).catch(() => {}).finally(() => {
  // The demo view is off while its menu link is removed; restoring the link brings it back.
  const demoEnabled = Boolean(document.querySelector(`.dashboard-nav a[href="${DEMO_HASH}"]`));
  const start = demoEnabled && location.hash !== LIVE_HASH ? 'demo' : 'live';
  if (mode === 'demo' && record) { mode = null; applyMode('demo'); }
  else if (!mode) applyMode(start);
  if (!record && start === 'demo') toggle.set('2d');
});
