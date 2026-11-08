// "점검 인사이트" on the inspection analysis page, above the power comparison. The first two cards use the saved
// inspection records; the weather card uses made-up forecasts (the contest rules exclude weather data).
import { TREND_RUNS, cellTrends, priorityCells, weatherWeek } from './analysis-insights.mjs';

const root = document.getElementById('value-results');
const section = document.createElement('section');
section.className = 'analysis-preview';
section.setAttribute('aria-label', '점검 인사이트');
section.innerHTML = `<div class="analysis-preview-head"><h3>점검 인사이트</h3><p>점검 기록으로 정비 순서와 다음 점검일을 정합니다. 결과는 참고용입니다.</p></div>
  <div class="analysis-preview-grid">
    <article class="preview-card"><span class="preview-chip">점검 기록 기반</span><h4>정비 우선순위</h4><div data-priority></div><p class="preview-note">최근 전체 점검의 핫스팟 구역. 승인한 후보가 있는 구역을 먼저, 그다음 후보 면적×점수 순</p></article>
    <article class="preview-card"><span class="preview-chip">점검 기록 기반</span><h4>구역 이력·재발</h4><div data-trend></div><p class="preview-note">최근 점검 ${TREND_RUNS}회의 구역별 판정. 두 번 이상 탐지된 구역은 재발로 표시</p></article>
    <article class="preview-card"><span class="preview-chip">기상 · 더미</span><h4>기상 연계 점검일</h4><div data-weather></div><p class="preview-note">맑고 바람이 약한 날을 추천. 실제 기상 데이터가 아닙니다</p></article>
  </div>`;
// Sits above the power comparison; falls back to the end of the page if that block is missing.
const comparison = root.querySelector('.energy-comparison');
if (comparison) comparison.before(section); else root.append(section);

const formatDay = date => `${date.getMonth() + 1}/${date.getDate()} ${'일월화수목금토'[date.getDay()]}`;
const formatRun = record => { const d = new Date(record.startedAt); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const empty = text => `<p class="preview-empty">${text}</p>`;

function renderPriority(records) {
  const { record, rows } = priorityCells(records);
  const host = section.querySelector('[data-priority]');
  if (!record) { host.innerHTML = empty('완료된 전체 점검 기록이 아직 없습니다.'); return; }
  if (!rows.length) { host.innerHTML = empty(`${formatRun(record)} 점검에서 핫스팟 구역이 없었습니다.`); return; }
  host.innerHTML = `<ol class="priority-list">${rows.map(row => `<li><b>${row.cell_id}</b><span>${row.approved ? `승인 ${row.approved}` : `미확인 ${row.candidates}`} · 최대 ${row.largest}px²</span></li>`).join('')}</ol><p class="preview-meta">기준: ${formatRun(record)} 전체 점검</p>`;
}

function renderTrend(records) {
  const { runs, rows } = cellTrends(records);
  const host = section.querySelector('[data-trend]');
  if (!runs.length) { host.innerHTML = empty('완료된 점검 기록이 아직 없습니다.'); return; }
  if (!rows.length) { host.innerHTML = empty(`최근 ${runs.length}회 점검에서 탐지된 구역이 없습니다.`); return; }
  const label = { check: '탐지', no_candidate: '없음', pending: '대기' };
  host.innerHTML = `<table class="trend-table"><thead><tr><th>구역</th>${runs.map(r => `<th title="${formatRun(r)}">${formatRun(r).split(' ')[0]}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 6).map(row => `<tr><th>${row.cell_id}${row.hits > 1 ? ' <em>재발</em>' : ''}</th>${row.marks.map(m => `<td><i class="trend-mark ${m ?? 'skip'}" title="${m ? label[m] ?? m : '방문 안 함'}"></i></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderWeather() {
  const { days, best } = weatherWeek();
  section.querySelector('[data-weather]').innerHTML = `<ul class="weather-row">${days.map(day => `<li class="${day === best ? 'best' : ''}"><span>${formatDay(day.date)}</span><b>${day.sky}</b><small>바람 ${day.wind}m/s</small></li>`).join('')}</ul>${best ? `<p class="preview-meta">추천: ${formatDay(best.date)} · ${best.sky}, 바람 ${best.wind}m/s</p>` : ''}`;
}

// Records come from the shared history store (inspection-history:review) instead of a second request of their own.
// The weather card needs no records, so it is drawn first.
let latest = null;
function render() {
  renderWeather();
  const priority = section.querySelector('[data-priority]'), trend = section.querySelector('[data-trend]');
  if (!latest) { priority.innerHTML = trend.innerHTML = empty('점검 기록을 불러오는 중입니다…'); return; }
  if (latest.error && !latest.records.length) { priority.innerHTML = trend.innerHTML = empty(latest.error); return; }
  renderPriority(latest.records); renderTrend(latest.records);
}
const receive = event => {
  if (event.detail?.records) latest = { records: event.detail.records, error: event.detail.error ?? '' };
  render();
};
document.addEventListener('inspection-history:review', receive);
document.addEventListener('inspection-history:records', receive);
document.addEventListener('dashboard:viewchange', event => { if (event.detail.id === 'value-results') render(); });
render();
document.dispatchEvent(new CustomEvent('inspection-history:request'));
