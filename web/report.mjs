import { cellReviewStatus, summarizeReview } from './cell-review-status.mjs';
import { STATUS, summarize } from './mission.mjs';
import { calculateValue } from './value.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', {maximumFractionDigits:2}) : '미입력/유효하지 않음';
const labels = {approved:'승인',excluded:'제외',pending:'미확인'};
export function buildReport({ mission, candidates, assumptions, generatedAt }) {
  const summary = summarize(mission);
  const counts = cell => {
    const approved=candidates.filter(c=>c.cell_id===cell.cell_id && c.decision==='approved').length;
    const excluded=candidates.filter(c=>c.cell_id===cell.cell_id && c.decision==='excluded').length;
    return {approved,excluded,pending:Math.max(0,cell.candidate_count-approved-excluded)};
  };
  const human=summarizeReview(mission.cells,counts);
  const value = calculateValue(mission.cells, assumptions);
  const rows = mission.cells.map(c => `<tr><td>${escape(c.cell_id)}</td><td>${escape(STATUS[c.status]?.label || c.status)}</td><td>${escape(cellReviewStatus(c,counts(c)).label)}</td><td>${c.candidate_count}</td><td>${candidates.filter(x => x.cell_id === c.cell_id && x.decision === 'approved').length}</td></tr>`).join('');
  const candidateRows = candidates.map(c => `<tr><td>${escape(c.cell_id)}</td><td>${escape(c.id)}</td><td>${escape(labels[c.decision] || '미확인')}</td><td>${number(c.area_px)} px² (예시)</td></tr>`).join('');
  const fields = [['capacity','구역당 용량','kW'],['utilization','이용률','%'],['price','판매 단가','원/kWh'],['carbon','탄소 계수','kgCO₂e/kWh'],['repair','구역당 수리비','원'],['low','저하율 낮음','%'],['base','저하율 기준','%'],['high','저하율 높음','%']];
  const estimate = value.error ? `<p>추정 계산 불가: ${escape(value.error)}</p>` : !value.ids.length ? '<p>확인 후 계산 · 승인한 후보가 있는 구역이 없습니다.</p>' : `<p>계산 대상 ${value.ids.length}곳: ${value.ids.map(escape).join(', ')} · 총 수리비 가정 ${number(value.cost)}원</p><div class="report-table"><table><thead><tr><th>가정 · 추정</th><th>전력 (kWh/년)</th><th>금전 (원/년)</th><th>탄소 (kgCO₂e/년)</th><th>회수 기간 (년)</th></tr></thead><tbody>${value.scenarios.map(s => `<tr><td>${{low:'낮음',base:'기준',high:'높음'}[s.key]}</td><td>${number(s.energy)}</td><td>${number(s.money)}</td><td>${number(s.carbon)}</td><td>${s.payback === null ? '계산 불가 · 연간 금전 0원' : number(s.payback)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<article class="report-document"><h1>태양광 점검 보고서 초안</h1><p><strong>시뮬레이션 · 합성 데이터 · 검토용</strong></p><p>생성 시각: ${escape(generatedAt)} · 생성 당시 결과를 고정한 사본입니다.</p><p>실제 촬영 사진·AI 예측·정답 라벨·실기체 비행 결과가 아닙니다. 후보 승인은 사용자의 예시 확인 기록이며 전문 점검을 대체하지 않습니다.</p>
    <h2>1. 점검 결과</h2><p>${mission.phase === 'complete' ? '전체 점검 완료' : '부분 결과 · 전체 점검 미완료'} · 진행 ${summary.completed}/${mission.cells.length}구역 · 탐지된 후보 없음 ${summary.clear} · 원래 탐지 확인 필요 ${summary.review} · 재촬영 필요 ${summary.retake}</p><p>사람 확인 기준: 미확인 ${human.unresolved}구역 · 승인 후보 있음 ${human.approved}구역 · 후보 모두 제외 ${human.excluded}구역</p><p>탐지된 후보 없음은 안전을 보증하지 않습니다. 재비행 시뮬레이션은 새 분석 결과를 만들지 않아 아래 원래 점검 상태를 유지합니다.</p><div class="report-table"><table><thead><tr><th>구역</th><th>원래 탐지 상태</th><th>현재 사람 확인 상태</th><th>후보 수</th><th>승인 수</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>2. 후보별 사람 확인 기록</h2><p>승인 ${candidates.filter(c=>c.decision==='approved').length}개 · 제외 ${candidates.filter(c=>c.decision==='excluded').length}개 · 미확인 ${candidates.filter(c=>c.decision==='pending').length}개</p>${candidateRows ? `<div class="report-table"><table><thead><tr><th>구역</th><th>후보 ID</th><th>확인 결과</th><th>예시 면적</th></tr></thead><tbody>${candidateRows}</tbody></table></div>` : '<p>현재 확인할 후보가 없습니다. 점검 미완료 구역을 안전하다고 판단할 수 없습니다.</p>'}
    <h2>3. 금전·공공 가치 추정</h2>${estimate}<h3>계산에 사용한 가정값</h3><ul>${fields.map(([key,label,unit])=>`<li>${label}: ${number(assumptions[key])} ${unit}</li>`).join('')}</ul>
    <h3>계산 근거와 한계</h3><p>연간 회수 가능 전력량 = 승인 구역 수 × 구역당 용량 × 8,760시간 × 이용률/100 × 출력 저하율/100<br>연간 금전 가치 = 전력량 × 판매 단가<br>탄소 감축 잠재량 = 전력량 × 탄소 계수<br>단순 수리비 회수 기간 = 승인 구역 수 × 구역당 수리비 ÷ 연간 금전 가치</p><p>동일 구역은 한 번만 계산합니다. 기본값은 시연용이며 실제 단가·공식 탄소 계수가 아닙니다. 수리 후 가정한 손실을 모두 회수할 때의 잠재 가치입니다. 낮음·기준·높음은 가정별 시나리오이며 통계적 신뢰구간이 아닙니다. 유지비·금융비용·할인율은 제외했고 실제 수익·감축 실적을 보장하지 않습니다.</p><h2>4. 다음 확인 사항</h2><p>미확인 후보는 근거 사진으로 검토하고, 재촬영 필요 구역은 사진을 확보하세요. 승인 후보의 정비 여부와 실제 계산 계수는 담당자가 확인해야 합니다.</p></article>`;
}
export const REPORT_STYLE = `body{font-family:system-ui,"Malgun Gothic",sans-serif;color:#203832;margin:24px;line-height:1.7}.report-document{max-width:1000px;margin:auto}.report-document h1{font-size:26px}.report-document h2{font-size:20px;margin-top:32px}.report-document table{width:100%;border-collapse:collapse;font-size:13px}.report-document th,.report-document td{border:1px solid #b9c8be;padding:8px;text-align:left;overflow-wrap:anywhere}.report-document th{background:#edf4eb}.report-table{overflow-x:auto}.report-document p{overflow-wrap:anywhere}@media print{body{margin:0;color:#000}.report-table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}@page{size:A4;margin:14mm}}`;
export function reportFile(body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>태양광 점검 보고서 · 시뮬레이션</title><style>${REPORT_STYLE}</style></head><body>${body}</body></html>`;
}
export function createReport({ getSnapshot }) {
  const root = document.getElementById('report');
  root.innerHTML = '<div class="report-page-heading"><div><p class="eyebrow">INSPECTION REPORT</p><h2>점검 보고서</h2><p>점검 결과·후보 확인·점검 분석을 보고서로 미리 확인하세요.</p></div><div class="report-preview-actions"><button type="button" data-report-create>현재 결과로 새로고침</button><button type="button" data-report-download>HTML 보고서 다운로드</button></div></div><p class="report-preview-status" role="status" data-report-message></p><iframe class="report-preview-frame" title="점검 보고서 미리보기" sandbox=""></iframe>';
  const frame = root.querySelector('iframe');
  let body = '';
  function refresh() {
    const generatedAt = new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) + ' (한국 시간)';
    body = buildReport({...getSnapshot(),generatedAt});
    frame.srcdoc = reportFile(body);
    root.querySelector('[data-report-message]').textContent = '미리보기 생성: ' + generatedAt + ' · 생성 시점의 사본입니다. 변경 사항은 새로고침하면 반영됩니다.';
  }
  root.querySelector('[data-report-create]').onclick = refresh;
  document.addEventListener('dashboard:viewchange', event => {
    if (event.detail.id === 'report') refresh();
  });
  root.querySelector('[data-report-download]').onclick = () => {
    if (!body) refresh();
    const url = URL.createObjectURL(new Blob([reportFile(body)],{type:'text/html;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'solar-inspection-report.html'; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    root.querySelector('[data-report-message]').textContent = '현재 미리보기와 동일한 HTML 파일 다운로드를 요청했습니다. 파일을 열어 인쇄하거나 PDF로 저장할 수 있습니다.';
  };
}
