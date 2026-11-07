import { CELL_IDS, STATUS } from './mission.mjs';
export const HISTORY_KEY = 'solar-loop.flight-rows.v1';
export const formatStarted = iso => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(iso));
export function snapshotCells(cells, getCandidates) {
  return CELL_IDS.map(id=>{
    const c=cells.find(c=>c.cell_id===id) ?? {status:'pending',candidate_count:0,confirmed_count:0};
    return {cell_id:id,status:STATUS[c.status]?c.status:'pending',candidate_count:c.candidate_count ?? 0,confirmed_count:c.confirmed_count ?? 0,
      candidates:(getCandidates({...c,cell_id:id})??[]).map(p=>({id:p.id,bbox:[...p.bbox],area_px:p.area_px,decision:p.decision??'pending'}))};
  });
}
export function recordRecommendations(record) {
  return record.cells.filter(c=>record.targets.includes(c.cell_id)&&record.visited.includes(c.cell_id)).filter(c=>c.status==='retake' || c.candidates.some(p=>p.decision!=='excluded') || (['check','caution'].includes(c.status)&&!c.candidates.length)).map(c=>c.cell_id);
}
// Old records may contain the previous full inspection. Expose only this flight's completed visits.
export function flightRecordCells(record) {
  if(record.kind !== 'selection') return structuredClone(record.cells);
  const visited=new Set(record.visited.filter(id=>record.targets.includes(id)));
  return record.cells.map(cell=>visited.has(cell.cell_id)?structuredClone(cell):{
    cell_id:cell.cell_id,status:'pending',candidate_count:0,confirmed_count:0,candidates:[]
  });
}
export function createHistoryStore(storage, {now=()=>new Date().toISOString(),uid=()=>crypto.randomUUID()}={}) {
  let records=[],error='';
  try {
    const data=JSON.parse(storage.getItem(HISTORY_KEY)??'[]');
    if(!Array.isArray(data)||data.some(r=>!r.id||!Number.isFinite(Date.parse(r.startedAt))||!Array.isArray(r.targets)||!Array.isArray(r.visited)||!Array.isArray(r.cells)||r.cells.some(c=>!CELL_IDS.includes(c.cell_id)||!STATUS[c.status]||!Array.isArray(c.candidates)))) throw Error('invalid');
    records=data.map(r=>({...r,phase:['running','paused'].includes(r.phase)?'interrupted':r.phase}));
  } catch {error='저장된 기록을 읽지 못했습니다. 기존 저장 데이터는 덮어쓰지 않습니다.';}
  const save=()=>{
    if(error.startsWith('저장된'))return;
    try {storage.setItem(HISTORY_KEY,JSON.stringify(records));error='';}
    catch {error='브라우저에 저장하지 못했습니다. 현재 기록은 새로고침하면 사라질 수 있습니다.';}
  };
  return {
    list:()=>records.map(record=>({...structuredClone(record),cells:flightRecordCells(record)})), error:()=>error,
    review(id, cellId, candidates) {
      const record=records.find(r=>r.id===id),cell=record?.cells.find(c=>c.cell_id===cellId);
      if(!cell || (record.kind==='selection' && (!record.visited.includes(cellId)||!record.targets.includes(cellId))))return;
      cell.candidates=structuredClone(candidates);
      cell.confirmed_count=candidates.filter(c=>c.decision==='approved').length;
      save();
    },
    begin({kind,source,targets,referenceId=null,cells}) {
      const record={id:uid(),startedAt:now(),endedAt:null,kind,source,targets:[...targets],referenceId,phase:'running',visited:[],cells:structuredClone(cells)};
      records.push(record);save();return record.id;
    },
    update(id,{phase,visited,cells}) {
      const record=records.find(r=>r.id===id);
      if(!record||['complete','interrupted'].includes(record.phase))return;
      record.phase=phase;record.visited=[...visited];record.cells=structuredClone(cells);
      if(['complete','interrupted'].includes(phase))record.endedAt=now();
      save();
    }
  };
}
