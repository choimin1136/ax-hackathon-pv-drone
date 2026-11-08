import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerHistoryStore} from '../web/server-history-store.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=records=>({ok:true,json:async()=>({records})});
function setup(t,fetcher){
  const previous=globalThis.document;
  globalThis.document={baseURI:'http://localhost/'};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  t.mock.method(globalThis,'fetch',fetcher);
  return createServerHistoryStore(()=>{});
}

test('slow downloads and JSON decoding allow only one refresh; later refresh still works',async t=>{
  const download=deferred(),decode=deferred();let calls=0;
  const store=setup(t,()=>{calls++;return calls===1?download.promise:Promise.resolve(response([{id:'new'}]));});
  const first=store.refresh();
  await Promise.all(Array.from({length:10},()=>store.refresh()));
  assert.equal(calls,1);
  download.resolve({ok:true,json:()=>decode.promise});
  await Promise.resolve();await store.refresh();assert.equal(calls,1);
  decode.resolve({records:[{id:'old'}]});await first;
  assert.equal(store.list()[0].id,'old');
  await store.refresh();assert.equal(calls,2);assert.equal(store.list()[0].id,'new');
});

test('failed refresh releases the guard and preserves loaded records',async t=>{
  let calls=0;
  const store=setup(t,async()=>{if(++calls===2)throw Error('offline');return response([{id:'saved'}]);});
  await store.refresh();await store.refresh();
  assert.equal(store.error(),'offline');assert.equal(store.list()[0].id,'saved');
  await store.refresh();assert.equal(store.error(),'');assert.equal(calls,3);
});

for(const fails of [false,true])test(`stale read ${fails?'failure':'success'} cannot overwrite a completed deletion`,async t=>{
  const oldRead=deferred();let reads=0;
  const store=setup(t,async(url,options)=>{
    if(options?.method==='DELETE')return response([]);
    return ++reads===1?response([{id:'removed'}]):oldRead.promise;
  });
  await store.refresh();const pending=store.refresh();
  await store.remove('removed');
  if(fails)oldRead.reject(Error('stale error'));else oldRead.resolve(response([{id:'removed'}]));
  await pending;assert.deepEqual(store.list(),[]);assert.equal(store.error(),'');
});
