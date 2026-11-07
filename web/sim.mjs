import { buildLog, logUntil } from './flight.mjs';
import { createScene } from './flight-scene.mjs';

const PHASES = { waiting: '이륙 대기', takeoff: '이륙', moving: '셀로 이동', capture: '촬영 지점 도착', returning: '복귀', landing: '착륙', done: '비행 종료' };
const SOURCES = { fc: 'FC', mission: 'MISSION', frame: 'FRAME' };
const POLL_MS = 2000;
const COLORS = { outside: '#a9b6c8', target: '#3a68a8', visited: '#087d57' };
const ERRORS = { 401: '운영자 비밀번호가 맞지 않습니다.', 503: '서버에 운영자 비밀번호가 설정되지 않았습니다.' };

const root = document.getElementById('sim');
root.innerHTML = `
  <div class="card-heading"><div><p class="eyebrow">ARDUPILOT SITL · LIVE</p><h2>드론 시뮬레이션</h2></div><span id="sim-source" class="sim-pill">확인 중</span></div>
  <p class="sitl-copy">서버의 ArduPilot SITL을 <strong id="sim-speed">5</strong>배속으로 실행합니다. 실제 드론 비행이 아니며, 사진 전송과 AI 분석은 연결되어 있지 않습니다. 셀 색은 도착 여부만 나타냅니다.</p>
  <div class="sim-controls">
    <label class="sim-token">운영자 비밀번호<input id="sim-token" type="password" autocomplete="off" spellcheck="false"></label>
    <button id="sim-power" type="button" disabled>SITL 켜기</button>
    <label>비행 범위<select id="sim-cells"><option value="">전체 24셀</option><option value="C-4,C-5,C-6">재점검 3셀 (C-4, C-5, C-6)</option></select></label>
    <button id="sim-fly" class="primary" type="button" disabled>▶ 비행 시작</button>
  </div>
  <p id="sim-message" class="sim-message" role="status"></p>
  <div class="sitl-stage sim-stage">
    <canvas id="sim-canvas" role="img" aria-label="서버에서 실행 중인 SITL 드론의 3D 화면. 현재 값은 아래 비행 상태에서 확인할 수 있습니다."></canvas>
    <span class="sitl-hint" aria-hidden="true">H: 이륙장 · 드래그: 회전</span>
  </div>
  <dl class="sitl-facts sim-facts">
    <div><dt>상태</dt><dd id="sim-phase">—</dd></div>
    <div><dt>최근 셀</dt><dd id="sim-cell">—</dd></div>
    <div><dt>고도</dt><dd id="sim-alt">—</dd></div>
    <div><dt>위치 (x, y)</dt><dd id="sim-pos">—</dd></div>
    <div><dt>방향</dt><dd id="sim-heading">—</dd></div>
    <div><dt>배터리 (시뮬)</dt><dd id="sim-battery">—</dd></div>
    <div><dt>도착 셀</dt><dd id="sim-frames">—</dd></div>
    <div><dt>실행 시간</dt><dd id="sim-time">—</dd></div>
  </dl>
  <div class="sitl-log-title"><h3>비행 로그</h3><span id="sim-log-count"></span></div>
  <ol id="sim-log" class="sitl-log" tabindex="0" aria-label="SITL 비행 로그"></ol>`;

const $ = id => document.getElementById(id);
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
let flight = null, entries = [], shown = -1, status = null, busy = false, wasFlying = false;

