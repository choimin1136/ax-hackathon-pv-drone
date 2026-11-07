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

test('model response is archived for its original flight, survives restart and preserves reviews',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'model-history-'));
 const options={file:path.join(dir,'history.json'),flightDir:dir};
 const flight=target=>[{type:'mission_start',cells:target},{type:'frame',cell_id:'A-1'}].map(JSON.stringify).join('\n');
 try {
  await writeFile(path.join(dir,'live.jsonl'),flight(['A-1','B-2']));
  const store=createInspectionHistory(options),id=await store.predictionTarget('A-1');
  assert.ok(id);assert.equal(await store.predictionTarget('B-2'),null);
  const result={photo:'thermal/first.jpg',is_hotspot:true,probability:.9,calibrated:false,image_size:[640,512],regions:[{bbox:[1,2,3,4],area_px:12,score:.8}],output:'data:image/png;base64,AA=='};
  await store.savePrediction(id,'A-1',result);
  // Replacing the live source while inference is pending cannot move the response to the new flight.
  await writeFile(path.join(dir,'live.jsonl'),flight(['A-1']));
  const second=await store.predictionTarget('A-1');assert.notEqual(second,id);
  await store.savePrediction(id,'A-1',{...result,photo:'wrong.jpg'});
  const records=await createInspectionHistory(options).list();
  const first=records.find(r=>r.id===id).cells.find(c=>c.cell_id==='A-1');
  assert.equal(first.model.photo,'thermal/first.jpg');assert.equal(first.model.overlay,result.output);
  assert.equal(first.candidates[0].area_px,12);assert.equal(first.candidates[0].decision,'pending');
  assert.equal(records.find(r=>r.id===second).cells.find(c=>c.cell_id==='A-1').model,undefined);
  await writeFile(path.join(dir,'live.jsonl'),flight(['A-1'])+'\n'+JSON.stringify({type:'mission_end'}));
  await store.savePrediction(second,'A-1',result);
  await store.review(second,'A-1','A-1-h1','approved');
  await store.savePrediction(second,'A-1',{...result,photo:'changed.jpg'});
  const saved=(await createInspectionHistory(options).list()).find(r=>r.id===second);
  assert.equal(saved.cells.find(c=>c.cell_id==='A-1').confirmed_count,1);
  assert.equal(saved.cells.find(c=>c.cell_id==='B-2').model,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('prediction API persists the same photo and regions returned to overview',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'prediction-history-api-'));
 await writeFile(path.join(dir,'live.jsonl'),[{type:'mission_start',cells:['A-1']},{type:'frame',cell_id:'A-1'},{type:'mission_end'}].map(JSON.stringify).join('\n'));
 const result={photo:'same.jpg',is_hotspot:false,regions:[],image_size:[640,512],probability:.02};
 const app=createApp({flightDir:dir,predictor:{predict:async()=>result}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(base+'/api/predict/A-1')).status,200);
  const {records}=await (await fetch(base+'/api/inspection-history')).json();
  assert.equal(records[0].cells[0].model.photo,'same.jpg');
  assert.equal(records[0].cells[0].status,'no_candidate');
  assert.equal(records[0].cells[0].candidates.length,0);
 }finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
