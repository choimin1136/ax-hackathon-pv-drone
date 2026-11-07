import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleAnalysis} from '../web/analysis-example.mjs';
const cell={cell_id:'C-4',status:'check',candidate_count:4};
test('analysis failure returns matching independent bundled result',()=>{
 const live=exampleAnalysis(cell), backup=exampleAnalysis(cell,'fallback');
 assert.equal(live.state,'success');assert.equal(backup.state,'fallback');
 assert.equal(backup.result.source,'bundled-synthetic');assert.deepEqual(live.result.candidates,backup.result.candidates);
 backup.result.candidates[0].bbox[0]=999;
 assert.equal(exampleAnalysis(cell,'fallback').result.candidates[0].bbox[0],70);
});
test('missing, mismatched, and unavailable results never masquerade as zero detections',()=>{
 for(const c of [cell,{...cell,cell_id:'X-1'},{...cell,candidate_count:2}]) assert.equal(exampleAnalysis(c,c===cell?'missing':'fallback').result,null);
 for(const status of ['pending','retake'])assert.equal(exampleAnalysis({...cell,status},'fallback').state,'unavailable');
 const empty=exampleAnalysis({cell_id:'A-1',status:'no_candidate',candidate_count:0},'fallback');assert.equal(empty.state,'fallback');assert.deepEqual(empty.result.candidates,[]);
});
