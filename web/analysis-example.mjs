import { candidatesFor } from './review.mjs';

// Bundled fallback snapshots: synthetic demo v1, not previous real model responses.
const counts = {'A-3':1,'B-2':3,'B-5':2,'C-4':4,'D-1':1,'D-3':2,'D-5':3};
const saved = new Map(['A','B','C','D'].flatMap(row=>Array.from({length:6},(_,i)=>`${row}-${i+1}`))
  .filter(id=>id!=='C-6').map(id=>[id,{cell_id:id,version:'synthetic-demo-v1',source:'bundled-synthetic',candidates:candidatesFor({cell_id:id,candidate_count:counts[id]??0})}]));

export function exampleAnalysis(cell, mode='normal') {
  if (!cell || ['pending','retake'].includes(cell.status)) return {state:'unavailable',result:null};
  if (mode==='normal') return {state:'success',result:{cell_id:cell.cell_id,version:'synthetic-demo-v1',source:'simulated-analysis',candidates:candidatesFor(cell)}};
  const record=saved.get(cell.cell_id);
  if (mode==='fallback' && record && record.candidates.length===cell.candidate_count) return {state:'fallback',result:structuredClone(record)};
  return {state:'failed',result:null};
}

export function createAnalysisExample({host,onChange}) {
  let cell, key='', request=0, timer, outcome={state:'unavailable',result:null};
  host.innerHTML=`<fieldset><legend>분석 장애 시험 · 합성 데이터</legend><label>분석 시험 <select aria-label="분석 시험"><option value="normal">정상 분석 예시</option><option value="fallback">분석 실패 · 저장 예시 있음</option><option value="missing">분석 실패 · 저장 예시 없음</option></select></label> <button type="button" data-analysis-retry>분석 다시 시도</button><p data-analysis-status role="status"></p><p>실제 모델 호출이 아닙니다. 저장 예시는 앱에 포함한 합성 후보이며 실제 과거 분석 결과가 아닙니다. 기존 확인 기록은 유지됩니다.</p></fieldset>`;
  const select=host.querySelector('select'),retry=host.querySelector('button'),status=host.querySelector('[data-analysis-status]');
  function stop() {request++;clearTimeout(timer);}
  function start() {
    stop();const current=request;
    const available=cell&&!['pending','retake'].includes(cell.status);
    select.disabled=!available;retry.disabled=!available;
    outcome={state:available?'loading':'unavailable',result:null};
    host.setAttribute('aria-busy',String(available));
    status.textContent=available?'분석 응답 대기 중 · 합성 시뮬레이션':'사진이 준비되지 않아 분석 예시를 표시할 수 없습니다.';
    if(available) timer=setTimeout(()=>{
      if(current!==request)return;
      outcome=exampleAnalysis(cell,select.value);
      host.setAttribute('aria-busy','false');
      status.textContent=outcome.state==='success'?'정상 분석 예시 · 합성 후보 표시 중':outcome.state==='fallback'?'분석 실패 · 저장된 합성 결과로 대체했습니다. 출처: 앱 포함 예시 / synthetic-demo-v1. 최신 분석 성공이 아닙니다.':'분석 실패 · 일치하는 저장 예시가 없습니다. 후보·마스크를 표시하지 않습니다. 정상 분석 예시로 전환해 재시도하세요.';
      onChange();
    },700);
  }
  select.onchange=()=>{start();onChange();};retry.onclick=()=>{start();onChange();};
  return {
    setCell(next) {const signature=JSON.stringify([next?.cell_id,next?.status,next?.candidate_count,next?.model]);if(signature===key)return;key=signature;cell=next;select.value='normal';start();},
    result:()=>outcome.result,
    ready:()=>['success','fallback'].includes(outcome.state),
    close() {stop();key='';outcome={state:'unavailable',result:null};}
  };
}
