import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticAssets,loadGeneration} from '../web/detail-assets.mjs';
import {candidatesFor} from '../web/review.mjs';
test('photo and mask share coordinate dimensions; mask follows fixture boxes',()=>{
 const c=candidatesFor({cell_id:'C-4',candidate_count:4});const a=syntheticAssets(c);
 const photo=decodeURIComponent(a.photo.split(',')[1]),mask=decodeURIComponent(a.mask.split(',')[1]);
 for(const image of [photo,mask])assert.match(image,/viewBox="0 0 640 512"/);
 assert.match(photo,/NOT A REAL PHOTO/);assert.equal((mask.match(/<ellipse/g)||[]).length,4);
 assert.match(mask,/cx="92.5" cy="137.5"/);assert.doesNotMatch(mask,/<rect/);
 assert.doesNotMatch(decodeURIComponent(syntheticAssets([]).mask),/<ellipse/);
});
test('late load generations cannot update a newer selection',()=>{
 const g=loadGeneration();const first=g.next();assert.equal(g.current(first),true);
 const next=g.next();assert.equal(g.current(first),false);assert.equal(g.current(next),true);
 g.next();assert.equal(g.current(next),false);
});
