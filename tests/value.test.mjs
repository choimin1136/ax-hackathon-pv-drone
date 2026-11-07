import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,calculateValue} from '../web/value.mjs';
const cell={cell_id:'A-3',status:'caution',confirmed_count:1};
test('approved cells counted once with correct units and scenario ordering',()=>{
 const r=calculateValue([cell,{...cell,confirmed_count:3},{cell_id:'C-4',status:'check',confirmed_count:0}],DEFAULTS);
 assert.deepEqual(r.ids,['A-3']);assert.equal(r.cost,100000);
 assert.ok(Math.abs(r.scenarios[1].energy-657)<1e-9);
 assert.ok(Math.abs(r.scenarios[1].money-65700)<1e-9);
 assert.ok(Math.abs(r.scenarios[1].carbon-262.8)<1e-9);
 assert.ok(Math.abs(r.scenarios[1].payback-100000/65700)<1e-9);
 const two=calculateValue([cell,{...cell,cell_id:'B-5'}],DEFAULTS);
 assert.equal(two.scenarios[1].money,r.scenarios[1].money*2);
 assert.equal(two.scenarios[1].payback,r.scenarios[1].payback);
});
test('no approval excluded; zero returns and invalid assumptions handled',()=>{
 assert.equal(calculateValue([{...cell,confirmed_count:0},{...cell,status:'pending'}],DEFAULTS).ids.length,0);
 assert.equal(calculateValue([cell],{...DEFAULTS,price:0}).scenarios[1].payback,null);
 for(const a of [{...DEFAULTS,capacity:0},{...DEFAULTS,base:101},{...DEFAULTS,low:6},{...DEFAULTS,price:NaN},{...DEFAULTS,carbon:-1},{...DEFAULTS,capacity:1e308}]) assert.ok(calculateValue([cell],a).error);
 assert.equal(calculateValue([cell],{...DEFAULTS,repair:0}).scenarios[1].payback,0);
});
