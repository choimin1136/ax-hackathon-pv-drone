import test from 'node:test';
import assert from 'node:assert/strict';
import {cellReviewStatus,summarizeReview} from '../web/cell-review-status.mjs';
import {reviewSummary,setDecision} from '../web/review.mjs';
const cell={cell_id:'C-4',status:'check',candidate_count:4,confirmed_count:0};
test('partial, approved, excluded, and undo change human status without changing detection',()=>{
 let reviews={};const status=()=>cellReviewStatus(cell,reviewSummary(cell,reviews));
 assert.equal(status().key,'review_pending');
 reviews=setDecision(reviews,cell,'C-4-h1','approved');assert.equal(status().key,'review_pending');
 for(let i=2;i<=4;i++) reviews=setDecision(reviews,cell,`C-4-h${i}`,'excluded');
 assert.equal(status().key,'approved');
 reviews=setDecision(reviews,cell,'C-4-h1','excluded');assert.equal(status().key,'excluded');
 assert.notEqual(status().label,'탐지된 후보 없음');assert.equal(cell.status,'check');
 reviews=setDecision(reviews,cell,'C-4-h1','pending');assert.equal(status().key,'review_pending');
 assert.equal(cellReviewStatus(cell,reviewSummary(cell,{})).key,'review_pending');
});
test('unavailable and candidate-free cells retain status; counts remain distinct',()=>{
 for(const status of ['pending','retake','no_candidate']) assert.equal(cellReviewStatus({...cell,status,candidate_count:0},{approved:0,excluded:0,pending:0}).key,status);
 const cells=[cell,{...cell,cell_id:'A-3'},{...cell,cell_id:'D-1'}];
 const counts={ 'C-4':{approved:0,excluded:4,pending:0},'A-3':{approved:1,excluded:3,pending:0},'D-1':{approved:1,excluded:0,pending:3}};
 assert.deepEqual(summarizeReview(cells,c=>counts[c.cell_id]),{unresolved:1,approved:1,excluded:1});
});
