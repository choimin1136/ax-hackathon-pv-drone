// Short log-based analysis for the report: how many inspections were saved, which cells keep showing hotspots,
// what to fix first, and the made-up power comparison of the latest record.
import { cellTrends, priorityCells } from './analysis-insights.mjs';
import { energyComparison } from './energy-dummy.mjs';
import { formatStarted } from './inspection-history-store.mjs';

const MAX_CELLS = 8;
const kwh = value => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 });

export function historySection(records, assumptions, escape) {
  const head = '<h2>3. 점검 기록 분석</h2>';
  if (records === null) return `${head}<p>서버의 점검 기록을 불러오지 못했습니다. 연결 후 새로고침하세요.</p>`;
  const saved = records.filter(r => !r.deletedAt);
  if (!saved.length) return `${head}<p>저장된 점검 기록이 없습니다. 비행을 마치면 기록이 쌓입니다.</p>`;
  const full = saved.filter(r => r.kind === 'full').length;
  const latest = [...saved].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
  const { runs, rows } = cellTrends(saved);
  const repeated = rows.filter(row => row.hits >= 2);
  const { rows: priority } = priorityCells(saved);
  const energy = energyComparison(latest, assumptions);
  const list = (items, text) => items.length ? items.slice(0, MAX_CELLS).map(text).join(', ') + (items.length > MAX_CELLS ? ` 외 ${items.length - MAX_CELLS}곳` : '') : '해당 구역 없음';
  const energyText = energy?.rows.length ? `예측 ${kwh(energy.predicted)} kWh · 실측(더미) ${kwh(energy.measured)} kWh · 차이 ${(energy.difference / energy.predicted * 100).toFixed(1)}%` : '비교할 구역 없음';
  const items = [
    ['점검 기록', `${saved.length}건(전체 ${full} · 선택 ${saved.length - full})`],
    ['최근 점검', escape(formatStarted(latest.startedAt).slice(0, -3))],
    [`반복 탐지 구역 (최근 ${runs.length}회 중 2회 이상)`, list(repeated, row => `${escape(row.cell_id)}(${row.hits}회)`)],
    ['우선 정비 후보 (최근 전체 점검)', list(priority, row => `${escape(row.cell_id)}(${row.approved ? `승인 ${row.approved}` : `후보 ${row.candidates}`})`)],
    ['발전량 비교 (최근 기록)', energyText]
  ];
  return `${head}<p>서버에 저장된 점검 기록을 바탕으로 한 참고 분석입니다. 발전량 실측값은 계량값이 아닌 시연용 수치입니다.</p>
    <div class="report-table"><table class="kv"><tbody>${items.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
}
