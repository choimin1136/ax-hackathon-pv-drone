import { syntheticAssets, loadGeneration } from './detail-assets.mjs';
export function createDetailMedia({host,onReady}) {
  const generation = loadGeneration();
  let cell, candidates=[], key='', mode='normal', ready=false;
  let highlighted=null, showMask=true, timer;
  host.innerHTML = `<div class="media-controls"><label>합성 화면 시험 <select aria-label="합성 화면 시험"><option value="normal">정상 로딩</option><option value="slow">느린 로딩</option><option value="photo-error">사진 실패</option><option value="mask-error">마스크 실패</option></select></label><button type="button" data-retry>다시 불러오기</button></div><p role="status" data-media-status></p><div class="media-stage" hidden><img data-photo alt="실제 촬영 사진이 아닌 합성 열화상 예시"><img data-overlay alt="합성 예시 마스크 · AI 예측 및 정답 라벨 아님"><svg data-highlight viewBox="0 0 640 512" aria-hidden="true"></svg></div>`;
  const stage=host.querySelector('.media-stage'), photo=host.querySelector('[data-photo]'), mask=host.querySelector('[data-overlay]');
  const status=host.querySelector('[data-media-status]'), retry=host.querySelector('[data-retry]'), select=host.querySelector('select');
  const decode = async src => { const image=new Image(); image.src=src; await image.decode(); return image; };
  const box=(svg,bbox,color,width,pad=0)=>{
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    [bbox[0]-pad,bbox[1]-pad,bbox[2]+pad*2,bbox[3]+pad*2].forEach((value,i)=>rect.setAttribute(['x','y','width','height'][i],value));
    rect.setAttribute('fill','none');rect.setAttribute('stroke',color);rect.setAttribute('stroke-width',width);svg.append(rect);
  };
  function overlays() {
    mask.hidden=!showMask || !mask.getAttribute('src');
    const svg=host.querySelector('[data-highlight]'); svg.replaceChildren();
    const candidate=candidates.find(c=>c.id===highlighted);
    // Model regions are often a few pixels wide, so every box is drawn with a margin to stay visible.
    if (cell?.model) for (const c of candidates) if (c!==candidate) box(svg,c.bbox,'#00e5ff',2,3);
    if (!showMask && !cell?.model || !candidate) return;
    box(svg,candidate.bbox,'white',4,cell?.model?5:0);
  }
  // A cell judged by the hotspot model shows its real photo; the overlay is the model's painted result image.
  async function loadModel(token) {
    const name=encodeURIComponent(cell.model.photo), overlay=cell.model.overlay ?? `./api/overlay?name=${encodeURIComponent(cell.model.photo)}`, [w,h]=cell.model.image_size??[640,512];
    host.querySelector('.media-controls').hidden=true;
    host.querySelector('[data-highlight]').setAttribute('viewBox',`0 0 ${w} ${h}`);
    photo.alt=`${cell.cell_id} 구역 열화상 사진`;mask.alt='핫스팟 모델이 표시한 결과 이미지';
    status.textContent='모델 결과 사진을 불러오는 중…';host.setAttribute('aria-busy','true');
    try {
      await decode(`./api/photo?name=${name}`); if(!generation.current(token))return;
      photo.src=`./api/photo?name=${name}`;stage.hidden=false;ready=true;onReady(true);
    } catch {
      if(!generation.current(token))return;
      status.textContent='사진을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.';
      host.querySelector('.media-controls').hidden=false;select.disabled=true;
      host.setAttribute('aria-busy','false');return;
    }
    try { await decode(overlay); if(!generation.current(token))return; mask.src=overlay; } catch {}
    status.textContent=candidates.length?`모델 결과 · 하늘색 상자 ${candidates.length}곳이 모델이 찾은 영역입니다. 결함 영역 표시를 켜면 모델 결과 이미지를 겹칩니다.`:'모델 결과 · 핫스팟을 찾지 못했습니다. 안전을 보증하는 결과는 아닙니다.';
    overlays();host.setAttribute('aria-busy','false');
  }
  function cancel() { generation.next(); clearTimeout(timer); }
  async function load() {
    cancel(); const token=generation.next(); ready=false; stage.hidden=true;
    photo.removeAttribute('src');mask.removeAttribute('src');onReady(false);
    const available=cell && !['pending','retake'].includes(cell.status);
    retry.disabled=!available;select.disabled=!available;
    if(!available) { status.textContent=cell?.status==='retake'?'사진 없음 · 재촬영 필요 예시입니다.':'점검 대기 · 아직 이미지가 없습니다.';host.setAttribute('aria-busy','false');return; }
    if(cell.model) { loadModel(token); return; }
    host.querySelector('.media-controls').hidden=false;
    host.querySelector('[data-highlight]').setAttribute('viewBox','0 0 640 512');
    photo.alt='실제 촬영 사진이 아닌 합성 열화상 예시';mask.alt='합성 예시 마스크 · AI 예측 및 정답 라벨 아님';
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
    setCell(next,list) {const nextKey=JSON.stringify([next?.cell_id,next?.status,next?.model,list]);if(nextKey===key)return;key=nextKey;cell=next;candidates=list;mode='normal';select.value=mode;load();},
    display(show,id) {showMask=show;highlighted=id;overlays();},
    close() {cancel();key='';ready=false;},
    ready:()=>ready
  };
}
