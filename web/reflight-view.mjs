import { createScene, createViewToggle } from './flight-scene.mjs';

const TILE_COLORS = { outside: '#172d46', target: '#3a68a8', done: '#087d57' };

const card = document.querySelector('.reflight-map-card');
const stage = document.createElement('div');
stage.className = 'reflight-stage';
stage.innerHTML = '<canvas role="img" aria-label="선택 구역 드론 재비행의 3D 화면. 구역별 진행은 2D 지도에서도 확인할 수 있습니다."></canvas><span class="sitl-source">드론 비행 대기</span><span class="sitl-hint" aria-hidden="true">H: 이륙장 · 드래그: 회전</span>';
card.querySelector('.reflight-mini-map').before(stage);
const note = document.createElement('p');
note.className = 'reflight-map-note reflight-3d-note';
const IDLE_NOTE = '선택 구역 재비행을 시작하면 드론의 실제 비행 위치가 표시됩니다.';
note.textContent = IDLE_NOTE;
card.querySelector('.reflight-map-note').before(note);

let live = false;

function tileKind(id) {
  const tile = card.querySelector(`[aria-label^="${id} ·"]`);
  return ['done', 'active', 'target'].find(kind => tile?.classList.contains(kind)) ?? 'outside';
}
const scene = createScene(stage.querySelector('canvas'), {
  fillOf: id => TILE_COLORS[tileKind(id)] ?? TILE_COLORS.outside,
  isActive: id => tileKind(id) === 'active'
});
scene.setFlight(null);
scene.render();

const toggle = createViewToggle(next => { card.dataset.mapView = next; });
card.querySelector('.reflight-map-heading').append(toggle.element);
toggle.set('3d');

// The view shows only the drone's own reflight; between flights it shows the plant with no drone path.
document.addEventListener('sitl:flight', event => {
  const source = stage.querySelector('.sitl-source');
  if (!event.detail) { live = false; source.textContent = '드론 비행 대기'; note.textContent = IDLE_NOTE; scene.setFlight(null); scene.render(); return; }
  if (!live) { live = true; scene.stop(); source.textContent = '드론 비행'; note.textContent = '드론 재비행의 실시간 위치를 보여 줍니다.'; }
  scene.setFlight(event.detail.flight);
  scene.setTime(event.detail.t);
});

// Tile colours follow the reinspection map, so redraw when it changes.
document.addEventListener('mission:change', () => scene.render());
