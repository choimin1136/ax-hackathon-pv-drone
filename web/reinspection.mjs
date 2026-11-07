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
  return ROUTE.filter(id => selected.has(id) && cells.some(c => c.cell_id === id && c.status !== 'pending'));
}

export function createReinspection({ getCells, getSummary }) {
  const root = document.getElementById('reinspection');
  const selected = new Set();
  const rows = new Map();
  let confirmed = false;
  root.innerHTML = `<div class="card-heading"><div><p class="eyebrow">NEXT INSPECTION</p><h2>재점검 대상 선택</h2></div><span class="demo-chip">예시 · 시뮬레이션</span></div>
    <p class="reinspection-help">사진 확보 필요, 미확인 후보, 승인한 주의 구역을 추천합니다. 점검이 끝난 구역을 직접 추가하거나 해제할 수 있습니다.</p>
    <div class="reinspection-actions"><button type="button" data-recommend>추천 대상 선택</button><button type="button" data-clear>전체 해제</button></div>
    <div class="reinspection-grid" aria-label="재점검 구역 선택"></div>
    <p data-selection></p><button type="button" class="primary" data-confirm>선택 확정 · 예시</button>
    <p data-result role="status"></p><p class="reinspection-help">선택은 현재 미션에만 보관됩니다. 새로고침·미션 초기화 시 지워집니다. 실제 재비행·정비 요청은 전송하지 않습니다.</p>`;
  for (const cell of getCells()) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', `${cell.cell_id} 재점검 대상`);
    const text = document.createElement('span');
    label.append(input, text);
    root.querySelector('.reinspection-grid').append(label);
    rows.set(cell.cell_id, { label, input, text });
    input.onchange = () => {
      if (input.checked) selected.add(cell.cell_id); else selected.delete(cell.cell_id);
      confirmed = false;
      render();
    };
  }
  function render() {
    const cells = getCells();
    let recommended = 0;
    for (const cell of cells) {
      const row = rows.get(cell.cell_id);
      const reason = recommendation(cell, getSummary(cell));
      if (reason) recommended++;
      row.input.disabled = cell.status === 'pending';
      row.input.checked = selected.has(cell.cell_id);
      row.label.classList.toggle('is-selected', row.input.checked);
      row.text.textContent = `${cell.cell_id} · ${cell.status === 'pending' ? '점검 대기' : reason || '직접 선택 가능'}`;
    }
    const targets = selectedTargets(cells, selected);
    root.querySelector('[data-recommend]').disabled = !recommended;
    root.querySelector('[data-recommend]').textContent = `추천 대상 선택 (${recommended}곳)`;
    root.querySelector('[data-clear]').disabled = !targets.length;
    root.querySelector('[data-confirm]').disabled = !targets.length || confirmed;
    root.querySelector('[data-selection]').textContent = `선택 ${targets.length}곳${targets.length ? ' · ' + targets.join(', ') : ' · 점검 후 대상을 선택하세요.'}`;
    root.querySelector('[data-result]').textContent = confirmed ? `예시 선택 확정: ${targets.join(', ')}. 실제 비행은 시작되지 않습니다.` : '대상을 선택한 뒤 확정하세요. 추천 목록은 후보 확인 결과에 따라 바뀌며, 직접 선택한 대상은 유지됩니다.';
  }
  root.querySelector('[data-recommend]').onclick = () => {
    selected.clear();
    for (const cell of getCells()) if (recommendation(cell, getSummary(cell))) selected.add(cell.cell_id);
    confirmed = false;
    render();
  };
  root.querySelector('[data-clear]').onclick = () => { selected.clear(); confirmed = false; render(); };
  root.querySelector('[data-confirm]').onclick = () => { confirmed = true; render(); };
  return {
    render,
    invalidate() { confirmed = false; },
    reset() { selected.clear(); confirmed = false; }
  };
}
