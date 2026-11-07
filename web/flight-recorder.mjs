import {flightRecordCells} from './inspection-history-store.mjs';
import {CELL_IDS} from './mission.mjs';
export function createFlightRecorder(store) {
  const tracks={full:{phase:'idle',id:null},selection:{phase:'idle',id:null}};
  return (state,flight,cells,source)=>{
    let changed=false;
    for(const [kind,next] of [['full',state],['selection',flight]]) {
      const track=tracks[kind];
      const targets=kind==='full'?CELL_IDS:next.targets;
      if(next.phase==='running'&&['idle','complete'].includes(track.phase)) {
        track.cells=structuredClone(cells);
        track.id=store.begin({kind,source,targets,cells:kind==='selection'?flightRecordCells({kind,targets,visited:[],cells}):cells});changed=true;
      }
      const saved=store.list().find(r=>r.id===track.id);
      if(saved&&!['complete','interrupted'].includes(saved.phase)) {
        const phase=next.phase==='idle'?'interrupted':next.phase;
        const visited=next.phase==='idle'?saved.visited:kind==='full'?cells.filter(c=>c.status!=='pending').map(c=>c.cell_id):targets.slice(0,next.index);
        const snapshot=next.phase==='idle'?saved.cells:kind==='selection'?flightRecordCells({kind,targets,visited,cells:track.cells}):cells;
        store.update(track.id,{phase,visited,cells:snapshot});changed=true;
      }
      if(next.phase==='idle')track.id=null;
      track.phase=next.phase;
    }
    return changed;
  };
}
