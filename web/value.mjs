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

export function createValueResults({ getCells }) {
  const root = document.getElementById('value-results');
  const fields = [
    ['capacity','구역당 용량 (kW)'], ['utilization','이용률 (%)'], ['price','판매 단가 (원/kWh)'],
    ['carbon','탄소 계수 (kgCO₂e/kWh)'], ['repair','구역당 수리비 (원)'],
    ['low','출력 저하율 낮음 (%)'], ['base','출력 저하율 기준 (%)'], ['high','출력 저하율 높음 (%)']
  ];
  root.innerHTML = `<div class="card-heading"><div><p class="eyebrow">ESTIMATED IMPACT</p><h2>점검 분석</h2></div><span class="demo-chip">추정 · 시뮬레이션</span></div>
    <p>사람이 승인한 후보가 있는 구역만 한 번씩 계산합니다. 모든 구역에 같은 용량·이용률·단가를 적용하는 예시입니다.</p>
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
    const assumptions = Object.fromEntries([...inputs].map(([key,input]) => [key,input.value.trim() === '' ? NaN : Number(input.value)]));
    const result = calculateValue(getCells(), assumptions);
    root.querySelector('[data-value-error]').textContent = result.error || '';
    const cards = root.querySelector('[data-value-cards]'); cards.replaceChildren();
    const summary = root.querySelector('[data-value-summary]');
    if (result.error) { summary.textContent = '입력값을 수정하면 추정 결과를 다시 계산합니다.'; return; }
    if (!result.ids.length) { summary.textContent = '확인 후 계산 · 승인한 후보가 있는 구역이 없습니다. 셀 상세에서 후보를 확인하고 승인하세요.'; return; }
    summary.textContent = `승인 구역 ${result.ids.length}곳 · ${result.ids.join(', ')} · 총 수리비 가정 ${format(result.cost)}원 · 연간 금전 가치 추정 범위 ${format(result.scenarios[0].money)}~${format(result.scenarios[2].money)}원`;
    const names = {low:'낮음',base:'기준',high:'높음'};
    for (const scenario of result.scenarios) {
      const card = document.createElement('article');
      card.innerHTML = `<h3>${names[scenario.key]} 가정 · 추정</h3><dl><div><dt>연간 회수 가능 전력량</dt><dd>${format(scenario.energy)} kWh/년</dd></div><div><dt>연간 금전 가치</dt><dd>${format(scenario.money)} 원/년</dd></div><div><dt>연간 탄소 감축 잠재량</dt><dd>${format(scenario.carbon)} kgCO₂e/년</dd></div><div><dt>단순 수리비 회수 기간</dt><dd>${scenario.payback === null ? '계산 불가 · 연간 금전 가치 0원' : format(scenario.payback) + ' 년'}</dd></div></dl>`;
      cards.append(card);
    }
  }
  root.querySelector('[data-value-reset]').onclick = () => { for (const [key,input] of inputs) input.value = DEFAULTS[key]; render(); };
  return { render, assumptions: () => Object.fromEntries([...inputs].map(([key,input]) => [key,input.value.trim() === '' ? NaN : Number(input.value)])) };
}
