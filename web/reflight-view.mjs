import { routeFlight } from './flight.mjs';
import { createScene, createViewToggle, followRoute } from './flight-scene.mjs';

const TILE_COLORS = { outside: '#a9b6c8', target: '#3a68a8', done: '#087d57' };

const card = document.querySelector('.reflight-map-card');
const speedSelect = document.querySelector('#reinspection [data-speed]');
const stage = document.createElement('div');
stage.className = 'reflight-stage';
stage.innerHTML = '<canvas role="img" aria-label="선택 구역 재비행 경로의 3D 화면. 구역별 진행은 2D 지도에서도 확인할 수 있습니다."></canvas><span class="sitl-source">경로 시뮬레이션</span><span class="sitl-hint" aria-hidden="true">H: 이륙장 · 드래그: 회전</span>';
card.querySelector('.reflight-mini-map').before(stage);
const note = document.createElement('p');
note.className = 'reflight-map-note reflight-3d-note';
note.textContent = '3D 드론은 선택한 구역으로 계산한 경로입니다. SITL 비행 기록이 아닙니다.';
card.querySelector('.reflight-map-note').before(note);

let reflight = { targets: [], phase: 'idle', index: 0, activeId: null };
let plan = routeFlight([]);
let routeKey = '', stepKey = '', live = false;

function tileKind(id) {
  const tile = card.querySelector(`[aria-label^="${id} ·"]`);
  return ['done', 'active', 'target'].find(kind => tile?.classList.contains(kind)) ?? 'outside';
}
const scene = createScene(stage.querySelector('canvas'), {
  fillOf: id => TILE_COLORS[tileKind(id)] ?? TILE_COLORS.outside,
  isActive: id => tileKind(id) === 'active'
});
scene.setFlight(plan);

function follow() {
  if (live) return;
  const key = reflight.targets.join(',');
  if (key !== routeKey) {
    routeKey = key;
    plan = routeFlight(reflight.targets);
    scene.setFlight(plan);
    scene.setTime(0);
  }
  followRoute(scene, plan, reflight, Number(speedSelect.value));
}

const toggle = createViewToggle(next => { card.dataset.mapView = next; });
card.querySelector('.reflight-map-heading').append(toggle.element);
toggle.set('3d');

// A reflight flown by SITL replaces the calculated route with the real flight record.
document.addEventListener('sitl:flight', event => {
  const source = stage.querySelector('.sitl-source');
  if (!event.detail) { live = false; routeKey = ''; source.textContent = '경로 시뮬레이션'; note.textContent = '3D 드론은 선택한 구역으로 계산한 경로입니다. SITL 비행 기록이 아닙니다.'; follow(); return; }
  if (!live) { live = true; scene.stop(); source.textContent = 'SITL 비행'; note.textContent = '3D 드론은 서버의 SITL 비행 위치입니다. 실제 드론 비행이 아닙니다.'; }
  scene.setFlight(event.detail.flight);
  scene.setTime(event.detail.t);
});

document.addEventListener('mission:change', event => {
  reflight = event.detail.reflight ?? reflight;
  const key = `${reflight.targets.join(',')}:${reflight.phase}:${reflight.index}:${reflight.activeId}:${speedSelect.value}`;
  if (key === stepKey) { scene.render(); return; }
  stepKey = key;
  follow();
});
