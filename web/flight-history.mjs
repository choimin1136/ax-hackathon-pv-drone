import {cellReviewStatus} from './cell-review-status.mjs';
import {STATUS,ROUTE} from './mission.mjs';
import {createDetail} from './detail.mjs';
import {formatStarted} from './inspection-history-store.mjs';
import {createServerHistoryStore} from './server-history-store.mjs';
export function createFlightHistory({getCandidates}) {
  const store=createServerHistoryStore(()=>{renderList();if(activeId&&!current()){detail.reset();backToList();}if(activeId){showMap(activeId);detail.loadReviews(current()?.cells.flatMap(c=>c.candidates)??[]);detail.refresh(true);}document.dispatchEvent(new CustomEvent('inspection-history:review'));});
  const root=document.getElementById('activity'),list=document.getElementById('events'),columns=root.querySelector('.event-columns');
  columns.innerHTML='<span>기록 시각 · 한국 시간</span><span>종류</span><span>점검 결과</span>';
  root.classList.add('flight-history');list.setAttribute('aria-label','비행별 점검 기록, 최신순');
  const note=document.createElement('p');note.className='flight-history-note';note.textContent='서버 기록을 불러오는 중입니다.';root.append(note);
  const panel=document.createElement('div');panel.className='flight-history-map';panel.hidden=true;
  panel.innerHTML='<div class="card-heading"><button type="button" data-back>← 점검 기록</button><span data-date></span></div>';
  const surface=document.querySelector('#overview .map-surface').cloneNode(true);
  surface.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  surface.querySelector('.grid-stage svg').innerHTML='<polyline/>';
  surface.querySelector('.cell-grid').replaceChildren();
  surface.querySelector('.map-caption span span').textContent='저장된 점검 결과 · 예시';
  surface.querySelector('.map-bottom>span').textContent='비행 당시 구역 상태 · 합성 판정/이미지';
  panel.append(surface);root.insertBefore(panel,note);
  let activeId=null;
  let deleteId=null;
  const deleteDialog=document.createElement('dialog');deleteDialog.className='history-delete-dialog';
  deleteDialog.setAttribute('aria-labelledby','history-delete-title');
  deleteDialog.innerHTML='<h2 id="history-delete-title">점검 기록 삭제</h2><p data-delete-date></p><p>이 기록을 삭제하면 모든 사용자의 목록·추천 기준·분석에서 제외됩니다.</p><form method="dialog"><button value="cancel" autofocus>취소</button><button value="delete" class="history-delete-confirm">기록 삭제</button></form>';
  document.body.append(deleteDialog);
  deleteDialog.addEventListener('close',()=>{const id=deleteId;deleteId=null;if(deleteDialog.returnValue==='delete'&&id)store.remove(id);});
  const current=()=>store.list().find(r=>r.id===activeId);
  const detail=createDetail({titleId:'history-review-title',archive:true,canReview:()=>!store.saving()&&!['running','paused'].includes(current()?.phase),getCell:id=>current()?.cells.find(c=>c.cell_id===id),onChange:id=>{
    const cell=current()?.cells.find(c=>c.cell_id===id);if(!cell)return;
    store.review(activeId,id,detail.candidates(cell));renderList();showMap(activeId);
    document.dispatchEvent(new CustomEvent('inspection-history:review'));
  }});
  function drawRoute(){
    const grid=surface.querySelector('.cell-grid'),base=grid.getBoundingClientRect();
    const ids=ROUTE.filter(id=>current()?.visited.includes(id));
    const points=ids.map(id=>{const rect=grid.querySelector(`[data-cell="${id}"]`).getBoundingClientRect();return `${rect.left-base.left+rect.width/2},${rect.top-base.top+rect.height/2}`;});
    surface.querySelector('polyline').setAttribute('points',points.join(' '));
    surface.querySelector('svg').style.display=surface.querySelector('input').checked?'block':'none';
  }
  surface.querySelector('input').onchange=drawRoute;new ResizeObserver(drawRoute).observe(surface.querySelector('.cell-grid'));
  function showMap(id){
    activeId=id;const saved=current();if(!saved)return;
    surface.querySelector('.map-bottom>span').textContent=saved.kind==='selection'?'이번 비행에서 방문 완료한 구역만 표시 · 새 분석이 아닌 합성 예시':'비행 당시 구역 상태 · 합성 판정/이미지';
    list.hidden=true;columns.hidden=true;panel.hidden=false;
    panel.querySelector('[data-date]').textContent=formatStarted(saved.startedAt)+' · '+phaseLabel(saved.phase)+' · 서버 파일 생성 시각';
    const grid=surface.querySelector('.cell-grid');grid.replaceChildren();
    for(const cell of saved.cells){
      const button=document.createElement('button');button.type='button';const counts={approved:0,excluded:0,pending:0};for(const c of cell.candidates)counts[c.decision]++;const review=cellReviewStatus(cell,counts);
      button.className='cell '+review.style;button.dataset.cell=cell.cell_id;
      const unvisited=saved.kind==='selection'&&(!saved.visited.includes(cell.cell_id)||!saved.targets.includes(cell.cell_id));
      button.setAttribute('aria-label',cell.cell_id+' 기록 상세, '+(unvisited?'이번 비행 미점검 · 이미지 없음':STATUS[cell.status].label));
      button.innerHTML=`<span class="panel-lines" aria-hidden="true"></span><span class="cell-id">${cell.cell_id}</span><span class="cell-symbol" aria-hidden="true">${review.symbol}</span>`;
      button.onclick=()=>{grid.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));detail.loadReviews(current().cells.flatMap(c=>c.candidates));detail.open(cell.cell_id);};grid.append(button);
    }
    drawRoute();
  }
  function backToList(){panel.hidden=true;list.hidden=false;columns.hidden=false;activeId=null;}
  panel.querySelector('[data-back]').onclick=backToList;
  const phaseLabel=p=>({running:'진행 중',paused:'일시정지',complete:'완료',interrupted:'중단'})[p]??p;
  function renderList(){
    const records=store.list();document.getElementById('event-count').textContent=`총 ${records.length}회 · 최신순`;
    list.replaceChildren();
    if(!records.length){const li=document.createElement('li');li.className='empty-event';li.textContent='비행을 시작하면 한 번의 비행이 하나의 기록으로 저장됩니다.';list.append(li);}
    for(const r of records.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||a.id.localeCompare(b.id))){
      const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='flight-history-row';
      const time=document.createElement('time');time.dateTime=r.startedAt;time.textContent=formatStarted(r.startedAt);
      const type=document.createElement('span');type.textContent=r.kind==='selection'?'선택 점검':'전체 점검';
      const result=document.createElement('span');result.textContent=`${phaseLabel(r.phase)} · ${r.visited.length}/${r.targets.length}구역 · 2D 지도 보기`;
      button.append(time,type,result);button.onclick=()=>showMap(r.id);
      const remove=document.createElement('button');remove.type='button';remove.className='history-delete';remove.textContent='삭제';
      remove.setAttribute('aria-label',`${formatStarted(r.startedAt)} ${type.textContent} 기록 삭제`);
      remove.disabled=store.saving()||['running','paused'].includes(r.phase);
      remove.title=['running','paused'].includes(r.phase)?'진행 중인 비행 기록은 삭제할 수 없습니다.':'점검 기록 삭제';
      remove.onclick=()=>{deleteId=r.id;deleteDialog.returnValue='';deleteDialog.querySelector('[data-delete-date]').textContent=formatStarted(r.startedAt)+' · '+type.textContent;deleteDialog.showModal();};
      li.append(button,remove);list.append(li);
    }
    note.textContent=store.error()||'서버 공용 기록 · 파일 생성 시각(한국 시간) · 합성 판정/이미지 · 셀을 눌러 승인·제외';
  }
  renderList();
  store.refresh();setInterval(()=>store.refresh(),5000);
  document.addEventListener('dashboard:viewchange',()=>store.refresh());
  return {records:()=>store.list(),observe(){}};
}
