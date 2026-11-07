import { syntheticAssets, loadGeneration } from './detail-assets.mjs';
export function createDetailMedia({host,onReady}) {
  const generation = loadGeneration();
  let cell, candidates=[], key='', mode='normal', ready=false;
  let highlighted=null, showMask=true, timer;
  host.innerHTML = `<div class="media-controls"><label>합성 화면 시험 <select aria-label="합성 화면 시험"><option value="normal">정상 로딩</option><option value="slow">느린 로딩</option><option value="photo-error">사진 실패</option><option value="mask-error">마스크 실패</option></select></label><button type="button" data-retry>다시 불러오기</button></div><p role="status" data-media-status></p><div class="media-stage" hidden><img data-photo alt="실제 촬영 사진이 아닌 합성 열화상 예시"><img data-overlay alt="합성 예시 마스크 · AI 예측 및 정답 라벨 아님"><svg data-highlight viewBox="0 0 640 512" aria-hidden="true"></svg></div>`;
  const stage=host.querySelector('.media-stage'), photo=host.querySelector('[data-photo]'), mask=host.querySelector('[data-overlay]');
  const status=host.querySelector('[data-media-status]'), retry=host.querySelector('[data-retry]'), select=host.querySelector('select');
  const decode = async src => { const image=new Image(); image.src=src; await image.decode(); return image; };
  function overlays() {
    mask.hidden=!showMask || !mask.getAttribute('src');
    const svg=host.querySelector('[data-highlight]'); svg.replaceChildren();
    const candidate=candidates.find(c=>c.id===highlighted);
    if (!showMask || !candidate) return;
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    ['x','y','width','height'].forEach((name,i)=>rect.setAttribute(name,candidate.bbox[i]));
    rect.setAttribute('fill','none');rect.setAttribute('stroke','white');rect.setAttribute('stroke-width','4');svg.append(rect);
  }
  function cancel() { generation.next(); clearTimeout(timer); }
  async function load() {
    cancel(); const token=generation.next(); ready=false; stage.hidden=true;
    photo.removeAttribute('src');mask.removeAttribute('src');onReady(false);
    const available=cell && !['pending','retake'].includes(cell.status);
    retry.disabled=!available;select.disabled=!available;
    if(!available) { status.textContent=cell?.status==='retake'?'사진 없음 · 재촬영 필요 예시입니다.':'점검 대기 · 아직 이미지가 없습니다.';host.setAttribute('aria-busy','false');return; }
    status.textContent='합성 사진과 마스크를 불러오는 중…';host.setAttribute('aria-busy','true');
    timer=setTimeout(async()=>{
      if(!generation.current(token))return;
      const assets=syntheticAssets(candidates);
      try {
        if(mode==='photo-error')throw new Error('demo');
        await decode(assets.photo); if(!generation.current(token))return;
        photo.src=assets.photo;stage.hidden=false;ready=true;onReady(true);
      } catch {
        if(!generation.current(token))return;
        status.textContent='사진을 불러오지 못했습니다 · 실패 시뮬레이션. 정상 로딩으로 바꾸거나 다시 시도하세요.';
        host.setAttribute('aria-busy','false');return;
      }
      try {
        if(mode==='mask-error')throw new Error('demo');
        await decode(assets.mask);if(!generation.current(token))return;
        mask.src=assets.mask;
        status.textContent=candidates.length?'합성 사진·마스크 표시 완료 · 실제 사진/AI 결과/정답 라벨 아님':'합성 사진 표시 완료 · 예시 후보 없음. 안전을 보증하지 않습니다.';
      } catch {
        if(!generation.current(token))return;
        status.textContent='마스크를 불러오지 못했습니다 · 합성 원본만 표시합니다. 정상 로딩으로 바꿔 재시도하세요.';
      }
      overlays();host.setAttribute('aria-busy','false');
    },mode==='slow'?2500:350);
  }
  select.onchange=()=>{mode=select.value;load();}; retry.onclick=()=>load();
  return {
    setCell(next,list) {const nextKey=JSON.stringify([next?.cell_id,next?.status,list]);if(nextKey===key)return;key=nextKey;cell=next;candidates=list;mode='normal';select.value=mode;load();},
    display(show,id) {showMask=show;highlighted=id;overlays();},
    close() {cancel();key='';ready=false;},
    ready:()=>ready
  };
}
