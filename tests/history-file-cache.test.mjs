import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHistoryFileCache} from '../server/history-file-cache.mjs';

test('unchanged large history is read once; callers cannot mutate cached decisions or image metadata',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'history-cache-')),file=path.join(dir,'history.json');
 try{
  const records=[{id:'saved',cells:[{model:{overlay:'x'.repeat(2*1024*1024),regions:[{bbox:[1,2,3,4]}]},candidates:[{decision:'pending'}]}]}];
  await writeFile(file,JSON.stringify(records));let reads=0;
  const cache=createHistoryFileCache(file,{read:async(...args)=>{reads++;return readFile(...args);}});
  const first=await cache.load();
  first[0].cells[0].candidates[0].decision='approved';
  first[0].cells[0].model.regions[0].bbox[0]=99;
  first[0].cells[0].model.overlay='changed';
  first.push({id:'not-saved'});
  for(let i=0;i<20;i++)assert.deepEqual(await cache.load(),records);
  assert.equal(reads,1);
  cache.invalidate();assert.deepEqual(await cache.load(),records);assert.equal(reads,2);
  t.diagnostic('21 unchanged reads: history file read/JSON parse occurs once');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('replacement, deletion, recreation and malformed files never return stale history',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'history-change-')),file=path.join(dir,'history.json');
 try{
  const cache=createHistoryFileCache(file);
  assert.deepEqual(await cache.load(),[]);
  await writeFile(file,'[{"id":"a"}]');assert.equal((await cache.load())[0].id,'a');
  await writeFile(file+'.new','[{"id":"b"}]');await rename(file+'.new',file);
  assert.equal((await cache.load())[0].id,'b');
  await writeFile(file,'broken');await assert.rejects(cache.load(),SyntaxError);
  await writeFile(file,'[]');assert.deepEqual(await cache.load(),[]);
  await rm(file);assert.deepEqual(await cache.load(),[]);
  await writeFile(file,'[{"id":"c"}]');assert.equal((await cache.load())[0].id,'c');
 }finally{await rm(dir,{recursive:true,force:true});}
});
