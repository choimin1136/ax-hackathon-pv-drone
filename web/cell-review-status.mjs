import { STATUS } from './mission.mjs';

// Human review status is separate from the original detection and flight state.
export function cellReviewStatus(cell, counts) {
  if (['pending','retake'].includes(cell.status) || !cell.candidate_count) {
    return { key:cell.status,label:STATUS[cell.status].label,style:cell.status,symbol:STATUS[cell.status].symbol,action:STATUS[cell.status].action };
  }
  if (counts.pending > 0) return {key:'review_pending',label:'미확인 후보 있음',style:cell.status,symbol:'?',action:`미확인 후보 ${counts.pending}개를 확인하세요. 승인 ${counts.approved}개 · 제외 ${counts.excluded}개.`};
  if (counts.approved > 0) return {key:'approved',label:'승인 후보 있음',style:cell.status,symbol:'!',action:`후보 ${counts.approved}개를 승인했습니다. 근거를 바탕으로 재점검·정비 여부를 판단하세요.`};
  return {key:'excluded',label:'후보 모두 제외',style:'excluded',symbol:'−',action:'탐지 후보를 모두 제외했습니다. 탐지 결과를 삭제하거나 안전을 보증한 것은 아닙니다. 필요하면 미확인으로 되돌리세요.'};
}

export function summarizeReview(cells, getCounts) {
  const states=cells.map(cell=>cellReviewStatus(cell,getCounts(cell)));
  return {
    unresolved:states.filter(s=>s.key==='review_pending').length,
    approved:states.filter(s=>s.key==='approved').length,
    excluded:states.filter(s=>s.key==='excluded').length
  };
}

export function renderReviewStates({cells,getCounts,selected}) {
  const summary=summarizeReview(cells,getCounts);
  document.getElementById('review-count').textContent=summary.unresolved+summary.approved;
  document.getElementById('review-count').closest('.metric').querySelector('.metric-note').textContent='미확인 또는 승인 후보가 있는 구역';
  let note=document.getElementById('human-review-summary');
  if(!note) {
    note=document.createElement('p');note.id='human-review-summary';note.setAttribute('role','status');
    note.style.cssText='font-size:12px;line-height:1.8;color:#54695d';
    document.querySelector('.map-help').after(note);
  }
  note.textContent=`사람 확인 기준 · 미확인 ${summary.unresolved}구역 · 승인 후보 있음 ${summary.approved}구역 · 후보 모두 제외 ${summary.excluded}구역. 색상은 원래 탐지 등급이며 모두 제외는 회색입니다.`;
  const buttons=document.querySelectorAll('#cell-grid button');
  cells.forEach((cell,index)=>{
    const status=cellReviewStatus(cell,getCounts(cell));const button=buttons[index];
    if(button && !button.classList.contains('active')) {
      button.className=`cell ${status.style}`;
      button.setAttribute('aria-label',`${cell.cell_id} 구역, ${status.label}, 원래 탐지 ${STATUS[cell.status].label}`);
      button.querySelector('.cell-symbol').textContent=status.symbol;
    }
    if(cell.cell_id===selected && !button?.classList.contains('active')) {
      const badge=document.getElementById('detail-status');badge.className=`status-badge ${status.style}`;badge.textContent=status.label;
      document.getElementById('detail-action').textContent=status.action;
      document.querySelector('.detail-foot').textContent=`원래 탐지: ${STATUS[cell.status].label} · 사람 확인은 현재 미션에만 저장됩니다.`;
    }
  });
}
