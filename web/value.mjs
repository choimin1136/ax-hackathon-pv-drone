import {formatStarted} from './inspection-history-store.mjs';
import {energyComparison} from './energy-dummy.mjs';
// Illustrative assumptions only; not market prices, measured losses or official factors.
export const DEFAULTS = { capacity: 10, utilization: 15, price: 100, carbon: 0.4, repair: 100000, low: 2, base: 5, high: 10 };
export function validateAssumptions(a) {
  if (Object.keys(DEFAULTS).some(key => typeof a[key] !== 'number' || !Number.isFinite(a[key]) || a[key] < 0)) return '모든 가정값에 0 이상의 유효한 숫자를 입력하세요.';
  if (a.capacity === 0) return '구역당 용량은 0보다 커야 합니다.';
  if ([a.utilization, a.low, a.base, a.high].some(value => value > 100)) return '이용률과 출력 저하율은 0~100%로 입력하세요.';
  if (a.low > a.base || a.base > a.high) return '출력 저하율은 낮음 ≤ 기준 ≤ 높음 순서로 입력하세요.';
  return '';
}
export function calculateValue(cells, a) {
  const error = validateAssumptions(a);
  if (error) return { error };
  const ids = [...new Set(cells.filter(c => c.confirmed_count > 0 && !['pending', 'retake'].includes(c.status)).map(c => c.cell_id))];
  const cost = ids.length * a.repair;
  const scenarios = ['low', 'base', 'high'].map(key => {
    const energy = ids.length * a.capacity * 8760 * (a.utilization / 100) * (a[key] / 100);
    const money = energy * a.price;
    return { key, energy, money, carbon: energy * a.carbon, payback: money > 0 ? cost / money : null };
  });
  if (!Number.isFinite(cost) || scenarios.some(s => [s.energy, s.money, s.carbon, ...(s.payback === null ? [] : [s.payback])].some(v => !Number.isFinite(v)))) return {error:'입력값이 너무 큽니다. 계산 가능한 범위로 줄여주세요.'};
  return { ids, cost, scenarios };
}

export function analyzeRecord(record, assumptions) {
  const cells = (record?.cells ?? []).filter(c=>record.targets.includes(c.cell_id) && record.visited.includes(c.cell_id));
  const counts = {approved:0,excluded:0,pending:0};
  for (const cell of cells) for (const candidate of cell.candidates) {
    if (candidate.decision in counts) counts[candidate.decision]++;
  }
  const result = calculateValue(cells.map(c=>({...c,confirmed_count:c.candidates.filter(p=>p.decision==='approved').length})),assumptions);
  // The power comparison covers every visited cell, approved or not; the value estimate stays limited to approvals.
  const energy = result.error ? null : energyComparison(record, assumptions);
  if(result.error || !result.ids.length) return {...result,counts,rows:[],energy};
  // A reproducible fixture for the selected calendar day, NOT telemetry or model output.
  const day = new Date(new Date(record.startedAt).getTime()+9*3600000).toISOString().slice(0,10);
  const seed = [...day].reduce((sum,c)=>sum+c.charCodeAt(0),0);
  const rows = result.ids.map(id=>{
    const predicted = assumptions.capacity*24*assumptions.utilization/100;
    const lossPercent = 3+(seed+id.charCodeAt(0)+Number(id.split('-')[1]))%10;
    const measured = predicted*(1-lossPercent/100);
    return {id,predicted,measured,difference:measured-predicted,lossPercent};
  });
  const predicted=rows.reduce((sum,r)=>sum+r.predicted,0),measured=rows.reduce((sum,r)=>sum+r.measured,0);
  return {...result,counts,day,rows,predicted,measured,difference:measured-predicted,energy};
}

