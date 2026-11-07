import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryStore,snapshotCells} from '../web/inspection-history-store.mjs';
import {createFlightRecorder} from '../web/flight-recorder.mjs';
import {createMission,startMission,tickMission,pauseMission} from '../web/mission.mjs';
import {createReflight,startReflight,tickReflight} from '../web/reflight.mjs';
const setup=()=>{let value=null,n=0,time='2026-01-01T04:00:00Z';const storage={getItem:()=>value,setItem:(k,v)=>value=v};const store=createHistoryStore(storage,{now:()=>time,uid:()=>String(++n)});return {store,storage,setTime:v=>time=v,observe:createFlightRecorder(store)};};
const cells=s=>snapshotCells(s.cells,()=>[]);
test('one row per flight across cell events, pause/resume and different dates',()=>{
 const x=setup();let s=startMission(createMission()),f=createReflight();
 x.observe(s,f,cells(s),'demo');s=tickMission(s);x.observe(s,f,cells(s),'demo');
 s=pauseMission(s);x.observe(s,f,cells(s),'demo');s=startMission(s);
 for(let i=0;i<47;i++){s=tickMission(s);x.observe(s,f,cells(s),'demo');}
 assert.equal(x.store.list().length,1);assert.equal(x.store.list()[0].visited.length,24);
 x.setTime('2026-01-02T04:00:00Z');s=startMission(s);x.observe(s,f,cells(s),'demo');
 assert.equal(x.store.list().length,2);assert.notEqual(x.store.list()[0].startedAt,x.store.list()[1].startedAt);
 assert.equal(x.store.list()[0].cells[0].status,'no_candidate');
 assert.equal(createHistoryStore(x.storage).list()[1].phase,'interrupted');
});
test('reflight has its own row; reset keeps the completed flight',()=>{
 const x=setup();let s=startMission(createMission()),f=createReflight();x.observe(s,f,cells(s),'demo');
 for(let i=0;i<48;i++){s=tickMission(s);x.observe(s,f,cells(s),'demo');}
 f=startReflight(createReflight(['A-3']));x.observe(s,f,cells(s),'demo');
 for(let i=0;i<2;i++){f=tickReflight(f);x.observe(s,f,cells(s),'demo');}
 x.observe(createMission(),createReflight(),cells(createMission()),'demo');
 assert.deepEqual(x.store.list().map(r=>r.phase),['complete','complete']);
 assert.deepEqual(x.store.list()[1].visited,['A-3']);
});
test('archive review changes only the selected flight and survives reload',()=>{
 const x=setup(),data=cells(createMission());
 const a=x.store.begin({kind:'full',source:'demo',targets:['A-1'],cells:data});
 x.store.begin({kind:'full',source:'demo',targets:['A-1'],cells:data});
 x.store.review(a,'A-1',[{id:'A-1-h1',bbox:[1,2,3,4],area_px:12,decision:'approved'}]);
 const rows=createHistoryStore(x.storage).list();assert.equal(rows[0].cells[0].confirmed_count,1);assert.equal(rows[1].cells[0].confirmed_count,0);assert.equal(data[0].confirmed_count,0);
});
