import { cellReviewStatus, summarizeReview } from './cell-review-status.mjs';
import { STATUS, summarize } from './mission.mjs';
import { calculateValue } from './value.mjs';
import { FIELD_CHECKS, conditionsSection, procedureSection } from './report-guidance.mjs';
import { historySection } from './report-history.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', {maximumFractionDigits:2}) : '미입력/유효하지 않음';
const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#2563eb"/><g fill="#fff"><rect x="14" y="14" width="16" height="16" rx="3.5"/><rect x="14" y="34" width="16" height="16" rx="3.5"/><rect x="34" y="34" width="16" height="16" rx="3.5"/></g><rect x="34" y="14" width="16" height="16" rx="3.5" fill="#fbbf24"/></svg>';

// records: saved inspection logs from the server, [] when none, null when they could not be loaded.
export function buildReport({ mission, candidates, assumptions, generatedAt, records = [] }) {
  const summary = summarize(mission);
  const counts = cell => {
    const approved=candidates.filter(c=>c.cell_id===cell.cell_id && c.decision==='approved').length;
    const excluded=candidates.filter(c=>c.cell_id===cell.cell_id && c.decision==='excluded').length;
    return {approved,excluded,pending:Math.max(0,cell.candidate_count-approved-excluded)};
  };
  const human=summarizeReview(mission.cells,counts);
  const value = calculateValue(mission.cells, assumptions);
  const total = decision => candidates.filter(c => decision === 'pending' ? !['approved','excluded'].includes(c.decision) : c.decision === decision).length;
  const rows = mission.cells.map(c => `<tr class="${escape(c.status)}"><td>${escape(c.cell_id)}</td><td class="status">${escape(STATUS[c.status]?.label || c.status)}</td><td>${escape(cellReviewStatus(c,counts(c)).label)}</td><td class="num">${c.candidate_count}</td><td class="num">${counts(c).approved}</td></tr>`).join('');
  const hot = mission.cells.filter(c => c.status === 'check');
  const hotRows = hot.map(c => {
    const n = counts(c), largest = Math.max(0, ...candidates.filter(x => x.cell_id === c.cell_id).map(x => x.area_px ?? 0));
    return `<tr><td>${escape(c.cell_id)}</td><td class="num">${c.candidate_count}</td><td class="num">${n.approved}</td><td class="num">${n.excluded}</td><td class="num">${n.pending}</td><td class="num">${largest ? `${number(largest)} px²` : '—'}</td></tr>`;
  }).join('');
  const fields = [['capacity','구역당 용량','kW'],['utilization','이용률','%'],['price','판매 단가','원/kWh'],['carbon','탄소 계수','kgCO₂e/kWh'],['repair','구역당 수리비','원'],['low','저하율 낮음','%'],['base','저하율 기준','%'],['high','저하율 높음','%']];
  const estimate = value.error ? `<p>추정 계산 불가: ${escape(value.error)}</p>` : !value.ids.length ? '<p>확인 후 계산 · 승인한 후보가 있는 구역이 없습니다.</p>' : `<p>계산 대상 ${value.ids.length}곳: ${value.ids.map(escape).join(', ')} · 총 수리비 가정 ${number(value.cost)}원</p><div class="report-table"><table><thead><tr><th>시나리오</th><th>전력 (kWh/년)</th><th>금전 (원/년)</th><th>탄소 (kgCO₂e/년)</th><th>회수 기간 (년)</th></tr></thead><tbody>${value.scenarios.map(s => `<tr><td>${{low:'낮음',base:'기준',high:'높음'}[s.key]}</td><td class="num">${number(s.energy)}</td><td class="num">${number(s.money)}</td><td class="num">${number(s.carbon)}</td><td class="num">${s.payback === null ? '계산 불가' : number(s.payback)}</td></tr>`).join('')}</tbody></table></div>`;

  return `<article class="report-document">
    <header class="report-head">${LOGO}<div><p class="eyebrow">SUNPATCH INSPECTION REPORT</p><h1>태양광 점검 보고서</h1></div><span class="badge">시뮬레이션 · 합성 데이터 · 검토용</span></header>
    <table class="kv info"><tbody><tr><th>점검 대상</th><td>가상 발전소 01 (4행 × 6열, 24구역)</td><th>생성 시각</th><td>${escape(generatedAt)}</td></tr><tr><th>점검 방법</th><td>드론 열화상 간이 점검 (ArduPilot 시뮬레이터)</td><th>판정</th><td>핫스팟 AI 모델 · 사람 확인</td></tr></tbody></table>
    <p class="note">드론 비행은 ArduPilot 시뮬레이터이고, 열화상은 AI Hub 데이터를 구역에 배정해 핫스팟 모델로 판정했습니다. 모델 판정은 참고용이며, 후보 승인은 사용자 확인 기록으로 전문 점검을 대체하지 않습니다. 생성 당시 결과를 고정한 사본입니다.</p>
    <h2>1. 점검 결과</h2>
    <table class="kv summary"><tbody><tr><th>진행</th><td>${mission.phase === 'complete' ? '전체 점검 완료' : '부분 결과 · 전체 점검 미완료'} · ${summary.completed}/${mission.cells.length}구역</td><th>핫스팟 탐지</th><td class="hot">${summary.review}구역</td><th>핫스팟 없음</th><td>${summary.clear}구역</td></tr><tr><th>사람 확인</th><td colspan="5">미확인 ${human.unresolved}구역 · 승인 후보 있음 ${human.approved}구역 · 후보 모두 제외 ${human.excluded}구역</td></tr></tbody></table>
    <p class="fine">핫스팟 없음은 안전을 보증하지 않습니다. 재비행 시뮬레이션은 새 분석 결과를 만들지 않아 원래 점검 상태를 유지합니다.</p>
    <div class="report-table"><table><thead><tr><th>구역</th><th>탐지 상태</th><th>사람 확인 상태</th><th>후보 수</th><th>승인 수</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>2. 핫스팟 구역 후보 확인</h2><p>승인 ${total('approved')}개 · 제외 ${total('excluded')}개 · 미확인 ${total('pending')}개 · 온도는 측정하지 않아 이상 등급은 현장 온도 측정 후 판정합니다.</p>
    ${hotRows ? `<div class="report-table"><table><thead><tr><th>구역</th><th>후보</th><th>승인</th><th>제외</th><th>미확인</th><th>최대 면적 (예시)</th></tr></thead><tbody>${hotRows}</tbody></table></div><h3>핫스팟 구역 현장 확인 항목</h3><ul>${FIELD_CHECKS.map(c => `<li>${c}</li>`).join('')}</ul>` : '<p>핫스팟이 탐지된 구역이 없습니다. 점검 미완료 구역을 안전하다고 판단할 수 없습니다.</p>'}
    ${historySection(records, assumptions, escape)}
    <h2>4. 금전·공공 가치 추정</h2>${estimate}
    <p class="fine">가정값: ${fields.map(([key,label,unit]) => `${label} ${number(assumptions[key])} ${unit}`).join(' · ')}</p>
    <p class="fine">연간 회수 가능 전력량 = 승인 구역 수 × 구역당 용량 × 8,760시간 × 이용률/100 × 출력 저하율/100 · 연간 금전 가치 = 전력량 × 판매 단가 · 탄소 감축 잠재량 = 전력량 × 탄소 계수 · 회수 기간 = 승인 구역 수 × 구역당 수리비 ÷ 연간 금전 가치. 기본값은 시연용이며 낮음·기준·높음은 가정별 시나리오로 통계적 신뢰구간이 아닙니다. 유지비·금융비용·할인율은 제외했고 실제 수익·감축 실적을 보장하지 않습니다.</p>
    <div class="page-break"></div>
    ${conditionsSection()}${procedureSection()}
    <h2>7. 다음 확인 사항</h2><p>미확인 후보는 근거 사진으로 검토하고, 재촬영 필요 구역은 사진을 확보하세요. 승인 후보의 정비 여부와 실제 계산 계수는 담당자가 확인해야 합니다.</p>
    <table class="sign"><tbody><tr><th>작성</th><th>검토</th><th>승인</th></tr><tr><td></td><td></td><td></td></tr></tbody></table>
  </article>`;
}

