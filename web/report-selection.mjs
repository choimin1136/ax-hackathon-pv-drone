import {flightRecordCells,formatStarted} from './inspection-history-store.mjs';

export const reportRecords = records => records.filter(r=>!r.deletedAt).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||String(a.id).localeCompare(String(b.id)));
export const reportRecordLabel = record => `${formatStarted(record.startedAt)} · ${record.kind==='selection'?'선택 점검':'전체 점검'}`;

export function reportSnapshot(record, assumptions, records) {
  const targets=new Set(record.targets),visited=new Set(record.visited.filter(id=>targets.has(id)));
  const cells=flightRecordCells(record).filter(c=>targets.has(c.cell_id)).map(c=>{
    const candidates=visited.has(c.cell_id)?(c.candidates??[]):[];
    return {...c,status:visited.has(c.cell_id)?c.status:'pending',candidates,
      candidate_count:candidates.length,confirmed_count:candidates.filter(p=>p.decision==='approved').length};
  });
  return {mission:{phase:record.phase,index:visited.size,cells},
    candidates:cells.flatMap(c=>c.candidates.map(p=>({...p,cell_id:c.cell_id}))),assumptions,
    selectedRecord:record,
    // Trends are evaluated up to this flight, never against later inspections.
    records:records.filter(r=>!r.deletedAt&&Date.parse(r.startedAt)<=Date.parse(record.startedAt))};
}
