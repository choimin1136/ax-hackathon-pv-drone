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
 assert.doesNotMatch(reportFile(html),/<script>/);
 mission.cells[0].status='pending';assert.match(html,/전체 점검 완료/);
 assert.match(reportFile(html),/@media print/);assert.match(html,/합성 데이터/);
});
test('report summarises saved logs: repeated hotspots, priority cells and load failures',()=>{
 const base={mission:createMission(),candidates:[],assumptions:DEFAULTS,generatedAt:'test'};
 const record=(startedAt,hot)=>({kind:'full',phase:'complete',startedAt,visited:['A-1','<b>x</b>'],targets:['A-1','<b>x</b>'],cells:[{cell_id:'A-1',status:hot?'check':'no_candidate',candidates:[{id:'h1',area_px:40,score:0.9}]},{cell_id:'<b>x</b>',status:'check',candidates:[]}]});
 const html=buildReport({...base,records:[record('2026-11-07T01:00:00Z',true),record('2026-11-08T01:00:00Z',true)]});
 assert.match(html,/2건\(전체 2 · 선택 0\)/);assert.match(html,/A-1\(2회\)/);
 assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);assert.doesNotMatch(html,/<b>x<\/b>/);
 assert.match(buildReport({...base,records:[]}),/저장된 점검 기록이 없습니다/);
 assert.match(buildReport({...base,records:null}),/불러오지 못했습니다/);
});
