import test from 'node:test';
import assert from 'node:assert/strict';
import {reportSnapshot,reportRecords} from '../web/report-selection.mjs';
import {buildReport} from '../web/report.mjs';
import {DEFAULTS} from '../web/value.mjs';
const record=(id,startedAt,decision)=>({id,startedAt,kind:'selection',phase:'complete',targets:['A-1','A-2'],visited:['A-1'],cells:[
 {cell_id:'A-1',status:'check',candidate_count:1,confirmed_count:99,candidates:[{id:'h1',decision,area_px:10}]},
 {cell_id:'A-2',status:'check',candidate_count:1,confirmed_count:1,candidates:[{id:'h2',decision:'approved'}]},
 {cell_id:'B-1',status:'check',candidate_count:1,confirmed_count:1,candidates:[{id:'h3',decision:'approved'}]}]});
test('selected historical flight controls report decisions, scope and dated analysis',()=>{
 const old=record('old','2026-01-01T01:00:00Z','excluded'),newer=record('new','2026-01-02T01:00:00Z','approved');
 const records=[old,newer];
 const input=reportSnapshot(old,DEFAULTS,records);
 assert.deepEqual(input.records,[old]);assert.equal(input.mission.index,1);assert.equal(input.mission.cells.length,2);
 assert.equal(input.mission.cells[1].status,'pending');assert.equal(input.mission.cells[1].confirmed_count,0);
 assert.equal(input.candidates.length,1);assert.equal(input.mission.cells[0].confirmed_count,0);
 const html=buildReport({...input,generatedAt:'test'});
 assert.match(html,/선택 점검 완료/);assert.match(html,/승인 0개 · 제외 1개/);assert.match(html,/1\/2구역/);
 assert.match(html,/승인한 후보가 있는 구역이 없습니다/);
 assert.equal(reportSnapshot(newer,DEFAULTS,records).mission.cells[0].confirmed_count,1);
 assert.equal(old.cells[0].confirmed_count,99);
 assert.deepEqual(reportRecords([...records,{...old,id:'deleted',deletedAt:'now'}]).map(r=>r.id),['new','old']);
});
