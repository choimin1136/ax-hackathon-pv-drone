import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFlightReview} from '../web/cell-review-status.mjs';
import {createMission,startMission,tickMission} from '../web/mission.mjs';
const counts=c=>({pending:c.candidate_count,approved:0,excluded:0});
test('reflight summary starts empty, counts completed targets, persists at completion and resets to full inspection',()=>{
 let state=startMission(createMission());for(let i=0;i<48;i++)state=tickMission(state);
 const flight={phase:'running',targets:['A-1','A-3'],index:0};
 assert.equal(summarizeFlightReview(state.cells,counts,flight).clear,0);
 assert.equal(summarizeFlightReview(state.cells,counts,flight).review,0);
 assert.equal(summarizeFlightReview(state.cells,counts,{...flight,index:1}).clear,1);
 assert.equal(summarizeFlightReview(state.cells,counts,{...flight,index:1}).review,0);
 for(const phase of ['paused','complete']){
 const result=summarizeFlightReview(state.cells,counts,{...flight,phase,index:2});assert.equal(result.clear,1);assert.equal(result.review,1);assert.equal(result.total,2);
 }
 const reset=summarizeFlightReview(state.cells,counts,{phase:'idle',targets:[],index:0});assert.equal(reset.clear,16);assert.equal(reset.review,8);
 assert.equal(state.cells.filter(c=>c.status==='no_candidate').length,16);
});
