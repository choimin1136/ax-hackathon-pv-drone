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

test('reflight masks non-target and not-yet-visited cells, including legacy records',async()=>{
 const {flightRecordCells}=await import('../web/inspection-history-store.mjs');
 const x=setup();let state=startMission(createMission());for(let i=0;i<48;i++)state=tickMission(state);
 const snapshot=snapshotCells(state.cells,c=>c.candidate_count?[{id:c.cell_id+'-h1',bbox:[1,2,3,4],area_px:12,decision:'approved'}]:[]);
 let flight=startReflight(createReflight(['A-3','B-2']));
 x.observe(state,flight,snapshot,'demo');
 assert.ok(x.store.list()[0].cells.every(c=>c.status==='pending'&&c.candidates.length===0));
 for(let i=0;i<2;i++){flight=tickReflight(flight);x.observe(state,flight,snapshot,'demo');}
 const saved=x.store.list()[0];
 assert.equal(saved.cells.find(c=>c.cell_id==='A-3').candidate_count,1);
 for(const id of ['B-2','C-4','A-1']) {const c=saved.cells.find(c=>c.cell_id===id);assert.equal(c.status,'pending');assert.equal(c.candidate_count,0);assert.deepEqual(c.candidates,[]);}
 const legacy={kind:'selection',targets:['A-3','B-2'],visited:['A-3'],cells:snapshot};
 assert.deepEqual(flightRecordCells(legacy),saved.cells);
 assert.equal(snapshot.find(c=>c.cell_id==='C-4').status,'check');
 for(let i=0;i<2;i++){flight=tickReflight(flight);x.observe(state,flight,snapshot,'demo');}
 assert.equal(x.store.list()[0].cells.find(c=>c.cell_id==='B-2').status,'check');
 assert.equal(createHistoryStore(x.storage).list()[0].cells.find(c=>c.cell_id==='C-4').status,'pending');
});

test('dated recommendations use that records decisions and completed targets only',async()=>{
 const {recordRecommendations}=await import('../web/inspection-history-store.mjs');
 const record={targets:['A-3','B-2','C-4'],visited:['A-3','B-2'],cells:[
 {cell_id:'A-3',status:'check',candidates:[{decision:'excluded'}]},
 {cell_id:'B-2',status:'check',candidates:[{decision:'approved'}]},
 {cell_id:'C-4',status:'check',candidates:[{decision:'pending'}]}]};
 assert.deepEqual(recordRecommendations(record),['B-2']);
 const other=structuredClone(record);other.cells[0].candidates[0].decision='pending';other.cells[1].candidates[0].decision='excluded';
 assert.deepEqual(recordRecommendations(other),['A-3']);assert.deepEqual(recordRecommendations(record),['B-2']);
});
test('reflight from a historical source retains that source after current mission reset',()=>{
 const x=setup();let past=startMission(createMission());for(let i=0;i<48;i++)past=tickMission(past);
 const snapshot=cells(past),current=createMission();let flight=startReflight(createReflight(['A-3']));
 x.observe(current,flight,cells(current),'demo',snapshot);
 for(let i=0;i<2;i++){flight=tickReflight(flight);x.observe(current,flight,cells(current),'demo',snapshot);}
 assert.equal(x.store.list()[0].cells.find(c=>c.cell_id==='A-3').status,'check');
 assert.equal(current.cells.find(c=>c.cell_id==='A-3').status,'pending');
});
