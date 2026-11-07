import { createPredictions } from './predictions.mjs';
import { selectionPanelColor } from './panel-colors.mjs';
import { createScene, createViewToggle } from './flight-scene.mjs';


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
let previousCells=[],lastLiveTime=-1;
const predictions=createPredictions(()=>scene.render());
document.addEventListener('reflight:start',()=>{predictions.clear();lastLiveTime=-1;});

function tileKind(id) {
  const tile = card.querySelector(`[aria-label^="${id} ·"]`);
  return ['done', 'active', 'target'].find(kind => tile?.classList.contains(kind)) ?? 'outside';
}
const scene = createScene(stage.querySelector('canvas'), {
  fillOf: id => {
    const kind=tileKind(id);
    return selectionPanelColor({kind,live,result:live&&kind==='done'?predictions.peek(id):null,previousStatus:previousCells.find(c=>c.cell_id===id)?.status});
  },
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
  if (!live) { live = true; scene.stop(); source.textContent = '드론 비행'; note.textContent = '남청색: 대기·결과 미확인 · 초록색: 핫스팟 없음 · 빨간색: 핫스팟 탐지 · 노란색: 촬영 중'; }
  if(event.detail.t<lastLiveTime)predictions.clear();
  lastLiveTime=event.detail.t;
  scene.setFlight(event.detail.flight);
  scene.setTime(event.detail.t);
});

// Tile colours follow the reinspection map and the previous cell results, so redraw when they change.
document.addEventListener('mission:change', event => {
  previousCells=event.detail.cells??previousCells;
  scene.render();
});
