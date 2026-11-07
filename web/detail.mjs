import { createAnalysisExample } from './analysis-example.mjs';
import { cellReviewStatus } from './cell-review-status.mjs';
import {createDetailMedia} from './detail-media.mjs';
import {candidatesFor, setDecision, reviewSummary} from './review.mjs';

export function createDetail({getCell, onChange, titleId="review-title", archive=false}) {
  let reviews = {};
  let active = null;
  let highlighted = null;
  let showMask = true;
  let renderedStatus = '';
  const dialog = document.createElement('dialog');
  dialog.className = 'detail-dialog';
  dialog.innerHTML = `<header><div><p class="eyebrow">시뮬레이션 · 합성 예시</p><h2 id="${titleId}">구역 상세</h2></div><button type="button" data-close aria-label="상세 창 닫기">닫기 ×</button></header><p class="review-disclaimer">합성 사진과 별도의 합성 마스크를 겹쳐 보여줍니다. 실제 촬영 사진·AI 예측 결과·정답 라벨이 아닙니다.</p><div class="review-layout"><section><div class="review-toolbar"><label><input type="checkbox" data-mask checked> 결함 영역 표시</label><span>640 × 512 · 예시</span></div><div data-image class="review-image"></div><p data-empty></p></section><section><div data-analysis></div><h3>후보 확인 기록</h3><p data-review-status role="status"></p><p data-summary></p><div data-candidates></div><p class="review-disclaimer">확인 결과는 이 브라우저의 메모리에만 저장됩니다. 새로고침하거나 미션을 다시 시작하면 초기화됩니다.</p></section></div>`;
  dialog.setAttribute('aria-labelledby',titleId);
  if(archive) dialog.querySelector('.review-layout section:last-child>.review-disclaimer').textContent='이 비행 기록에만 저장됩니다. 현재 점검 결과에는 영향을 주지 않습니다.';
  document.body.append(dialog);
  const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./detail-media.css',import.meta.url).href;document.head.append(style);
  const analysis=createAnalysisExample({host:dialog.querySelector('[data-analysis]'),onChange:()=>render()});
  function updateControls() {
    const usable=media.ready() && analysis.ready();
    dialog.querySelectorAll('[data-candidates] button').forEach(button=>button.disabled=!usable);
    dialog.querySelector('[data-candidates]').hidden=!analysis.ready();
    media.display(showMask && analysis.ready(),highlighted);
  }
  const media=createDetailMedia({host:dialog.querySelector('[data-image]'),onReady:()=>updateControls()});
  dialog.addEventListener('close',()=>{media.close();analysis.close();});
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('[data-mask]').onchange = e => {showMask = e.target.checked; renderImage();};
  function renderImage() {
    const cell=getCell(active);
    media.setCell(cell,cell?candidatesFor(cell):[]);
    media.display(showMask && analysis.ready(),highlighted);
  }
  function render() {
    const cell = getCell(active);
    if (!cell) return;
    renderedStatus = `${cell.cell_id}:${cell.status}:${cell.candidate_count}`;
    dialog.querySelector('h2').textContent = `${active} 구역 상세`;
    analysis.setCell(cell);
    const counts = reviewSummary(cell,reviews);
    dialog.querySelector('[data-review-status]').textContent = '현재 셀 상태: '+cellReviewStatus(cell,counts).label;
    dialog.querySelector('[data-summary]').textContent = `승인 ${counts.approved} · 제외 ${counts.excluded} · 미확인 ${counts.pending}`;
    dialog.querySelector('[data-empty]').textContent = cell.status === 'pending' ? '점검이 완료되면 예시 이미지와 후보를 볼 수 있습니다.' : cell.status === 'retake' ? '사진 전송 실패 예시입니다. 재촬영이 필요합니다.' : !cell.candidate_count ? '탐지된 후보가 없습니다. 안전을 보증하는 결과는 아닙니다.' : '후보 번호를 누르면 해당 영역이 강조됩니다.';
    const list = dialog.querySelector('[data-candidates]');
    list.replaceChildren();
    (analysis.result()?.candidates ?? []).forEach((candidate,index)=>{
      const item = document.createElement('article');
      item.className='review-candidate';
      const select = document.createElement('button');
      select.textContent=`후보 ${index+1} · ${candidate.area_px} px² (예시)`;
      select.setAttribute('aria-pressed',String(highlighted===candidate.id));
      select.onclick=()=>{highlighted=candidate.id;render();};
      item.append(select);
      const actions=document.createElement('div');
      for(const [value,label] of [['approved','승인'],['excluded','제외'],['pending','미확인']]) {
        const button=document.createElement('button');
        button.type='button';button.textContent=label;
        button.setAttribute('aria-label',`후보 ${index+1} ${label}`);
        button.setAttribute('aria-pressed',String((reviews[candidate.id]??'pending')===value));
        button.onclick=()=>{reviews=setDecision(reviews,cell,candidate.id,value);onChange(active,reviewSummary(cell,reviews));render();};
        actions.append(button);
      }
      item.append(actions);list.append(item);
    });
    renderImage();
    updateControls();
  }
  return {
    loadReviews(candidates) { reviews=Object.fromEntries(candidates.map(c=>[c.id,c.decision])); },
    open(id) {analysis.close();media.close();active=id;highlighted=null;render();dialog.showModal();},
    refresh() {
      const cell=getCell(active);
      if(dialog.open && cell && renderedStatus!==`${cell.cell_id}:${cell.status}:${cell.candidate_count}`) render();
    },
    candidates(cell) { return candidatesFor(cell).map(c=>({...c,cell_id:cell.cell_id,decision:reviews[c.id]??'pending'})); },
    summary(cell) {return reviewSummary(cell,reviews);},
    reset() {analysis.close();media.close();reviews={};if(dialog.open) dialog.close();}
  };
}
