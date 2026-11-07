import test from 'node:test';
import assert from 'node:assert/strict';
import {CELL_COLORS,selectionPanelColor} from '../web/panel-colors.mjs';
test('selection uses inspection status colors, never arrival alone as a clear result',()=>{
 for(const kind of ['outside','target','active'])assert.equal(selectionPanelColor({kind,live:true,result:{state:'ready',data:{is_hotspot:true}}}),CELL_COLORS.pending);
 for(const state of ['loading','fallback'])assert.equal(selectionPanelColor({kind:'done',live:true,result:{state},previousStatus:'no_candidate'}),CELL_COLORS.pending);
 assert.equal(selectionPanelColor({kind:'done',live:true,result:{state:'ready',data:{is_hotspot:true}}}),CELL_COLORS.check);
 assert.equal(selectionPanelColor({kind:'done',live:true,result:{state:'ready',data:{is_hotspot:false}}}),CELL_COLORS.no_candidate);
 assert.equal(selectionPanelColor({kind:'done',live:false,previousStatus:'check'}),CELL_COLORS.check);
});
