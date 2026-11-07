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
