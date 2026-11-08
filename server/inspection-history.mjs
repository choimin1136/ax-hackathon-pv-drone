import {readFile,writeFile,mkdir,rename,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CELL_IDS,missionFromFlight} from '../web/mission.mjs';
import {candidatesFor} from '../web/review.mjs';
import {dummyEnergy} from '../web/energy-dummy.mjs';
import {createHistoryFileCache} from './history-file-cache.mjs';

// One server process owns this file. Writes are serialized and atomically replaced.
export function createInspectionHistory({file,flightDir}) {
  let queue=Promise.resolve();
  const run=task=>{const next=queue.then(task);queue=next.catch(()=>{});return next;};
  const fileCache=createHistoryFileCache(file);
  const load=()=>fileCache.load();
  async function save(records){
    try{await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(records),'utf8');await rename(file+'.tmp',file);}
    catch(error){fileCache.invalidate();throw error;}
    await fileCache.remember(records);
  }
  // Flight files already ingested as finished (complete, interrupted or deleted) are not read again until they change.
  const settled=new Map();
  async function ingest(records){
    let changed=false;
    // A new flight can replace live.jsonl before the old flight writes mission_end.
    // Only reconcile sources we can positively identify; I/O failures must not unlock active records.
    let names;try{names=await readdir(flightDir);}catch{return records;}
    const sourceIds=new Map();
    for(const name of names.filter(n=>/^[\w-]+\.jsonl$/.test(n))){
      let info;try{info=await stat(path.join(flightDir,name));}catch{continue;}
      const stamp=`${info.birthtimeMs}:${info.mtimeMs}:${info.size}`;
      if(settled.get(name)?.stamp===stamp&&records.some(r=>r.id===settled.get(name).id)){sourceIds.set(name,settled.get(name).id);continue;}
      let rows;try{rows=(await readFile(path.join(flightDir,name),'utf8')).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}catch{continue;}
      const start=rows.find(r=>r.type==='mission_start');if(!start)continue;
      const id=createHash('sha256').update(name+':'+info.birthtimeMs+':'+JSON.stringify(start)).digest('hex').slice(0,32);
      sourceIds.set(name,id);
      const existing=records.find(r=>r.id===id);if(existing?.deletedAt){settled.set(name,{stamp,id});continue;}
      if(existing && existing.sourceFile!==name){existing.sourceFile=name;changed=true;}
      if(existing?.phase==='complete'){settled.set(name,{stamp,id});continue;}
      const targets=[...new Set((start.cells??[]).filter(id=>CELL_IDS.includes(id)))];
      const visited=[...new Set(rows.filter(r=>r.type==='frame'&&targets.includes(r.cell_id)).map(r=>r.cell_id))];
      const end=rows.find(r=>r.type==='mission_end');
      const phase=end?'complete':Date.now()-info.mtimeMs>60000?'interrupted':'running';
      if(phase!=='running')settled.set(name,{stamp,id});
      if(existing&&existing.phase===phase&&existing.visited.join()===visited.join())continue;
      const cells=missionFromFlight(visited,null,!!end,!end).cells.map(c=>{
        const previous=existing?.cells.find(old=>old.cell_id===c.cell_id);
        if(previous?.model)return previous;
        const candidates=candidatesFor(c).map(p=>({...p,decision:previous?.candidates.find(old=>old.id===p.id)?.decision??'pending'}));
        return {...c,candidates,confirmed_count:candidates.filter(p=>p.decision==='approved').length};
      });
      const record={id,sourceFile:name,startedAt:info.birthtime.toISOString(),endedAt:end?info.mtime.toISOString():null,timeBasis:'server-file-created',kind:targets.length===24?'full':'selection',source:'server-flight',targets,visited,phase,cells,
        // Made-up daily power figures saved with the record so every inspection has a comparison to show.
        energy:dummyEnergy({startedAt:info.birthtime.toISOString(),visited})};
      if(existing)Object.assign(existing,record);else records.push(record);changed=true;
    }
    for(const record of records){
      if(record.deletedAt||record.source!=='server-flight'||!record.sourceFile||!['running','paused'].includes(record.phase))continue;
      const replaced=sourceIds.has(record.sourceFile)&&sourceIds.get(record.sourceFile)!==record.id;
      const removed=!names.includes(record.sourceFile);
      if(replaced||removed){record.phase='interrupted';changed=true;}
    }
    if(changed)await save(records);return records;
  }
  return {
    predictionTarget:cellId=>run(async()=>{
      const records=await ingest(await load());
      let info,start;
      try {
        info=await stat(path.join(flightDir,'live.jsonl'));
        start=(await readFile(path.join(flightDir,'live.jsonl'),'utf8')).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(r=>r.type==='mission_start');
      }catch{return null;}
      if(!start)return null;
      const id=createHash('sha256').update('live.jsonl:'+info.birthtimeMs+':'+JSON.stringify(start)).digest('hex').slice(0,32);
      return records.find(r=>r.id===id&&!r.deletedAt&&r.targets.includes(cellId)&&r.visited.includes(cellId))?.id??null;
    }),
    savePrediction:(id,cellId,result)=>run(async()=>{
      const records=await load(),record=records.find(r=>r.id===id&&!r.deletedAt);
      if(!record||!record.visited.includes(cellId)||!record.targets.includes(cellId)||result.status||!result.photo)return;
      const cell=record.cells.find(c=>c.cell_id===cellId);
      // First successful response is the historical snapshot. Repeated readers cannot overwrite reviews.
      if(!cell||cell.model)return;
      cell.model={photo:result.photo,probability:result.probability,calibrated:result.calibrated,
        image_size:result.image_size,regions:result.is_hotspot?result.regions:[],overlay:result.output??null};
      cell.status=result.is_hotspot?'check':'no_candidate';
      cell.candidates=candidatesFor(cell).map(c=>({...c,decision:'pending'}));
      cell.candidate_count=cell.candidates.length;cell.confirmed_count=0;
      await save(records);
    }),
    overlay:(id,cellId)=>run(async()=>{
      const record=(await load()).find(r=>r.id===id&&!r.deletedAt);
      if(!record?.visited.includes(cellId)||!record.targets.includes(cellId))return null;
      return record.cells.find(c=>c.cell_id===cellId)?.model?.overlay??null;
    }),
    list:()=>run(async()=>(await ingest(await load())).filter(r=>!r.deletedAt)),
    remove:id=>run(async()=>{
      const records=await ingest(await load()),record=records.find(r=>r.id===id&&!r.deletedAt);
      if(!record)throw Object.assign(Error('record not found'),{status:404});
      if(['running','paused'].includes(record.phase))throw Object.assign(Error('flight still running'),{status:409});
      // Keep a tombstone so the source flight cannot reappear on the next scan.
      record.deletedAt=new Date().toISOString();
      await save(records);return records.filter(r=>!r.deletedAt);
    }),
    review:(id,cellId,candidateId,decision)=>run(async()=>{
      if(!['approved','excluded','pending'].includes(decision))throw Object.assign(Error('invalid decision'),{status:400});
      const records=await ingest(await load()),record=records.find(r=>r.id===id);
      if(!record||record.deletedAt||!record.targets.includes(cellId)||!record.visited.includes(cellId))throw Object.assign(Error('record or visited cell not found'),{status:404});
      if(['running','paused'].includes(record.phase))throw Object.assign(Error('flight still running'),{status:409});
      const cell=record.cells.find(c=>c.cell_id===cellId),candidate=cell?.candidates.find(c=>c.id===candidateId);
      if(!candidate)throw Object.assign(Error('candidate not found'),{status:404});
      candidate.decision=decision;cell.confirmed_count=cell.candidates.filter(c=>c.decision==='approved').length;
      await save(records);return records.filter(r=>!r.deletedAt);
    })
  };
}
