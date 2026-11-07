import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRecord,DEFAULTS} from '../web/value.mjs';
const cell=(id,decisions)=>({cell_id:id,status:'check',confirmed_count:99,candidates:decisions.map(decision=>({decision}))});
const record={startedAt:'2026-01-01T15:00:00Z',targets:['A-3','B-2'],visited:['A-3'],cells:[cell('A-3',['pending','excluded']),cell('B-2',['approved'])]};
test('history analysis ignores stale counts and unvisited approvals; no approval means no estimates',()=>{
 const r=analyzeRecord(record,DEFAULTS);assert.equal(r.rows.length,0);assert.equal(r.ids.length,0);assert.equal(r.predicted,undefined);
});
test('approved record cells counted once; daily comparison is stable and review changes clear it',()=>{
 const r={...record,cells:[cell('A-3',['approved','approved']),cell('B-2',['approved'])]};
 const a=analyzeRecord(r,DEFAULTS);assert.deepEqual(a.ids,['A-3']);assert.equal(a.day,'2026-01-02');assert.equal(a.predicted,36);assert.ok(a.measured<a.predicted);assert.equal(a.difference,a.measured-a.predicted);assert.deepEqual(analyzeRecord(r,DEFAULTS),a);
 assert.equal(analyzeRecord({...r,cells:[cell('A-3',['excluded'])]},DEFAULTS).rows.length,0);
 assert.equal(analyzeRecord(undefined,DEFAULTS).ids.length,0);
});
