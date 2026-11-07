import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInspectionHistory} from '../server/inspection-history.mjs';
import {createPredictionRecorder} from '../server/prediction-recorder.mjs';

test('selection flights archive all visited model results without a browser prediction request',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'selection-results-'));
 try{
  const file=path.join(dir,'live.jsonl'),history=createInspectionHistory({file:path.join(dir,'history.json'),flightDir:dir});
  const write=async(targets,visited)=>writeFile(file,[{type:'mission_start',cells:targets},...visited.map(cell_id=>({type:'frame',cell_id})),{type:'mission_end'}].map(JSON.stringify).join('\n'));
  const calls=[];const predictor={status:async()=>({configured:true}),predict:async id=>{calls.push(id);return {photo:id+'.jpg',is_hotspot:true,regions:[{bbox:[1,2,3,4],area_px:12}],image_size:[640,512]};}};
  const recorder=createPredictionRecorder({history,predictor});
  await write(['A-1','B-2','C-3'],['A-1','B-2']);
  await Promise.all([recorder.sync(),recorder.sync()]);
  const first=(await history.list())[0];
  assert.deepEqual(calls,['A-1','B-2']);
  assert.equal(first.cells.find(c=>c.cell_id==='B-2').model.photo,'B-2.jpg');
  assert.equal(first.cells.find(c=>c.cell_id==='C-3').model,undefined);
  await history.review(first.id,'A-1','A-1-h1','approved');
  await recorder.sync();assert.equal(calls.length,2);
  await write(['A-1'],['A-1']);await recorder.sync();
  assert.deepEqual(calls,['A-1','B-2','A-1']);
  const records=await history.list();assert.equal(records.length,2);
  assert.equal(records.find(r=>r.id===first.id).cells[0].confirmed_count,1);
  assert.equal(records.find(r=>r.id!==first.id).cells[0].model.photo,'A-1.jpg');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('failed inference is retried without overlapping requests or invented model results',async()=>{
 let clock=0,calls=0,saved=0;
 const history={list:async()=>[{id:'one',sourceFile:'live.jsonl',targets:['A-1'],visited:['A-1'],cells:[]}],predictionTarget:async()=>'one',savePrediction:async()=>saved++};
 const recorder=createPredictionRecorder({history,now:()=>clock,predictor:{predict:async()=>{calls++;return calls===1?{status:502}:{photo:'actual.jpg'};}}});
 await recorder.sync();await recorder.sync();assert.equal(calls,1);assert.equal(saved,0);
 clock=10001;await recorder.sync();assert.equal(calls,2);assert.equal(saved,1);
});

test('server background collector saves selected cells without any predict API call',async()=>{
 const {createApp}=await import('../server/index.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'selection-background-'));
 await writeFile(path.join(dir,'live.jsonl'),[{type:'mission_start',cells:['B-2','C-4']},{type:'frame',cell_id:'B-2'},{type:'frame',cell_id:'C-4'},{type:'mission_end'}].map(JSON.stringify).join('\n'));
 const app=createApp({flightDir:dir,predictor:{status:async()=>({configured:true}),predict:async id=>({photo:id+'.jpg',is_hotspot:false,regions:[],image_size:[640,512]})}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${app.address().port}`;
  let record;
  for(let i=0;i<20;i++){
   const {records}=await (await fetch(base+'/api/inspection-history')).json();record=records[0];
   if(record?.cells.find(c=>c.cell_id==='C-4')?.model)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(record.cells.find(c=>c.cell_id==='B-2').model.photo,'B-2.jpg');
  assert.equal(record.cells.find(c=>c.cell_id==='C-4').model.photo,'C-4.jpg');
  assert.equal(record.cells.find(c=>c.cell_id==='A-1').model,undefined);
 }finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
