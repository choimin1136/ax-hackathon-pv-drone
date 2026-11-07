import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendation, selectedTargets } from '../web/reinspection.mjs';
import { createMission, startMission, tickMission } from '../web/mission.mjs';
import { reviewSummary, setDecision } from '../web/review.mjs';
test('recommendations follow review results without relabeling detections', () => {
  const cell={cell_id:'A-3',status:'caution',candidate_count:1};
  assert.equal(recommendation(cell,reviewSummary(cell,{})), '미확인 후보 있음');
  assert.equal(recommendation(cell,reviewSummary(cell,setDecision({},cell,'A-3-h1','excluded'))), '');
  assert.equal(recommendation(cell,reviewSummary(cell,setDecision({},cell,'A-3-h1','approved'))), '주의 구역 경과 관찰');
  assert.equal(recommendation({...cell,status:'check'},{pending:0,approved:1}), '');
  assert.equal(recommendation({...cell,status:'pending'},{pending:1}), '');
  assert.equal(recommendation({...cell,status:'retake'},{pending:0}), '사진 확보 필요');
});
test('completed scenario recommends 8 cells and filters pending/unknown targets in route order', () => {
  let state=startMission(createMission());
  for(let i=0;i<48;i++) state=tickMission(state);
  const ids=new Set(state.cells.filter(c=>recommendation(c,reviewSummary(c,{}))).map(c=>c.cell_id));
  assert.equal(ids.size,8);
  assert.deepEqual(selectedTargets(state.cells,ids),['A-3','B-5','B-2','C-4','C-6','D-5','D-3','D-1']);
  assert.deepEqual(selectedTargets(createMission().cells,new Set(['A-1','unknown'])),[]);
});

import { mergeFlightProgress, missionFromFlight } from '../web/mission.mjs';
test('repeated partial reflights retain all previously inspected cells and reviews', () => {
  let state=startMission(createMission());
  for(let i=0;i<48;i++)state=tickMission(state);
  state.cells.find(c=>c.cell_id==='B-2').confirmed_count=2;
  for(const visited of [['B-2'],['A-3','B-2'],['D-6']]) {
    state=mergeFlightProgress(state,missionFromFlight(visited,null,true,false,20));
    assert.equal(state.phase,'complete');
    assert.equal(selectedTargets(state.cells,new Set(state.cells.map(c=>c.cell_id))).length,24);
    assert.equal(state.cells.find(c=>c.cell_id==='B-2').confirmed_count,2);
  }
  const reset=mergeFlightProgress(createMission(),missionFromFlight(['A-1'],null,false,true,2));
  assert.deepEqual(selectedTargets(reset.cells,new Set(['A-1','B-2'])),['A-1']);
});