// A4 document on screen and in print, with the dashboard's colours (blue accent, red for hotspot cells).
export const REPORT_STYLE = `*{box-sizing:border-box}
body{margin:0;padding:24px 12px;background:#f5f7fb;color:#17243b;font-family:"Pretendard","Segoe UI","Malgun Gothic",system-ui,sans-serif;font-size:13px;line-height:1.65;-webkit-font-smoothing:antialiased}
.report-document{max-width:210mm;margin:auto;background:#fff;border:1px solid #e3e9f2;border-radius:6px;box-shadow:0 4px 20px #17243b0d;padding:18mm 16mm}
.report-head{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:2px solid #2563eb}
.report-head svg{width:38px;height:38px;flex:none}.report-head>div{flex:1}
.eyebrow{margin:0;font-size:9px;letter-spacing:.14em;font-weight:700;color:#2563eb}
h1{margin:0;font-size:22px}
.badge{font-size:10px;font-weight:600;color:#1d4ed8;background:#eff6ff;border:1px solid #bfd4fb;border-radius:999px;padding:4px 10px;white-space:nowrap}
h2{font-size:15px;margin:26px 0 8px;padding-left:9px;border-left:3px solid #2563eb;break-after:avoid}
h3{font-size:13px;margin:14px 0 4px;break-after:avoid}
p,li{overflow-wrap:anywhere}p{margin:6px 0}ul{margin:4px 0;padding-left:20px}
.note{margin:12px 0 0;font-size:12px;color:#52647b;background:#f8fafc;border:1px solid #e3e9f2;border-radius:6px;padding:9px 12px}
.fine{font-size:11px;color:#66758c}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #dce4ef;padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#f1f5f9;font-weight:600;color:#344a67}
.kv th{width:1%;white-space:nowrap}.info{margin-top:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums}th.narrow{width:22%}td.source{font-size:11px;color:#66758c;white-space:nowrap}
tr.check td.status,td.hot{color:#c63038;font-weight:600}tr.no_candidate td.status{color:#087d57}tr.retake td.status{color:#713bc2}tr.caution td.status{color:#ad6800}
.report-table{overflow-x:auto}
.sign{width:60%;margin:26px 0 0 auto;text-align:center}.sign th{text-align:center}.sign td{height:56px}
@media(max-width:700px){.report-document{padding:20px 16px}.report-head{flex-wrap:wrap}td.source{white-space:normal}}
@media print{body{background:#fff;padding:0;font-size:11.5px}.report-document{max-width:none;border:0;box-shadow:none;border-radius:0;padding:0}.report-table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}.page-break{break-before:page}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4;margin:15mm}}`;

