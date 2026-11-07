import test from 'node:test';
import assert from 'node:assert/strict';
import {candidatesFor,setDecision,reviewSummary} from '../web/review.mjs';
test('candidate decisions replace each other without double counting or crossing cells',()=>{
  const cell={cell_id:'C-4',candidate_count:4};
  const id=candidatesFor(cell)[0].id;
  let reviews=setDecision({},cell,id,'approved');
  assert.deepEqual(reviewSummary(cell,reviews),{approved:1,excluded:0,pending:3});
  reviews=setDecision(reviews,cell,id,'excluded');
  assert.deepEqual(reviewSummary(cell,reviews),{approved:0,excluded:1,pending:3});
  assert.equal(reviewSummary({cell_id:'A-3',candidate_count:1},reviews).pending,1);
  reviews=setDecision(reviews,cell,id,'pending');
  assert.equal(reviewSummary(cell,reviews).pending,4);
  assert.equal(setDecision(reviews,cell,'invalid','approved'),reviews);
});