function renderLog(t) {
  const visible = logUntil(entries, t);
  $('sim-log-count').textContent = `${visible.length} / ${entries.length}`;
  if (visible.length === shown) return;
  const list = $('sim-log');
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
const scene = createScene($('sim-canvas'), {
  fillOf(id, state) {
    if (state?.visited.some(frame => frame.cell_id === id)) return COLORS.visited;
    return flight?.cells.includes(id) ? COLORS.target : COLORS.outside;
  },
  isActive: (id, state) => state?.current === id,
  onRender(state, t) {
    const p = state.position;
    $('sim-phase').textContent = PHASES[state.phase];
    $('sim-cell').textContent = state.last_cell ?? '—';
    $('sim-alt').textContent = p ? `${p.rel_alt_m.toFixed(1)} m` : '—';
    $('sim-pos').textContent = p ? `${p.x_m.toFixed(1)}, ${p.y_m.toFixed(1)} m` : '—';
    $('sim-heading').textContent = p?.heading == null ? '—' : `${Math.round(p.heading)}°`;
    $('sim-battery').textContent = p?.battery == null ? '—' : `${p.battery}%`;
    $('sim-frames').textContent = `${state.visited.length} / ${flight.cells.length}`;
    $('sim-time').textContent = clock(t);
    renderLog(t);
  }
});
scene.render();

function renderControls() {
  const power = $('sim-power'), fly = $('sim-fly'), pill = $('sim-source');
  if (!status) { power.disabled = fly.disabled = true; pill.textContent = '서버 확인 불가'; pill.dataset.state = 'off'; return; }
  $('sim-speed').textContent = status.speedup;
  power.textContent = status.sitl ? 'SITL 끄기' : 'SITL 켜기';
  power.disabled = busy;
  fly.disabled = busy || !status.sitl || status.flying;
  fly.textContent = status.flying ? '비행 중' : '▶ 비행 시작';
  $('sim-cells').disabled = status.flying;
  pill.textContent = status.flying ? `● SITL 비행 중 · ${status.speedup}배속` : status.sitl ? `SITL 켜짐 · ${status.speedup}배속` : 'SITL 꺼짐';
  pill.dataset.state = status.flying ? 'flying' : status.sitl ? 'on' : 'off';
}
function setMessage(text, isError = false) {
  $('sim-message').textContent = text;
  $('sim-message').classList.toggle('error', isError);
}
async function loadFlight(follow) {
  const response = await fetch('./api/missions/live');
  if (!response.ok) return;
  const next = await response.json();
  if (!next.positions.length) return;
  if (!flight || next.duration_s < scene.time()) { shown = -1; scene.setTime(0); }
  flight = next;
  entries = buildLog(flight);
  scene.setFlight(flight);
  if (follow) scene.flyTo(flight.duration_s, POLL_MS);
  else scene.setTime(flight.duration_s);
}
async function poll() {
  try {
    const response = await fetch('./api/sitl/status');
    if (!response.ok) throw new Error(String(response.status));
    status = await response.json();
    if (status.flying || wasFlying) await loadFlight(status.flying);
    if (wasFlying && !status.flying) setMessage(status.mission === 'done' ? '비행을 마치고 착륙했습니다.' : '비행이 완료되지 않았습니다. SITL 상태를 확인한 뒤 다시 시도하세요.', status.mission !== 'done');
    wasFlying = status.flying;
  } catch { status = null; }
  renderControls();
}
async function act(pathName, body, doneMessage) {
  busy = true; renderControls();
  setMessage('요청 중입니다…');
  try {
    const response = await fetch(`./api/sitl/${pathName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operator-Token': $('sim-token').value },
      body: JSON.stringify(body ?? {})
    });
    if (!response.ok) { setMessage(ERRORS[response.status] ?? '요청을 처리하지 못했습니다. SITL 상태를 확인하세요.', true); return; }
    status = await response.json();
    setMessage(doneMessage);
    if (pathName === 'stop') wasFlying = false;
    if (pathName === 'fly') { wasFlying = true; flight = null; entries = []; shown = -1; scene.setFlight(null); scene.setTime(0); $('sim-log').replaceChildren(); }
  } catch { setMessage('서버에 연결하지 못했습니다.', true); }
  finally { busy = false; renderControls(); }
}

$('sim-power').addEventListener('click', () => (status?.sitl
  ? act('stop', null, 'SITL을 껐습니다.')
  : act('start', null, 'SITL을 켰습니다. 위치를 잡을 때까지 잠시 기다린 뒤 비행을 시작하세요.')));
$('sim-fly').addEventListener('click', () => act('fly', { cells: $('sim-cells').value || null }, '비행을 시작했습니다. 이륙까지 잠시 걸릴 수 있습니다.'));

const { missions } = await fetch('./api/missions').then(response => response.json()).catch(() => ({ missions: [] }));
if (missions.includes('live')) await loadFlight(false).catch(() => {});
await poll();
setInterval(poll, POLL_MS);
