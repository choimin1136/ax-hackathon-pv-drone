import { syntheticAssets } from './detail-assets.mjs';
import { candidatesFor } from './review.mjs';
import { STATUS } from './mission.mjs';

const STORE_KEY = 'side-cards-collapsed';

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}
function saveCollapsed(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

// Each right-column card folds down to its heading; the choice is remembered in this browser only.
export function makeCollapsible(card, heading, name) {
  const saved = loadCollapsed();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'collapse-toggle';
  button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  heading.classList.add('collapse-head');
  heading.append(button);
  const set = collapsed => {
    card.dataset.collapsed = String(collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${heading.querySelector('h3')?.textContent ?? ''} ${collapsed ? '펼치기' : '접기'}`);
    button.title = collapsed ? '펼치기' : '접기';
  };
  set(Boolean(saved[name]));
  button.addEventListener('click', () => {
    const collapsed = card.dataset.collapsed !== 'true';
    set(collapsed);
    saveCollapsed({ ...loadCollapsed(), [name]: collapsed });
  });
}

// Shows the thermal image of the cell the drone reached last: the hotspot model's overlay when the server has a result,
// otherwise a code-generated example image (never a drone photo).
export function createThermalCard({ onOpen }) {
  const card = document.createElement('section');
  card.className = 'thermal-card';
  card.setAttribute('aria-label', '최근 촬영 열화상');
  card.innerHTML = `<div class="sitl-log-title"><h3>촬영 이미지</h3><span data-source>합성 예시</span></div>
    <button class="thermal-frame" type="button" disabled><span class="thermal-shot"><img data-photo alt=""><img data-mask alt="" aria-hidden="true"></span><span class="thermal-empty">드론이 구역에 도착하면 열화상이 표시됩니다.</span></button>
    <p class="thermal-caption" role="status"></p>`;
  const frame = card.querySelector('.thermal-frame'), photo = card.querySelector('[data-photo]'), mask = card.querySelector('[data-mask]');
  const caption = card.querySelector('.thermal-caption'), source = card.querySelector('[data-source]'), empty = card.querySelector('.thermal-empty');
  let shown = '', cellId = null;
  frame.addEventListener('click', () => { if (cellId) onOpen(cellId); });

  function clear(text) {
    photo.removeAttribute('src'); mask.removeAttribute('src');
    card.classList.remove('has-image');
    empty.textContent = text;
    frame.disabled = true; cellId = null; frame.removeAttribute('aria-label');
  }
  function show(cell, prediction = null) {
    const ready = cell && !['pending', 'retake'].includes(cell.status);
    const model = ready && prediction?.state === 'ready' && prediction.data.output ? prediction.data : null;
    const loading = cell && !ready && prediction?.state === 'loading';
    const key = model ? `model:${cell.cell_id}` : ready ? `${cell.cell_id}:${cell.status}:${cell.candidate_count}` : loading ? `loading:${cell.cell_id}` : '';
    if (key === shown) return;
    shown = key;
    caption.dataset.status = ready ? cell.status : '';
    if (loading) { clear(`${cell.cell_id} 열화상을 모델로 분석하는 중입니다…`); caption.textContent = `${cell.cell_id} · 분석 중`; return; }
    if (!ready) { clear('드론이 구역에 도착하면 열화상이 표시됩니다.'); caption.textContent = ''; return; }
    cellId = cell.cell_id;
    frame.disabled = false;
    card.classList.add('has-image');
    frame.setAttribute('aria-label', `${cell.cell_id} 구역 상세 열기`);
    const label = STATUS[cell.status]?.label ?? '';
    if (model) {
      photo.src = model.output;
      mask.removeAttribute('src');
      photo.alt = `${cell.cell_id} 구역 열화상과 모델이 표시한 핫스팟 영역`;
      source.textContent = '모델 결과';
      caption.textContent = `${cell.cell_id} · ${label} · 점수 ${model.probability.toFixed(2)}${model.calibrated ? '' : ' (보정 전)'} · 영역 ${model.regions.length}곳 · 누르면 상세`;
      return;
    }
    const assets = syntheticAssets(candidatesFor(cell));
    photo.src = assets.photo;
    mask.src = assets.mask;
    photo.alt = `${cell.cell_id} 구역의 합성 열화상 예시`;
    source.textContent = '합성 예시';
    caption.textContent = `${cell.cell_id} · ${label}${cell.candidate_count ? ` · 후보 ${cell.candidate_count}개` : ''} · 누르면 상세`;
  }
  return { element: card, show };
}