export function createValueResults({ getRecords }) {
  const root = document.getElementById('value-results');
  let selectedId='';
  const fields = [
    ['capacity','구역당 용량 (kW)'], ['utilization','이용률 (%)'], ['price','판매 단가 (원/kWh)'],
    ['carbon','탄소 계수 (kgCO₂e/kWh)'], ['repair','구역당 수리비 (원)'],
    ['low','출력 저하율 낮음 (%)'], ['base','출력 저하율 기준 (%)'], ['high','출력 저하율 높음 (%)']
  ];
  root.innerHTML = `<div class="card-heading"><div><p class="eyebrow">ESTIMATED IMPACT</p><h2>점검 분석</h2></div><span class="demo-chip">추정 · 시뮬레이션</span></div>
    <label class="recommendation-source">분석 기준 기록 <select data-analysis-source aria-label="분석 기준 기록"></select></label>
    <p data-analysis-review role="status"></p>
    <p>점검 기록에서 승인한 후보가 있는 구역만 한 번씩 계산합니다. 미확인·제외 후보는 계산에서 제외합니다. <a href="#activity">점검 기록에서 승인·제외하기 →</a></p>
    <section class="energy-comparison" aria-label="발전량 예측과 실측 비교"><h3>발전량 예측·실측 비교 <span class="demo-chip">모두 더미 데이터</span></h3>
    <p>선택 기록의 한국 날짜 하루(00:00~24:00)를 가정합니다. 예측은 용량·이용률 계산 예시, 실측은 날짜·구역별 고정 손실률(3~12%)을 적용한 더미입니다. 실제 계량기 수치나 모델 예측이 아니며, 비행 시간 동안의 발전량도 아닙니다.</p>
    <div data-energy-summary class="value-scenarios"></div><div class="energy-table" data-energy-table></div></section>
    <p>기본값은 계산 시연용이며 실제 단가·공식 탄소 계수·실측 저하율이 아닙니다. 수리 후 가정한 손실을 모두 회수할 때의 연간 잠재 가치이며, 실제 수익이나 감축 실적을 보장하지 않습니다.</p>
    <fieldset><legend>계산 가정값 · 직접 수정 가능</legend><div class="value-fields"></div><button type="button" data-value-reset>예시 가정값으로 복원</button></fieldset>
    <p data-value-error role="alert"></p><p data-value-summary role="status"></p>
    <div class="value-scenarios" data-value-cards></div>
    <details><summary>계산식과 해석 보기</summary><p>연간 회수 가능 전력량 = 승인 구역 수 × 구역당 용량 × 8,760시간 × 이용률 ÷ 100 × 출력 저하율 ÷ 100<br>연간 금전 가치 = 전력량 × 판매 단가<br>연간 탄소 감축 잠재량 = 전력량 × 탄소 계수<br>단순 수리비 회수 기간(년) = 승인 구역 수 × 구역당 수리비 ÷ 연간 금전 가치</p><p>같은 구역의 여러 후보를 승인해도 용량을 중복 계산하지 않습니다. 범위는 낮음·높음 가정에 따른 시나리오이며 통계적 신뢰구간이 아닙니다. 회수 기간에는 유지비·금융비용·할인율을 반영하지 않습니다. 연간 금전 가치가 0이면 회수 기간을 계산하지 않습니다.</p></details>`;
  const inputs = new Map();
  for (const [key, labelText] of fields) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number'; input.min = key === 'capacity' ? '0.000001' : '0'; input.step = 'any';
    if (['utilization','low','base','high'].includes(key)) input.max = '100';
    input.value = DEFAULTS[key]; input.required = true;
    input.addEventListener('input', render);
    label.append(input); root.querySelector('.value-fields').append(label); inputs.set(key,input);
  }
  const format = value => value.toLocaleString('ko-KR', {maximumFractionDigits:2});
  function render() {
    const records=getRecords().filter(r=>!['running','paused'].includes(r.phase)).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||a.id.localeCompare(b.id));
    const select=root.querySelector('[data-analysis-source]');
    if(!records.some(r=>r.id===selectedId))selectedId=records[0]?.id??'';
    select.replaceChildren();
    for(const r of records){const option=document.createElement('option');option.value=r.id;option.textContent=formatStarted(r.startedAt)+' · '+(r.kind==='selection'?'선택 점검':'전체 점검')+(r.phase==='interrupted'?' · 중단/부분 기록':'');select.append(option);}
    if(!records.length){const option=document.createElement('option');option.textContent='저장된 점검 기록 없음';option.value='';select.append(option);}
    select.value=selectedId;select.disabled=!records.length;
    const record=records.find(r=>r.id===selectedId);
    const assumptions = Object.fromEntries([...inputs].map(([key,input]) => [key,input.value.trim() === '' ? NaN : Number(input.value)]));
    const result = analyzeRecord(record, assumptions);
    root.querySelector('[data-analysis-review]').textContent=record?`선택 기록 · 방문 완료 ${record.visited.length}/${record.targets.length}구역 · 후보 승인 ${result.counts.approved} · 제외 ${result.counts.excluded} · 미확인 ${result.counts.pending}`:'저장된 점검 기록이 없습니다. 점검 후 기록에서 후보를 확인하세요.';
    const energy=root.querySelector('[data-energy-summary]'),table=root.querySelector('[data-energy-table]');energy.replaceChildren();table.replaceChildren();
    root.querySelector('[data-value-error]').textContent = result.error || '';
    const cards = root.querySelector('[data-value-cards]'); cards.replaceChildren();
    const summary = root.querySelector('[data-value-summary]');
    if (result.error) { summary.textContent = '입력값을 수정하면 추정 결과를 다시 계산합니다.'; return; }
    // Shown for every record with visited cells, before the approval-only value estimate below.
    const e=result.energy;
    if (e?.rows.length) {
      for(const [label,value] of [['예측 발전량 · 더미',e.predicted],['실측 발전량 · 더미',e.measured],['실측 − 예측 · 더미',e.difference]]){const card=document.createElement('article');const title=document.createElement('h3');title.textContent=label;const p=document.createElement('p');p.textContent=format(value)+' kWh/일';card.append(title,p);energy.append(card);}
      const grid=document.createElement('table');grid.innerHTML='<caption>방문 구역별 하루 발전량 비교 · 더미</caption><thead><tr><th>구역</th><th>예측 (kWh)</th><th>실측 (kWh)</th><th>차이 (kWh)</th><th>예측 대비 차이</th></tr></thead><tbody></tbody>';
      for(const r of e.rows){const row=document.createElement('tr');for(const value of [r.id,format(r.predicted),format(r.measured),format(r.difference),'-'+r.lossPercent+'%']){const td=document.createElement('td');td.textContent=value;row.append(td);}grid.querySelector('tbody').append(row);}table.append(grid);
    }
    if (!result.ids.length) { summary.textContent = record?'분석 대상 없음 · 이 기록에 승인한 후보가 없습니다. 점검 기록의 셀 상세에서 승인하면 해당 구역만 계산합니다.':'분석 대상 없음 · 저장된 점검 기록을 선택해야 합니다.'; return; }
    summary.textContent = `승인 구역 ${result.ids.length}곳 · ${result.ids.join(', ')} · 총 수리비 가정 ${format(result.cost)}원 · 연간 금전 가치 추정 범위 ${format(result.scenarios[0].money)}~${format(result.scenarios[2].money)}원`;
    const names = {low:'낮음',base:'기준',high:'높음'};
    for (const scenario of result.scenarios) {
      const card = document.createElement('article');
      card.innerHTML = `<h3>${names[scenario.key]} 가정 · 추정</h3><dl><div><dt>연간 회수 가능 전력량</dt><dd>${format(scenario.energy)} kWh/년</dd></div><div><dt>연간 금전 가치</dt><dd>${format(scenario.money)} 원/년</dd></div><div><dt>연간 탄소 감축 잠재량</dt><dd>${format(scenario.carbon)} kgCO₂e/년</dd></div><div><dt>단순 수리비 회수 기간</dt><dd>${scenario.payback === null ? '계산 불가 · 연간 금전 가치 0원' : format(scenario.payback) + ' 년'}</dd></div></dl>`;
      cards.append(card);
    }
  }
  root.querySelector('[data-value-reset]').onclick = () => { for (const [key,input] of inputs) input.value = DEFAULTS[key]; render(); };
  root.querySelector('[data-analysis-source]').onchange=event=>{selectedId=event.target.value;render();};
  document.addEventListener('dashboard:viewchange',event=>{if(event.detail.id==='value-results')render();});
  document.addEventListener('inspection-history:review',render);
  return { render, assumptions: () => Object.fromEntries([...inputs].map(([key,input]) => [key,input.value.trim() === '' ? NaN : Number(input.value)])) };
}
