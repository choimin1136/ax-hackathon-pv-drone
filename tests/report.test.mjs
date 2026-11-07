import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport,reportFile} from '../web/report.mjs';
import {createMission,startMission,tickMission} from '../web/mission.mjs';
import {DEFAULTS} from '../web/value.mjs';
test('report distinguishes partial/unapproved results and invalid estimates',()=>{
 const input={mission:createMission(),candidates:[],assumptions:DEFAULTS,generatedAt:'test'};
 assert.match(buildReport(input),/부분 결과/);assert.match(buildReport(input),/확인 후 계산/);
 assert.match(buildReport({...input,assumptions:{...DEFAULTS,price:NaN}}),/추정 계산 불가/);
});
test('report contains review decisions and snapshot estimates without executable input',()=>{
 let mission=startMission(createMission());for(let i=0;i<48;i++)mission=tickMission(mission);
 mission.cells=mission.cells.map(c=>c.cell_id==='A-3'?{...c,confirmed_count:1}:c);
 const candidates=[{cell_id:'A-3',id:'<script>alert(1)</script>',decision:'approved',area_px:180}];
 const html=buildReport({mission,candidates,assumptions:DEFAULTS,generatedAt:'test'});
 assert.match(html,/전체 점검 완료/);assert.match(html,/65,700/);assert.match(html,/승인 1개/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(reportFile(html),/<script>/);
 mission.cells[0].status='pending';assert.match(html,/전체 점검 완료/);
 assert.match(reportFile(html),/@media print/);assert.match(html,/합성 데이터/);
});
