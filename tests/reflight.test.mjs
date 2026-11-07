import test from 'node:test';
import assert from 'node:assert/strict';
import {createReflight,startReflight,pauseReflight,tickReflight} from '../web/reflight.mjs';
test('visits only selected valid cells once in route order',()=>{
  const ids=['C-6','A-3','A-3','invalid'];
  let s=startReflight(createReflight(ids)); ids.push('B-2');
  const visited=[];
  for(let i=0;i<4;i++){s=tickReflight(s);if(s.activeId) visited.push(s.activeId);}
  assert.deepEqual(visited,['A-3','C-6']);
  assert.equal(s.phase,'complete');assert.equal(s.index,2);
  assert.equal(tickReflight(s),s);
});
test('pause freezes active capture and replay resets only reflight progress',()=>{
  let s=tickReflight(startReflight(createReflight(['C-6'])));
  s=pauseReflight(s);assert.equal(tickReflight(s),s);assert.equal(s.activeId,'C-6');
  s=tickReflight(startReflight(s));assert.equal(s.phase,'complete');
  s=startReflight(s);assert.equal(s.index,0);assert.equal(s.elapsed,0);assert.equal(s.activeId,null);assert.deepEqual(s.targets,['C-6']);
  const empty=createReflight();assert.equal(startReflight(empty),empty);
});
