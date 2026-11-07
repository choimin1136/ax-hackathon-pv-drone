import { createReflight, startReflight, pauseReflight, tickReflight } from './reflight.mjs';
import { formatStarted, recordRecommendations } from './inspection-history-store.mjs';
import { ROUTE } from './mission.mjs';

// Prototype recommendations, not a flight or maintenance decision.
export function recommendation(cell, counts) {
  if (cell.status === 'pending') return '';
  if (cell.status === 'retake') return '사진 확보 필요';
  if (counts.pending > 0) return '미확인 후보 있음';
  if (cell.status === 'caution' && counts.approved > 0) return '주의 구역 경과 관찰';
  return '';
}

export function selectedTargets(cells, selected) {
  return ROUTE.filter(id => selected.has(id) && cells.some(c => c.cell_id === id));
}

export function createReinspection({ getCells, getSummary, getRecords=()=>[], isMissionBusy=()=>false, onFlightChange }) {
  const root = document.getElementById('reinspection');
  let sourceId='';
  const sourceRecord=()=>getRecords().find(record=>record.id===sourceId);
  const sourceCells=()=>sourceRecord()?.cells ?? getCells();
  const reasonFor=cell=>sourceRecord() ? (recordRecommendations(sourceRecord()).includes(cell.cell_id)?'선택 기록 기준 확인 필요':'') : recommendation(cell,getSummary(cell));
  const ready=()=>!isMissionBusy();
  const selected = new Set();
  const rows = new Map();
  let confirmed = false;
  let flight = createReflight();
  let timer;
  // external: the reflight is a real SITL flight started by sitl.mjs, which reports its progress through 'reflight:set'.
  let external = false, notice = '';
  const busy = () => ['running', 'paused'].includes(flight.phase);
  function clearFlight() { clearInterval(timer); flight = createReflight(); external = false; notice = ''; }
  function schedule() {
    clearInterval(timer);
    if (flight.phase !== 'running') return;
    timer = setInterval(() => {
      flight = tickReflight(flight);
      if (flight.phase === 'complete') clearInterval(timer);
      onFlightChange();
    }, 1000 / Number(root.querySelector('[data-speed]').value));
  }
  root.innerHTML = `<div class="reinspection-picker"><div class="card-heading"><div><p class="eyebrow">NEXT INSPECTION</p><h2>선택 점검</h2></div><span class="demo-chip">예시 · 시뮬레이션</span></div>
    <p class="reinspection-help">원하는 셀을 직접 선택하세요. 기록을 고르면 추천 셀이 자동 선택되며, 자유롭게 추가하거나 해제할 수 있습니다.</p>
    <label class="recommendation-source">추천 기준 기록 <select data-history-source aria-label="추천 기준 기록"><option value="">사용자 지정</option></select></label><p class="reinspection-help" data-history-note></p><div class="reinspection-actions"><button type="button" data-clear>전체 해제</button></div>
    <div class="reinspection-grid" aria-label="재점검 구역 선택"></div>
    <p data-selection></p><button type="button" class="primary" data-confirm>선택 확정 · 예시</button>
    <p data-result role="status"></p>
    <p class="reinspection-help reinspection-storage-note">선택은 현재 미션에만 보관됩니다. 새로고침·미션 초기화 시 지워집니다. 실제 재비행·정비 요청은 전송하지 않습니다.</p></div><div class="reflight-column"><section class="reflight-panel" aria-label="선택 구역 재비행 시뮬레이션">
      <h3>선택 구역 드론 재비행</h3>
      <p>확정한 구역만 드론이 다시 비행합니다. 점검 현황에서 드론을 켠 뒤 시작하세요. 진행은 아래 지도와 점검 현황에 함께 표시되고, 기존 탐지·승인 결과는 유지됩니다.</p>
      <details class="reflight-route-details"><summary>방문 순서 보기</summary><ol data-flight-route aria-label="재비행 방문 순서"></ol></details>
      <progress data-flight-progress max="1" value="0" aria-label="재비행 진행률"></progress>
      <p data-flight-status role="status"></p>
      <div class="reinspection-actions"><button type="button" data-flight-play>선택 구역 재비행 시작</button><button type="button" data-flight-reset>재비행 초기화</button>
      <label>재비행 속도 <select data-speed aria-label="재비행 속도"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div>
    </section><section class="reflight-map-card" aria-label="재점검 진행 지도"><div class="reflight-map-heading"><h3>재점검 구역 지도</h3><span>6 × 4 · 예시</span></div><div class="reflight-mini-map" data-reflight-map role="list" aria-label="구역별 재점검 진행"></div><div class="reflight-map-legend"><span>· 비대상</span><span>○ 대상</span><span>◉ 촬영 중</span><span>✓ 촬영 완료</span></div><p data-reflight-map-summary role="status"></p><p class="reflight-map-note">예시 촬영 완료를 표시합니다. 새 AI 분석·결함 해소 결과는 아닙니다.</p></section></div>`;
  const mapCells = new Map();
  for (const cell of getCells()) {
    const tile = document.createElement('div');
    tile.className = 'reflight-map-cell'; tile.setAttribute('role', 'listitem');
    tile.innerHTML = `<strong>${cell.cell_id}</strong><span aria-hidden="true">·</span>`;
    root.querySelector('[data-reflight-map]').append(tile);
    mapCells.set(cell.cell_id, tile);
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', `${cell.cell_id} 선택 점검`);
    const text = document.createElement('span');
    label.append(input, text);
    root.querySelector('.reinspection-grid').append(label);
    rows.set(cell.cell_id, { label, input, text });
    input.onchange = () => {
      if (input.checked) selected.add(cell.cell_id); else selected.delete(cell.cell_id);
      confirmed = false;
      clearFlight();
      onFlightChange();
    };
  }
  root.querySelector('[data-history-source]').onchange=e=>{
    if(busy())return;
    sourceId=e.target.value;selected.clear();
    const record=sourceRecord();
    if(record) for(const id of recordRecommendations(record)) selected.add(id);
    confirmed=false;clearFlight();onFlightChange();
  };
  function render() {
    if(sourceId&&!sourceRecord()) {sourceId='';if(!busy()){selected.clear();confirmed=false;clearFlight();}}
    const select=root.querySelector('[data-history-source]');
    const records=getRecords().filter(r=>!['running','paused'].includes(r.phase)&&r.visited.length).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||a.id.localeCompare(b.id));
    const signature=records.map(r=>r.id).join(',');
    if(select.dataset.records!==signature){
      select.replaceChildren(new Option('사용자 지정',''),...records.map(r=>new Option(formatStarted(r.startedAt)+' · '+(r.kind==='selection'?'재점검':'전체 점검'),r.id)));
      select.dataset.records=signature;
    }
    select.value=sourceId;select.disabled=busy();
    root.querySelector('[data-history-note]').textContent=sourceRecord()?'기록의 추천 셀을 불러왔습니다. 선택 여부는 모든 셀에서 자유롭게 수정할 수 있습니다.':'24개 셀 중 원하는 구역을 직접 선택하세요.';
    const cells = sourceCells();
    for (const cell of cells) {
      const row = rows.get(cell.cell_id);
      const reason = reasonFor(cell);
      row.input.disabled = busy();
      row.input.checked = selected.has(cell.cell_id);
      row.label.classList.toggle('is-selected', row.input.checked);
      row.text.textContent = `${cell.cell_id} · ${cell.status === 'pending' ? '직접 선택 가능' : reason || '직접 선택 가능'}`;
    }
    const targets = selectedTargets(cells, selected);
    root.querySelector('[data-clear]').disabled = busy() || !targets.length;
    root.querySelector('[data-confirm]').disabled = busy() || !targets.length || (confirmed && flight.phase !== 'complete');
    root.querySelector('[data-selection]').textContent = `선택 ${targets.length}곳${targets.length ? ' · 선택한 구역을 확정하세요.' : ' · 원하는 구역을 선택하세요.'}`;
    root.querySelector('[data-result]').textContent = confirmed ? `예시 선택 ${targets.length}곳 확정 · 오른쪽에서 방문 순서를 확인하세요. 실제 비행은 시작되지 않습니다.` : '대상을 선택한 뒤 확정하세요. 추천 목록은 후보 확인 결과에 따라 바뀌며, 직접 선택한 대상은 유지됩니다.';
    const route = flight.targets.length ? flight.targets : confirmed ? targets : [];
    const displayedTargets = flight.targets.length ? flight.targets : targets;
    const completedIds = new Set(flight.targets.slice(0, flight.index));
    for (const cell of cells) {
      const tile = mapCells.get(cell.cell_id);
      const done = completedIds.has(cell.cell_id);
      const active = flight.activeId === cell.cell_id;
      const included = displayedTargets.includes(cell.cell_id);
      const kind = done ? 'done' : active ? 'active' : included ? 'target' : 'outside';
      const label = done ? '예시 촬영 완료 · 재분석 결과 없음' : active ? (flight.phase === 'paused' ? '예시 촬영 일시정지' : '예시 촬영 중') : included ? (confirmed || flight.targets.length ? '재비행 대기' : '선택 중 · 미확정') : '재점검 비대상';
      tile.className = 'reflight-map-cell ' + kind;
      tile.setAttribute('aria-label', cell.cell_id + ' · ' + label);
      tile.title = cell.cell_id + ' · ' + label;
      tile.querySelector('span').textContent = done ? '✓' : active ? '◉' : included ? '○' : '·';
    }
    root.querySelector('[data-reflight-map-summary]').textContent = displayedTargets.length
      ? '대상 ' + displayedTargets.length + '곳 · 예시 촬영 완료 ' + completedIds.size + '곳' + (flight.phase === 'paused' ? ' · 일시정지' : '')
      : '왼쪽에서 구역을 선택하면 지도에 표시됩니다.';
    const list = root.querySelector('[data-flight-route]');
    list.replaceChildren(...route.map((id, index) => {
      const li = document.createElement('li');
      li.textContent = id + (index < flight.index ? ' · 예시 촬영 완료' : flight.activeId === id ? ' · 예시 촬영 중' : ' · 이동 대기');
      if (flight.activeId === id) li.setAttribute('aria-current', 'step');
      return li;
    }));
    const progress = root.querySelector('[data-flight-progress]');
    progress.max = route.length || 1; progress.value = flight.index;
    const labels = {idle:'대기',running:'진행 중',paused:'일시정지',complete:'완료'};
    root.querySelector('[data-flight-status]').textContent = notice ? notice : route.length
      ? (external ? '드론 재비행 ' : '재비행 ') + labels[flight.phase] + ' · ' + flight.index + '/' + route.length + '곳 · ' + (external ? '비행 경과 ' : '예시 경과 ') + flight.elapsed + '초' + (flight.phase === 'complete' ? ' · 선택 구역 방문 완료. 새 분석 결과는 없습니다.' : '')
      : '대상을 직접 선택하거나 기록을 불러온 뒤 확정하세요.';
    const play = root.querySelector('[data-flight-play]');
    play.textContent = external && flight.phase === 'running' ? '드론 재비행 중' : flight.phase === 'running' ? '재비행 일시정지' : flight.phase === 'paused' ? '재비행 이어서 재생' : flight.phase === 'complete' ? '선택 구역 다시 재비행' : '선택 구역 재비행 시작';
    play.disabled = !ready() || (!busy() && !confirmed) || (external && busy());
    root.querySelector('[data-flight-reset]').disabled = flight.phase === 'idle' || (external && busy());
  }
  root.querySelector('[data-clear]').onclick = () => { selected.clear(); confirmed = false; clearFlight(); onFlightChange(); };
  root.querySelector('[data-confirm]').onclick = () => {
    if (busy()) return;
    if (flight.phase === 'complete') clearFlight();
    confirmed = true;
    onFlightChange();
  };
  root.querySelector('[data-flight-play]').onclick = () => {
    if (!ready()) return;
    if (flight.phase === 'running') flight = pauseReflight(flight);
    else {
      if (!busy() && !confirmed) return;
      if (external && busy()) return;
      const targets = flight.phase === 'paused' ? flight.targets : selectedTargets(sourceCells(), selected);
      const request = new CustomEvent('reflight:start', { cancelable: true, detail: { targets } });
      document.dispatchEvent(request);
      if (request.defaultPrevented) {
        clearInterval(timer);
        notice = request.detail.notice ?? '';
        if (request.detail.started) { flight = startReflight(createReflight(targets)); external = true; }
        onFlightChange();
        return;
      }
      // Without the drone controller there is no example playback; the reflight only runs on the drone.
      notice = '드론 연결을 확인할 수 없습니다. 점검 현황에서 드론을 켠 뒤 다시 시작하세요.';
      onFlightChange();
      return;
    }
    onFlightChange(); schedule();
  };
  document.addEventListener('reflight:set', event => {
    const { notice: message, ...next } = event.detail;
    clearInterval(timer);
    flight = { ...flight, ...next };
    external = flight.phase !== 'idle';
    notice = message ?? '';
    onFlightChange();
  });
  root.querySelector('[data-flight-reset]').onclick = () => { clearFlight(); onFlightChange(); };
  root.querySelector('[data-speed]').onchange = schedule;
  document.addEventListener('dashboard:viewchange',event=>{if(event.detail.id==='reinspection')render();});
  document.addEventListener('inspection-history:review',render);
  return {
    render,
    referenceCells:()=>sourceRecord()?.cells,
    summaryCells:()=>sourceCells(),
    summaryCounts:cell=>sourceRecord()?{pending:cell.candidates.filter(c=>c.decision==='pending').length,approved:cell.candidates.filter(c=>c.decision==='approved').length,excluded:cell.candidates.filter(c=>c.decision==='excluded').length}:getSummary(cell),
    flight: () => flight,
    invalidate() { confirmed = false; },
    reset() { clearFlight(); selected.clear(); confirmed = false; sourceId=''; }
  };
}
