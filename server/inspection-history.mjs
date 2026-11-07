import {readFile,writeFile,mkdir,rename,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CELL_IDS,missionFromFlight} from '../web/mission.mjs';
import {candidatesFor} from '../web/review.mjs';

// One server process owns this file. Writes are serialized and atomically replaced.
export function createInspectionHistory({file,flightDir}) {
  let queue=Promise.resolve();
  const run=task=>{const next=queue.then(task);queue=next.catch(()=>{});return next;};
  async function load(){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async function save(records){await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(records),'utf8');await rename(file+'.tmp',file);}
  async function ingest(records){
    let changed=false;
    for(const name of (await readdir(flightDir).catch(()=>[])).filter(n=>/^[\w-]+\.jsonl$/.test(n))){
      let rows,info;try{info=await stat(path.join(flightDir,name));rows=(await readFile(path.join(flightDir,name),'utf8')).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}catch{continue;}
      const start=rows.find(r=>r.type==='mission_start');if(!start)continue;
      const id=createHash('sha256').update(name+':'+info.birthtimeMs+':'+JSON.stringify(start)).digest('hex').slice(0,32);
      const existing=records.find(r=>r.id===id);if(existing?.phase==='complete')continue;
      const targets=[...new Set((start.cells??[]).filter(id=>CELL_IDS.includes(id)))];
      const visited=[...new Set(rows.filter(r=>r.type==='frame'&&targets.includes(r.cell_id)).map(r=>r.cell_id))];
      const end=rows.find(r=>r.type==='mission_end');
      const phase=end?'complete':Date.now()-info.mtimeMs>60000?'interrupted':'running';
      if(existing&&existing.phase===phase&&existing.visited.join()===visited.join())continue;
      const cells=missionFromFlight(visited,null,!!end,!end).cells.map(c=>{
        const previous=existing?.cells.find(old=>old.cell_id===c.cell_id);
        const candidates=candidatesFor(c).map(p=>({...p,decision:previous?.candidates.find(old=>old.id===p.id)?.decision??'pending'}));
        return {...c,candidates,confirmed_count:candidates.filter(p=>p.decision==='approved').length};
      });
      const record={id,startedAt:info.birthtime.toISOString(),endedAt:end?info.mtime.toISOString():null,timeBasis:'server-file-created',kind:targets.length===24?'full':'selection',source:'server-flight',targets,visited,phase,cells};
      if(existing)Object.assign(existing,record);else records.push(record);changed=true;
    }
    if(changed)await save(records);return records;
  }
  return {
    list:()=>run(async()=>ingest(await load())),
    review:(id,cellId,candidateId,decision)=>run(async()=>{
      if(!['approved','excluded','pending'].includes(decision))throw Object.assign(Error('invalid decision'),{status:400});
      const records=await ingest(await load()),record=records.find(r=>r.id===id);
      if(!record||!record.targets.includes(cellId)||!record.visited.includes(cellId))throw Object.assign(Error('record or visited cell not found'),{status:404});
      if(['running','paused'].includes(record.phase))throw Object.assign(Error('flight still running'),{status:409});
      const cell=record.cells.find(c=>c.cell_id===cellId),candidate=cell?.candidates.find(c=>c.id===candidateId);
      if(!candidate)throw Object.assign(Error('candidate not found'),{status:404});
      candidate.decision=decision;cell.confirmed_count=cell.candidates.filter(c=>c.decision==='approved').length;
      await save(records);return records;
    })
  };
}
