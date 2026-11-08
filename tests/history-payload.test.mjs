import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';

test('history reads and writes omit image bytes while detail serves the exact saved snapshot',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'history-payload-'));
 const id='a'.repeat(32),secondId='b'.repeat(32);
 const bytes=Buffer.alloc(512*1024,42),overlay='data:image/png;base64,'+bytes.toString('base64');
 const cell={cell_id:'A-1',status:'check',confirmed_count:0,candidates:[{id:'A-1-h1',decision:'pending'}],model:{photo:'saved.jpg',regions:[],overlay}};
 const records=[{id,phase:'complete',targets:['A-1'],visited:['A-1'],cells:[cell],energy:{source:'dummy'}},
 {id:secondId,phase:'complete',targets:['A-1'],visited:['A-1'],cells:[{...cell,model:{...cell.model,overlay:'data:image/png;base64,AQID'}}]}];
 const file=path.join(dir,'history.json');await writeFile(file,JSON.stringify(records));
 const app=createApp({flightDir:dir,historyFile:file,basePath:'/i/demo',predictor:{predict:()=>{throw Error('must not re-analyze');}}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 try{
  const root='http://127.0.0.1:'+app.address().port+'/i/demo/';
  const url=root+'api/inspection-history';
  const text=await (await fetch(url)).text(),body=JSON.parse(text);
  assert.ok(Buffer.byteLength(text)<Buffer.byteLength(JSON.stringify({records}))*0.01);
  t.diagnostic('Synthetic response: '+Buffer.byteLength(JSON.stringify({records}))+' -> '+Buffer.byteLength(text)+' bytes');
  const imageUrl=new URL(body.records[0].cells[0].model.overlay,root);
  const image=await fetch(imageUrl);assert.equal(image.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(body.records[1].cells[0].model.overlay,root))).arrayBuffer()),Buffer.from([1,2,3]));
  assert.equal((await fetch(imageUrl,{method:'HEAD'})).headers.get('content-length'),String(bytes.length));
  assert.equal((await fetch(root+'api/inspection-history/'+id+'/B-2/overlay')).status,404);
  const write=async(method,payload)=>fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const reviewed=await (await write('PATCH',{id,cellId:'A-1',candidateId:'A-1-h1',decision:'approved'})).json();
  assert.equal(reviewed.records[0].cells[0].confirmed_count,1);
  assert.equal(reviewed.records[0].cells[0].model.overlay,body.records[0].cells[0].model.overlay);
  assert.equal(JSON.parse(await readFile(file,'utf8'))[0].cells[0].model.overlay,overlay);
  const deleted=await (await write('DELETE',{id:secondId})).json();
  assert.equal(deleted.records.length,1);assert.ok(!JSON.stringify(deleted).includes('base64'));
  assert.equal((await fetch(new URL(body.records[1].cells[0].model.overlay,root))).status,404);
 }finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
