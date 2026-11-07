import { createFlightHistory } from './flight-history.mjs';
import { renderReviewStates, summarizeFlightReview } from './cell-review-status.mjs';
import { createReport } from './report.mjs';
import { createValueResults } from './value.mjs';
import { CELL_IDS, ROUTE, STATUS, createMission, startMission, pauseMission, tickMission, summarize, mergeFlightProgress } from './mission.mjs';
import {createReinspection} from './reinspection.mjs';
import {createDetail} from './detail.mjs';
const $ = id => document.getElementById(id);
let state = createMission();
let selected = 'A-1';
let timer;
const detail = createDetail({getCell:id=>state.cells.find(c=>c.cell_id===id),onChange:(id,counts)=>{
  state={...state,cells:state.cells.map(c=>c.cell_id===id?{...c,confirmed_count:counts.approved}:c)};
  reinspection.invalidate();
  render();
}});
const reinspection = createReinspection({getCells:()=>state.cells,getSummary:cell=>detail.summary(cell),getRecords:()=>flightHistory.records(),isMissionBusy:()=>['running','paused'].includes(state.phase),isMissionComplete:()=>state.phase==='complete',onFlightChange:()=>render()});
const flightHistory = createFlightHistory({getCandidates:cell=>detail.candidates(cell)});
const valueResults = createValueResults({getCells:()=>state.cells});
createReport({getSnapshot:()=>({mission:state,candidates:state.cells.flatMap(c=>detail.candidates(c)),assumptions:valueResults.assumptions()})});
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const cells = new Map();
for (const id of CELL_IDS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cell pending';
  button.innerHTML = `<span class="panel-lines" aria-hidden="true"></span><span class="cell-id">${id}</span><span class="cell-symbol" aria-hidden="true">·</span><span class="drone-marker" aria-hidden="true" hidden>✣</span>`;
  button.addEventListener('click', () => { selected = id; render(); detail.open(id); });
  $('cell-grid').append(button);
  cells.set(id, button);
}
function renderRoute() {
  $('route').style.display = !$('show-route').checked || state.phase === 'idle' ? 'none' : 'block';
  const base = $('cell-grid').getBoundingClientRect();
  const flight = reinspection.flight();
  const points = (flight.phase === 'idle' ? ROUTE : flight.targets).map(id => {
    const rect = cells.get(id).getBoundingClientRect();
    return `${rect.left - base.left + rect.width / 2},${rect.top - base.top + rect.height / 2}`;
  });
  $('route-line').setAttribute('points', points.join(' '));
}
function render() {
  const summary = summarize(state);
  $('clear-count').textContent = summary.clear;
  $('review-count').textContent = summary.review;
  $('retake-count').textContent = summary.retake;
  const percent = Math.round(summary.completed / 24 * 100);
  $('progress').value = summary.completed;
  $('progress').textContent = `${percent}%`;
  $('progress-text').textContent = `${percent}%`;
  $('elapsed').textContent = clock(state.elapsed);
  $('battery').textContent = state.phase === 'idle' ? '—' : `${100 - state.index}%`;
  const phaseLabels = { idle: '준비', running: '진행 중', paused: '일시정지', complete: '완료' };
  $('phase-pill').textContent = phaseLabels[state.phase];
  const playLabels = { idle: '▶ 미션 체험하기', running: 'Ⅱ 일시정지', paused: '▶ 이어서 재생', complete: '↻ 다시 체험하기' };
  $('play').textContent = playLabels[state.phase];
  $('reset').disabled = state.phase === 'idle';
  $('map-phase').textContent = state.phase === 'idle' ? '미션 대기' : `예시 미션 · ${phaseLabels[state.phase]}`;
  $('mission-copy').textContent = state.phase === 'complete' ? '24개 구역의 예시 점검이 완료됐어요. 구역을 선택해 결과를 살펴보세요.' : state.phase === 'paused' ? '잠시 멈췄어요. 구역을 살펴본 뒤 이어서 재생할 수 있어요.' : '24개 구역을 순서대로 이동하며 점검하는 과정을 체험해 보세요.';
  $('flight-position').textContent = state.phase === 'idle' ? '미션을 시작하면 가상 경로가 표시됩니다' : state.phase === 'complete' ? '예시 미션 완료 · 전체 구역 방문' : state.activeId ? `${state.activeId} 구역 · ${state.phase === 'paused' ? '일시정지' : '분석 중 (예시)'}` : `다음 구역으로 이동 ${state.phase === 'paused' ? '대기' : '중'} · 예시`;
  for (const cell of state.cells) {
    const button = cells.get(cell.cell_id);
    const active = (reinspection.flight().activeId || state.activeId) === cell.cell_id;
    button.className = `cell ${cell.status}${active ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(selected === cell.cell_id));
    button.setAttribute('aria-label', `${cell.cell_id} 구역, ${active ? (reinspection.flight().activeId ? '재비행 예시 촬영 중' : '분석 중 예시') : STATUS[cell.status].label}`);
    button.querySelector('.cell-symbol').textContent = STATUS[cell.status].symbol;
    button.querySelector('.drone-marker').hidden = !active;
  }
  const cell = state.cells.find(item => item.cell_id === selected);
  $('detail-title').innerHTML = `${selected} <span>구역</span>`;
  $('detail-status').className = `status-badge ${cell.status}`;
  $('detail-status').textContent = state.activeId === selected ? '분석 중 · 예시' : STATUS[cell.status].label;
  $('detail-candidates').textContent = cell.status === 'pending' || cell.status === 'retake' ? '—' : `${cell.candidate_count}개 · 예시`;
  $('detail-action').textContent = state.activeId === selected ? '예시 분석을 진행하고 있습니다.' : cell.status === 'pending' && state.phase !== 'idle' ? '이 구역은 점검 순서를 기다리고 있습니다.' : STATUS[cell.status].action;
  const counts=detail.summary(cell);
  document.querySelector('.detail-card dl>div:last-child dd').textContent=cell.candidate_count?`승인 ${counts.approved} · 제외 ${counts.excluded} · 미확인 ${counts.pending}`:'확인할 후보 없음';
  document.querySelector('.detail-foot').textContent='합성 이미지와 후보 확인 · 저장은 현재 미션에만 적용';
  detail.refresh();
  valueResults.render();
  reinspection.render();
  flightHistory.observe(state,reinspection.flight());
  const flight = reinspection.flight();
  if (flight.phase !== 'idle') $('flight-position').textContent = flight.phase === 'complete' ? '선택 구역 재비행 완료 · 예시' : '재비행 · ' + (flight.phase === 'paused' ? '일시정지 · ' : '') + (flight.activeId ? flight.activeId + ' 예시 촬영' : '선택 구역으로 이동 중');
  renderRoute();
  renderReviewStates({cells:state.cells,getCounts:cell=>detail.summary(cell),selected});
  const displayed=summarizeFlightReview(flight.phase==='idle'?state.cells:reinspection.summaryCells(),cell=>flight.phase==='idle'?detail.summary(cell):reinspection.summaryCounts(cell),flight);
  $('clear-count').textContent=displayed.clear;
  $('review-count').textContent=displayed.review;
  $('retake-count').textContent=displayed.retake;
  const scope=displayed.reflight ? '재점검 방문 완료 '+displayed.completed+'/'+displayed.total+'구역 · 이전 판정 참고, 새 분석 아님' : '';
  $('clear-count').closest('.metric').querySelector('.metric-note').textContent=scope || '탐지 결과가 안전을 보증하지 않습니다';
  $('review-count').closest('.metric').querySelector('.metric-note').textContent=scope || '미확인 또는 승인 후보가 있는 구역';
  document.dispatchEvent(new CustomEvent('mission:change', {detail: {...state, reflight: reinspection.flight()}}));
}
function schedule() {
  clearInterval(timer);
  if (state.phase !== 'running') return;
  timer = setInterval(() => {
    state = tickMission(state);
    render();
    if (state.phase === 'complete') {
      clearInterval(timer);
      $('announcement').textContent = '예시 미션이 완료되었습니다. 24개 구역 중 핫스팟 탐지 8개입니다.';
    }
  }, 1000 / Number($('speed').value));
}
$('play').addEventListener('click', () => {
  if(state.phase==='complete') { detail.reset(); reinspection.reset(); }
  state = state.phase === 'running' ? pauseMission(state) : startMission(state);
  $('announcement').textContent = state.phase === 'running' ? '예시 미션을 재생합니다.' : '예시 미션을 일시정지했습니다.';
  render(); schedule();
});
$('reset').addEventListener('click', () => {
  detail.reset();
  reinspection.reset();
  clearInterval(timer); state = createMission(); selected = 'A-1'; render();
  $('announcement').textContent = '미션이 처음 상태로 돌아갔습니다.';
});
$('speed').addEventListener('change', schedule);
// The drone-linked view feeds real flight progress in here instead of the demo timer.
document.addEventListener('mission:set', event => {
  clearInterval(timer);
  if (event.detail.reset) { detail.reset(); reinspection.reset(); state = createMission(); selected = 'A-1'; }
  else {
    state = mergeFlightProgress(state, event.detail.mission);
  }
  render();
});
$('show-route').addEventListener('change', renderRoute);
new ResizeObserver(renderRoute).observe($('cell-grid'));
render();