export function reportFile(body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SunPatch 점검 보고서 · 시뮬레이션</title><style>${REPORT_STYLE}</style></head><body>${body}</body></html>`;
}

async function loadRecords() {
  try {
    const response = await fetch('./api/inspection-history');
    return response.ok ? (await response.json()).records ?? [] : null;
  } catch { return null; }
}

export function createReport({ getSnapshot }) {
  const root = document.getElementById('report');
  root.innerHTML = '<div class="report-page-heading"><div><p class="eyebrow">INSPECTION REPORT</p><h2>점검 보고서</h2><p>점검 결과·후보 확인·점검 기록 분석을 보고서로 미리 확인하세요.</p></div><div class="report-preview-actions"><button type="button" data-report-create>현재 결과로 새로고침</button><button type="button" data-report-download>HTML 보고서 다운로드</button></div></div><p class="report-preview-status" role="status" data-report-message></p><iframe class="report-preview-frame" title="점검 보고서 미리보기" sandbox=""></iframe>';
  const frame = root.querySelector('iframe');
  let body = '';
  async function refresh() {
    const generatedAt = new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) + ' (한국 시간)';
    const records = await loadRecords();
    body = buildReport({...getSnapshot(),generatedAt,records});
    frame.srcdoc = reportFile(body);
    root.querySelector('[data-report-message]').textContent = '미리보기 생성: ' + generatedAt + ' · 생성 시점의 사본입니다. 변경 사항은 새로고침하면 반영됩니다.';
  }
  root.querySelector('[data-report-create]').onclick = refresh;
  document.addEventListener('dashboard:viewchange', event => {
    if (event.detail.id === 'report') refresh();
  });
  root.querySelector('[data-report-download]').onclick = async () => {
    if (!body) await refresh();
    const url = URL.createObjectURL(new Blob([reportFile(body)],{type:'text/html;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'sunpatch-inspection-report.html'; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    root.querySelector('[data-report-message]').textContent = '현재 미리보기와 동일한 HTML 파일 다운로드를 요청했습니다. 파일을 열어 인쇄하거나 PDF로 저장할 수 있습니다.';
  };
}
