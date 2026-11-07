import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInspectionHistory} from '../server/inspection-history.mjs';
import {createApp} from '../server/index.mjs';
test('server history survives restart, deduplicates readers and preserves per-candidate decisions',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'shared-history-'));
 try{
 const options={file:path.join(dir,'history.json'),flightDir:dir};
 await writeFile(path.join(dir,'live.jsonl'),[{type:'mission_start',cells:['A-3','B-2']},{type:'frame',cell_id:'A-3'},{type:'mission_end'}].map(JSON.stringify).join('\n'));
 const store=createInspectionHistory(options);const [r]=await store.list();assert.equal((await store.list()).length,1);assert.equal(r.cells.find(c=>c.cell_id==='B-2').candidates.length,0);
 await store.review(r.id,'A-3','A-3-h1','approved');
 const other=createInspectionHistory(options);assert.equal((await other.list())[0].cells.find(c=>c.cell_id==='A-3').confirmed_count,1);
 await other.review(r.id,'A-3','A-3-h1','excluded');assert.equal((await store.list())[0].cells.find(c=>c.cell_id==='A-3').confirmed_count,0);
 await assert.rejects(store.review(r.id,'B-2','B-2-h1','approved'));
 await assert.rejects(store.review(r.id,'A-3','A-3-h1','invalid'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('shared API returns saved reviews to a separate client and rejects invalid writes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'shared-api-'));
 await writeFile(path.join(dir,'flight.jsonl'),[{type:'mission_start',cells:['B-2']},{type:'frame',cell_id:'B-2'},{type:'mission_end'}].map(JSON.stringify).join('\n'));
 const app=createApp({flightDir:dir,basePath:'/i/demo'});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;
 try{
 const url=base+'/i/demo/api/inspection-history';const {records:[r]}=await (await fetch(url)).json();
 const patch=(candidateId,decision)=>fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id,cellId:'B-2',candidateId,decision})});
 assert.equal((await patch('B-2-h1','approved')).status,200);
 assert.equal((await patch('B-2-h2','excluded')).status,200);
 const other=await (await fetch(base+'/api/inspection-history')).json();
 assert.equal(other.records[0].cells.find(c=>c.cell_id==='B-2').confirmed_count,1);
 assert.equal(other.records[0].cells.find(c=>c.cell_id==='B-2').candidates[1].decision,'excluded');
 assert.equal((await patch('not-a-candidate','approved')).status,404);
 assert.equal((await patch('B-2-h1','invalid')).status,400);
 await writeFile(path.join(dir,'second.jsonl'),[{type:'mission_start',cells:['A-3']},{type:'frame',cell_id:'A-3'},{type:'mission_end'}].map(JSON.stringify).join('\n'));
 assert.equal((await (await fetch(url)).json()).records.length,2);
 const deletion=await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id})});
 assert.equal(deletion.status,200);assert.equal((await deletion.json()).records.length,1);
 assert.equal((await (await fetch(url)).json()).records.length,1);
 assert.equal((await patch('B-2-h1','approved')).status,404);
 const reopened=createInspectionHistory({file:path.join(dir,'inspection-history.json'),flightDir:dir});
 assert.equal((await reopened.list()).length,1);
 await writeFile(path.join(dir,'running.jsonl'),JSON.stringify({type:'mission_start',cells:['A-1']}));
 const running=(await reopened.list()).find(r=>r.phase==='running');
 await assert.rejects(reopened.remove(running.id),{status:409});
 }finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
